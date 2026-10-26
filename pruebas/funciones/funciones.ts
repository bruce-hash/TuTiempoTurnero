// Prueba de las Edge Functions REALES de Mercado Pago (Bloque 1) contra la base + PostgREST locales y un Mercado Pago
// falso (mp_falso.ts). Las funciones se importan tal cual (supabase/functions/*/index.ts) y se llaman directo, sin servidor.
// Corre dentro de pruebas/entorno_e2e.mjs (que da E2E_URL, E2E_PG y E2E_SECRET):
//   npm run test:funciones
import pg from "npm:pg@8.12.0";
import { mpFalso } from "./mp_falso.ts";

const BASE = Deno.env.get("E2E_URL")!, PG = Deno.env.get("E2E_PG")!, SECRET = Deno.env.get("E2E_SECRET")!;
if (!BASE || !PG || !SECRET) throw new Error("Correr dentro de pruebas/entorno_e2e.mjs (npm run test:funciones)");
let F = 0;
const ok = (name: string, cond: unknown, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// ---------- JWT de prueba (mismo secreto que PostgREST y e2e_server) ----------
const b64u = (b: Uint8Array | string) =>
  btoa(typeof b === "string" ? b : String.fromCharCode(...b)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function jwt(payload: Record<string, unknown>) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${h}.${p}.${b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${h}.${p}`))))}`;
}
async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- Base ----------
const db = new pg.Client({ connectionString: PG });
await db.connect();
async function q(sql: string, args: unknown[] = [], uid?: string) {
  await db.query("begin");
  try {
    if (uid) {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
      await db.query("set local role authenticated");
    }
    const r = await db.query(sql, args);
    await db.query("commit");
    return r.rows;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
const one = async (sql: string, args: unknown[] = [], uid?: string) => Object.values((await q(sql, args, uid))[0] ?? {})[0] as any;

// ---------- Mercado Pago falso y funciones ----------
const mp = mpFalso();
const SITE = "http://sitio.test", WHSEC = "whsec-prueba";
const SERVICE = await jwt({ role: "service_role" });
const rnd = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
const CRON = rnd(36), TOKENS_KEY = rnd(32), OWNER_MP = "9000";
for (const [k, v] of Object.entries({
  SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: await jwt({ role: "anon" }), MP_API_URL: mp.url,
  MP_WEBHOOK_SECRET: WHSEC, MP_CLIENT_ID: "cliente-tutiempo", MP_CLIENT_SECRET: "secreto-tutiempo", SITE_URL: SITE,
  CRON_SECRET: CRON, MP_TOKENS_KEY: TOKENS_KEY, MP_OWNER_USER_ID: OWNER_MP,
})) Deno.env.set(k, v);
const handlers: Record<string, (req: Request) => Promise<Response>> = {};
let loading = "";
(Deno as any).serve = (h: any) => { handlers[loading] = typeof h === "function" ? h : h.handler; return { finished: Promise.resolve(), shutdown: async () => {} }; };
for (const n of ["mp-oauth", "mp-create-preference", "mp-webhook", "mp-refunds", "dni-cleanup"]) {
  loading = n;
  await import(`../../supabase/functions/${n}/index.ts`);
}
const fn = (name: string, req: Request) => handlers[name](req);
const utilMod = await import("../../supabase/functions/_shared/util.ts");
async function body(res: Response) { return await res.json().catch(() => ({})); }

// sinReqId: el aviso llega sin x-request-id. completa: se firma con la plantilla entera aunque falte el encabezado.
async function webhook(pid: number, acc: number | null, payId: string, { firma = true, sinReqId = false, completa = false } = {}) {
  const ts = String(Date.now()), reqId = crypto.randomUUID();
  const texto = `id:${payId.toLowerCase()};` + (sinReqId && !completa ? "" : `request-id:${sinReqId ? "" : reqId};`) + `ts:${ts};`;
  const v1 = firma ? await hmacHex(WHSEC, texto) : "0".repeat(64);
  const u = `https://fn.test/functions/v1/mp-webhook?provider=${pid}${acc ? `&account=${acc}` : ""}&data.id=${payId}&type=payment`;
  const headers: Record<string, string> = { "x-signature": `ts=${ts},v1=${v1}`, "Content-Type": "application/json" };
  if (!sinReqId) headers["x-request-id"] = reqId;
  return fn("mp-webhook", new Request(u, { method: "POST", headers, body: JSON.stringify({ type: "payment", data: { id: payId } }) }));
}
const evento = async (payId: string, reason: string) =>
  Number(await one("select count(*) from mp_webhook_events where mp_payment_id = $1 and reason = $2", [payId, reason]));
const refundsRun = async (key = CRON) => fn("mp-refunds", new Request("https://fn.test/functions/v1/mp-refunds", { method: "POST", headers: { Authorization: `Bearer ${key}` } }));
async function preference(uid: string, ids: number[]) {
  return fn("mp-create-preference", new Request("https://fn.test/functions/v1/mp-create-preference", {
    method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: uid, role: "authenticated" })}`, Origin: SITE, "Content-Type": "application/json" },
    body: JSON.stringify({ booking_ids: ids }) }));
}
async function oauth(uid: string, code: string) {
  const r = await fn("mp-oauth", new Request("https://fn.test/functions/v1/mp-oauth", {
    method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: uid, role: "authenticated" })}`, Origin: SITE } }));
  const state = new URL((await body(r)).url).searchParams.get("state");
  return fn("mp-oauth", new Request(`https://fn.test/functions/v1/mp-oauth?code=${code}&state=${state}`));
}

// ---------- Datos: prestador, cliente, servicio de $10.000 (seña $5.000 + comisión $1.000) ----------
const owner = crypto.randomUUID(), cli = crypto.randomUUID();
await q("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'prov@fn.test', '{\"full_name\":\"Prov Fn\"}'), ($2, 'ana@fn.test', '{\"full_name\":\"Ana Fn\"}')", [owner, cli]);
const pid = Number(await one("select register_provider('Prov Funciones', 'Calle 1', array['b'], '2284 1', '30111555')", [], owner));
await q("update providers set status = 'active' where id = $1", [pid]);
await q("update provider_settings set online = true, notice_min = 0, deposit_pct = 50, pay_mode = 'deposit' where provider_id = $1", [pid]);
await q("delete from provider_hours where provider_id = $1", [pid]);
await q("insert into provider_hours select $1, g, 1, '08:00', '21:00' from generate_series(0, 6) g", [pid]);
await q("update app_settings set commission_pct = 10");
const sv = Number(await one("insert into services (provider_id, category_id, name, duration_min, price) values ($1, 'b', 'Corte', 30, 10000) returning id", [pid]));
let slotN = 0;
async function book(): Promise<number[]> {
  const n = slotN++;
  const day = new Date(Date.now() + (2 + Math.floor(n / 12)) * 864e5).toISOString().slice(0, 10);
  const start = `${day}T${String(8 + (n % 12)).padStart(2, "0")}:00:00-03:00`;
  const r = await one("select book_slot($1, $2)", [sv, start], cli);
  return r.booking_ids.map(Number);
}
// cuenta de MP del prestador, con la llave descifrada en `token` (la base solo guarda el texto cifrado)
const acc = async (user: string) => {
  const row = (await q("select id, provider_id, status, access_token, mp_user_id, last_error, refreshed_at, expires_at from mp_accounts where provider_id = $1 and mp_user_id = $2", [pid, user]))[0];
  if (row) row.token = row.access_token ? await utilMod.decryptToken(row.access_token, Number(row.provider_id), row.mp_user_id, "access_token").catch(() => null) : null;
  return row;
};
const st = async (id: number) => await one("select status from bookings where id = $1", [id]);
const refundRow = async (bid: number) => (await q("select id, status, attempts, last_error, mp_refund_id, mp_account_id, next_attempt_at, mp_payment_id from refunds where booking_id = $1 order by id desc", [bid]))[0];

// ---------- 1. Conectar con OAuth: la llave queda en mp_accounts ----------
mp.codigo("c-A", "1001");
let r = await oauth(owner, "c-A");
ok("mp-oauth: vuelve al sitio con mp_connected=1", r.status === 302 && r.headers.get("location") === `${SITE}/?mp_connected=1`, `${r.status} ${r.headers.get("location")}`);
const A = await acc("1001");
ok("mp-oauth: cuenta 1001 activa con su llave, cifrada", A?.status === "active" && /^tok-1001-/.test(A.token) && /^v1:/.test(A.access_token)
   && !A.access_token.includes("tok-1001"));
ok("mp-oauth: provider_private.mp_connected", (await one("select mp_connected from provider_private where provider_id = $1", [pid])) === true);
r = await fn("mp-oauth", new Request(`https://fn.test/functions/v1/mp-oauth?code=c-A&state=otro`));
ok("mp-oauth: un state inválido no conecta nada", r.headers.get("location") === `${SITE}/?mp_connected=0`);

// ---------- 2. Crear el cobro con la cuenta activa ----------
const b1 = await book();
r = await preference(cli, b1);
const pref = mp.preferencias.at(-1)!;
ok("mp-create-preference: cobra con la llave de la cuenta activa", r.status === 200 && pref?.llave === A.token, String(r.status));
ok("mp-create-preference: el aviso dice prestador y cuenta", pref?.body.notification_url === `${BASE}/functions/v1/mp-webhook?provider=${pid}&account=${A.id}`, pref?.body.notification_url);
ok("mp-create-preference: monto y comisión salen de la base", pref?.body.items[0].unit_price === 6000 && pref?.body.marketplace_fee === 1000);

// ---------- 3. Webhook: pago aprobado ----------
mp.pago({ id: "9001", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b1.join(",") });
r = await webhook(pid, A.id, "9001");
ok("mp-webhook: pago aprobado → turno confirmado", r.status === 200 && (await st(b1[0])) === "confirmed", String(r.status));
const p1 = (await q("select mp_account_id, fee_mp, fee_expected, outcome, collector_id, mp_responses from payments where mp_payment_id = '9001'"))[0];
ok("mp-webhook: el pago queda con la cuenta que cobró y la comisión que informó MP", p1 && Number(p1.mp_account_id) === Number(A.id) && p1.fee_mp === 1000 && p1.outcome === "confirmed" && p1.collector_id === "1001");
const guardado = JSON.stringify(p1?.mp_responses ?? []);
ok("3/11) se guarda solo la lista de campos permitidos: nada de la tarjeta ni del comprador", p1?.mp_responses.length === 1 && guardado.includes("fee_details")
   && !["450995", "3704", "30111222", "ANA LOPEZ", "Ana López", "ana@test.ar", "200.45.1.2", "2284 555666"].some((x) => guardado.includes(x))
   && !["payer", "additional_info", "card"].some((k) => k in p1.mp_responses[0].body));
r = await webhook(pid, A.id, "9001");
ok("mp-webhook: mismo aviso dos veces → 200 y nada nuevo", r.status === 200 && (await body(r)).result?.status === "already_processed"
   && Number(await one("select count(*) from payments where mp_payment_id = '9001'")) === 1);
r = await webhook(pid, A.id, "9001", { firma: false });
ok("mp-webhook: firma inválida → 401", r.status === 401);

// ---------- 4. b) Comisión que informa Mercado Pago ----------
const b2 = await book();
mp.pago({ id: "9002", collector: "1001", status: "approved", amount: 6000, fee: 500, ref: b2.join(",") });
await webhook(pid, A.id, "9002");
ok("b) comisión distinta → pago en revisión (fee_mismatch), turno confirmado",
   (await st(b2[0])) === "confirmed" && JSON.stringify(await one("select review_reasons from payments where mp_payment_id = '9002'")) === '["fee_mismatch"]');
const b3 = await book();
mp.pago({ id: "9003", collector: "1001", status: "approved", amount: 6000, fee: null, ref: b3.join(",") });
await webhook(pid, A.id, "9003");
ok("b) sin application_fee → pago en revisión (fee_missing)", JSON.stringify(await one("select review_reasons from payments where mp_payment_id = '9003'")) === '["fee_missing"]');

// ---------- 5. H23: desconectar ----------
const h1 = await book();
await preference(cli, h1);                                   // el cliente ya está pagando
const h2 = await book();
await q("update bookings set mp_preference_id = 'pref-manual' where id = $1", [h2[0]]);
const s = await one("select mp_disconnect()", [], owner);
ok("H23: desconectar → no puede cobrar", s.can_charge === false && (await acc("1001")).status === "refunds_only");
r = await preference(cli, h2);
ok("H23: mp-create-preference ya no crea cobros con la cuenta desconectada", r.status === 409 && (await body(r)).error === "provider_mp_not_connected");
mp.pago({ id: "9004", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: h1.join(",") });
r = await webhook(pid, A.id, "9004");
ok("H23: el hold que ya estaba pagando se paga después → confirmado con la cuenta vieja", (await st(h1[0])) === "confirmed"
   && Number(await one("select mp_account_id from payments where mp_payment_id = '9004'")) === Number(A.id));

// ---------- 6. Devolución después de desconectar: con la llave guardada ----------
await one("select cancel_by_provider($1)", [b1[0]], owner);
r = await refundsRun();
let dv = mp.devoluciones.at(-1);
ok("H23: cancelar después de desconectar → mp-refunds devuelve con la llave guardada", r.status === 200 && dv?.pago === "9001" && dv.monto === 6000 && dv.llave === A.token);
let rf = await refundRow(b1[0]);
ok("mp-refunds: la devolución queda hecha, con el id de MP y un intento", rf?.status === "done" && rf.mp_refund_id === dv?.id && rf.attempts === 1
   && Number(await one("select refund_pending from bookings where id = $1", [b1[0]])) === 0);
ok("mp-refunds: la clave de idempotencia es la de la devolución", dv?.clave === `refund-${rf?.id}`);

// ---------- 7. Reconectar con OTRA cuenta: no pisa la anterior ----------
mp.codigo("c-B", "1002");
await oauth(owner, "c-B");
const B = await acc("1002");
ok("reconectar con otra cuenta: 1002 activa y 1001 sigue con su llave (solo devoluciones)", B?.status === "active"
   && (await acc("1001")).status === "refunds_only" && (await acc("1001")).token === A.token);
await one("select cancel_by_provider($1)", [h1[0]], owner);
await refundsRun();
dv = mp.devoluciones.at(-1);
ok("devolver un pago de la cuenta vieja usa la llave de la cuenta vieja", dv?.pago === "9004" && dv.llave === A.token);
const b4 = await book();
await preference(cli, b4);
ok("los cobros nuevos salen con la cuenta nueva", mp.preferencias.at(-1)?.llave === B.token
   && mp.preferencias.at(-1)?.body.notification_url.endsWith(`account=${B.id}`));
mp.pago({ id: "9005", collector: "1002", status: "approved", amount: 6000, fee: 1000, ref: b4.join(",") });
await webhook(pid, B.id, "9005");
await one("select cancel_by_provider($1)", [b4[0]], owner);
await refundsRun();
ok("…y sus devoluciones con la llave nueva", mp.devoluciones.at(-1)?.pago === "9005" && mp.devoluciones.at(-1)?.llave === B.token);

// ---------- 8. Aviso viejo sin la cuenta: prueba con las cuentas del prestador ----------
const b5 = await book();
mp.pago({ id: "9006", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b5.join(",") });
r = await webhook(pid, null, "9006");
ok("aviso sin cuenta: lo encuentra con la cuenta vieja y lo confirma", r.status === 200 && (await st(b5[0])) === "confirmed"
   && Number(await one("select mp_account_id from payments where mp_payment_id = '9006'")) === Number(A.id));
r = await webhook(pid, null, "9999");
ok("aviso de un pago que no existe en ninguna cuenta: 200 sin hacer nada", r.status === 200 && (await body(r)).error === "payment_not_found");
ok("2) …pero queda el rastro en mp_webhook_events", (await evento("9999", "payment_not_found")) === 1);
r = await webhook(999999, null, "9998");
ok("2) aviso de un prestador sin cuentas: 200 y queda el rastro (unknown_provider)", r.status === 200 && (await evento("9998", "unknown_provider")) === 1);

// ---------- 9. Reconectar la MISMA cuenta: actualiza esa llave ----------
mp.codigo("c-A2", "1001");
await oauth(owner, "c-A2");
const A2 = await acc("1001");
ok("reconectar la misma cuenta: misma fila, llave nueva, activa; la otra queda para devoluciones",
   Number(A2.id) === Number(A.id) && A2.status === "active" && A2.token !== A.token && (await acc("1002")).status === "refunds_only");
await one("select cancel_by_provider($1)", [b5[0]], owner);
await refundsRun();
ok("las devoluciones de esa cuenta usan la llave nueva", mp.devoluciones.at(-1)?.pago === "9006" && mp.devoluciones.at(-1)?.llave === A2.token);

// ---------- 10. D19: devolución que falla y se reintenta ----------
const b6 = await book();
mp.pago({ id: "9007", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b6.join(",") });
await webhook(pid, A.id, "9007");
await one("select cancel_by_provider($1)", [b6[0]], owner);
mp.fallas.push({ status: 400, message: "insufficient_amount" });
const nDev = mp.devoluciones.length;
await refundsRun();
rf = await refundRow(b6[0]);
const mins = (new Date(rf.next_attempt_at).getTime() - Date.now()) / 60000;
ok("D19: falla → queda reintentando, con el error de MP y el próximo intento en 10 min",
   rf.status === "pending" && rf.attempts === 1 && rf.last_error === "400 insufficient_amount" && mins > 8 && mins <= 10, JSON.stringify(rf));
await refundsRun();
ok("D19: antes de tiempo no se reintenta", (await refundRow(b6[0])).attempts === 1 && mp.devoluciones.length === nDev);
await q("update refunds set next_attempt_at = now() where id = $1", [rf.id]);
await refundsRun();
rf = await refundRow(b6[0]);
ok("D19: en el próximo intento sale bien", rf.status === "done" && rf.attempts === 2 && mp.devoluciones.length === nDev + 1);

// ---------- 11. e) Turno viejo con mp_payment_id y sin payment_id ----------
const bl = Number(await one(`insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, paid_mp, app_fee, mp_payment_id)
  values ($1, $2, $3, 'Ana Fn', 'Corte', 'app', 'confirmed', now() + interval '20 days', now() + interval '20 days 30 minutes', 10000, 5000, 1000, 5000, 1000, '8001') returning id`, [pid, sv, cli]));
mp.pago({ id: "8001", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: String(bl) });
await one("select cancel_by_provider($1)", [bl], owner);
await refundsRun();
ok("e) turno viejo: mp-refunds devuelve con su mp_payment_id", mp.devoluciones.at(-1)?.pago === "8001" && (await refundRow(bl)).status === "done");

// ---------- 12. D17 / D18: cambios de estado informados por Mercado Pago ----------
const b7 = await book();
mp.pago({ id: "9008", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b7.join(",") });
await webhook(pid, A.id, "9008");
Object.assign(mp.pagos.get("9008")!, { status: "refunded", refunded: 6000, detail: "refunded" });
r = await webhook(pid, A.id, "9008");
ok("D17: devuelto desde MP → turno cancelled_refunded y aviso al prestador", r.status === 200 && (await st(b7[0])) === "cancelled_refunded"
   && Number(await one("select count(*) from provider_notices where provider_id = $1 and kind = 'mp_refunded' and ref = '9008'", [pid])) === 1);
const b8 = await book();
mp.pago({ id: "9009", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b8.join(",") });
await webhook(pid, A.id, "9009");
Object.assign(mp.pagos.get("9009")!, { status: "charged_back", detail: "settled" });
await webhook(pid, A.id, "9009");
ok("D18: contracargo → turno cancelado y pago en revisión", (await st(b8[0])) === "cancelled_refunded"
   && (await one("select mp_status from payments where mp_payment_id = '9009'")) === "charged_back");
const b9 = await book();
mp.pago({ id: "9010", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b9.join(",") });
await webhook(pid, A.id, "9010");
Object.assign(mp.pagos.get("9010")!, { status: "in_mediation" });
await webhook(pid, A.id, "9010");
ok("D18: reclamo → el turno sigue y el pago queda en revisión", (await st(b9[0])) === "confirmed"
   && (await one("select outcome from payments where mp_payment_id = '9010'")) === "review");
const b10 = await book();
mp.pago({ id: "9011", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: b10.join(","), refunded: 2000, detail: "partially_refunded" });
await webhook(pid, A.id, "9011");
ok("D17: devolución parcial que no hizo la app → revisión", JSON.stringify(await one("select review_reasons from payments where mp_payment_id = '9011'")) === '["partial_refund_mismatch"]');

// ---------- 12b. Cobrador equivocado, moneda, firma y errores al guardar cambios ----------
const bw = await book();
mp.pago({ id: "9020", collector: "1001", informa: "5555", status: "approved", amount: 6000, fee: 1000, ref: bw.join(",") });
r = await webhook(pid, A.id, "9020");
const pw = (await q("select outcome, review_reasons, collector_id, mp_account_id from payments where mp_payment_id = '9020'"))[0];
ok("1) cobrador equivocado: el webhook no confirma el turno", r.status === 200 && (await body(r)).error === "wrong_collector" && (await st(bw[0])) === "hold");
ok("1) …el pago queda en 'Para revisar' (no como bueno) y con el collector que informó MP", pw?.outcome === "review"
   && JSON.stringify(pw.review_reasons) === '["wrong_collector"]' && pw.collector_id === "5555" && pw.mp_account_id === null
   && Number(await one("select count(*) from payment_bookings where payment_id = (select id from payments where mp_payment_id = '9020')")) === 0);
ok("1) …y queda el rastro en mp_webhook_events", (await evento("9020", "wrong_collector")) === 1);
r = await webhook(pid, A.id, "9020");
ok("1) el mismo aviso otra vez no confirma nada", (await st(bw[0])) === "hold" && Number(await one("select count(*) from payments where mp_payment_id = '9020'")) === 1);
// una cuenta vieja de solo devoluciones sin mp_user_id (las activas ya no pueden: CHECK del Bloque 2a)
mp.cuentas.set("tok-sin-id", "1001");
const sinId = Number(await one("insert into mp_accounts (provider_id, mp_user_id, status, access_token) values ($1, null, 'refunds_only', $2) returning id",
  [pid, await utilMod.encryptToken("tok-sin-id", pid, null, "access_token")]));
const bn = await book();
mp.pago({ id: "9021", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: bn.join(",") });
await webhook(pid, sinId, "9021");
ok("2) cuenta sin mp_user_id: no se saltea el control, se trata como cobrador equivocado", (await st(bn[0])) === "hold"
   && (await evento("9021", "wrong_collector")) === 1 && (await one("select outcome from payments where mp_payment_id = '9021'")) === "review");
const bu = await book();
mp.pago({ id: "9022", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: bu.join(","), currency: "USD" });
r = await webhook(pid, A.id, "9022");
ok("2) moneda distinta de ARS: no confirma y queda el rastro", r.status === 200 && (await st(bu[0])) === "hold" && (await evento("9022", "bad_currency")) === 1);
const bs = await book();
mp.pago({ id: "9023", collector: "1001", status: "approved", amount: 6000, fee: 1000, ref: bs.join(",") });
r = await webhook(pid, A.id, "9023", { sinReqId: true, completa: true });
ok("4) sin x-request-id, firmado con la plantilla entera: rechazado", r.status === 401 && (await st(bs[0])) === "hold");
r = await webhook(pid, A.id, "9023", { sinReqId: true });
ok("4) sin x-request-id, firmado sin esa parte (como dice Mercado Pago): aceptado", r.status === 200 && (await st(bs[0])) === "confirmed");
await q("revoke execute on function public.payment_mp_update(text, text, int, text, jsonb, bigint) from service_role");
Object.assign(mp.pagos.get("9023")!, { status: "refunded", refunded: 6000 });
r = await webhook(pid, A.id, "9023");
await q("grant execute on function public.payment_mp_update(text, text, int, text, jsonb, bigint) to service_role");
ok("8) si falla guardar un cambio de estado, 500 aunque el pago esté registrado (Mercado Pago reintenta)", r.status === 500 && (await st(bs[0])) === "confirmed");
r = await webhook(pid, A.id, "9023");
ok("8) …y el reintento lo procesa", r.status === 200 && (await st(bs[0])) === "cancelled_refunded");

// ---------- 13. Llaves que vencen ----------
const dbfn = utilMod.admin();
await q("update mp_accounts set expires_at = now() + interval '5 days', refreshing_until = null where id = $1", [A.id]);
let antes0 = (await acc("1001")).token;
const pedidos0 = mp.refrescos_pedidos.length;
mp.demorarRefresco(300);
const accRow = await utilMod.accountById(dbfn, Number(A.id));
const [t1, t2] = await Promise.all([utilMod.accountToken(dbfn, accRow), utilMod.accountToken(dbfn, accRow)]);
mp.demorarRefresco(0);
const Ar = await acc("1001");
ok("1·R) dos renovaciones al mismo tiempo: se pide una sola a Mercado Pago y la cuenta queda activa, sin error",
   mp.refrescos_pedidos.length === pedidos0 + 1 && Ar.status === "active" && !Ar.last_error && Ar.token !== antes0 && !!t1 && !!t2);
await q("update mp_accounts set expires_at = now() + interval '5 days', refreshing_until = null where id = $1", [A.id]);
mp.fallarRefrescoTras(async () => {
  // mientras tanto, otro proceso ya la renovó (por ejemplo, con la reserva vencida)
  await q("update mp_accounts set access_token = $2, refresh_token = $3, expires_at = now() + interval '170 days' where id = $1",
    [A.id, await utilMod.encryptToken("tok-de-otro", pid, "1001", "access_token"), await utilMod.encryptToken("ref-de-otro", pid, "1001", "refresh_token")]);
});
const t3 = await utilMod.accountToken(dbfn, await utilMod.accountById(dbfn, Number(A.id)));
const Ao = await acc("1001");
ok("1·R) si la renovación falla pero otro ya renovó, usa la llave nueva y no marca error", t3 === "tok-de-otro" && Ao.status === "active" && !Ao.last_error);
mp.codigo("c-A3", "1001");
await oauth(owner, "c-A3");   // vuelve a una llave que el Mercado Pago falso conoce
await q("update mp_accounts set expires_at = now() + interval '5 days' where id = $1", [A.id]);
const antes = (await acc("1001")).token;
await refundsRun();
ok("mp-refunds renueva la llave que vence en menos de 15 días", (await acc("1001")).token !== antes && (await acc("1001")).refreshed_at);
await q("update mp_accounts set expires_at = now() + interval '5 days' where id = $1", [B.id]);
const antesB = (await acc("1002")).token;
await refundsRun();
ok("…también las de solo devoluciones", (await acc("1002")).token !== antesB);
mp.romperRefresco(true);
await q("update mp_accounts set expires_at = now() - interval '1 minute' where id = $1", [A.id]);
await refundsRun();
const Av = await acc("1001");
ok("llave vencida que no se puede renovar: deja de cobrar y queda el error", Av.status === "refunds_only" && /renovar/.test(Av.last_error)
   && (await one("select mp_connected from provider_private where provider_id = $1", [pid])) === false);
mp.romperRefresco(false);

// ---------- 14. Seguridad y configuración ----------
r = await refundsRun(await jwt({ sub: owner, role: "authenticated" }));
ok("mp-refunds rechaza a cualquiera que no sea el cron", r.status === 403);
r = await refundsRun(SERVICE);
ok("2a) mp-refunds tampoco acepta la service_role: solo CRON_SECRET", r.status === 403);

// ---------- 15. Bloque 2a: H12 y llaves cifradas ----------
mp.codigo("c-OWN", OWNER_MP);
r = await oauth(owner, "c-OWN");
ok("H12) la cuenta de Mercado Pago de TuTiempo no se puede conectar como prestador", r.headers.get("location") === `${SITE}/?mp_connected=0`
   && Number(await one("select count(*) from mp_accounts where mp_user_id = $1", [OWNER_MP])) === 0);
Deno.env.delete("MP_OWNER_USER_ID");
mp.codigo("c-SIN", "1003");
r = await oauth(owner, "c-SIN");
Deno.env.set("MP_OWNER_USER_ID", OWNER_MP);
ok("H12) sin MP_OWNER_USER_ID configurado no se conecta ninguna cuenta", r.headers.get("location") === `${SITE}/?mp_connected=0`
   && Number(await one("select count(*) from mp_accounts where mp_user_id = '1003'")) === 0);
ok("H13) nada en la base empieza sin 'v1:'", Number(await one("select count(*) from mp_accounts where (access_token is not null and access_token !~ '^v1:') or (refresh_token is not null and refresh_token !~ '^v1:')")) === 0
   && Number(await one("select count(*) from mp_accounts where access_token is not null")) > 0);
const cif = await utilMod.encryptToken("APP_USR-secreto", 5, "123", "access_token");
ok("H13) ida y vuelta (formato v1:<iv>:<cifrado>, IV de 12 bytes)", /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(cif) && atob(cif.split(":")[1]).length === 12
   && (await utilMod.decryptToken(cif, 5, "123", "access_token")) === "APP_USR-secreto" && !cif.includes("APP_USR"));
ok("H13) cada valor lleva su IV: cifrar dos veces da textos distintos", cif !== (await utilMod.encryptToken("APP_USR-secreto", 5, "123", "access_token")));
const falla = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };
ok("H13) con otro prestador, otra cuenta u otro campo (AAD) no se descifra", (await falla(utilMod.decryptToken(cif, 6, "123", "access_token")))
   && (await falla(utilMod.decryptToken(cif, 5, "124", "access_token"))) && (await falla(utilMod.decryptToken(cif, 5, "123", "refresh_token"))));
Deno.env.set("MP_TOKENS_KEY", rnd(32));
ok("H13) con la clave equivocada no se descifra", await falla(utilMod.decryptToken(cif, 5, "123", "access_token")));
Deno.env.set("MP_TOKENS_KEY", TOKENS_KEY);
Deno.env.set("MP_TOKENS_KEY_V2", rnd(32));
const cif2 = await utilMod.encryptToken("APP_USR-nueva", 5, "123", "access_token");
ok("H13) rotación: con MP_TOKENS_KEY_V2 se escribe con v2 y se siguen leyendo las v1", cif2.startsWith("v2:")
   && (await utilMod.decryptToken(cif2, 5, "123", "access_token")) === "APP_USR-nueva" && (await utilMod.decryptToken(cif, 5, "123", "access_token")) === "APP_USR-secreto");
Deno.env.delete("MP_TOKENS_KEY_V2");
// una llave vieja en texto plano (de antes del Bloque 2a): la cuenta queda para reconectar, con el error
await q("alter table mp_accounts disable trigger mp_accounts_encrypted");
await q("update mp_accounts set access_token = 'APP_USR-texto-plano', expires_at = now() + interval '100 days' where id = $1", [A.id]);
await q("alter table mp_accounts enable trigger mp_accounts_encrypted");
const tPlano = await utilMod.accountToken(dbfn, await utilMod.accountById(dbfn, Number(A.id)));
const Ap = await acc("1001");
ok("H13) llave sin 'v1:': no se usa, la cuenta queda para reconectar y queda el error", tPlano === null && Ap.status === "refunds_only" && /sin cifrar/.test(Ap.last_error)
   && (await one("select mp_connected from provider_private where provider_id = $1", [pid])) === false);
// ---------- D24: dni-cleanup borra las fotos del DNI con la API de Storage (el Storage del server del e2e) ----------
const dniRun = (key = CRON) => fn("dni-cleanup", new Request("https://fn.test/functions/v1/dni-cleanup", { method: "POST", headers: { Authorization: `Bearer ${key}` } }));
const subir = async (uid: string, name: string) => (await fetch(`${BASE}/storage/v1/object/dni/${uid}/${name}`, {
  method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: uid, role: "authenticated" })}`, "Content-Type": "image/jpeg" },
  body: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) })).status;
const archivo = async (name: string) => (await (await fetch(`${BASE}/__dni?name=${encodeURIComponent(name)}`)).json()).exists === true;
const fila = async (name: string) => Number(await one("select count(*) from storage.objects where bucket_id = 'dni' and name = $1", [name]));
const dniUser = async (email: string, dni: string) => {
  const uid = crypto.randomUUID();
  await q("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, '{}')", [uid, email]);
  const p = Number(await one("select register_provider($1, 'Calle 1', array['b'], '2284 1', $2)", [email, dni], uid));
  const fotos = [`${uid}/frente-1.jpg`, `${uid}/dorso-1.jpg`];
  for (const f of fotos) await subir(uid, f.split("/")[1]);
  return { uid, pid: p, fotos };
};
const ver = await dniUser("verificado@fn.test", "30111701"), nueva = await dniUser("nueva@fn.test", "30111702"), baja = await dniUser("baja@fn.test", "30111703");
ok("D24) las fotos subidas están en disco y en storage.objects", (await Promise.all([...ver.fotos, ...nueva.fotos, ...baja.fotos].map(async (f) => (await archivo(f)) && (await fila(f)) === 1))).every(Boolean));
await q("update providers set status = 'active', dni_verified = true where id = $1", [ver.pid]);
await q("update provider_private set dni_verified_at = now() - interval '31 days' where provider_id = $1", [ver.pid]);
await q("select delete_my_provider()", [], baja.uid);
r = await dniRun("otra-clave-cualquiera-de-mas-de-32-caracteres");
ok("D24) dni-cleanup sin la clave del cron: 403 y no borra nada", r.status === 403 && (await archivo(ver.fotos[0])));
r = await dniRun();
let dj = await body(r);
ok("D24) dni-cleanup borra las fotos del verificado hace 31 días y las de la baja", r.status === 200 && dj.files === 4 && dj.failed === 0, JSON.stringify(dj));
ok("D24) …el archivo ya no existe y su fila tampoco", (await Promise.all([...ver.fotos, ...baja.fotos].map(async (f) => !(await archivo(f)) && (await fila(f)) === 0))).every(Boolean));
ok("D24) …el verificado queda con dni_paths vacío, la fecha del borrado y su verificación",
   (await q("select pp.dni_paths, pp.dni_photos_deleted_at is not null as borrado, pp.dni_number, p.dni_verified from provider_private pp join providers p on p.id = pp.provider_id where p.id = $1", [ver.pid]))
     .every((x: any) => x.dni_paths.length === 0 && x.borrado && x.dni_number === "30111701" && x.dni_verified));
ok("D24) las del alta reciente siguen (en disco y en la base)", (await Promise.all(nueva.fotos.map(async (f) => (await archivo(f)) && (await fila(f)) === 1))).every(Boolean));
dj = await body(await dniRun());
ok("D24) una segunda corrida no tiene nada que borrar", dj.files === 0 && dj.failed === 0, JSON.stringify(dj));

const cfg = new URL("./deno.json", import.meta.url).pathname;
const util = new URL("../../supabase/functions/_shared/util.ts", import.meta.url).href;
const leer = async (extra: Record<string, string>) => {
  const env = { ...Deno.env.toObject(), ...extra };
  if (!("MP_API_URL" in extra)) delete env.MP_API_URL;
  const out = await new Deno.Command(Deno.execPath(), { args: ["eval", "--config", cfg, `const u = await import("${util}"); console.log(u.MP_API)`], env, clearEnv: true }).output();
  return new TextDecoder().decode(out.stdout).trim();
};
ok("sin el secreto MP_API_URL, las funciones usan la API real de Mercado Pago", (await leer({})) === "https://api.mercadopago.com");
ok("con MP_API_URL (solo pruebas), usan esa", (await leer({ MP_API_URL: "http://mp.falso/" })) === "http://mp.falso");

await db.end();
await mp.cerrar();
console.log(F ? `${F} FALLAS` : "TODO OK");
Deno.exit(F ? 1 : 0);

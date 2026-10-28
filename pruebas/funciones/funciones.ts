// Prueba de las Edge Functions REALES de Mercado Pago (Bloque 1) contra la base + PostgREST locales y un Mercado Pago
// falso (mp_falso.ts). Las funciones se importan tal cual (supabase/functions/*/index.ts) y se llaman directo, sin servidor.
// Corre dentro de pruebas/entorno_e2e.mjs (que da E2E_URL, E2E_PG y E2E_SECRET):
//   npm run test:funciones
import pg from "npm:pg@8.12.0";
import { fileURLToPath } from "node:url";
import { mpFalso } from "./mp_falso.ts";
import { resendFalso } from "./resend_falso.ts";
import { pushFalso } from "./push_falso.ts";
import { b64u as b64uBytes } from "../../supabase/functions/_shared/webpush.ts";

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
const RESEND_KEY = "re_llave_de_prueba", rs = resendFalso(RESEND_KEY);
// Bloque C: claves VAPID de prueba (como las de npm run vapid) y un servicio de push falso
const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const VAPID_PUB = b64uBytes(new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey)));
const VAPID_PRIV = (await crypto.subtle.exportKey("jwk", vapidPair.privateKey)).d!;
const ps = pushFalso(VAPID_PUB);
const SITE = "http://sitio.test", WHSEC = "whsec-prueba";
const SERVICE = await jwt({ role: "service_role" });
const rnd = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
const CRON = rnd(36), TOKENS_KEY = rnd(32), OWNER_MP = "9000";
for (const [k, v] of Object.entries({
  SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: await jwt({ role: "anon" }), MP_API_URL: mp.url,
  MP_WEBHOOK_SECRET: WHSEC, MP_CLIENT_ID: "cliente-tutiempo", MP_CLIENT_SECRET: "secreto-tutiempo", SITE_URL: SITE,
  CRON_SECRET: CRON, MP_TOKENS_KEY: TOKENS_KEY, MP_OWNER_USER_ID: OWNER_MP,
  RESEND_API_KEY: RESEND_KEY, EMAIL_FROM: "TuTiempo <avisos@tutiempo.com.ar>", EMAIL_REPLY_TO: "soporte@tutiempo.com.ar",
  EMAIL_API_URL: rs.url, EMAIL_GAP_MS: "0",
  VAPID_PUBLIC_KEY: VAPID_PUB, VAPID_PRIVATE_KEY: VAPID_PRIV, VAPID_SUBJECT: "mailto:contacto@tutiempo.com.ar", PUSH_TEST_ORIGINS: ps.origin,
})) Deno.env.set(k, v);
const handlers: Record<string, (req: Request) => Promise<Response>> = {};
let loading = "";
const realServe = Deno.serve.bind(Deno);   // el de verdad, para los servidores falsos de la prueba
(Deno as any).serve = (h: any) => { handlers[loading] = typeof h === "function" ? h : h.handler; return { finished: Promise.resolve(), shutdown: async () => {} }; };
for (const n of ["mp-oauth", "mp-create-preference", "mp-webhook", "mp-refunds", "dni-cleanup", "email-send", "push-send"]) {
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
// caso 2: la baja pide el borrado en el momento, pero esa llamada no llega (acá no hay URL ni clave en Vault, como con
// la red o la función caídas): la baja se hace igual y las fotos las borra la corrida del cron
await q("delete from net.requests");
await q("select delete_my_provider()", [], baja.uid);
ok("D24) caso 2: la baja se hace aunque la llamada a dni-cleanup no salga", (await one("select status from providers where id = $1", [baja.pid])) === "deleted"
   && Number(await one("select count(*) from net.requests where url like '%/dni-cleanup'")) === 0 && (await archivo(baja.fotos[0])));
r = await dniRun("otra-clave-cualquiera-de-mas-de-32-caracteres");
ok("D24) dni-cleanup sin la clave del cron: 403 y no borra nada", r.status === 403 && (await archivo(ver.fotos[0])));
r = await dniRun();
let dj = await body(r);
ok("D24) la corrida del cron borra las fotos del verificado hace 31 días y las de la baja (caso 2)", r.status === 200 && dj.files === 4 && dj.failed === 0, JSON.stringify(dj));
ok("D24) …el archivo ya no existe y su fila tampoco", (await Promise.all([...ver.fotos, ...baja.fotos].map(async (f) => !(await archivo(f)) && (await fila(f)) === 0))).every(Boolean));
ok("D24) …el verificado queda con dni_paths vacío, la fecha del borrado y su verificación",
   (await q("select pp.dni_paths, pp.dni_photos_deleted_at is not null as borrado, pp.dni_number, p.dni_verified from provider_private pp join providers p on p.id = pp.provider_id where p.id = $1", [ver.pid]))
     .every((x: any) => x.dni_paths.length === 0 && x.borrado && x.dni_number === "30111701" && x.dni_verified));
ok("D24) las del alta reciente siguen (en disco y en la base)", (await Promise.all(nueva.fotos.map(async (f) => (await archivo(f)) && (await fila(f)) === 1))).every(Boolean));
dj = await body(await dniRun());
ok("D24) una segunda corrida no tiene nada que borrar", dj.files === 0 && dj.failed === 0, JSON.stringify(dj));

// ---------- Bloque 3: email-send manda los avisos por email con Resend (un Resend falso) ----------
const emailRun = (key = CRON) => fn("email-send", new Request("https://fn.test/functions/v1/email-send", { method: "POST", headers: { Authorization: `Bearer ${key}` } }));
await q("delete from email_outbox");   // lo que dejaron las secciones de arriba (clientes sin email confirmado)
const mailUser = crypto.randomUUID();
await q("insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, 'cliente@fn.test', '{\"full_name\":\"Cliente Mail\"}', now())", [mailUser]);
const aviso = async (kind: string, ref: string, texto: string) => {
  const m = Number(await one("insert into client_messages (provider_id, user_id, body, kind, ref) values ($1, $2, $3, $4, $5) returning id", [pid, mailUser, texto, kind, ref]));
  return Number(await one("select id from email_outbox where message_id = $1", [m]));
};
const estado = async (id: number) => (await q("select status, attempts, provider_message_id, last_error from email_outbox where id = $1", [id]))[0];
const LINK = "https://tutiempo.com.ar/" + (await one("select slug from providers where id = $1", [pid]));
const eRev = await aviso("rev", "999001", `¡Gracias por venir! <script>alert(1)</script> ¿Nos dejás tu opinión? ${LINK}.`);
const eBday = await aviso("bday", "2026", "¡Feliz cumpleaños, Cliente! Este mes tenés 15% off.");
r = await emailRun("otra-clave-cualquiera-de-mas-de-32-caracteres");
ok("email-send sin la clave del cron: 403 y no manda nada", r.status === 403 && rs.enviados.length === 0);
Deno.env.delete("RESEND_API_KEY");
r = await emailRun();
ok("email-send sin RESEND_API_KEY: 500 (config) y no toma los pendientes", r.status === 500 && (await body(r)).error === "config" && (await estado(eRev)).status === "pending"
   && Number(await one("select count(*) from email_outbox where next_attempt_at > now()")) === 0);
Deno.env.set("RESEND_API_KEY", RESEND_KEY);
r = await emailRun();
let ej = await body(r);
ok("email-send manda los pendientes", r.status === 200 && ej.sent === 2 && ej.failed === 0, JSON.stringify(ej));
const mRev = rs.enviados.find((e) => e.clave === `tt-email-${eRev}`)?.body;
ok("…con remitente, respuestas a soporte, destinatario y asunto", mRev?.from === "TuTiempo <avisos@tutiempo.com.ar>" && mRev?.reply_to === "soporte@tutiempo.com.ar"
   && JSON.stringify(mRev?.to) === JSON.stringify(["cliente@fn.test"]) && mRev?.subject === "¿Qué tal tu turno en Prov Funciones?", JSON.stringify(mRev));
ok("…con el texto de la app escapado (nada de HTML del texto) y el link tocable", mRev?.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !mRev?.html.includes("<script>")
   && mRev?.html.includes(`<a href="${LINK}" style="color:#4338ca">${LINK}</a>.`));
ok("…y el pie con el link a Mi perfil para dejar de recibirlos (también en el texto plano)",
   /<a href="https:\/\/tutiempo\.com\.ar\/cuenta"[^>]*>Dejar de recibir estos emails<\/a>/.test(mRev?.html ?? "")
   && mRev?.text.includes("Dejar de recibir estos emails: https://tutiempo.com.ar/cuenta") && mRev?.text.startsWith("¡Gracias por venir! <script>"));
ok("…y en la base quedan enviados, con el id de Resend", (await estado(eRev)).status === "sent" && /^re_/.test((await estado(eRev)).provider_message_id)
   && (await estado(eBday)).status === "sent");
ej = await body(await emailRun());
ok("una segunda corrida no manda nada otra vez", ej.sent === 0 && ej.failed === 0 && rs.enviados.length === 2);
// Resend caído: se reintenta (con la misma clave de idempotencia)
const eRe = await aviso("rev", "999002", "Aviso que se reintenta");
rs.fallas.push({ status: 500, message: "internal_server_error" });
ej = await body(await emailRun());
const st1 = await estado(eRe);
ok("si Resend falla, queda pendiente con el error para reintentar", ej.failed === 1 && st1.status === "pending" && st1.attempts === 1 && /^500/.test(st1.last_error));
await q("update email_outbox set next_attempt_at = now() where id = $1", [eRe]);
ej = await body(await emailRun());
ok("…y el reintento sale, con la misma clave", ej.sent === 1 && (await estado(eRe)).status === "sent"
   && rs.pedidos.filter((k) => k === `tt-email-${eRe}`).length === 2 && rs.enviados.filter((e) => e.clave === `tt-email-${eRe}`).length === 1);
// salió pero la respuesta se perdió: el reintento no manda un segundo email
const eDup = await aviso("rev", "999003", "Aviso que ya había salido");
await fetch(`${rs.url}/emails`, { method: "POST", headers: { Authorization: `Bearer ${RESEND_KEY}`, "Idempotency-Key": `tt-email-${eDup}` }, body: "{}" });
ej = await body(await emailRun());
ok("si ya había salido (respuesta perdida), el reintento no manda otro: idempotencia", ej.sent === 1
   && rs.enviados.filter((e) => e.clave === `tt-email-${eDup}`).length === 1 && (await estado(eDup)).status === "sent");
const eMal = await aviso("rev", "999004", "Aviso con dirección rechazada");
rs.fallas.push({ status: 422, message: "Invalid `to` field" });
await body(await emailRun());
ok("una dirección que Resend rechaza (422) queda fallida, sin reintentos", (await estado(eMal)).status === "failed" && (await estado(eMal)).attempts === 1);
await q("update profiles set email_notices = false where id = $1", [mailUser]);
const eOff = await aviso("rev", "999005", "No va");
ok("con «Recordatorios y novedades» apagada, la reseña no entra a la cola", Number.isNaN(eOff) && rs.enviados.length === 4);
const eCan = await aviso("cancel", "999006", "Prov Funciones tuvo que cancelar tu turno del lunes 2/11 a las 10:00.");
ej = await body(await emailRun());
const mCan = rs.enviados.find((e) => e.clave === `tt-email-${eCan}`)?.body;
ok("…pero una cancelación igual sale por email", !Number.isNaN(eCan) && ej.sent === 1 && (await estado(eCan)).status === "sent" && !!mCan);
ok("…con el pie de los avisos que llegan siempre: «Recordatorios y novedades: Mi perfil» (no «Dejar de recibir»)",
   /Recordatorios y novedades: <a href="https:\/\/tutiempo\.com\.ar\/cuenta"[^>]*>Mi perfil<\/a>/.test(mCan?.html ?? "") && !mCan?.html.includes("Dejar de recibir")
   && mCan?.text.includes("Recordatorios y novedades: Mi perfil (https://tutiempo.com.ar/cuenta)") && !mCan?.text.includes("Dejar de recibir"));
await q("update profiles set email_notices = true where id = $1", [mailUser]);
// texto que viene del prestador con HTML (plantilla, nombre del negocio y dirección): todo escapado y ningún link ajeno
const [nombre0, dir0] = Object.values((await q("select name, address from providers where id = $1", [pid]))[0]);
const plantilla0 = await one("select body from message_templates where provider_id = $1 and key = 'rev'", [pid]);
await q("update providers set name = $1, address = $2 where id = $3", [`Barbería "La <b>Esquina</b>" & Cía`, `<img src=x onerror="alert(1)"> Calle 'Uno'`, pid]);
await q("update message_templates set body = $1, enabled = true where provider_id = $2 and key = 'rev'",
  [`<a href="https://otro.com">Promo</a> <script>alert("x")</script> "{barberia}" te espera en {direccion}. ¿Nos dejás tu opinión? {link}`, pid]);
const bRev = Number(await one("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price) "
  + "values ($1, $2, 'Cliente Mail', 'Corte', 'app', 'done', now() - interval '3 hours', now() - interval '150 minutes', 10000) returning id", [pid, mailUser]));
await q("select notify_booking($1, 'rev')", [bRev]);
const eHtml = Number(await one("select o.id from email_outbox o where o.booking_id = $1 and o.kind = 'rev'", [bRev]));
ej = await body(await emailRun());
const mHtml = rs.enviados.find((e) => e.clave === `tt-email-${eHtml}`)?.body?.html ?? "";
const hrefs = [...mHtml.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
ok("HTML del prestador: la plantilla, el nombre y la dirección llegan escapados (ni <a>, ni <script>, ni <img>, ni <b>)",
   ej.sent === 1 && !/<a href="https:\/\/otro|<script|<img|<b>/.test(mHtml)
   && mHtml.includes("&lt;a href=&quot;https://otro.com&quot;&gt;Promo&lt;/a&gt;") && mHtml.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
   && mHtml.includes("Barbería &quot;La &lt;b&gt;Esquina&lt;/b&gt;&quot; &amp; Cía") && mHtml.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Calle &#39;Uno&#39;"),
   mHtml.slice(0, 600));
ok("…y todos los links son del sitio: el del aviso, el único botón (Ver mis turnos) y el de Mi perfil",
   hrefs.length === 3 && hrefs.every((h) => h.startsWith("https://tutiempo.com.ar/")) && hrefs.includes(LINK)
   && (mHtml.match(/display:inline-block/g) ?? []).length === 1 && hrefs.includes("https://tutiempo.com.ar/mis-turnos"), JSON.stringify(hrefs));
await q("update providers set name = $1, address = $2 where id = $3", [nombre0, dir0, pid]);
await q("update message_templates set body = $1 where provider_id = $2 and key = 'rev'", [plantilla0, pid]);

// ---------- Usuario que llama: proyecto nuevo (claves asimétricas y publishable/secret) y viejo (HS256) ----------
// Un proyecto nuevo firma las sesiones con ES256 y publica las claves en /auth/v1/.well-known/jwks.json; las claves
// viejas (anon, service_role) pueden estar desactivadas: Auth las rechaza. Proyecto simulado delante del e2e_server.
{
  const PUB = "sb_publishable_prueba";
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pubJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k-nueva", alg: "ES256", use: "sig" };
  let jwksUp = true;
  const authCalls: string[] = [];
  const nuevo = realServe({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const u = new URL(req.url);
    if (u.pathname === "/auth/v1/.well-known/jwks.json") return jwksUp ? Response.json({ keys: [pubJwk] }) : new Response("caído", { status: 503 });
    if (u.pathname === "/auth/v1/user") {
      const key = req.headers.get("apikey") ?? "";
      authCalls.push(key.startsWith("sb_") ? "publishable" : "vieja");
      if (key !== PUB) return Response.json({ message: "Legacy API keys are disabled" }, { status: 401 });
      const tok = (req.headers.get("Authorization") ?? "").slice(7);
      try {
        const c = JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        return Response.json({ id: c.sub, email: c.email ?? null });
      } catch { return Response.json({ msg: "bad_jwt" }, { status: 403 }); }
    }
    // el resto (PostgREST) va al e2e_server de siempre
    return await fetch(BASE + u.pathname + u.search, { method: req.method, headers: req.headers, body: req.body });
  });
  const NUEVO = `http://127.0.0.1:${nuevo.addr.port}`;
  async function es256(payload: Record<string, unknown>, key = pair.privateKey, kid = "k-nueva") {
    const h = b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
    const p = b64u(JSON.stringify({ iss: `${NUEVO}/auth/v1`, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
    const s = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64u(s)}`;
  }
  const saved = Object.fromEntries(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS", "SUPABASE_JWKS"].map((k) => [k, Deno.env.get(k)]));
  const restore = () => { for (const [k, v] of Object.entries(saved)) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v); };
  // las claves viejas siguen en el entorno (SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY), pero Auth ya no las acepta
  Deno.env.set("SUPABASE_URL", NUEVO);
  Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: PUB }));
  Deno.env.set("SUPABASE_SECRET_KEYS", JSON.stringify({ default: SERVICE }));   // en la prueba, la "secreta" es el JWT del e2e
  const logs: string[] = [];
  const warn0 = console.warn;
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const post = (name: string, auth: string | null) => fn(name, new Request(`https://fn.test/functions/v1/${name}`, {
    method: "POST", headers: { ...(auth ? { Authorization: auth } : {}), Origin: SITE, "Content-Type": "application/json" }, body: "{}" }));
  try {
    const vieja = await fetch(`${NUEVO}/auth/v1/user`, { headers: { apikey: Deno.env.get("SUPABASE_ANON_KEY")!, Authorization: `Bearer ${await es256({ sub: owner })}` } });
    await vieja.body?.cancel();
    ok("proyecto nuevo (simulado): Auth rechaza la clave anon vieja, como en el proyecto de prueba (401)", vieja.status === 401);

    const tok = await es256({ sub: owner, email: "prov@fn.test" });
    authCalls.length = 0;
    let rr = await post("mp-oauth", `Bearer ${tok}`);
    let jj = await body(rr);
    ok("proyecto nuevo: Conectar Mercado Pago con una sesión ES256 devuelve la URL de autorización (antes: 401 login_required)",
       rr.status === 200 && String(jj.url).startsWith("https://auth.mercadopago.com/authorization"), `${rr.status} ${JSON.stringify(jj)}`);
    ok("…la firma se verifica con las claves públicas del proyecto, sin preguntarle a Auth con una apikey", authCalls.length === 0, authCalls.join(","));
    rr = await post("mp-create-preference", `Bearer ${tok}`);
    jj = await body(rr);
    ok("proyecto nuevo: mp-create-preference reconoce al usuario (pasa a validar el pedido: 400 bad_request, no 401)", rr.status === 400 && jj.error === "bad_request", `${rr.status} ${JSON.stringify(jj)}`);

    // rechazos, cada uno con su motivo en el log
    const cases: [string, string | null, string][] = [
      ["sin Authorization", null, "sin_authorization"],
      ["con la clave publishable (sin sesión)", `Bearer ${PUB}`, "no_es_jwt"],
      ["con la clave anon (JWT con role anon)", `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`, "rol_no_authenticated"],
      ["vencido", `Bearer ${await es256({ sub: owner, exp: Math.floor(Date.now() / 1000) - 60 })}`, "vencido"],
      ["firmado con otra clave", `Bearer ${await es256({ sub: owner }, other.privateKey)}`, "firma_invalida"],
      ["con un kid que el proyecto no tiene", `Bearer ${await es256({ sub: owner }, other.privateKey, "k-ajena")}`, "kid_desconocido"],
      ["de otro emisor", `Bearer ${await es256({ sub: owner, iss: "https://otro.test" })}`, "emisor_desconocido"],
      ["alg none", `Bearer ${b64u(JSON.stringify({ alg: "none" }))}.${b64u(JSON.stringify({ sub: owner, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 }))}.`, "alg_no_soportado"],
    ];
    for (const [name, auth, reason] of cases) {
      logs.length = 0;
      const res = await post("mp-oauth", auth);
      const b = await body(res);
      const line = logs.find((l) => l.startsWith("caller: rechazado")) ?? "";
      const secret = auth ? auth.slice(7) : "";
      const sig = secret.split(".")[2] ?? "";
      ok(`rechaza ${name}: 401 login_required y el log dice "${reason}" sin el token`,
         res.status === 401 && b.error === "login_required" && line.includes(`(${reason}`)
         && (!secret || (!line.includes(secret) && (sig.length < 8 || !line.includes(sig)))), `${res.status} ${line}`);
    }

    // SUPABASE_JWKS inyectada: sirve aunque el endpoint de claves no responda
    jwksUp = false;
    Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [pubJwk] }));
    rr = await post("mp-oauth", `Bearer ${await es256({ sub: owner })}`);
    ok("con SUPABASE_JWKS (inyectada por Supabase) no hace falta pedir las claves", rr.status === 200, String(rr.status));
    await rr.body?.cancel();
    Deno.env.delete("SUPABASE_JWKS");

    // clave nueva que todavía no está en la lista guardada y el endpoint caído: se le pregunta a Auth con la publishable
    authCalls.length = 0;
    rr = await post("mp-oauth", `Bearer ${await es256({ sub: owner }, pair.privateKey, "k-rotada")}`);
    ok("si no se pueden leer las claves públicas, le pregunta a Auth con la clave publishable",
       rr.status === 200 && authCalls.length === 1 && authCalls[0] === "publishable", `${rr.status} ${authCalls.join(",")}`);
    await rr.body?.cancel();
    jwksUp = true;

    // HS256 en un proyecto con claves nuevas: Auth con la publishable
    authCalls.length = 0;
    rr = await post("mp-oauth", `Bearer ${await jwt({ sub: owner, role: "authenticated" })}`);
    ok("sesión HS256 con claves nuevas: le pregunta a Auth con la publishable y anda", rr.status === 200 && authCalls[0] === "publishable", `${rr.status} ${authCalls.join(",")}`);
    await rr.body?.cancel();

    // qué clave usa cada cliente
    ok("projectKey: la nueva por nombre (default) antes que la vieja", utilMod.projectKey("publishable") === PUB && utilMod.projectKey("secret") === SERVICE);
    Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", "{}");
    Deno.env.set("SUPABASE_SECRET_KEYS", "");
    ok("projectKey: sin claves nuevas, las viejas (proyecto viejo)", utilMod.projectKey("publishable") === Deno.env.get("SUPABASE_ANON_KEY") && utilMod.projectKey("secret") === SERVICE);
  } finally {
    console.warn = warn0;
    restore();
    await nuevo.shutdown();
  }
  // proyecto viejo (HS256, solo claves viejas): sigue igual (todo lo de arriba ya lo usó)
  const rr = await fn("mp-oauth", new Request("https://fn.test/functions/v1/mp-oauth", {
    method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: owner, role: "authenticated" })}`, Origin: SITE } }));
  ok("proyecto viejo (HS256 y clave anon): Conectar Mercado Pago sigue andando", rr.status === 200, String(rr.status));
  await rr.body?.cancel();
}

// ---------- H32: un error de la base nunca es "no es prestador" (ni "no hay reservas", ni "no hay cuenta") ----------
// La base de la prueba es como un proyecto nuevo (supabase_emulation.sql sin permisos por defecto): service_role tiene
// solo los permisos que dan las migraciones. Sacándole uno se ve qué responde cada función.
{
  const logs: string[] = [];
  const e0 = console.error, w0 = console.warn;
  console.error = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  console.warn = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const asUser = async (uid: string) => ({ Authorization: `Bearer ${await jwt({ sub: uid, role: "authenticated" })}`, Origin: SITE, "Content-Type": "application/json" });
  const oauthPost = async (uid: string) => fn("mp-oauth", new Request("https://fn.test/functions/v1/mp-oauth", { method: "POST", headers: await asUser(uid) }));
  const without = async (grant: string, table: string, run: () => Promise<Response>) => {
    await db.query(`revoke ${grant} on public.${table} from service_role`);
    try { return await run(); } finally { await db.query(`grant ${grant} on public.${table} to service_role`); }
  };
  try {
    let res = await oauthPost(owner);
    ok("H32: con los permisos de la migración, Conectar Mercado Pago anda (proyecto nuevo)", res.status === 200, String(res.status));
    await res.body?.cancel();

    logs.length = 0;
    res = await without("select", "providers", () => oauthPost(owner));
    let b = await body(res);
    ok("H32: sin permiso sobre providers responde 500 server_error, no 403 not_a_provider",
       res.status === 500 && b.error === "server_error", `${res.status} ${JSON.stringify(b)}`);
    ok("…y el log dice qué consulta falló y por qué (42501, permission denied)",
       logs.some((l) => l.includes("db: falló buscar el prestador del usuario") && l.includes("42501") && l.includes("permission denied")), logs.join(" | "));

    logs.length = 0;
    res = await without("insert", "mp_oauth_states", () => oauthPost(owner));
    b = await body(res);
    ok("H32: si no se puede guardar el state del OAuth, 500 (no una URL que después falla)", res.status === 500 && logs.some((l) => l.includes("guardar el state del OAuth")), `${res.status} ${logs.join(" | ")}`);

    logs.length = 0;
    const nobody = crypto.randomUUID();
    await q("insert into auth.users (id, email) values ($1, 'nadie@fn.test')", [nobody]);
    res = await oauthPost(nobody);
    b = await body(res);
    ok("H32: un usuario que de verdad no es prestador: 403 not_a_provider, con el motivo en el log",
       res.status === 403 && b.error === "not_a_provider" && logs.some((l) => l.includes("mp-oauth: not_a_provider") && l.includes(nobody)), `${res.status} ${logs.join(" | ")}`);

    logs.length = 0;
    // una reserva en hold de la clienta (directo en la base: a esta altura el prestador ya desconectó Mercado Pago)
    const ids = [Number(await one("insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, hold_expires_at) "
      + "values ($1, $2, $3, 'Ana', 'Corte', 'app', 'hold', now() + interval '20 days', now() + interval '20 days 30 minutes', 10000, 5000, now() + interval '10 minutes') returning id", [pid, sv, cli]))];
    const cliHeaders = await asUser(cli);
    res = await without("select", "bookings", () => fn("mp-create-preference", new Request("https://fn.test/functions/v1/mp-create-preference", {
      method: "POST", headers: cliHeaders, body: JSON.stringify({ booking_ids: ids }) })));
    b = await body(res);
    ok("H32: sin permiso sobre bookings, mp-create-preference responde 500 (no hold_expired) y lo loguea",
       res.status === 500 && b.error === "server_error" && logs.some((l) => l.includes("leer las reservas") && l.includes("42501")), `${res.status} ${JSON.stringify(b)} ${logs.join(" | ")}`);
    await q("delete from bookings where id = $1", [ids[0]]);

    logs.length = 0;
    res = await without("select", "mp_accounts", () => webhook(pid, null, "999000111"));
    ok("H32: si el webhook no puede leer la cuenta, 500 (Mercado Pago reintenta), no 'proveedor desconocido'",
       res.status === 500 && logs.some((l) => /db: falló leer la(s)? cuenta/.test(l) && l.includes("42501")), `${res.status} ${logs.join(" | ")}`);
    await res.body?.cancel();

    // las del cron usan solo funciones de la base: sin permisos sobre las tablas, igual andan
    const tablesOfCron = ["refunds", "payments"];
    for (const t of tablesOfCron) await db.query(`revoke all on public.${t} from service_role`);
    try {
      const rr = await refundsRun();
      ok("H32: mp-refunds no lee tablas directo (todo por funciones de la base)", rr.status === 200, String(rr.status));
      await rr.body?.cancel();
    } finally {
      await db.query("grant select, insert, update on public.payments, public.refunds to service_role");
    }
  } finally {
    console.error = e0;
    console.warn = w0;
  }
}

// ---------- Bloque C: push-send manda las notificaciones (servicio de push falso que verifica VAPID y descifra) ----------
{
  const pushRun = (key = CRON) => fn("push-send", new Request("https://fn.test/functions/v1/push-send", { method: "POST", headers: { Authorization: `Bearer ${key}` } }));
  const cli = crypto.randomUUID();
  await q("insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1, 'push@fn.test', '{\"full_name\":\"Paula Push Gómez\"}', now())", [cli]);
  const subDev = async (user: string, nombre: string) => {
    const d = await ps.dispositivo(nombre);
    // directo en la tabla (push_subscribe solo acepta servicios de push reales; el falso es localhost)
    await q("insert into push_subscriptions (user_id, endpoint, p256dh, auth, label) values ($1, $2, $3, $4, $5)", [user, d.endpoint, d.p256dh, d.auth, nombre]);
    return d;
  };
  const dA = await subDev(cli, "celu"), dB = await subDev(cli, "viejo"), dC = await subDev(cli, "caido"), dD = await subDev(cli, "otra-clave");
  const dOwner = await subDev(owner, "prestador");
  await q("delete from push_outbox where subscription_id not in (select id from push_subscriptions where endpoint like $1)", [ps.origin + "%"]);
  const bk = Number(await one("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price) values ($1, $2, 'Paula Push Gómez', 'Corte', 'app', 'hold', now() + interval '30 hours', now() + interval '31 hours', 12500) returning id", [pid, cli]));
  await q("update bookings set status = 'confirmed' where id = $1", [bk]);
  await q("select notify_booking($1, 'conf')", [bk]);
  const outbox = async () => (await q("select o.id, o.kind, o.status, o.attempts, o.last_status, s.label from push_outbox o left join push_subscriptions s on s.id = o.subscription_id where o.booking_id = $1 order by o.id", [bk]));
  ok("push: la confirmación quedó en la cola para los 4 dispositivos y la nueva reserva para el prestador",
     (await outbox()).filter((x: any) => x.kind === "conf").length === 4 && (await outbox()).filter((x: any) => x.kind === "new_booking").length === 1);
  let rr = await pushRun("otra-clave-cualquiera-de-mas-de-32-caracteres");
  ok("push-send sin la clave del cron: 403 y no manda nada", rr.status === 403 && ps.recibidos.length === 0);
  Deno.env.delete("VAPID_PRIVATE_KEY");
  const e0 = console.error; console.error = () => {};
  rr = await pushRun();
  console.error = e0;
  ok("push-send sin las claves VAPID: 500 (config) y no toma los pendientes", rr.status === 500 && (await body(rr)).error === "config"
     && (await outbox()).every((x: any) => x.status === "pending") && Number(await one("select count(*) from push_outbox where next_attempt_at > now()")) === 0);
  Deno.env.set("VAPID_PRIVATE_KEY", VAPID_PRIV);
  ps.responder("viejo", 410); ps.responder("caido", 503); ps.responder("otra-clave", 403);
  const logs: string[] = []; console.error = (...a: unknown[]) => logs.push(a.join(" "));
  rr = await pushRun();
  console.error = e0;
  const res = await body(rr);
  ok("push-send manda: 2 enviadas (celu y prestador), 1 vencida, 2 fallidas", rr.status === 200 && res.sent === 2 && res.gone === 1 && res.failed === 2, JSON.stringify(res));
  const rCelu = ps.recibidos.find((x) => x.device === "celu")!;
  ok("el servicio de push verificó la firma VAPID (RFC 8292: ES256 con la clave k, para su origen, por menos de 24 h)", rCelu.vapidOk, rCelu.vapidWhy);
  ok("…cifrado aes128gcm, con TTL hasta el turno, urgencia alta y Topic del turno", rCelu.encoding === "aes128gcm" && rCelu.ttl > 29 * 3600 && rCelu.ttl <= 30 * 3600
     && rCelu.urgency === "high" && rCelu.topic === `turno-${bk}`, JSON.stringify({ ...rCelu, payload: undefined }));
  ok("el dispositivo descifra el mensaje (RFC 8291): título, texto, adónde lleva y la etiqueta", rCelu.payload.title === "Turno confirmado"
     && /^Prov Funciones · (dom|lun|mar|mié|jue|vie|sáb) \d\d\/\d\d, \d\d:\d\d$/.test(rCelu.payload.body) && rCelu.payload.url === `/turno/${bk}` && rCelu.payload.tag === `turno-${bk}`, JSON.stringify(rCelu.payload));
  ok("…y nada más (sin montos ni datos de otros)", JSON.stringify(Object.keys(rCelu.payload).sort()) === '["body","tag","title","url"]' && !JSON.stringify(rCelu.payload).includes("$"));
  const rOwner = ps.recibidos.find((x) => x.device === "prestador")!;
  ok("al prestador: «Nueva reserva» con el nombre de pila del cliente (sin apellido)", rOwner.payload.title === "Nueva reserva" && rOwner.payload.body.startsWith("Paula · Corte · ")
     && !rOwner.payload.body.includes("Gómez") && /^\/panel\/agenda\?dia=\d{4}-\d\d-\d\d$/.test(rOwner.payload.url), JSON.stringify(rOwner.payload));
  const after = await outbox();
  ok("en la base: enviadas, la del 503 para reintentar, la del 403 fallida", after.filter((x: any) => x.status === "sent").length === 2
     && after.some((x: any) => x.label === "caido" && x.status === "pending" && x.attempts === 1 && x.last_status === 503)
     && after.some((x: any) => x.label === "otra-clave" && x.status === "failed" && x.last_status === 403));
  ok("410: la suscripción vencida se borró", Number(await one("select count(*) from push_subscriptions where endpoint = $1", [dB.endpoint])) === 0);
  ok("el log dice qué pasó con el 403 (clave VAPID) sin el contenido ni el endpoint completo", logs.some((l) => l.includes("rechazó la firma VAPID (403)"))
     && !logs.some((l) => l.includes(dA.endpoint) || l.includes(dD.endpoint) || l.includes("Turno confirmado")));
  const n0 = ps.recibidos.length;
  ok("una segunda corrida no manda nada otra vez", (await body(await pushRun())).sent === 0 && ps.recibidos.length === n0);
  await q("update push_outbox set next_attempt_at = now() where status = 'pending'");
  ok("el reintento del 503 sale", (await body(await pushRun())).sent === 1 && ps.recibidos.filter((x) => x.device === "caido").length === 2
     && (await outbox()).some((x: any) => x.label === "caido" && x.status === "sent"));
  // endpoint de un servicio desconocido (no debería estar en la tabla, pero si está, la función no lo llama)
  await q("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://interno.evil.test/robar', $2, $3)", [cli, dA.p256dh, dA.auth]);
  const bk2 = Number(await one("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price) values ($1, $2, 'Paula', 'Corte', 'app', 'confirmed', now() + interval '50 hours', now() + interval '51 hours', 12500) returning id", [pid, cli]));
  await q("select notify_booking($1, 'conf')", [bk2]);
  console.error = () => {};
  await pushRun();
  console.error = e0;
  ok("un endpoint de un servicio desconocido no se llama: falla sin reintentos", (await q("select o.status, o.last_status from push_outbox o join push_subscriptions s on s.id = o.subscription_id where s.endpoint = 'https://interno.evil.test/robar'"))[0]?.status === "failed");
  ok("sin el secreto PUSH_TEST_ORIGINS, el servicio falso tampoco sería aceptado (solo los conocidos)", !(await import("../../supabase/functions/_shared/webpush.ts")).knownEndpoint(dA.endpoint));
  await ps.cerrar();
}

const cfg = fileURLToPath(new URL("./deno.json", import.meta.url));
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
await rs.cerrar();
console.log(F ? `${F} FALLAS` : "TODO OK");
Deno.exit(F ? 1 : 0);

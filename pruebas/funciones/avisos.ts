// 12/11: TODAS las notificaciones push y los emails, de punta a punta. Cada aviso sale de la acción real que lo dispara
// (una reserva pagada por el webhook de Mercado Pago, una cancelación, un seguidor, un feriado, una suspensión…), las
// Edge Functions reales push-send y email-send lo mandan, y se comprueba lo que llegó: el servicio de push falso verifica
// VAPID y descifra el mensaje como el navegador (push_falso.ts) y el Resend falso anota cada email (resend_falso.ts).
// Al final, una tabla con cada tipo: si llegó por push y por email, con su título o asunto.
// Corre dentro de pruebas/entorno_e2e.mjs (que da E2E_URL, E2E_PG y E2E_SECRET):
//   npm run test:avisos
import pg from "npm:pg@8.12.0";
import { mpFalso } from "./mp_falso.ts";
import { resendFalso } from "./resend_falso.ts";
import { pushFalso, type Recibido } from "./push_falso.ts";
import { b64u as b64uBytes } from "../../supabase/functions/_shared/webpush.ts";

const BASE = Deno.env.get("E2E_URL")!, PG = Deno.env.get("E2E_PG")!, SECRET = Deno.env.get("E2E_SECRET")!;
if (!BASE || !PG || !SECRET) throw new Error("Correr dentro de pruebas/entorno_e2e.mjs (npm run test:avisos)");
let F = 0;
const ok = (name: string, cond: unknown, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// ---------- JWT de prueba (mismo secreto que PostgREST) ----------
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

// ---------- Base (como el usuario de la app cuando se pasa uid; si no, como postgres) ----------
const db = new pg.Client({ connectionString: PG });
await db.connect();
async function q(sql: string, args: unknown[] = [], uid?: string, role = "authenticated") {
  await db.query("begin");
  try {
    if (uid || role === "service_role") {
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(uid ? { sub: uid, role } : { role })]);
      await db.query(`set local role ${role}`);
    }
    const r = await db.query(sql, args);
    await db.query("commit");
    return r.rows;
  } catch (e) {
    await db.query("rollback");
    throw e;
  }
}
const one = async (sql: string, args: unknown[] = [], uid?: string, role?: string) => Object.values((await q(sql, args, uid, role))[0] ?? {})[0] as any;

// ---------- Servicios falsos y Edge Functions reales ----------
const mp = mpFalso();
const RESEND_KEY = "re_llave_de_prueba", rs = resendFalso(RESEND_KEY);
const vapidPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const VAPID_PUB = b64uBytes(new Uint8Array(await crypto.subtle.exportKey("raw", vapidPair.publicKey)));
const VAPID_PRIV = (await crypto.subtle.exportKey("jwk", vapidPair.privateKey)).d!;
const ps = pushFalso(VAPID_PUB);
const SITE = "http://sitio.test", WHSEC = "whsec-prueba";
const rnd = (n: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(n))));
const CRON = rnd(36);
for (const [k, v] of Object.entries({
  SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: await jwt({ role: "service_role" }), SUPABASE_ANON_KEY: await jwt({ role: "anon" }),
  MP_API_URL: mp.url, MP_WEBHOOK_SECRET: WHSEC, MP_CLIENT_ID: "cliente-tutiempo", MP_CLIENT_SECRET: "secreto-tutiempo", SITE_URL: SITE,
  CRON_SECRET: CRON, MP_TOKENS_KEY: rnd(32), MP_OWNER_USER_ID: "9000",
  RESEND_API_KEY: RESEND_KEY, EMAIL_FROM: "TuTiempo <avisos@tutiempo.com.ar>", EMAIL_REPLY_TO: "soporte@tutiempo.com.ar",
  EMAIL_API_URL: rs.url, EMAIL_GAP_MS: "0",
  VAPID_PUBLIC_KEY: VAPID_PUB, VAPID_PRIVATE_KEY: VAPID_PRIV, VAPID_SUBJECT: "mailto:contacto@tutiempo.com.ar", PUSH_TEST_ORIGINS: ps.origin,
})) Deno.env.set(k, v);
const handlers: Record<string, (req: Request) => Promise<Response>> = {};
let loading = "";
(Deno as any).serve = (h: any) => { handlers[loading] = typeof h === "function" ? h : h.handler; return { finished: Promise.resolve(), shutdown: async () => {} }; };
for (const n of ["mp-oauth", "mp-create-preference", "mp-webhook", "email-send", "push-send"]) {
  loading = n;
  await import(`../../supabase/functions/${n}/index.ts`);
}
const fn = (name: string, req: Request) => handlers[name](req);
const body = async (res: Response) => await res.json().catch(() => ({}));
const cronCall = (name: string) => fn(name, new Request(`https://fn.test/functions/v1/${name}`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } }));

// ---------- Datos: profesional con Mercado Pago, cliente, admin, un dispositivo con push cada uno ----------
const owner = crypto.randomUUID(), cli = crypto.randomUUID(), admin = crypto.randomUUID();
await q(`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ($1, 'prof@avisos.test', '{"full_name":"Pía Profesional"}', now()),
  ($2, 'cliente@avisos.test', '{"full_name":"Ana Cliente"}', now()),
  ($3, 'admin@avisos.test', '{"full_name":"Admin Avisos"}', now())`, [owner, cli, admin]);
await q("insert into app_admins (user_id) values ($1)", [admin]);
const pid = Number(await one("select register_provider('Barbería Avisos', 'Calle 1', array['b'], '2284 1', '30111555')", [], owner));
await q("update providers set status = 'active' where id = $1", [pid]);
// ya verificado (DNI aprobado): así el admin lo puede reactivar al final sin las fotos
await q("update providers set dni_verified = true where id = $1", [pid]);
await q("update provider_private set dni_verified_at = now() where provider_id = $1", [pid]);
await q("update provider_settings set online = true, notice_min = 0 where provider_id = $1", [pid]);
await q("delete from provider_hours where provider_id = $1", [pid]);
await q("insert into provider_hours select $1, g, 1, '00:00', '23:59' from generate_series(0, 6) g", [pid]);
const sv = Number(await one("insert into services (provider_id, category_id, name, duration_min, price) values ($1, 'b', 'Corte', 30, 10000) returning id", [pid]));

// Mercado Pago conectado con OAuth (mp-oauth real contra el Mercado Pago falso)
mp.codigo("c-av", "1001");
{
  const r = await fn("mp-oauth", new Request("https://fn.test/functions/v1/mp-oauth", {
    method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: owner, role: "authenticated" })}`, Origin: SITE } }));
  const state = new URL((await body(r)).url).searchParams.get("state");
  await fn("mp-oauth", new Request(`https://fn.test/functions/v1/mp-oauth?code=c-av&state=${state}`));
}
const accId = Number(await one("select id from mp_accounts where provider_id = $1 and status = 'active'", [pid]));
ok("preparación: el profesional conectó Mercado Pago", accId > 0);

// un dispositivo para cada uno (directo en la tabla: push_subscribe solo acepta servicios de push reales y el falso es
// localhost; push_subscribe se prueba en test_push.py y en el navegador, test:pwa)
const devs: Record<string, { endpoint: string }> = {};
for (const [nombre, uid] of [["celu-cliente", cli], ["celu-profesional", owner]] as const) {
  const d = await ps.dispositivo(nombre);
  await q("insert into push_subscriptions (user_id, endpoint, p256dh, auth, label) values ($1, $2, $3, $4, 'Chrome en Android')", [uid, d.endpoint, d.p256dh, d.auth]);
  devs[nombre] = d;
}

// un turno a la hora en punto o y media (BA es -03 todo el año), al menos `h` horas desde ahora, que entre en el día
const BA = (d: Date) => new Date(d.getTime() - 3 * 3600e3);
function slotAt(h: number) {
  let t = new Date(Math.ceil((Date.now() + h * 3600e3) / 1800e3) * 1800e3);
  while (BA(t).getUTCHours() === 23 && BA(t).getUTCMinutes() === 30) t = new Date(t.getTime() + 1800e3);
  return t.toISOString();
}
// reserva real: book_slot (seña con Mercado Pago) → mp-create-preference → pago aprobado → mp-webhook confirma
let payN = 0;
async function reservaPagada(h: number) {
  const r = await one("select book_slot($1, $2)", [sv, slotAt(h)], cli);
  const ids: number[] = r.booking_ids.map(Number);
  await fn("mp-create-preference", new Request("https://fn.test/functions/v1/mp-create-preference", {
    method: "POST", headers: { Authorization: `Bearer ${await jwt({ sub: cli, role: "authenticated" })}`, Origin: SITE, "Content-Type": "application/json" },
    body: JSON.stringify({ booking_ids: ids }) }));
  const pref = mp.preferencias.at(-1)!.body;
  const payId = String(7000 + ++payN);
  mp.pago({ id: payId, collector: "1001", status: "approved", amount: pref.items[0].unit_price, fee: pref.marketplace_fee, ref: pref.external_reference });
  const ts = String(Date.now()), reqId = crypto.randomUUID();
  const v1 = await hmacHex(WHSEC, `id:${payId};request-id:${reqId};ts:${ts};`);
  await fn("mp-webhook", new Request(`https://fn.test/functions/v1/mp-webhook?provider=${pid}&account=${accId}&data.id=${payId}&type=payment`, {
    method: "POST", headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": reqId, "Content-Type": "application/json" },
    body: JSON.stringify({ type: "payment", data: { id: payId } }) }));
  return ids[0];
}

// manda lo pendiente con las funciones reales y devuelve lo que llegó desde la última vez
let pushVisto = 0, mailVisto = 0;
async function enviar() {
  await q("update push_outbox set next_attempt_at = now() where status = 'pending'");
  await q("update email_outbox set next_attempt_at = now() where status = 'pending'");
  const rp = await body(await cronCall("push-send"));
  const re = await body(await cronCall("email-send"));
  const pushes = ps.recibidos.slice(pushVisto), mails = rs.enviados.slice(mailVisto).map((e) => e.body);
  pushVisto = ps.recibidos.length; mailVisto = rs.enviados.length;
  return { pushes, mails, rp, re };
}
type Fila = { tipo: string; para: string; dispara: string; push?: string; email?: string; pushOk?: boolean; emailOk?: boolean | null };
const tabla: Fila[] = [];
const ver = (p?: Recibido) => p ? `«${p.payload?.title}» — ${p.payload?.body}` : "no llegó";
// cada tipo: lo que tiene que llegar por push (dispositivo, título) y por email (destinatario, asunto), o null si no va por email
async function caso(tipo: string, para: string, dispara: string, accion: () => Promise<unknown>,
                    push: { dev: string; title: RegExp; url?: RegExp }, email: { to: string; subject: RegExp } | null) {
  await accion();
  const { pushes, mails } = await enviar();
  const p = pushes.find((x) => x.device === push.dev && push.title.test(x.payload?.title ?? "") && (!push.url || push.url.test(x.payload?.url ?? "")));
  const okP = !!p && p.status === 201 && p.vapidOk && p.encoding === "aes128gcm";
  ok(`${tipo} · push a ${para}: ${ver(p)}`, okP, JSON.stringify(pushes.map((x) => [x.device, x.payload?.title])));
  let okE: boolean | null = null, m: any;
  if (email) {
    m = mails.find((x) => x?.to?.[0] === email.to && email.subject.test(x?.subject ?? ""));
    okE = !!m && /<html/i.test(m.html ?? "") && !!m.text;
    ok(`${tipo} · email a ${para}: ${m ? `«${m.subject}»` : "no llegó"}`, okE, JSON.stringify(mails.map((x) => [x?.to?.[0], x?.subject])));
  }
  tabla.push({ tipo, para, dispara, push: p ? `${p.payload.title} — ${p.payload.body}` : "NO LLEGÓ", email: email ? (m ? m.subject : "NO LLEGÓ") : "—", pushOk: okP, emailOk: okE });
}

// ============================ Cliente ============================
let bConf = 0;
await caso("conf", "cliente", "Pago aprobado de la seña (webhook de Mercado Pago)", async () => { bConf = await reservaPagada(50); },
  { dev: "celu-cliente", title: /^Turno confirmado$/, url: /^\/turno\/\d+$/ }, { to: "cliente@avisos.test", subject: /^Tu turno en Barbería Avisos quedó confirmado$/ });
// la misma reserva le avisa al profesional (se mandó en la misma corrida: se busca en todo lo recibido)
{
  const p = ps.recibidos.find((x) => x.device === "celu-profesional" && x.payload?.title === "Nueva reserva" && x.payload?.url?.includes("/panel/agenda"));
  const m = rs.enviados.map((e) => e.body).find((x) => x?.to?.[0] === "prof@avisos.test" && /^Nueva reserva: Ana/.test(x?.subject ?? ""));
  ok(`new_booking · push al profesional: ${ver(p)}`, !!p && p.status === 201);
  ok(`new_booking · email al profesional: ${m ? `«${m.subject}»` : "no llegó"}`, !!m);
  tabla.push({ tipo: "new_booking", para: "profesional", dispara: "Reserva nueva confirmada desde la app", push: p ? `${p.payload.title} — ${p.payload.body}` : "NO LLEGÓ",
    email: m ? m.subject : "NO LLEGÓ", pushOk: !!p && p.status === 201, emailOk: !!m });
}

const bR24 = await reservaPagada(20);
await enviar();   // su confirmación y su «Nueva reserva» (ya probadas arriba)
await caso("r24", "cliente", "Tarea cada 10 min (send_scheduled_notices): turno en las próximas 24 h", async () => {
  await q("update bookings set created_at = now() - interval '2 days' where id = $1", [bR24]);   // reservado con más de un día
  await q("select send_scheduled_notices()");
}, { dev: "celu-cliente", title: /^Mañana tenés turno$/ }, { to: "cliente@avisos.test", subject: /^Mañana tenés turno en Barbería Avisos$/ });

const bRev = await reservaPagada(2);
await enviar();
await caso("rev", "cliente", "El profesional marca «Asistió» (mark_booking done)", () => q("select mark_booking($1, 'done')", [bRev], owner),
  { dev: "celu-cliente", title: /^¿Qué tal tu turno\?$/ }, { to: "cliente@avisos.test", subject: /^¿Qué tal tu turno en Barbería Avisos\?$/ });

const bCan = await reservaPagada(60);
await enviar();
await caso("cancel", "cliente", "El profesional cancela el turno (cancel_by_provider)", () => q("select cancel_by_provider($1)", [bCan], owner),
  { dev: "celu-cliente", title: /^Se canceló tu turno$/ }, { to: "cliente@avisos.test", subject: /canceló tu turno/ });

const pc = Number(await one("select id from provider_clients where provider_id = $1 and user_id = $2", [pid, cli]));
await caso("msg", "cliente", "El profesional le manda un mensaje (Clientes → Mensaje)", () => q("select send_client_messages(array[$1]::bigint[], 'Mañana abrimos más tarde')", [pc], owner),
  { dev: "celu-cliente", title: /^Mensaje de Barbería Avisos$/ }, null);

// ============================ Profesional ============================
await caso("client_cancel", "profesional", "El cliente cancela un turno confirmado (cancel_by_client)", () => q("select cancel_by_client($1)", [bConf], cli),
  { dev: "celu-profesional", title: /^Se canceló una reserva$/ }, { to: "prof@avisos.test", subject: /^Se canceló una reserva: Ana/ });

await caso("new_follower", "profesional", "Un cliente lo empieza a seguir", () => q("insert into follows (user_id, provider_id) values ($1, $2)", [cli, pid], cli),
  { dev: "celu-profesional", title: /seguidor/i }, null);

// ============================ Seguidores (cliente) ============================
await caso("news", "cliente (seguidor)", "«Avisar a tus seguidores» (notify_followers)", () => q("select notify_followers('Llegaron productos nuevos')", [], owner),
  { dev: "celu-cliente", title: /^Novedad de Barbería Avisos$/ }, null);

await caso("offer", "cliente (seguidor)", "«Ofrecer turno» a un seguidor (offer_slot)", async () => {
  const s = slotAt(72);
  await q("select offer_slot($1, $2::timestamptz, $3)", [s, new Date(new Date(s).getTime() + 1800e3).toISOString(), cli], owner);
}, { dev: "celu-cliente", title: /^Turno libre en Barbería Avisos$/ }, null);

// ============================ Profesional: cobros, Mercado Pago, feriados, cuenta, prueba ============================
await caso("cobros", "profesional", "Novedad de un cobro (devolución, contracargo, mediación, costo o plazo de MP)", () =>
  q("insert into provider_notices (provider_id, kind, ref, body) values ($1, 'mp_refunded', 'av-1', 'Se devolvió una seña')", [pid]),
  { dev: "celu-profesional", title: /^Novedad en tus cobros$/ }, null);

await caso("mp_reconnect", "profesional", "Mercado Pago se desconectó (hay que volver a conectarlo)", () =>
  q("insert into provider_notices (provider_id, kind, ref, body) values ($1, 'mp_reconnect', 'av-2', 'Volvé a conectar Mercado Pago')", [pid]),
  { dev: "celu-profesional", title: /^Volvé a conectar Mercado Pago$/ }, null);

// «Avisarle» del admin solo va a quien no tiene Mercado Pago conectado: primero lo desconecta
await caso("mp_reconnect", "profesional", "El admin le pide conectar Mercado Pago («Avisarle», admin_nudge_mp)", async () => {
  await q("select mp_disconnect()", [], owner);
  await q("select admin_nudge_mp($1)", [pid], admin);
}, { dev: "celu-profesional", title: /^Conectá Mercado Pago$/ }, null);

await caso("holiday", "profesional", "Tarea diaria: feriado en los próximos 7 días (holiday_notices)", async () => {
  const dia = new Date(Date.now() + 5 * 864e5 - 3 * 3600e3).toISOString().slice(0, 10);
  await q("select holidays_sync_save($1, $2::jsonb)", [Number(dia.slice(0, 4)), JSON.stringify([{ fecha: dia, tipo: "inamovible", nombre: "Feriado Avisos" }])], undefined, "service_role");
  await q("select admin_holidays_confirm($1)", [Number(dia.slice(0, 4))], admin);
  await q("select holiday_notices()");
}, { dev: "celu-profesional", title: /feriado/i }, null);

await caso("test", "quien lo pide", "«Mandarme una de prueba» en Mi perfil (push_test)", () => q("select push_test($1)", [devs["celu-profesional"].endpoint], owner),
  { dev: "celu-profesional", title: /prueba/i }, null);

await caso("account", "profesional", "El admin suspende la cuenta", () => q("select admin_set_provider($1, 'suspended', null, 'Prueba de avisos')", [pid], admin),
  { dev: "celu-profesional", title: /^Tu cuenta está suspendida$/ }, { to: "prof@avisos.test", subject: /^Tu cuenta de TuTiempo está suspendida$/ });
await caso("account", "profesional", "El admin la reactiva", () => q("select admin_set_provider($1, 'active', null, null)", [pid], admin),
  { dev: "celu-profesional", title: /^Tu cuenta está activa de nuevo$/ }, { to: "prof@avisos.test", subject: /^Tu cuenta de TuTiempo está activa de nuevo$/ });

// ---------- nada quedó en la cola sin mandar ni falló ----------
const quedan = await q("select kind, status, skip_reason, last_status from push_outbox where user_id = any($1::uuid[]) and status <> 'sent' order by id", [[cli, owner]]);
ok("push: nada de estos usuarios quedó pendiente ni falló (lo salteado, con su motivo)", quedan.every((r: any) => r.status === "skipped"), JSON.stringify(quedan));
const quedanE = await q("select kind, status, skip_reason, last_error from email_outbox where user_id = any($1::uuid[]) and status <> 'sent' order by id", [[cli, owner]]);
ok("email: nada de estos usuarios quedó pendiente ni falló", quedanE.every((r: any) => r.status === "skipped"), JSON.stringify(quedanE));
const tipos = new Set(tabla.map((t) => t.tipo));
const todos = (await one("select pg_get_constraintdef(oid) from pg_constraint where conname = 'push_outbox_kind_check'")).match(/'([a-z0-9_]+)'/g).map((s: string) => s.slice(1, -1));
const dejados = ["r2", "bday"];   // dejaron de mandarse el 7/11 (Bloque 5, 20261106200000_bloques_5_6.sql)
ok("se probó cada tipo de push que existe (salvo r2 y bday, que ya no se mandan)", todos.every((k: string) => tipos.has(k) || dejados.includes(k)),
   todos.filter((k: string) => !tipos.has(k) && !dejados.includes(k)).join(", "));

console.log("\n| Tipo | Para | Lo dispara | Push (título — texto) | Email (asunto) |\n|---|---|---|---|---|");
for (const t of tabla) {
  console.log(`| ${t.tipo} | ${t.para} | ${t.dispara} | ${t.pushOk ? "✔" : "✘"} ${t.push} | ${t.emailOk === null ? "—" : (t.emailOk ? "✔ " : "✘ ") + t.email} |`);
}
console.log("");
await ps.cerrar(); await rs.cerrar(); await mp.cerrar(); await db.end();
console.log(F ? `${F} FALLAS` : "TODO OK");
Deno.exit(F ? 1 : 0);

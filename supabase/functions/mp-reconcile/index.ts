// Consulta a Mercado Pago por los cobros abiertos que todavía no tienen pago registrado (Paso 1, v4): si el aviso del
// webhook no llegó o se rechazó (por ejemplo, por la clave de la firma), el pago igual termina confirmado o devuelto.
// Busca los pagos del cobro por su external_reference (los turnos) con la llave de la cuenta que cobra, vuelve a pedir
// cada uno por su id y lo registra igual que el webhook (_shared/pago.ts). Un pago encontrado así deja el rastro
// 'recovered' en mp_webhook_events: en "Para revisar" se ve que los avisos no están llegando.
//  POST con CRON_SECRET (cron tt-mp-sync, cada 2 minutos) → los cobros que tocan (checkouts_due).
//  POST {token} desde la pantalla de regreso (sin sesión) → solo ese cobro, a lo sumo cada 15 segundos (checkout_poke).
//    No devuelve datos: el estado lo lee la pantalla con checkout_status.
// Desplegar con verify_jwt = false.
import { accountById, accountToken, admin, cors, cronOnly, json, MP_API, providerAccounts, type MpAccount } from "../_shared/util.ts";
import { discard, processPayment, registered } from "../_shared/pago.ts";

type Db = ReturnType<typeof admin>;
type Due = { id: number; booking_ids: number[]; provider_id: number; mp_account_id: number | null; external_reference: string };
const WANTED = ["approved", "refunded", "cancelled", "charged_back", "in_mediation"];

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);
  const db = admin();
  try {
    const body = await req.json().catch(() => ({}));
    let due: Due[];
    if (typeof body?.token === "string") {
      if (!/^[0-9a-f]{64}$/.test(body.token)) return json({ ok: true }, 200, h);
      const poke = await db.rpc("checkout_poke", { p_token: body.token });
      if (poke.error) { console.error("checkout_poke", poke.error); return json({ error: "server_error" }, 500, h); }
      if (!poke.data) return json({ ok: true }, 200, h);   // cerrado, inexistente o consultado hace menos de 15 s
      const r = await db.rpc("checkouts_due", { p_limit: 1, p_only: poke.data });
      if (r.error) { console.error("checkouts_due", r.error); return json({ error: "server_error" }, 500, h); }
      due = r.data ?? [];
    } else {
      const denied = cronOnly(req);
      if (denied) return denied;
      const r = await db.rpc("checkouts_due", { p_limit: 30 });
      if (r.error) { console.error("checkouts_due", r.error); return json({ error: "server_error" }, 500); }
      due = r.data ?? [];
    }
    let found = 0;
    for (const ck of due) {
      try {
        if (await check(db, ck)) found++;
      } catch (e) {
        console.error("mp-reconcile", ck.id, e instanceof Error ? e.message : e);
        await db.rpc("checkout_checked", { p_id: ck.id, p_found: false, p_error: String(e instanceof Error ? e.message : e).slice(0, 200) });
      }
    }
    if (due.length) console.log(`mp-reconcile: ${due.length} cobros consultados, ${found} pagos registrados sin aviso`);
    return json({ ok: true, checked: due.length, found }, 200, h);
  } catch (e) {
    console.error("mp-reconcile", e instanceof Error ? e.message : e);
    return json({ error: "server_error" }, 500, h);
  }
});

// un cobro: true si quedó algún pago registrado (lo encontró ahora o ya estaba)
async function check(db: Db, ck: Due): Promise<boolean> {
  let accounts: MpAccount[] = [];
  if (ck.mp_account_id) {
    const acc = await accountById(db, ck.mp_account_id);
    if (acc && acc.provider_id === ck.provider_id) accounts = [acc];
  }
  if (!accounts.length) accounts = await providerAccounts(db, ck.provider_id);
  let any = false, answered = false, lastError: string | null = accounts.length ? null : "el prestador no tiene cuentas de Mercado Pago";
  for (const acc of accounts) {
    const token = await accountToken(db, acc);
    if (!token) { lastError = "sin llave para consultar"; continue; }
    const q = new URLSearchParams({ external_reference: ck.external_reference, sort: "date_created", criteria: "desc", limit: "20" });
    const r = await fetch(`${MP_API}/v1/payments/search?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { lastError = `Mercado Pago respondió ${r.status} al buscar`; continue; }
    answered = true;
    const results: Record<string, any>[] = (await r.json())?.results ?? [];
    for (const hit of results) {
      const payId = String(hit?.id ?? "");
      if (!payId || !WANTED.includes(String(hit?.status))) continue;
      if (String(hit?.external_reference ?? "") !== ck.external_reference) continue;
      if (await registered(db, payId)) { any = true; continue; }
      // el pago completo, por su id (lo mismo que consulta el webhook)
      const one = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(payId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!one.ok) { lastError = `Mercado Pago respondió ${one.status} al pedir el pago`; continue; }
      const pay = await one.json();
      if (pay.status !== "approved") {
        // devuelto o cancelado antes de que la app lo registrara: queda el rastro para revisarlo
        await discard(db, payId, ck.provider_id, acc.id, "recovered", `pago sin aviso, ya ${pay.status} en Mercado Pago (no se registró)`);
        continue;
      }
      const res = await processPayment(db, pay, ck.provider_id, acc, payId);
      if (res.done) {
        any = true;
        await discard(db, payId, ck.provider_id, acc.id, "recovered", "pago aprobado sin aviso: lo encontró la consulta automática");
      }
    }
    if (answered) break;   // la cuenta que cobra respondió: no hace falta preguntar con las otras
  }
  const { error } = await db.rpc("checkout_checked", { p_id: ck.id, p_found: any, p_error: answered ? null : lastError });
  if (error) console.error("checkout_checked", error);
  return any;
}

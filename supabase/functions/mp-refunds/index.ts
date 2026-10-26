// Ejecuta las devoluciones pendientes (tabla refunds): cuando cancela el prestador, el horario ya no estaba libre, el
// monto no alcanzaba, etc. Cada devolución usa la llave de la cuenta que COBRÓ ese pago (aunque el prestador haya
// desconectado o reconectado otra). Cada intento queda registrado; si falla, se reintenta con backoff (D19) y desde el
// primer fallo aparece en "Para revisar" del panel admin.
// La llama pg_cron cada 10 minutos (public.run_refunds) con CRON_SECRET, que el cron lee de Vault; cualquier otra
// llamada se rechaza (ni la service_role sirve: la clave del cron solo dispara esto).
import { accountById, accountToken, admin, cronOnly, json, MP_API, type MpAccount } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  const db = admin();
  const { data: rows, error } = await db.rpc("refunds_due", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);
  let done = 0, failed = 0;
  const accounts = new Map<number, MpAccount | null>();
  for (const rf of rows ?? []) {
    let result: { ok: boolean; id?: string; error?: string };
    if (!accounts.has(rf.mp_account_id)) accounts.set(rf.mp_account_id, rf.mp_account_id ? await accountById(db, rf.mp_account_id) : null);
    const token = await accountToken(db, accounts.get(rf.mp_account_id) ?? null);
    if (!rf.mp_payment_id) result = { ok: false, error: "No hay un pago de Mercado Pago ligado a esta devolución" };
    else if (!token) result = { ok: false, error: "La cuenta de Mercado Pago que cobró este pago no tiene llave (reconectar esa cuenta o devolver a mano)" };
    else {
      try {
        const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(rf.mp_payment_id)}/refunds`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": `refund-${rf.id}` },
          body: JSON.stringify({ amount: rf.amount }),
        });
        const body = await r.json().catch(() => ({}));
        result = r.ok ? { ok: true, id: body.id != null ? String(body.id) : undefined }
                      : { ok: false, error: `${r.status} ${body.message ?? body.error ?? ""}`.trim().slice(0, 300) };
      } catch (e) {
        result = { ok: false, error: `Sin respuesta de Mercado Pago: ${String(e).slice(0, 200)}` };
      }
    }
    const { error: e2 } = await db.rpc("refund_result", { p_refund: rf.id, p_ok: result.ok, p_mp_refund_id: result.id ?? null, p_error: result.error ?? null });
    if (e2) console.error("refund_result", rf.id, e2);
    if (result.ok) done++; else { failed++; console.error("refund", rf.id, result.error); }
  }
  // llaves que ya no hacen falta para devoluciones ni consultas: se borran (purge_mp_accounts)
  await db.rpc("purge_mp_accounts");
  // llaves que vencen en menos de 15 días (activas y de solo devoluciones): se renuevan ahora
  const soon = new Date(Date.now() + 15 * 864e5).toISOString();
  const { data: exp } = await db.from("mp_accounts").select("id, provider_id, mp_user_id, status, access_token, refresh_token, expires_at")
    .neq("status", "purged").lt("expires_at", soon).not("refresh_token", "is", null).limit(20);
  for (const acc of (exp as MpAccount[]) ?? []) await accountToken(db, acc);
  return json({ done, failed });
});

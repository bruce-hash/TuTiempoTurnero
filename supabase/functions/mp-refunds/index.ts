// Procesa devoluciones pendientes (cuando cancela el prestador o el horario ya no estaba libre).
// La llama pg_cron cada 10 minutos con la service_role key; cualquier otra llamada se rechaza.
import { admin, env, json, safeEqual, sellerToken, MP_API } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  if (!safeEqual(auth, `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`)) return json({ error: "forbidden" }, 403);
  const db = admin();
  const { data: rows, error } = await db.from("bookings")
    .select("id, provider_id, refund_pending, mp_payment_id, series_id")
    .gt("refund_pending", 0).limit(50);
  if (error) return json({ error: error.message }, 500);
  let done = 0, failed = 0;
  for (const b of rows ?? []) {
    // el pago de una serie quedó registrado en el primer turno de la serie
    let payId = b.mp_payment_id;
    if (!payId && b.series_id) {
      const { data: first } = await db.from("bookings").select("mp_payment_id").eq("series_id", b.series_id).not("mp_payment_id", "is", null).limit(1).maybeSingle();
      payId = first?.mp_payment_id ?? null;
    }
    const token = await sellerToken(db, b.provider_id);
    if (!payId || !token) { failed++; continue; }
    const r = await fetch(`${MP_API}/v1/payments/${payId}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": `refund-${b.id}` },
      body: JSON.stringify({ amount: b.refund_pending }),
    });
    if (r.ok) { await db.from("bookings").update({ refund_pending: 0 }).eq("id", b.id); done++; }
    else { failed++; console.error("refund", b.id, r.status, await r.text()); }
  }
  // prestadores eliminados: su llave de Mercado Pago se borra cuando ya no quedan devoluciones pendientes
  await db.rpc("purge_deleted_secrets");
  // llaves que vencen en menos de 15 días: se renuevan ahora (así ningún prestador queda sin poder cobrar)
  const soon = new Date(Date.now() + 15 * 864e5).toISOString();
  const { data: exp } = await db.from("provider_secrets").select("provider_id").lt("mp_expires_at", soon).not("mp_refresh_token", "is", null).limit(20);
  for (const x of exp ?? []) await sellerToken(db, x.provider_id);
  return json({ done, failed });
});

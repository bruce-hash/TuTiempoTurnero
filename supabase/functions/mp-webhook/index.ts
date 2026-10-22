// Webhook de Mercado Pago: verifica la firma, consulta el pago real en la API de MP
// y recién ahí confirma el turno (función confirm_payment, idempotente).
// Desplegar con verify_jwt = false (lo llama Mercado Pago, no un usuario).
import { admin, env, hmacHex, json, safeEqual, sellerToken, MP_API } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "");
    const type = url.searchParams.get("type") ?? body?.type ?? "";
    const pid = Number(url.searchParams.get("provider"));

    // Firma: x-signature = "ts=...,v1=..." sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
    const sig = req.headers.get("x-signature") ?? "";
    const reqId = req.headers.get("x-request-id") ?? "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=").map((x) => x.trim())));
    const manifest = `id:${dataId.toLowerCase()};request-id:${reqId};ts:${parts.ts};`;
    const expected = await hmacHex(env("MP_WEBHOOK_SECRET"), manifest);
    if (!parts.ts || !parts.v1 || !safeEqual(expected, parts.v1)) return json({ error: "bad_signature" }, 401);
    if (Math.abs(Date.now() - Number(parts.ts)) > 10 * 60 * 1000 && Math.abs(Date.now() / 1000 - Number(parts.ts)) > 600) {
      return json({ error: "stale" }, 401);
    }
    if (type !== "payment" || !dataId || !Number.isInteger(pid)) return json({ ok: true });

    const db = admin();
    const token = await sellerToken(db, pid);
    if (!token) return json({ error: "unknown_provider" }, 200);
    const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return json({ error: "mp_lookup_failed" }, 502);
    const pay = await r.json();
    if (pay.status !== "approved") return json({ ok: true, status: pay.status });
    if (pay.currency_id && pay.currency_id !== "ARS") return json({ error: "bad_currency" }, 200);
    // el pago tiene que haber entrado a la cuenta de ESTE prestador
    const { data: pp } = await db.from("provider_private").select("mp_user_id").eq("provider_id", pid).maybeSingle();
    if (pp?.mp_user_id && pay.collector_id && String(pay.collector_id) !== String(pp.mp_user_id)) return json({ error: "wrong_collector" }, 200);

    const ids = String(pay.external_reference ?? "").split(",").map(Number).filter(Number.isInteger);
    if (!ids.length) return json({ ok: true });
    const { data, error } = await db.rpc("confirm_payment", {
      p_booking_ids: ids, p_payment_id: String(pay.id), p_amount: Math.round(Number(pay.transaction_amount)),
    });
    if (error) { console.error("confirm_payment", error); return json({ error: error.message }, 409); }
    return json({ ok: true, result: data });
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
});

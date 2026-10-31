// Webhook de Mercado Pago: verifica la firma, consulta el pago real en la API de MP (con la llave de la cuenta que lo
// cobró) y lo registra en la base (_shared/pago.ts, lo mismo que hace mp-reconcile cuando el aviso no llega).
// Ante una aprobación que ya quedó registrada nunca responde error (así Mercado Pago no reintenta para siempre); si falla
// un cambio de estado (devuelto, contracargo, reclamo), responde 500 para que Mercado Pago lo reintente.
// Ningún aviso se descarta sin rastro (Paso 1, v4): también los rechazados ANTES de procesar (sin firma, firma inválida
// o vencida, sin datos, configuración incompleta) quedan en mp_webhook_events, sin datos personales, y aparecen en
// "Para revisar". Un aviso rechazado no se usa para nada más que adelantar la consulta de los cobros abiertos de ese
// prestador (checkout_hint): lo que vale es lo que responde la API de Mercado Pago.
// Desplegar con verify_jwt = false (lo llama Mercado Pago, no un usuario).
import { accountById, accountToken, admin, hmacHex, json, MP_API, providerAccounts, safeEqual, type MpAccount } from "../_shared/util.ts";
import { discard, processPayment, registered } from "../_shared/pago.ts";

const posInt = (v: string | null) => (v && /^\d{1,12}$/.test(v) && Number(v) > 0 ? Number(v) : null);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  let dataId = "";
  const db = admin();
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    // formato de webhooks (data.id y type) o el viejo de IPN (id y topic), por si la cuenta manda ese
    dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? url.searchParams.get("id") ?? "");
    const type = url.searchParams.get("type") ?? body?.type ?? url.searchParams.get("topic") ?? body?.topic ?? "";
    const pid = posInt(url.searchParams.get("provider"));
    const accId = posInt(url.searchParams.get("account"));
    const reject = async (reason: string, detail: string, status: number, error: string) => {
      console.warn("mp-webhook rechazado", reason, detail);
      // solo los avisos de pagos: un merchant_order sin firma no dice nada de un pago
      if (!type || type === "payment") {
        await discard(db, dataId, pid, accId, reason, detail);
        if (pid) { const { error: e } = await db.rpc("checkout_hint", { p_provider: pid }); if (e) console.error("checkout_hint", e); }
      }
      return json({ error }, status);
    };

    const secret = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
    if (!secret) return await reject("config_error", "falta el secreto MP_WEBHOOK_SECRET en la función", 500, "config");

    // Firma: x-signature = "ts=...,v1=..." sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Como indica la
    // documentación de Mercado Pago, si el aviso no trae data.id o x-request-id, esa parte se omite del texto firmado.
    const sig = req.headers.get("x-signature") ?? "";
    const reqId = req.headers.get("x-request-id") ?? "";
    if (!sig) {
      const ipn = url.searchParams.has("topic") || url.searchParams.has("id") && !url.searchParams.has("data.id");
      return await reject("no_signature", ipn ? "aviso sin x-signature con formato IPN (topic/id)" : `aviso sin x-signature${reqId ? "" : " ni x-request-id"}`, 401, "bad_signature");
    }
    const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=").map((x) => x.trim())));
    if (!parts.ts || !parts.v1) return await reject("bad_signature", "x-signature sin ts o sin v1", 401, "bad_signature");
    const manifest = (dataId ? `id:${dataId.toLowerCase()};` : "") + (reqId ? `request-id:${reqId};` : "") + `ts:${parts.ts};`;
    if (!safeEqual(await hmacHex(secret, manifest), parts.v1)) {
      return await reject("bad_signature", `la firma no coincide con MP_WEBHOOK_SECRET${reqId ? "" : " (sin x-request-id)"}`, 401, "bad_signature");
    }
    const ageMs = Math.min(Math.abs(Date.now() - Number(parts.ts)), Math.abs(Date.now() - Number(parts.ts) * 1000));
    if (!(ageMs <= 10 * 60 * 1000)) {
      return await reject("stale_signature", `firma de hace ${Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : "?"} min (máximo 10)`, 401, "stale");
    }
    if (type !== "payment") return json({ ok: true });   // merchant_order y otros: nada que hacer
    if (!dataId) return await reject("bad_request", "aviso de pago sin id de pago", 200, "bad_request");
    if (!pid) {
      return await reject("bad_request", "aviso sin ?provider en la dirección (¿webhook configurado en el panel de Mercado Pago?)", 200, "bad_request");
    }

    // La cuenta que cobró: la del aviso (los cobros nuevos la mandan) o, en avisos viejos, las del prestador.
    let accounts: MpAccount[] = [];
    if (accId) {
      const acc = await accountById(db, accId);
      if (acc && acc.provider_id === pid) accounts = [acc];
    } else {
      accounts = await providerAccounts(db, pid);
    }
    let pay: Record<string, any> | null = null, used: MpAccount | null = null, lookupFailed = false;
    for (const acc of accounts) {
      const token = await accountToken(db, acc);
      if (!token) continue;
      const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(dataId)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) { pay = await r.json(); used = acc; break; }
      if (r.status !== 404) lookupFailed = true;
    }
    if (!pay || !used) {
      if (await registered(db, dataId)) return json({ ok: true, status: "already_registered" });
      if (!accounts.length) { await discard(db, dataId, pid, accId, "unknown_provider"); return json({ error: "unknown_provider" }, 200); }
      if (lookupFailed) return json({ error: "mp_lookup_failed" }, 502);   // Mercado Pago no respondió bien: que reintente
      await discard(db, dataId, pid, accounts[0]?.id ?? null, "payment_not_found");
      return json({ error: "payment_not_found" }, 200);
    }
    const res = await processPayment(db, pay, pid, used, dataId);
    return json(res.body, res.status);
  } catch (e) {
    console.error(e);
    if (dataId && (await registered(db, dataId).catch(() => false))) return json({ ok: true, status: "already_registered" });
    return json({ error: "server_error" }, 500);
  }
});

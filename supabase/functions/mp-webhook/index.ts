// Webhook de Mercado Pago: verifica la firma, consulta el pago real en la API de MP (con la llave de la cuenta que lo
// cobró) y lo registra en la base (_shared/pago.ts, lo mismo que hace mp-reconcile cuando el aviso no llega).
// Ante una aprobación que ya quedó registrada nunca responde error (así Mercado Pago no reintenta para siempre); si falla
// un cambio de estado (devuelto, contracargo, reclamo), responde 500 para que Mercado Pago lo reintente.
// Ningún aviso se descarta sin rastro (Paso 1, v4): también los rechazados ANTES de procesar (sin firma, firma inválida
// o vencida, sin datos, configuración incompleta) quedan en mp_webhook_events, sin datos personales, y aparecen en
// "Para revisar". Un aviso rechazado no se usa para nada más que adelantar la consulta de los cobros abiertos de ese
// prestador (checkout_hint): lo que vale es lo que responde la API de Mercado Pago.
// Desplegar con verify_jwt = false (lo llama Mercado Pago, no un usuario).
import { accountById, accountsByMpUser, accountToken, admin, hmacHex, json, MP_API, providerAccounts, safeEqual, type MpAccount } from "../_shared/util.ts";
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
    const urlId = url.searchParams.get("data.id"), bodyId = body?.data?.id != null ? String(body.data.id) : null, ipnId = url.searchParams.get("id");
    const idFrom = urlId ? "url" : bodyId ? "body" : ipnId ? "ipn" : "none";
    // 11/11 · H06: aviso con el formato viejo de IPN (?id=…&topic=…, sin data.id). Mercado Pago no lo firma con la clave
    // de Webhooks: si no valida, se ignora (200, para que no reintente) y solo adelanta la consulta de los cobros.
    const isIpn = idFrom === "ipn";
    dataId = String(urlId ?? bodyId ?? ipnId ?? "");
    const type = url.searchParams.get("type") ?? body?.type ?? url.searchParams.get("topic") ?? body?.topic ?? "";
    let pid = posInt(url.searchParams.get("provider"));
    let accId = posInt(url.searchParams.get("account"));
    // 11/11 · H06: el aviso del webhook del panel de Mercado Pago no trae ?provider: trae el user_id de la cuenta
    // conectada que cobró
    const mpUser = body?.user_id != null ? String(body.user_id) : "";
    // La cuenta que cobró: la del aviso (los cobros nuevos la mandan en la dirección), la del user_id del aviso del panel
    // (antes de la firma, para que el rechazo quede con su prestador) o, en avisos viejos, las del prestador.
    let accounts: MpAccount[] = [];
    if (!pid && mpUser) {
      const found = await accountsByMpUser(db, mpUser);
      // la misma cuenta de Mercado Pago conectada en dos negocios: el de la cuenta que cobra
      if (found.length) { pid = found[0].provider_id; accId = null; accounts = found.filter((a) => a.provider_id === pid); }
    }
    let diag: Record<string, unknown> | undefined;
    const reject = async (reason: string, detail: string, status: number, error: string) => {
      console.warn("mp-webhook rechazado", reason, detail, diag ? JSON.stringify(diag) : "");
      // solo los avisos de pagos: un merchant_order sin firma no dice nada de un pago
      if (!type || type === "payment") {
        await discard(db, dataId, pid, accId, reason, detail, diag);
        if (pid) { const { error: e } = await db.rpc("checkout_hint", { p_provider: pid }); if (e) console.error("checkout_hint", e); }
      }
      return json({ error }, status);
    };

    // varias claves separadas por coma: la actual y, mientras se cambia, la anterior (o la de otra aplicación)
    const secrets = (Deno.env.get("MP_WEBHOOK_SECRET") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!secrets.length) return await reject("config_error", "falta el secreto MP_WEBHOOK_SECRET en la función", 500, "config");

    // Firma: x-signature = "ts=...,v1=..." sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Como indica la
    // documentación de Mercado Pago, data.id es el de la dirección del aviso (en minúsculas si tiene letras) y si el aviso
    // no trae data.id o x-request-id, esa parte se omite del texto firmado.
    const sig = req.headers.get("x-signature") ?? "";
    const reqId = req.headers.get("x-request-id") ?? "";
    if (!sig) {
      if (isIpn) return await reject("ipn_ignored", "aviso IPN (formato viejo id/topic) sin x-signature: ignorado, se consulta el cobro", 200, "ipn_ignored");
      const ipn = url.searchParams.has("topic");
      return await reject("no_signature", ipn ? "aviso sin x-signature con formato IPN (topic/id)" : `aviso sin x-signature${reqId ? "" : " ni x-request-id"}`, 401, "bad_signature");
    }
    // el encabezado puede traer más de un v1 (por ejemplo, mientras Mercado Pago cambia la clave)
    let ts = "";
    const v1s: string[] = [];
    for (const piece of sig.split(/[,\s]+/)) {
      const [k, ...rest] = piece.split("=");
      const v = rest.join("=").trim();
      if (k.trim() === "ts" && v) ts = v;
      else if (k.trim() === "v1" && v) v1s.push(v.toLowerCase());
    }
    // lo que se arma para firmar: el data.id de la dirección (o del cuerpo), como manda la documentación (minúsculas) y,
    // de respaldo, tal como vino; con cada clave. Si coincide una variante que no es la principal, queda en el registro.
    const ids = [...new Set([urlId, bodyId, ipnId].filter((x): x is string => !!x))];
    const manifestOf = (id: string) => (id ? `id:${id};` : "") + (reqId ? `request-id:${reqId};` : "") + `ts:${ts};`;
    const main = manifestOf(dataId.toLowerCase());
    diag = {
      id_from: idFrom, id_url: urlId, id_body: bodyId, request_id: reqId || null, ts: ts || null, manifest: main,
      v1_count: v1s.length, v1_start: v1s[0]?.slice(0, 8) ?? null, secrets: secrets.length,
      query: [...url.searchParams.keys()], user_id: mpUser || null, live_mode: body?.live_mode ?? null,
      action: body?.action ?? null, api_version: body?.api_version ?? null,
    };
    if ((!ts || !v1s.length) && isIpn) return await reject("ipn_ignored", "aviso IPN (formato viejo id/topic) con x-signature incompleta: ignorado, se consulta el cobro", 200, "ipn_ignored");
    if (!ts || !v1s.length) return await reject("bad_signature", "x-signature sin ts o sin v1", 401, "bad_signature");
    const variants: [string, string][] = [["principal", main]];
    for (const id of ids) {
      for (const [form, value] of [["minúsculas", id.toLowerCase()], ["como vino", id]] as const) {
        const m = manifestOf(value);
        if (!variants.some(([, x]) => x === m)) variants.push([`id de ${id === urlId ? "la dirección" : id === bodyId ? "el cuerpo" : "id="} (${form})`, m]);
      }
    }
    let via = "";
    for (const [si, secret] of secrets.entries()) {
      for (const [name, m] of variants) {
        const h = await hmacHex(secret, m);
        if (v1s.some((v) => safeEqual(h, v))) { via = `${name}${secrets.length > 1 ? `, clave ${si + 1}` : ""}`; break; }
      }
      if (via) break;
    }
    if (!via && isIpn) {
      return await reject("ipn_ignored", "aviso IPN (formato viejo id/topic): no valida con la clave de Webhooks; ignorado, se consulta el cobro", 200, "ipn_ignored");
    }
    if (!via) {
      return await reject("bad_signature", `la firma no coincide con MP_WEBHOOK_SECRET${reqId ? "" : " (sin x-request-id)"}`, 401, "bad_signature");
    }
    const ageMs = Math.min(Math.abs(Date.now() - Number(ts)), Math.abs(Date.now() - Number(ts) * 1000));
    if (!(ageMs <= 10 * 60 * 1000)) {
      return await reject("stale_signature", `firma de hace ${Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : "?"} min (máximo 10)`, 401, "stale");
    }
    // la firma valida: el aviso de "Para revisar" se apaga solo (H06)
    {
      const { error: e } = await db.rpc("mp_webhook_ok", { p_provider: pid, p_via: via });
      if (e) console.error("mp_webhook_ok", e);
      if (via !== "principal") console.warn("mp-webhook: firma válida con otra variante", via, JSON.stringify(diag));
    }
    if (type !== "payment") return json({ ok: true });   // merchant_order y otros: nada que hacer
    if (!dataId) return await reject("bad_request", "aviso de pago sin id de pago", 200, "bad_request");
    if (!pid) {
      return await reject("bad_request", mpUser ? `aviso del panel de una cuenta de Mercado Pago que no está conectada (user_id ${mpUser.slice(0, 20)})`
        : "aviso sin ?provider en la dirección ni user_id (¿webhook configurado en el panel de Mercado Pago?)", 200, "bad_request");
    }
    if (accounts.length) {
      // ya están (por el user_id)
    } else if (accId) {
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

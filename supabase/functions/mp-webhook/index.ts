// Webhook de Mercado Pago: verifica la firma, consulta el pago real en la API de MP (con la llave de la cuenta que lo
// cobró) y lo registra en la base:
//  - aprobado → confirm_payment (idempotente; nunca falla: lo que no se puede confirmar queda para devolver o revisar);
//  - devuelto, cancelado, contracargo o reclamo → payment_mp_update (D17, D18).
// Ante una aprobación que ya quedó registrada nunca responde error (así Mercado Pago no reintenta para siempre); si falla
// un cambio de estado (devuelto, contracargo, reclamo), responde 500 para que Mercado Pago lo reintente.
// Ningún aviso se descarta sin rastro: los que no se procesan quedan en mp_webhook_events (sin datos personales).
// Desplegar con verify_jwt = false (lo llama Mercado Pago, no un usuario).
import { accountById, accountToken, admin, env, hmacHex, json, mpClean, providerAccounts, safeEqual, MP_API, type MpAccount } from "../_shared/util.ts";

const CHANGES = ["refunded", "cancelled", "charged_back", "in_mediation"];

// comisión de TuTiempo que informa Mercado Pago (application_fee); null si no vino
function appFee(pay: Record<string, any>): number | null {
  const fd = Array.isArray(pay.fee_details) ? pay.fee_details.find((f: any) => f?.type === "application_fee") : null;
  const v = fd?.amount ?? pay.marketplace_fee;
  return v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true });
  let dataId = "";
  const db = admin();
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    dataId = String(url.searchParams.get("data.id") ?? body?.data?.id ?? "");
    const type = url.searchParams.get("type") ?? body?.type ?? "";
    const pid = Number(url.searchParams.get("provider"));
    const accId = Number(url.searchParams.get("account"));

    // Firma: x-signature = "ts=...,v1=..." sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". Como indica la
    // documentación de Mercado Pago, si el aviso no trae data.id o x-request-id, esa parte se omite del texto firmado.
    const sig = req.headers.get("x-signature") ?? "";
    const reqId = req.headers.get("x-request-id") ?? "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=").map((x) => x.trim())));
    const manifest = (dataId ? `id:${dataId.toLowerCase()};` : "") + (reqId ? `request-id:${reqId};` : "") + `ts:${parts.ts};`;
    const expected = await hmacHex(env("MP_WEBHOOK_SECRET"), manifest);
    if (!parts.ts || !parts.v1 || !safeEqual(expected, parts.v1)) return json({ error: "bad_signature" }, 401);
    if (Math.abs(Date.now() - Number(parts.ts)) > 10 * 60 * 1000 && Math.abs(Date.now() / 1000 - Number(parts.ts)) > 600) {
      return json({ error: "stale" }, 401);
    }
    if (type !== "payment" || !dataId || !Number.isInteger(pid)) return json({ ok: true });

    // La cuenta que cobró: la del aviso (los cobros nuevos la mandan) o, en avisos viejos, las del prestador.
    let accounts: MpAccount[] = [];
    if (Number.isInteger(accId) && accId > 0) {
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
    const discard = async (reason: string, acc: number | null) => {
      const { error } = await db.rpc("mp_webhook_event", { p_payment_id: dataId, p_provider: pid, p_account: acc, p_reason: reason });
      if (error) console.error("mp_webhook_event", error);
    };
    if (!pay || !used) {
      if (await registered(db, dataId)) return json({ ok: true, status: "already_registered" });
      if (!accounts.length) { await discard("unknown_provider", Number.isInteger(accId) && accId > 0 ? accId : null); return json({ error: "unknown_provider" }, 200); }
      if (lookupFailed) return json({ error: "mp_lookup_failed" }, 502);   // Mercado Pago no respondió bien: que reintente
      await discard("payment_not_found", accounts[0]?.id ?? null);
      return json({ error: "payment_not_found" }, 200);
    }
    const raw = mpClean(pay);
    if (pay.currency_id && pay.currency_id !== "ARS") { await discard("bad_currency", used.id); return json({ error: "bad_currency" }, 200); }
    // el pago tiene que haber entrado a la cuenta que lo consultó. Sin mp_user_id (o sin collector_id) no se puede
    // comprobar: se trata igual que un cobrador equivocado. Queda en "Para revisar" y no confirma turnos.
    if (!used.mp_user_id || pay.collector_id == null || String(pay.collector_id) !== String(used.mp_user_id)) {
      console.error("wrong_collector", dataId, used.id);
      await discard("wrong_collector", used.id);
      const ids = String(pay.external_reference ?? "").split(",").map(Number).filter(Number.isInteger);
      const { error } = await db.rpc("payment_review", {
        p_payment_id: String(pay.id ?? dataId), p_provider: pid, p_collector: pay.collector_id != null ? String(pay.collector_id) : null,
        p_booking_ids: ids, p_amount: Math.round(Number(pay.transaction_amount)) || 0, p_reason: "wrong_collector", p_raw: raw,
      });
      if (error) { console.error("payment_review", error); return json({ error: "server_error" }, 500); }
      return json({ error: "wrong_collector" }, 200);
    }
    const refunded = Math.round(Number(pay.transaction_amount_refunded ?? 0)) || 0;

    if (pay.status === "approved") {
      const ids = String(pay.external_reference ?? "").split(",").map(Number).filter(Number.isInteger);
      const { data, error } = await db.rpc("confirm_payment", {
        p_booking_ids: ids, p_payment_id: String(pay.id), p_amount: Math.round(Number(pay.transaction_amount)),
        p_provider: pid, p_account: used.id, p_fee_mp: appFee(pay), p_collector: pay.collector_id != null ? String(pay.collector_id) : null,
        p_raw: raw, p_status_detail: pay.status_detail ?? null,
      });
      if (error) throw error;
      // devolución parcial informada por Mercado Pago (el pago sigue aprobado)
      if (refunded > 0) {
        const up = await db.rpc("payment_mp_update", { p_payment_id: String(pay.id), p_status: "approved", p_refunded: refunded, p_status_detail: pay.status_detail ?? null });
        if (up.error) { console.error("payment_mp_update", up.error); return json({ error: "server_error" }, 500); }
      }
      return json({ ok: true, result: data });
    }
    if (CHANGES.includes(pay.status)) {
      const { data, error } = await db.rpc("payment_mp_update", {
        p_payment_id: String(pay.id), p_status: pay.status, p_refunded: refunded, p_status_detail: pay.status_detail ?? null,
        p_raw: raw, p_provider: pid,
      });
      // un cambio de estado que no se pudo guardar: 500 aunque el pago esté registrado (Mercado Pago reintenta)
      if (error) { console.error("payment_mp_update", error); return json({ error: "server_error" }, 500); }
      return json({ ok: true, result: data });
    }
    return json({ ok: true, status: pay.status });   // pendiente, rechazado, etc.: nada que hacer
  } catch (e) {
    console.error(e);
    if (dataId && (await registered(db, dataId).catch(() => false))) return json({ ok: true, status: "already_registered" });
    return json({ error: "server_error" }, 500);
  }
});

async function registered(db: ReturnType<typeof admin>, id: string): Promise<boolean> {
  const { data } = await db.from("payments").select("id").eq("mp_payment_id", id).maybeSingle();
  return !!data;
}

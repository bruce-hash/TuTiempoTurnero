// Webhook de Mercado Pago: verifica la firma, consulta el pago real en la API de MP (con la llave de la cuenta que lo
// cobró) y lo registra en la base:
//  - aprobado → confirm_payment (idempotente; nunca falla: lo que no se puede confirmar queda para devolver o revisar);
//  - devuelto, cancelado, contracargo o reclamo → payment_mp_update (D17, D18).
// Ante un pago que ya quedó registrado nunca responde error (así Mercado Pago no reintenta para siempre).
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
    if (!pay || !used) {
      if (await registered(db, dataId)) return json({ ok: true, status: "already_registered" });
      if (!accounts.length) return json({ error: "unknown_provider" }, 200);
      return lookupFailed ? json({ error: "mp_lookup_failed" }, 502) : json({ error: "payment_not_found" }, 200);
    }
    if (pay.currency_id && pay.currency_id !== "ARS") return json({ error: "bad_currency" }, 200);
    // el pago tiene que haber entrado a la cuenta que lo consultó
    if (used.mp_user_id && pay.collector_id && String(pay.collector_id) !== String(used.mp_user_id)) {
      console.error("wrong_collector", dataId, used.id);
      return json({ error: "wrong_collector" }, 200);
    }
    const raw = mpClean(pay);
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
        if (up.error) throw up.error;
      }
      return json({ ok: true, result: data });
    }
    if (CHANGES.includes(pay.status)) {
      const { data, error } = await db.rpc("payment_mp_update", {
        p_payment_id: String(pay.id), p_status: pay.status, p_refunded: refunded, p_status_detail: pay.status_detail ?? null,
        p_raw: raw, p_provider: pid,
      });
      if (error) throw error;
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

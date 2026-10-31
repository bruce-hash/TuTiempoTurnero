// Registro de un pago de Mercado Pago ya consultado en su API (con la llave de la cuenta que lo cobró). Lo usan
// mp-webhook (cuando llega el aviso) y mp-reconcile (cuando el aviso no llegó o se rechazó): las dos hacen lo mismo.
//  - aprobado → confirm_payment (idempotente; nunca falla: lo que no se puede confirmar queda para devolver o revisar);
//  - devuelto, cancelado, contracargo o reclamo → payment_mp_update (D17, D18).
// Ningún pago se descarta sin rastro: lo que no se procesa queda en mp_webhook_events (sin datos personales).
import { admin, mpClean, must, type MpAccount } from "./util.ts";

type Db = ReturnType<typeof admin>;
export const CHANGES = ["refunded", "cancelled", "charged_back", "in_mediation"];

// comisión de TuTiempo que informa Mercado Pago (application_fee); null si no vino
export function appFee(pay: Record<string, any>): number | null {
  const fd = Array.isArray(pay.fee_details) ? pay.fee_details.find((f: any) => f?.type === "application_fee") : null;
  const v = fd?.amount ?? pay.marketplace_fee;
  return v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
}

// aviso descartado o rechazado (mp_webhook_event suma hits si se repite)
export async function discard(db: Db, payId: string, pid: number | null, acc: number | null, reason: string, detail?: string) {
  const { error } = await db.rpc("mp_webhook_event", { p_payment_id: payId, p_provider: pid, p_account: acc, p_reason: reason, p_detail: detail ?? null });
  if (error) console.error("mp_webhook_event", error);
}

export async function registered(db: Db, id: string): Promise<boolean> {
  return !!must("buscar el pago", await db.from("payments").select("id").eq("mp_payment_id", id).maybeSingle());
}

export type Processed = { status: number; body: Record<string, unknown>; done: boolean };

// registra el pago `pay` (la respuesta de GET /v1/payments/:id) del prestador `pid`, consultado con la cuenta `used`.
// done: quedó registrado (confirmado, para devolver o para revisar) o actualizado su estado.
export async function processPayment(db: Db, pay: Record<string, any>, pid: number, used: MpAccount, payId: string): Promise<Processed> {
  const raw = mpClean(pay);
  if (pay.currency_id && pay.currency_id !== "ARS") {
    await discard(db, payId, pid, used.id, "bad_currency");
    return { status: 200, body: { error: "bad_currency" }, done: false };
  }
  // el pago tiene que haber entrado a la cuenta que lo consultó. Sin mp_user_id (o sin collector_id) no se puede
  // comprobar: se trata igual que un cobrador equivocado. Queda en "Para revisar" y no confirma turnos.
  if (!used.mp_user_id || pay.collector_id == null || String(pay.collector_id) !== String(used.mp_user_id)) {
    console.error("wrong_collector", payId, used.id);
    await discard(db, payId, pid, used.id, "wrong_collector");
    const ids = String(pay.external_reference ?? "").split(",").map(Number).filter(Number.isInteger);
    const { error } = await db.rpc("payment_review", {
      p_payment_id: String(pay.id ?? payId), p_provider: pid, p_collector: pay.collector_id != null ? String(pay.collector_id) : null,
      p_booking_ids: ids, p_amount: Math.round(Number(pay.transaction_amount)) || 0, p_reason: "wrong_collector", p_raw: raw,
    });
    if (error) { console.error("payment_review", error); return { status: 500, body: { error: "server_error" }, done: false }; }
    return { status: 200, body: { error: "wrong_collector" }, done: true };
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
      if (up.error) { console.error("payment_mp_update", up.error); return { status: 500, body: { error: "server_error" }, done: true }; }
    }
    return { status: 200, body: { ok: true, result: data }, done: true };
  }
  if (CHANGES.includes(pay.status)) {
    const { data, error } = await db.rpc("payment_mp_update", {
      p_payment_id: String(pay.id), p_status: pay.status, p_refunded: refunded, p_status_detail: pay.status_detail ?? null,
      p_raw: raw, p_provider: pid,
    });
    // un cambio de estado que no se pudo guardar: 500 aunque el pago esté registrado (Mercado Pago reintenta)
    if (error) { console.error("payment_mp_update", error); return { status: 500, body: { error: "server_error" }, done: false }; }
    return { status: 200, body: { ok: true, result: data }, done: true };
  }
  return { status: 200, body: { ok: true, status: pay.status }, done: false };   // pendiente, rechazado, etc.: nada que hacer
}

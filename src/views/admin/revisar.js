import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { admReviewDemo } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { render } from "../../ui/render.js";

// "Para revisar · cobros" (Bloque 1, D19 y D20): devoluciones que fallaron o se están reintentando y pagos en revisión.
// En vivo vienen de admin_review (se piden una vez y se guardan en S.admRev); en la demo, de datos de ejemplo.
export function admReviewData() {
  if (!LIVE) {
    return admReviewDemo();
  }
  if (S.admRev) {
    return S.admRev;
  }
  if (!S.admRevL) {
    S.admRevL = true;
    api
      .adminReview()
      .then(() => {
        S.admRevL = false;
        render();
      })
      .catch(() => {
        S.admRevL = false;
        S.admRev = { refunds: [], payments: [], err: true };
        render();
      });
  }
  return null;
}
const REFUND_WHY = {
  provider_cancelled: "canceló el prestador",
  slot_taken: "el horario ya estaba ocupado cuando llegó el pago",
  booking_unavailable: "el turno ya no estaba disponible cuando llegó el pago",
  amount_short: "el pago no alcanzaba",
  unknown_booking: "pago sin turno de ese prestador",
};
const PAYMENT_WHY = {
  fee_missing: "Mercado Pago no informó la comisión",
  fee_mismatch: "la comisión de Mercado Pago no coincide con la calculada",
  amount_over: "pagó más de lo que debía (la diferencia no se devolvió sola)",
  other_provider: "trae turnos de otro prestador",
  partial_refund_mismatch: "devolución parcial que no hizo la app",
  charged_back: "contracargo",
  in_mediation: "reclamo abierto en Mercado Pago",
};
const paymentWhy = (reason) =>
  PAYMENT_WHY[reason] || (/^unregistered_/.test(reason) ? "aviso de un pago que no está registrado" : /^error/.test(reason) ? "error al procesarlo: " + reason.slice(7) : reason);
// formulario de "Resuelto a mano": la nota es obligatoria
function resolveForm(kind, id) {
  return `<form id="fResolve" class="stack" style="gap:6px;margin-top:6px" data-k="${kind}" data-id="${id}" novalidate>
    <label class="lbl" for="rsNote" style="margin:0">Cómo se resolvió (queda registrado con tu usuario y la fecha)</label>
    <textarea id="rsNote" rows="2" maxlength="500" placeholder="Ej.: le devolví por transferencia el 24/10"></textarea>
    <p class="hint" id="rserr" role="alert"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admResolveNo">Cancelar</button><button class="btn btn-pri btn-sm">Guardar</button></div></form>`;
}
export function admReview() {
  const data = admReviewData();
  if (!data) {
    return '<div class="skel" style="min-height:60px"></div>';
  }
  const refunds = data.refunds || [];
  const payments = data.payments || [];
  if (!refunds.length && !payments.length) {
    return "";
  }
  const open = S.admResolve || {};
  const refundLi = (refund) => `<li><div><b>Devolución de ${money(refund.amount)} · ${esc(refund.provider_name || "Prestador")}</b>
     <span>${esc(refund.client_name || "Sin turno")} · ${esc(REFUND_WHY[refund.reason] || refund.reason)}${refund.mp_payment_id ? " · pago " + esc(refund.mp_payment_id) : ""}</span>
     <span class="hint">${refund.status === "failed" ? "❌ Falló: ya no se reintenta sola" : `🔁 Reintentando · ${refund.attempts} intento${refund.attempts === 1 ? "" : "s"}${refund.next_attempt_at ? " · próximo " + esc(dmyIso(refund.next_attempt_at)) : ""}`}${refund.last_error ? " · Último error: " + esc(refund.last_error) : ""}</span>
     ${open.k === "refund" && open.id === refund.id ? resolveForm("refund", refund.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="admRetry" data-id="${refund.id}">Reintentar</button><button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="refund" data-id="${refund.id}">Resuelto a mano</button></div>`}</div></li>`;
  const paymentLi = (payment) => `<li><div><b>Pago ${esc(payment.mp_payment_id)} de ${money(payment.amount)} · ${esc(payment.provider_name || "Prestador")}</b>
     <span>${esc(payment.client_name || "")}${payment.client_name ? " · " : ""}${(payment.review_reasons || []).map((reason) => esc(paymentWhy(reason))).join(" · ")}</span>
     ${open.k === "payment" && open.id === payment.id ? resolveForm("payment", payment.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="payment" data-id="${payment.id}">Resuelto a mano</button></div>`}</div></li>`;
  return `<div class="panel admalert"><p class="lbl">Para revisar · cobros <span class="cnt">${refunds.length + payments.length}</span></p>
   <ul class="adml">${refunds.map(refundLi).join("")}${payments.map(paymentLi).join("")}</ul></div>`;
}

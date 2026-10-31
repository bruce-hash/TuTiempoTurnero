import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { admReviewDemo } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { render } from "../../ui/render.js";

// "Para revisar · cobros" (Bloque 1, D19 y D20): devoluciones que fallaron o se están reintentando, pagos en revisión
// y (Bloque 2b) cuentas de Mercado Pago con error en su llave.
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
  booking_past: "el pago llegó después de la hora del turno (D29)",
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
  wrong_collector: "lo cobró otra cuenta de Mercado Pago, no la del prestador (no se confirmó ningún turno)",
};
// avisos de Mercado Pago que no se procesaron (mp_webhook_events)
const EVENT_WHY = {
  unknown_provider: "prestador sin cuenta de Mercado Pago",
  payment_not_found: "el pago no existe en ninguna cuenta del prestador",
  wrong_collector: "cobrado por otra cuenta",
  bad_currency: "moneda distinta de pesos",
  // Paso 1 (v4): rechazados antes de procesar (casi siempre, Mercado Pago o la función mal configurados)
  bad_signature: "rechazado: la firma no es válida",
  stale_signature: "rechazado: la firma está vencida",
  no_signature: "rechazado: llegó sin firma",
  bad_request: "rechazado: le faltan datos",
  config_error: "rechazado: falta configurar la función",
  recovered: "pago sin aviso: lo encontró la consulta automática",
};
const REJECTED = ["bad_signature", "stale_signature", "no_signature", "bad_request", "config_error"];
const paymentWhy = (reason) =>
  PAYMENT_WHY[reason] || (/^unregistered_/.test(reason) ? "aviso de un pago que no está registrado" : /^error/.test(reason) ? "error al procesarlo: " + reason.slice(7) : reason);
// formulario de "Devolver" (D20): monto (por defecto lo que falta devolver) y nota obligatoria; la devolución la hace
// mp-refunds con la llave de la cuenta que cobró
function refundForm(payment) {
  return `<form id="fAdmRefund" class="stack" style="gap:6px;margin-top:6px" data-id="${payment.id}" novalidate>
    <label class="lbl" for="arAmount" style="margin:0">Monto a devolver (máximo ${money(payment.refundable)})</label>
    <input id="arAmount" inputmode="numeric" value="${+payment.refundable || 0}">
    <label class="lbl" for="arNote" style="margin:0">Por qué (queda registrado con tu usuario y la fecha)</label>
    <textarea id="arNote" rows="2" maxlength="500" placeholder="Ej.: pagó de más, le devuelvo la diferencia"></textarea>
    <p class="hint" id="arerr" role="alert"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admResolveNo">Cancelar</button><button class="btn btn-pri btn-sm">Devolver</button></div></form>`;
}
// formulario de "Reprocesar" (H27): vuelve a procesar el pago como si recién llegara; la nota es obligatoria
function reprocessForm(id) {
  return `<form id="fReprocess" class="stack" style="gap:6px;margin-top:6px" data-id="${id}" novalidate>
    <label class="lbl" for="rpNote" style="margin:0">Por qué lo reprocesás (queda registrado con tu usuario y la fecha)</label>
    <textarea id="rpNote" rows="2" maxlength="500" placeholder="Ej.: ya se corrigió el error, vuelvo a procesarlo"></textarea>
    <p class="hint" id="rperr" role="alert"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admResolveNo">Cancelar</button><button class="btn btn-pri btn-sm">Reprocesar</button></div></form>`;
}
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
  const events = data.webhook_events || [];
  const accounts = data.accounts || [];
  const alert = data.webhook_alert || {};
  if (!refunds.length && !payments.length && !events.length && !accounts.length) {
    return "";
  }
  const open = S.admResolve || {};
  const refundLi = (refund) => `<li><div><b>Devolución de ${money(refund.amount)} · ${esc(refund.provider_name || "Prestador")}</b>
     <span>${esc(refund.client_name || "Sin turno")} · ${esc(REFUND_WHY[refund.reason] || refund.reason)}${refund.mp_payment_id ? " · pago " + esc(refund.mp_payment_id) : ""}</span>
     <span class="hint">${refund.status === "failed" ? "❌ Falló: ya no se reintenta sola" : `🔁 Reintentando · ${refund.attempts} intento${refund.attempts === 1 ? "" : "s"}${refund.next_attempt_at ? " · próximo " + esc(dmyIso(refund.next_attempt_at)) : ""}`}${refund.last_error ? " · Último error: " + esc(refund.last_error) : ""}</span>
     ${open.k === "refund" && open.id === refund.id ? resolveForm("refund", refund.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="admRetry" data-id="${refund.id}">Reintentar</button><button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="refund" data-id="${refund.id}">Resuelto a mano</button></div>`}</div></li>`;
  const paymentLi = (payment) => `<li><div><b>Pago ${esc(payment.mp_payment_id)} de ${money(payment.amount)} · ${esc(payment.provider_name || "Prestador")}</b>
     <span>${esc(payment.client_name || "")}${payment.client_name ? " · " : ""}${(payment.review_reasons || []).map((reason) => esc(paymentWhy(reason))).join(" · ")}</span>
     ${payment.refundable_from_app === false ? '<span class="hint">No es de una cuenta de TuTiempo: la devolución se hace a mano.</span>' : ""}
     ${open.k === "payment" && open.id === payment.id ? resolveForm("payment", payment.id) : open.k === "refundNew" && open.id === payment.id ? refundForm(payment) : open.k === "reprocess" && open.id === payment.id ? reprocessForm(payment.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${payment.reprocessable ? `<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="reprocess" data-id="${payment.id}">Reprocesar</button>` : ""}${payment.refundable_from_app !== false && +payment.refundable > 0 ? `<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="refundNew" data-id="${payment.id}">Devolver</button>` : ""}<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="payment" data-id="${payment.id}">Resuelto a mano</button></div>`}</div></li>`;
  // cuenta de Mercado Pago que no puede cobrar o devolver por su llave: sale sola cuando se renueva o el prestador reconecta
  const accountLi = (account) => `<li><div><b>Cuenta de Mercado Pago con error · ${esc(account.provider_name || "Prestador")}</b>
     <span>Cuenta n° ${esc(account.mp_user_id || "?")} · ${account.status === "active" ? "cobra las reservas" : `solo devoluciones (${account.refunds_pending} pendiente${account.refunds_pending === 1 ? "" : "s"})`}</span>
     <span class="hint">❌ ${esc(account.last_error)} · desde ${esc(dmyIso(account.error_at))}. Si sigue, el prestador tiene que volver a conectarla (Perfil → Cobros).</span></div></li>`;
  const eventLi = (event) =>
    `<li><div><span>${event.reason === "recovered" ? "Pago recuperado" : "Aviso descartado"} · pago ${esc(event.mp_payment_id || "?")}${event.provider_name ? " · " + esc(event.provider_name) : ""}</span><span class="hint">${esc(EVENT_WHY[event.reason] || event.reason)}${event.detail ? " (" + esc(event.detail) + ")" : ""} · ${esc(dmyIso(event.last_at || event.created_at))}${+event.hits > 1 ? ` · ${+event.hits} veces` : ""}</span></div></li>`;
  // Paso 1 (v4): Mercado Pago manda avisos que la app rechaza, o hubo pagos que se registraron sin aviso: arriba de todo,
  // porque mientras siga así los pagos se confirman con demora (los encuentra la consulta automática)
  const webhookLi =
    +alert.rejected || +alert.recovered
      ? `<li><div><b>⚠ Los avisos de Mercado Pago no están llegando bien</b>
     <span>${+alert.rejected ? `${+alert.rejected} aviso${+alert.rejected === 1 ? "" : "s"} rechazado${+alert.rejected === 1 ? "" : "s"} en 7 días${alert.rejected_reason ? " (" + esc(EVENT_WHY[alert.rejected_reason] || alert.rejected_reason) + ")" : ""}${alert.rejected_last ? ", el último el " + esc(dmyIso(alert.rejected_last)) : ""}. ` : ""}${+alert.recovered ? `${+alert.recovered} pago${+alert.recovered === 1 ? "" : "s"} registrado${+alert.recovered === 1 ? "" : "s"} sin aviso por la consulta automática.` : ""}</span>
     <span class="hint">Los pagos igual se registran (la app le pregunta a Mercado Pago cada 2 minutos), pero con demora. Revisá el webhook y MP_WEBHOOK_SECRET: docs/02 → "Si los pagos no se registran".</span></div></li>`
      : "";
  const nAlert = webhookLi ? 1 : 0;
  return `<div class="panel admalert"><p class="lbl">Para revisar · cobros <span class="cnt">${refunds.length + payments.length + accounts.length + nAlert}</span></p>
   <ul class="adml">${webhookLi}${accounts.map(accountLi).join("")}${refunds.map(refundLi).join("")}${payments.map(paymentLi).join("")}</ul>
   ${events.length ? `<details${webhookLi || REJECTED.includes((events[0] || {}).reason) ? " open" : ""}><summary class="hint">Avisos de Mercado Pago descartados o recuperados (últimos 30 días): ${events.length}</summary><ul class="adml">${events.map(eventLi).join("")}</ul></details>` : ""}</div>`;
}

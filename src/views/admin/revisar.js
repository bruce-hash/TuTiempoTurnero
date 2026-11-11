import { alertDismissed, alertRead } from "../../lib/avisos-admin.js";
import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { admReviewDemo } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { render } from "../../ui/render.js";
import { ic } from "../../ui/iconos.js";

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
  provider_cancelled: "canceló el profesional",
  slot_taken: "el horario ya estaba ocupado cuando llegó el pago",
  booking_unavailable: "el turno ya no estaba disponible cuando llegó el pago",
  amount_short: "el pago no alcanzaba",
  booking_past: "el pago llegó después de la hora del turno (D29)",
  provider_suspended: "el pago llegó con el profesional suspendido (D43)",
  unknown_booking: "pago sin turno de ese profesional",
};
const PAYMENT_WHY = {
  fee_missing: "Mercado Pago no informó la comisión de TuTiempo",
  fee_mismatch: "la comisión de TuTiempo que informó Mercado Pago no coincide con la calculada",
  // D30 (el texto con los dos números lo arma paymentWhy)
  mp_cost_mismatch: "la comisión de Mercado Pago no es la del plazo elegido",
  // 4/11 · Bloque 4: es la de otro plazo de la tabla; el plazo no se cambió solo (se le avisó al profesional)
  mp_term_mismatch: "la comisión de Mercado Pago es la de otro plazo, no la del que eligió el profesional en Horarios (se le avisó; el plazo no se cambió)",
  amount_over: "pagó más de lo que debía (la diferencia no se devolvió sola)",
  other_provider: "trae turnos de otro profesional",
  partial_refund_mismatch: "devolución parcial que no hizo la app",
  charged_back: "contracargo",
  in_mediation: "reclamo abierto en Mercado Pago",
  wrong_collector: "lo cobró otra cuenta de Mercado Pago, no la del profesional (no se confirmó ningún turno)",
};
// avisos de Mercado Pago que no se procesaron (mp_webhook_events)
const EVENT_WHY = {
  unknown_provider: "profesional sin cuenta de Mercado Pago",
  payment_not_found: "el pago no existe en ninguna cuenta del profesional",
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
// 11/11 (H06): los descartados van agrupados por motivo, una línea por motivo que se despliega («81 avisos rechazados
// por firma»); n = cuántos avisos (sumando las veces que llegó cada uno)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const GROUP_TITLE = {
  bad_signature: (n) => `${plural(n, "aviso rechazado", "avisos rechazados")} por firma`,
  stale_signature: (n) => `${plural(n, "aviso rechazado", "avisos rechazados")} por firma vencida`,
  no_signature: (n) => `${plural(n, "aviso rechazado", "avisos rechazados")} por llegar sin firma`,
  bad_request: (n) => `${plural(n, "aviso rechazado", "avisos rechazados")} por datos incompletos`,
  config_error: (n) => `${plural(n, "aviso rechazado", "avisos rechazados")} por falta de configuración`,
  recovered: (n) => `${plural(n, "pago recuperado", "pagos recuperados")} sin aviso`,
};
const groupTitle = (reason, n) => (GROUP_TITLE[reason] ? GROUP_TITLE[reason](n) : `${plural(n, "aviso descartado", "avisos descartados")}: ${EVENT_WHY[reason] || reason}`);
// H06: con qué se armó el texto firmado de un aviso rechazado (sin la clave ni la firma completa), para diagnosticar
function diagLine(diag) {
  if (!diag || typeof diag !== "object") {
    return "";
  }
  const from = { url: "la dirección", body: "el cuerpo", ipn: "id= (IPN)", none: "ningún lado" }[diag.id_from] || diag.id_from;
  const bits = [
    diag.id_from ? `data.id de ${from}` : "",
    diag.id_url && diag.id_body && diag.id_url !== diag.id_body ? `(dirección ${diag.id_url}, cuerpo ${diag.id_body})` : "",
    `request-id ${diag.request_id ? "sí" : "no"}`,
    diag.ts ? `ts ${diag.ts}` : "sin ts",
    diag.v1_count != null ? `${diag.v1_count} v1${diag.v1_start ? ` (empieza ${diag.v1_start}…)` : ""}` : "",
    diag.user_id ? `user_id ${diag.user_id}` : "",
    diag.secrets > 1 ? `${diag.secrets} claves probadas` : "",
  ].filter(Boolean);
  return `<span class="hint">${esc(bits.join(" · "))}</span>${diag.manifest ? `<span class="hint">Texto firmado: <code>${esc(diag.manifest)}</code></span>` : ""}`;
}
const paymentWhy = (reason, payment) =>
  (reason === "mp_cost_mismatch" || reason === "mp_term_mismatch") && payment && payment.mp_cost != null
    ? `${PAYMENT_WHY[reason]}: cobró ${money(payment.mp_cost)} y se esperaba ${money(payment.mp_cost_expected)} (revisar que el plazo del perfil del profesional sea el de su cuenta)`
    : PAYMENT_WHY[reason] || (/^unregistered_/.test(reason) ? "aviso de un pago que no está registrado" : /^error/.test(reason) ? "error al procesarlo: " + reason.slice(7) : reason);
// formulario de "Devolver" (D20): monto (por defecto lo que falta devolver) y nota obligatoria; la devolución la hace
// mp-refunds con la llave de la cuenta que cobró
function refundForm(payment) {
  return `<form id="fAdmRefund" class="stack" style="gap:6px;margin-top:6px" data-id="${payment.id}" novalidate>
    <label class="lbl" for="arAmount" style="margin:0">Monto a devolver (máximo ${money(payment.refundable)})</label>
    <input id="arAmount" inputmode="numeric" value="${+payment.refundable || 0}">
    <label class="lbl" for="arNote" style="margin:0">Por qué (queda registrado con tu cuenta y la fecha)</label>
    <textarea id="arNote" rows="2" maxlength="500" placeholder="Ej.: pagó de más, le devuelvo la diferencia"></textarea>
    <p class="hint" id="arerr" role="alert"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admResolveNo">Cancelar</button><button class="btn btn-pri btn-sm">Devolver</button></div></form>`;
}
// formulario de "Reprocesar" (H27): vuelve a procesar el pago como si recién llegara; la nota es obligatoria
function reprocessForm(id) {
  return `<form id="fReprocess" class="stack" style="gap:6px;margin-top:6px" data-id="${id}" novalidate>
    <label class="lbl" for="rpNote" style="margin:0">Por qué lo reprocesás (queda registrado con tu cuenta y la fecha)</label>
    <textarea id="rpNote" rows="2" maxlength="500" placeholder="Ej.: ya se corrigió el error, vuelvo a procesarlo"></textarea>
    <p class="hint" id="rperr" role="alert"></p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admResolveNo">Cancelar</button><button class="btn btn-pri btn-sm">Reprocesar</button></div></form>`;
}
// formulario de "Resuelto a mano": la nota es obligatoria
function resolveForm(kind, id) {
  return `<form id="fResolve" class="stack" style="gap:6px;margin-top:6px" data-k="${kind}" data-id="${id}" novalidate>
    <label class="lbl" for="rsNote" style="margin:0">Cómo se resolvió (queda registrado con tu cuenta y la fecha)</label>
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
  // v2 (3/11): los avisos de Mercado Pago descartados o recuperados son informativos: se pueden borrar (los borrados no
  // vuelven); los pagos y devoluciones para resolver salen solos al resolverlos
  // 7/11: además, se borran solos una vez leídos (se ven en una visita y en la siguiente ya no están)
  // 11/11 (H06): mientras los avisos sigan rechazándose, los rechazados no se van al leerlos (con su diagnóstico)
  const alert = data.webhook_alert || {};
  const stillRejected = +alert.rejected > 0 && alert.active !== false;
  const events = (data.webhook_events || []).filter((event) => !alertDismissed("mpev:" + event.id) && (!alertRead("mpev:" + event.id) || (stillRejected && REJECTED.includes(event.reason))));
  const accounts = data.accounts || [];
  if (!refunds.length && !payments.length && !events.length && !accounts.length && !stillRejected) {
    return "";
  }
  const open = S.admResolve || {};
  const refundLi = (refund) => `<li><div><b>Devolución de ${money(refund.amount)} · ${esc(refund.provider_name || "Profesional")}</b>
     <span>${esc(refund.client_name || "Sin turno")} · ${esc(REFUND_WHY[refund.reason] || refund.reason)}${refund.mp_payment_id ? " · pago " + esc(refund.mp_payment_id) : ""}</span>
     <span class="hint">${refund.status === "failed" ? `${ic("error")} Falló: ya no se reintenta sola` : `${ic("actualizar")} Reintentando · ${refund.attempts} intento${refund.attempts === 1 ? "" : "s"}${refund.next_attempt_at ? " · próximo " + esc(dmyIso(refund.next_attempt_at)) : ""}`}${refund.last_error ? " · Último error: " + esc(refund.last_error) : ""}</span>
     ${open.k === "refund" && open.id === refund.id ? resolveForm("refund", refund.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px"><button class="btn btn-ghost btn-sm" data-act="admRetry" data-id="${refund.id}">Reintentar</button><button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="refund" data-id="${refund.id}">Resuelto a mano</button></div>`}</div></li>`;
  const paymentLi = (payment) => `<li><div><b>Pago ${esc(payment.mp_payment_id)} de ${money(payment.amount)} · ${esc(payment.provider_name || "Profesional")}</b>
     <span>${esc(payment.client_name || "")}${payment.client_name ? " · " : ""}${(payment.review_reasons || []).map((reason) => esc(paymentWhy(reason, payment))).join(" · ")}</span>
     ${payment.refundable_from_app === false ? '<span class="hint">No es de una cuenta de TuTiempo: la devolución se hace a mano.</span>' : ""}
     ${open.k === "payment" && open.id === payment.id ? resolveForm("payment", payment.id) : open.k === "refundNew" && open.id === payment.id ? refundForm(payment) : open.k === "reprocess" && open.id === payment.id ? reprocessForm(payment.id) : `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${payment.reprocessable ? `<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="reprocess" data-id="${payment.id}">Reprocesar</button>` : ""}${payment.refundable_from_app !== false && +payment.refundable > 0 ? `<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="refundNew" data-id="${payment.id}">Devolver</button>` : ""}<button class="btn btn-ghost btn-sm" data-act="admResolveOpen" data-k="payment" data-id="${payment.id}">Resuelto a mano</button></div>`}</div></li>`;
  // cuenta de Mercado Pago que no puede cobrar o devolver por su llave: sale sola cuando se renueva o el prestador reconecta
  const accountLi = (account) => `<li><div><b>Cuenta de Mercado Pago con error · ${esc(account.provider_name || "Profesional")}</b>
     <span>Cuenta n° ${esc(account.mp_user_id || "?")} · ${account.status === "active" ? "cobra las reservas" : `solo devoluciones (${account.refunds_pending} pendiente${account.refunds_pending === 1 ? "" : "s"})`}</span>
     <span class="hint">${ic("error")} ${esc(account.last_error)} · desde ${esc(dmyIso(account.error_at))}. Si sigue, el profesional tiene que volver a conectarla (Perfil → Cobros).</span></div></li>`;
  const eventLi = (event) =>
    `<li class="admal" data-k="mpev:${esc(String(event.id))}"><div><span>${event.reason === "recovered" ? "Pago recuperado" : "Aviso descartado"} · pago ${esc(event.mp_payment_id || "?")}${event.provider_name ? " · " + esc(event.provider_name) : ""}</span><span class="hint">${esc(EVENT_WHY[event.reason] || event.reason)}${event.detail ? " (" + esc(event.detail) + ")" : ""} · ${esc(dmyIso(event.last_at || event.created_at))}${+event.hits > 1 ? ` · ${+event.hits} veces` : ""}</span>${diagLine(event.diag)}</div><button type="button" class="xbtn" data-act="admAlertDel" data-k="mpev:${esc(String(event.id))}" aria-label="Borrar este aviso" title="Borrar">✕</button></li>`;
  // Paso 1 (v4): Mercado Pago manda avisos que la app rechaza, o hubo pagos que se registraron sin aviso: arriba de todo,
  // porque mientras siga así los pagos se confirman con demora (los encuentra la consulta automática)
  // 7/11: solo los avisos RECHAZADOS (un problema de configuración) prenden este aviso. Un pago recuperado sin aviso
  // está registrado y es informativo: va en la lista de abajo y no hace volver este aviso una vez borrado.
  // 11/11 (H06): el aviso no se borra a mano ni se va al leerlo: sigue mientras haya un rechazo sin una firma válida
  // después ('active', de la base) y se apaga solo cuando los avisos vuelven a validar
  const webhookLi =
    stillRejected
      ? `<li class="admwh"><div><b>${ic("aviso")} Los avisos de Mercado Pago no están llegando bien</b>
     <span>${`${+alert.rejected} aviso${+alert.rejected === 1 ? "" : "s"} rechazado${+alert.rejected === 1 ? "" : "s"} en 7 días${alert.rejected_reason ? " (" + esc(EVENT_WHY[alert.rejected_reason] || alert.rejected_reason) + ")" : ""}${alert.rejected_last ? ", el último el " + esc(dmyIso(alert.rejected_last)) : ""}. `}${+alert.recovered ? `${+alert.recovered} pago${+alert.recovered === 1 ? "" : "s"} registrado${+alert.recovered === 1 ? "" : "s"} sin aviso por la consulta automática.` : ""}</span>
     <span class="hint">Los pagos igual se registran (la app le pregunta a Mercado Pago cada 2 minutos), pero con demora. Revisá el webhook y MP_WEBHOOK_SECRET: docs/02 → "Si los pagos no se registran". Este aviso se va solo cuando los avisos vuelvan a validar${alert.last_ok ? ` (última firma válida: ${esc(dmyIso(alert.last_ok))})` : " (todavía no validó ninguno)"}.</span></div></li>`
      : "";
  const nAlert = webhookLi ? 1 : 0;
  // los descartados, por motivo (los rechazados primero)
  const groups = [];
  events.forEach((event) => {
    let group = groups.find((g) => g.reason === event.reason);
    if (!group) {
      groups.push((group = { reason: event.reason, hits: 0, items: [] }));
    }
    group.hits += Math.max(1, +event.hits || 1);
    group.items.push(event);
  });
  groups.sort((a, b) => (REJECTED.includes(b.reason) ? 1 : 0) - (REJECTED.includes(a.reason) ? 1 : 0));
  const groupHtml = (group) =>
    `<details class="admgrp" data-reason="${esc(group.reason)}"><summary>${esc(groupTitle(group.reason, group.hits))}${group.items.length > 1 ? ` <span class="hint">· ${group.items.length} pagos</span>` : ""}</summary><ul class="adml">${group.items.map(eventLi).join("")}</ul></details>`;
  return `<div class="panel admalert"><p class="lbl">Para revisar · cobros <span class="cnt">${refunds.length + payments.length + accounts.length + nAlert}</span></p>
   <ul class="adml">${webhookLi}${accounts.map(accountLi).join("")}${refunds.map(refundLi).join("")}${payments.map(paymentLi).join("")}</ul>
   ${events.length ? `<details${nAlert || REJECTED.includes((events[0] || {}).reason) ? " open" : ""}><summary class="hint">Avisos de Mercado Pago descartados o recuperados (últimos 30 días): ${events.reduce((n, event) => n + Math.max(1, +event.hits || 1), 0)}</summary><div class="admal-h"><span></span><button type="button" class="lnk" data-act="admAlertsClear">Borrar los leídos</button></div>${groups.map(groupHtml).join("")}</details>` : ""}</div>`;
}

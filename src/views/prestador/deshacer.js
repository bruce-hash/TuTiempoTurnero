// 10/11 · punto 4: en la ficha de un turno atendido, «Editar cobro» (el mismo editor de Cargar diferencia) y «Deshacer
// asistió» (vuelve a Confirmado o pasa a No vino). Antes de confirmar se ve qué cambia. Con la caja de ese día (o su
// mes) cerrada, nada de eso: primero «Volver a abrir la caja». Nunca hay devolución de Mercado Pago (D08).
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { longLabel } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { restOf } from "../../lib/resto.js";
import { cli } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { stampGoal } from "../../ui/sellos.js";
import { restSummary } from "./resto.js";

// la caja del día de ese turno, o su mes, está cerrada
export const cajaClosed = (item) => !!(store.CLOSINGS["day|" + item.date] || store.CLOSINGS["month|" + String(item.date).slice(0, 7)]);

const loadedRest = (item) => !!item.restMethod || !!(item.restParts && item.restParts.length);

// ¿el turno sumó un sello? (en vivo lo dice la base antes de confirmar; en la demo, lo que marcó «Asistió»)
function stampLine(item) {
  const check = S.undoCheck && S.undoCheck.id === item.id ? S.undoCheck : null;
  const svc = (pr(ME()).svcs || []).find((row) => row[0] === item.svc);
  const has = check ? check.stamp === "undo" : !!item.stamped && !!svc && !!stampGoal(ME(), svc);
  return has ? `<li>Se le resta a ${esc(firstName(item.cliente))} el sello de ${esc(item.svc)} que sumó con este turno.</li>` : "";
}
const firstName = (name) => String(name || "el cliente").split(" ")[0];

// lo que cambia al deshacer, para leer antes de confirmar
function undoPanel(item) {
  const to = S.undoTo === "noshow" ? "noshow" : "confirmed";
  const check = S.undoCheck && S.undoCheck.id === item.id ? S.undoCheck : null;
  if (check && check.loading) {
    return '<div class="restbox undo-ask"><p class="note">Revisando el turno…</p></div>';
  }
  if (check && check.stamp === "redeemed") {
    return `<div class="restbox undo-ask"><b>No se puede deshacer</b><p class="note" style="text-align:left;margin:6px 0 10px">${esc(firstName(item.cliente))} ya usó el sello de este turno en un canje de su tarjeta de ${esc(item.svc)}.</p><button type="button" class="btn btn-ghost btn-block" data-act="undoNo">Volver</button></div>`;
  }
  const stats = item.cliente ? cli(item.cliente) : null;
  const lines = [
    loadedRest(item) && restOf(item)
      ? `<li>Se borra lo que anotaste como cobrado en el local: <b>${restSummary(item)}</b>. Sale de la Caja del día.</li>`
      : "",
    stampLine(item),
    item.cliente && stats
      ? `<li>Sale de sus visitas (${stats.v} → ${Math.max(stats.v - 1, 0)}) y de lo que gastó con vos.${to === "noshow" ? " Y le suma una falta." : ""}</li>`
      : "",
    `<li>No cambia: ${item.paid ? `la seña de Mercado Pago (${money(item.paid)}, no se devuelve nada)` : "lo que pagó por Mercado Pago (no se devuelve nada)"}${item.src === "app" ? " ni el pedido de reseña, que ya le llegó. Si ya dejó reseña, queda" : ""}.</li>`,
  ].join("");
  return `<div class="restbox undo-ask"><b>¿Deshacer «Asistió»?</b>
   <div class="undo-to" role="radiogroup" aria-label="Cómo queda el turno"><button type="button" class="btn btn-sm ${to === "confirmed" ? "btn-pri" : "btn-ghost"}" role="radio" aria-checked="${to === "confirmed"}" data-act="undoTo" data-to="confirmed">Volver a Confirmado</button><button type="button" class="btn btn-sm ${to === "noshow" ? "btn-pri" : "btn-ghost"}" role="radio" aria-checked="${to === "noshow"}" data-act="undoTo" data-to="noshow">Pasar a No vino</button></div>
   <span class="hint">Antes de confirmar, esto es lo que cambia:</span>
   <ul class="note undo-list">${lines}</ul>
   <div class="bacts undo-bt"><button type="button" class="btn btn-ghost" data-act="undoNo">Volver</button><button type="button" class="btn btn-bad" data-act="undoYes" data-id="${item.id}">Sí, deshacer</button></div></div>`;
}

// debajo de «Atendido»: el resumen del cobro y las dos opciones (o el aviso de la caja cerrada)
export function doneActions(item, restBlock) {
  if (item.type === "block") {
    return "";
  }
  if (cajaClosed(item)) {
    const monthOnly = !store.CLOSINGS["day|" + item.date];
    return `${loadedRest(item) && restOf(item) ? `<div class="restbox rs-done"><span>Resto: ${restSummary(item)}</span></div>` : ""}
   <p class="note undo-closed">${monthOnly ? `El mes de este turno está cerrado. Para editar el cobro o deshacer «Asistió», primero volvé a abrirlo en Finanzas → Mes.` : `La caja del ${esc(longLabel(item.date))} está cerrada. Para editar el cobro o deshacer «Asistió», primero volvé a abrirla.`}</p>
   ${monthOnly ? "" : `<button type="button" class="btn btn-ghost btn-block" data-act="reopenDay" data-d="${item.date}">Volver a abrir la caja</button>`}`;
  }
  if (S.undoAsk === item.id) {
    return (loadedRest(item) && restOf(item) ? `<div class="restbox rs-done"><span>Resto: ${restSummary(item)}</span></div>` : "") + undoPanel(item);
  }
  const editing = restBlock && (!loadedRest(item) || S.restEd === item.id);
  return `${restBlock}<div class="bacts undo-bt">${restOf(item) && !editing ? `<button type="button" class="btn btn-ghost" data-act="restOpen" data-id="${item.id}">Editar cobro</button>` : ""}<button type="button" class="btn btn-ghost" data-act="undoAsk" data-id="${item.id}">Deshacer asistió</button></div>`;
}

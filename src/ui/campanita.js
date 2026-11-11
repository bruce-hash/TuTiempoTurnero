import { api } from "../api/index.js";
import { isBusiness } from "../lib/cuentas.js";
import { esc } from "../lib/dom.js";
import { TODAY, nowHM, relDate } from "../lib/fechas.js";
import { avatar } from "../lib/prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { ic } from "./iconos.js";

// 4/11 · La campanita de avisos en la cabecera, para el cliente y para el profesional (antes, los del cliente estaban en
// Mis turnos y los del profesional arriba del panel). El número dice cuántos hay sin leer; al abrirla se ven todos y
// quedan leídos (los nuevos siguen resaltados mientras la lista está abierta). Cada aviso del cliente lleva su acción (ver el turno, dejar la reseña, reservar el
// turno ofrecido, ver el perfil), su ✕ y "Borrar los leídos"; los del profesional, a dónde ir (Seguidores, Perfil) y,
// desde el 7/11, también su ✕ y "Borrar los leídos". Los ya vistos van más pálidos y con «✓ Visto».
// Se cierra tocando afuera, con Esc o al elegir una acción.

// a quién son los avisos: los del panel si es el profesional (o una cuenta de negocio); si no, los del cliente
const forProvider = () => S.role === "barbero" || isBusiness();
const items = () => (forProvider() ? S.notices || [] : S.inbox || []);
export const bellUnread = () => items().filter((item) => !item.read).length;
// la campanita va con sesión, salvo en el panel de TuTiempo
export const bellShown = () => !!S.user && S.role !== "admin";

// la acción de cada aviso del cliente según lo que dice. Confirmación, recordatorios y cancelación → ver ese turno;
// pedido de reseña → dejarla (o "Ya calificaste"); turno libre que ofreció el profesional → "Reservar" (4/11); los
// mensajes del profesional, las novedades (y los saludos de cumpleaños viejos) → ver su perfil. Si el turno ya no está, su perfil.
export function msgAction(msg) {
  const btn = (attrs, label, cls = "btn-ghost") => `<button class="btn ${cls} btn-sm msg-act" ${attrs}>${label}</button>`;
  if (msg.kind === "offer" && msg.pid) {
    const slot = msg.slot;
    if (!slot || slot.date + " " + slot.time <= TODAY() + " " + nowHM()) {
      return '<span class="hint">Ese horario ya pasó</span>';
    }
    return btn(`data-act="offerBook" data-id="${esc(String(msg.pid))}" data-d="${esc(slot.date)}"`, "Reservar", "btn-pri");
  }
  const booking = msg.ref && ["conf", "r24", "r2", "rev", "cancel"].includes(msg.kind) ? store.BOOK.find((item) => item.mine && String(item.id) === String(msg.ref)) : null;
  if (booking && msg.kind === "rev") {
    if (booking.reviewed) {
      return '<span class="hint">✓ Ya calificaste</span>';
    }
    if (booking.status === "done") {
      return btn(`data-act="inboxRate" data-id="${booking.id}"`, "★ Dejar reseña");
    }
  }
  if (booking && msg.kind !== "rev") {
    return btn(`data-act="verTurno" data-id="${booking.id}"`, "Ver turno");
  }
  return msg.pid ? btn(`data-go="perfil" data-id="${esc(String(msg.pid))}"`, "Ver perfil") : "";
}
// a dónde lleva cada aviso del profesional
function noticeAction(notice) {
  const go = (to, label) => `<button class="btn btn-ghost btn-sm msg-act" data-act="bellGo" data-to="${to}">${label}</button>`;
  if (notice.kind === "new_follower") {
    return go("seguidores", "Ver seguidores");
  }
  if (notice.kind === "mp_connect" || notice.kind === "mp_reconnect") {
    return go("perfil", "Conectar Mercado Pago");
  }
  // 7/11 · Feriados; 10/11: cerrados por defecto. «El lunes 23/11 es feriado y tu agenda está cerrada. ¿Vas a trabajar?»
  // y «Tenés N turnos el …, que es feriado…», con Abrir el día / Dejarlo cerrado (o lo que ya eligió)
  if ((notice.kind === "holiday" || notice.kind === "holiday_bookings") && notice.ref) {
    if (notice.ref < TODAY()) {
      return "";
    }
    const day = esc(notice.ref);
    const agenda = notice.kind === "holiday_bookings" ? `<button class="btn btn-ghost btn-sm msg-act" data-act="bellGo" data-to="agenda" data-d="${day}">Ver la Agenda</button>` : "";
    if (notice.open != null) {
      return `<span class="hint">✓ ${notice.open ? "Vas a trabajar ese día" : "Lo dejaste cerrado"}</span>${notice.open ? "" : agenda}`;
    }
    return `<div class="holbtns"><button class="btn btn-ghost btn-sm msg-act" data-act="holOpen" data-d="${day}">Abrir el día</button><button class="btn btn-ghost btn-sm msg-act" data-act="holClose" data-d="${day}">Dejarlo cerrado</button>${agenda}</div>`;
  }
  // 11/11 (D25): una reserva nueva o una cancelación de un cliente: a la Agenda, en el día del turno (si no pasó)
  if ((notice.kind === "new_booking" || notice.kind === "client_cancel") && notice.ref) {
    return notice.ref < TODAY() ? "" : `<button class="btn btn-ghost btn-sm msg-act" data-act="bellGo" data-to="agenda" data-d="${esc(notice.ref)}">Ver la Agenda</button>`;
  }
  // 4/11 · Bloque 4: Mercado Pago cobró la comisión de otro plazo: a donde se elige (9/11: Perfil → Cobros con Mercado Pago)
  if (notice.kind === "mp_term") {
    return go("perfil", "Revisar el plazo");
  }
  return "";
}
function clientList() {
  const inbox = S.inbox || [];
  if (!inbox.length) {
    return '<p class="note bell-empty">No tenés avisos. Acá te llegan las confirmaciones, los recordatorios y lo que te mandan tus profesionales.</p>';
  }
  return `<ul class="ag">${inbox
    .map(
      (msg) =>
        `<li class="${liClass(msg)}" data-msg="${esc(String(msg.id))}">${avatar({ photo: msg.photo, name: msg.name, hue: msg.hue })}<div><b>${esc(msg.name)}</b><span class="msgb">${esc(msg.body)}</span><span class="hint">${seenMark(msg)}${esc(msg.d)}</span>${msgAction(msg)}</div><button class="xbtn" data-act="inboxDel" data-id="${esc(String(msg.id))}" aria-label="Borrar este aviso">✕</button></li>`,
    )
    .join("")}</ul>`;
}
function providerList() {
  const notices = S.notices || [];
  if (!notices.length) {
    return '<p class="note bell-empty">No tenés avisos. Acá te llegan las reservas nuevas, las cancelaciones, los seguidores nuevos y las novedades de tus cobros.</p>';
  }
  return `<ul class="ag">${notices
    .map(
      (notice) =>
        `<li class="${liClass(notice)}" data-notice="${esc(String(notice.id))}"><div><b class="notice-t">${ic(NOTICE_IC[notice.kind] || "campana")} ${esc(NOTICE_TITLE[notice.kind] || "Aviso")}</b><span class="msgb">${esc(notice.body)}</span><span class="hint">${seenMark(notice)}${esc(relDate(notice.at))}</span>${noticeAction(notice)}</div><button class="xbtn" data-act="noticeDel" data-id="${esc(String(notice.id))}" aria-label="Borrar este aviso">✕</button></li>`,
    )
    .join("")}</ul>`;
}
// los que estaban sin leer al abrir la campanita (se resaltan aunque ya queden leídos)
let opened = new Set();
const fresh = (item) => !item.read || opened.has(String(item.id));
// 7/11: los ya vistos van más pálidos y con «✓ Visto» (cliente y profesional, igual)
const liClass = (item) => (fresh(item) ? "unread" : "seen");
const seenMark = (item) => (fresh(item) ? "" : "✓ Visto · ");
// título e ícono de cada aviso del profesional (el texto lo arma la base)
const NOTICE_TITLE = {
  // 11/11 (D25): cada reserva nueva de la app y cada cancelación de un cliente (también por email y push)
  new_booking: "Nueva reserva",
  client_cancel: "Cancelación de un cliente",
  new_follower: "Nuevo seguidor",
  holiday: "Feriado",
  holiday_bookings: "Turnos en un feriado",
  mp_term: "Plazo de Mercado Pago",
  mp_connect: "Mercado Pago",
  mp_reconnect: "Mercado Pago",
  mp_cost: "Mercado Pago",
  mp_refunded: "Cobros",
  mp_charged_back: "Cobros",
  mp_in_mediation: "Cobros",
  // 10/11 (D43): TuTiempo suspendió la cuenta o la volvió a activar (el aviso fijo del panel dice cómo resolverlo)
  suspended: "Cuenta suspendida",
  reactivated: "Cuenta activa",
};
const NOTICE_IC = { new_booking: "agenda", client_cancel: "agenda", new_follower: "clientes", holiday: "agenda", holiday_bookings: "agenda", mp_term: "mp", mp_connect: "mp", mp_reconnect: "mp", mp_cost: "mp", mp_refunded: "efectivo", mp_charged_back: "aviso", mp_in_mediation: "aviso", suspended: "pausa", reactivated: "ok" };
// el botón de la cabecera y, si está abierta, la lista
export function bell() {
  if (!bellShown()) {
    return "";
  }
  const unread = bellUnread();
  const provider = forProvider();
  const hasRead = items().some((item) => item.read);
  return `<div class="bellw"><button type="button" class="bell-btn" data-act="bellToggle" aria-haspopup="dialog" aria-expanded="${!!S.bellOpen}" aria-controls="bellPanel" aria-label="Avisos${unread ? `, ${unread} sin leer` : ""}"><span aria-hidden="true">${ic("campana")}</span>${unread ? `<span class="bell-n">${unread > 9 ? "9+" : unread}</span>` : ""}</button>${
    S.bellOpen
      ? `<div class="bellpanel inbox" id="bellPanel" role="dialog" aria-label="Avisos"><div class="inbox-h"><p class="lbl">${ic("campana")} Avisos${unread ? ` <span class="cnt">${unread}</span>` : ""}</p>${hasRead ? `<button class="lnk" data-act="${provider ? "noticeClear" : "inboxClear"}">Borrar los leídos</button>` : ""}</div>${provider ? providerList() : clientList()}</div>`
      : ""
  }</div>`;
}

// al abrir quedan leídos (en la base y en pantalla); los que eran nuevos se siguen resaltando hasta cerrar
export function markBellRead() {
  const list = items();
  opened = new Set(list.filter((item) => !item.read).map((item) => String(item.id)));
  if (!opened.size) {
    return;
  }
  list.forEach((item) => (item.read = true));
  if (forProvider()) {
    api.m.readNotices();
  } else {
    api.m.readMessages();
  }
}

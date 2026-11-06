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
// turno ofrecido, ver el perfil), su ✕ y "Borrar los leídos"; los del profesional, a dónde ir (Seguidores, Perfil).
// Se cierra tocando afuera, con Esc o al elegir una acción.

// a quién son los avisos: los del panel si es el profesional (o una cuenta de negocio); si no, los del cliente
const forProvider = () => S.role === "barbero" || isBusiness();
const items = () => (forProvider() ? S.notices || [] : S.inbox || []);
export const bellUnread = () => items().filter((item) => !item.read).length;
// la campanita va con sesión, salvo en el panel de TuTiempo
export const bellShown = () => !!S.user && S.role !== "admin";

// la acción de cada aviso del cliente según lo que dice. Confirmación, recordatorios y cancelación → ver ese turno;
// pedido de reseña → dejarla (o "Ya calificaste"); turno libre que ofreció el profesional → "Reservar" (4/11); los
// mensajes del profesional, las novedades y el saludo de cumpleaños → ver su perfil. Si el turno ya no está, su perfil.
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
        `<li class="${fresh(msg) ? "unread" : ""}" data-msg="${esc(String(msg.id))}">${avatar({ photo: msg.photo, name: msg.name, hue: msg.hue })}<div><b>${esc(msg.name)}</b><span class="msgb">${esc(msg.body)}</span><span class="hint">${esc(msg.d)}</span>${msgAction(msg)}</div><button class="xbtn" data-act="inboxDel" data-id="${esc(String(msg.id))}" aria-label="Borrar este aviso">✕</button></li>`,
    )
    .join("")}</ul>`;
}
function providerList() {
  const notices = S.notices || [];
  if (!notices.length) {
    return '<p class="note bell-empty">No tenés avisos. Acá te llegan los seguidores nuevos y las novedades de tus cobros.</p>';
  }
  return `<ul class="ag">${notices
    .map(
      (notice) =>
        `<li class="${fresh(notice) ? "unread" : ""}"><div><span class="msgb">${esc(notice.body)}</span><span class="hint">${esc(relDate(notice.at))}</span>${noticeAction(notice)}</div></li>`,
    )
    .join("")}</ul>`;
}
// los que estaban sin leer al abrir la campanita (se resaltan aunque ya queden leídos)
let opened = new Set();
const fresh = (item) => !item.read || opened.has(String(item.id));
// el botón de la cabecera y, si está abierta, la lista
export function bell() {
  if (!bellShown()) {
    return "";
  }
  const unread = bellUnread();
  const provider = forProvider();
  const hasRead = !provider && (S.inbox || []).some((msg) => msg.read);
  return `<div class="bellw"><button type="button" class="bell-btn" data-act="bellToggle" aria-haspopup="dialog" aria-expanded="${!!S.bellOpen}" aria-controls="bellPanel" aria-label="Avisos${unread ? `, ${unread} sin leer` : ""}"><span aria-hidden="true">${ic("campana")}</span>${unread ? `<span class="bell-n">${unread > 9 ? "9+" : unread}</span>` : ""}</button>${
    S.bellOpen
      ? `<div class="bellpanel inbox" id="bellPanel" role="dialog" aria-label="Avisos"><div class="inbox-h"><p class="lbl">${ic("campana")} Avisos${unread ? ` <span class="cnt">${unread}</span>` : ""}</p>${hasRead ? '<button class="lnk" data-act="inboxClear">Borrar los leídos</button>' : ""}</div>${provider ? providerList() : clientList()}</div>`
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

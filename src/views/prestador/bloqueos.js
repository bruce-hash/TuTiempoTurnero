import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc, ini } from "../../lib/dom.js";
import { TODAY, dayLabel, dm, isoToLocal, nowHM } from "../../lib/fechas.js";
import { ME } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";
import { inApp } from "./mensajes.js";

// D45 (punto 10): Eliminar de la lista y Bloquear, desde la ficha de un cliente (y Bloquear desde Seguidores). Las
// confirmaciones con los turnos que tiene reservados y la lista Bloqueados (Clientes → Bloqueados). Quien está bloqueado
// no lo sabe: no puede reservar ni seguir y no le llegan novedades, ofertas ni mensajes (lo hace cumplir la base).

// a quién se le pregunta (S.cliAsk): {kind: "del"|"block", name: ficha de Clientes, user: cuenta, label: cómo se llama}
export const askTarget = () => S.cliAsk;
// la cuenta de la app de una ficha (en la demo, el nombre hace de cuenta)
export const clientUser = (name) => {
  const client = store.CLIENTS[name];
  return client && (LIVE ? client.user || null : inApp(name) ? "demo:" + name : null);
};
// los turnos que vienen de esa persona en la Agenda: por su cuenta si reservó por la app, por el nombre escrito si es un
// contacto cargado a mano (la misma regla que client_upcoming en la base)
export function upcomingOf(target) {
  const now = TODAY() + nowHM();
  const user = LIVE ? target.user : null;
  const name = String(target.name || "").toLowerCase();
  return store.BOOK.filter(
    (booking) =>
      booking.pid == ME() &&
      !booking.busy &&
      booking.type !== "block" &&
      booking.status === "confirmed" &&
      booking.date + booking.time >= now &&
      (user ? booking.user === user : LIVE ? !booking.user && booking.src === "manual" && booking.cliente.toLowerCase() === name : !!name && booking.cliente.toLowerCase() === name),
  ).sort((one, other) => (one.date + one.time).localeCompare(other.date + other.time));
}
const paidOf = (booking) => (booking.paid || 0) + (booking.fee || 0) + (booking.mpFee || 0);
const turnosList = (list) =>
  `<ul class="ag">${list
    .map(
      (booking) =>
        `<li><span class="ag-t">${booking.time}</span><div><b>${esc(dayLabel(booking.date))}</b><span>${esc(booking.svc)}${booking.paid ? ` · seña ${money(booking.paid)}` : ""}</span></div>${booking.paid ? '<span class="chip ok">Seña pagada</span>' : ""}</li>`,
    )
    .join("")}</ul>`;
// las dos opciones cuando tiene turnos reservados (cancelarlos con la devolución de siempre, D08, o dejarlos)
function upcomingChoice(list, kind, manual) {
  const n = list.length;
  const many = n > 1;
  const paid = list.reduce((sum, booking) => sum + paidOf(booking), 0);
  const cancelTxt = manual ? `Cancelar ${many ? "sus turnos futuros" : "su turno"}` : many ? "Cancelar los turnos y devolver las señas" : "Cancelar el turno y devolver la seña";
  const cancelNote = manual
    ? `${many ? "Se cancelan" : "Se cancela"} en tu Agenda. No tiene la app: avisale vos.`
    : `${paid ? `Le devolvemos todo lo que pagó (${money(paid)}, seña y comisión) y le` : "Le"} ${kind === "block" ? "llega el aviso de siempre de turno cancelado, sin decir que lo bloqueaste." : "avisamos por la app."}`;
  const keepTxt = `${manual ? (many ? "Dejarlos" : "Dejarlo") : many ? "Dejar los turnos" : "Dejar el turno"} y ${kind === "block" ? "bloquear" : "eliminar"} igual`;
  const keepNote = manual
    ? `${many ? "Quedan" : "Queda"} en tu Agenda con su nombre.`
    : kind === "block"
      ? `${many ? "Los turnos siguen" : "El turno sigue"} en tu Agenda. Lo bloqueás igual: no puede reservar otro.`
      : `${many ? "Los turnos siguen" : "El turno sigue"} en tu Agenda y lo atendés como siempre.`;
  return `<p class="sub">${manual ? `Tiene ${n} turno${many ? "s" : ""} agendado${many ? "s" : ""}` : `Tiene ${n} turno${many ? "s" : ""} reservado${many ? "s" : ""}`}</p>
   ${turnosList(list)}
   <div class="optbtns">
    <button class="btn btn-bad btn-block" data-act="cliDo" data-c="1">${cancelTxt}</button>
    <p class="note">${cancelNote}</p>
    <button class="btn btn-ghost btn-block" data-act="cliDo" data-c="0">${keepTxt}</button>
    <p class="note">${keepNote}</p>
    <button class="lnk" data-act="cliAskBack">Volver</button>
   </div>`;
}
const plainChoice = (label) =>
  `<div class="optrow"><button class="btn btn-ghost" data-act="cliAskBack">Volver</button><button class="btn btn-bad" data-act="cliDo">${label}</button></div>`;
// el recuadro de confirmación (en la ficha o debajo de la fila de Seguidores)
export function askPanel(target) {
  const list = upcomingOf(target);
  const who = esc(target.label);
  if (target.kind === "block") {
    return `<div class="panel delpanel cliask"><b>Bloquear a ${who}</b>
     <ul class="dl"><li>Deja de seguirte y no puede volver a seguirte.</li><li>No puede reservarte: en tu perfil ve «No hay turnos disponibles con este profesional».</li><li>No le llegan tus novedades, ofertas ni mensajes.</li><li>Sale de Clientes y de Seguidores. Sus turnos pasados, Finanzas y Estadísticas quedan igual.</li><li>No le avisamos que lo bloqueaste.</li><li>Lo podés desbloquear cuando quieras desde Clientes → Bloqueados.</li></ul>
     ${list.length ? upcomingChoice(list, "block", false) : plainChoice("Bloquear")}</div>`;
  }
  if (!target.user) {
    return `<div class="panel delpanel cliask"><b>Eliminar el contacto ${who}</b>
     <ul class="dl"><li>Es un contacto que cargaste vos: se borran su nombre, celular, cumpleaños y notas.</li><li>Sus turnos pasados quedan en tu Agenda con su nombre. Lo que ya te pagó queda en Finanzas y Estadísticas.</li><li>No se puede deshacer.</li></ul>
     ${list.length ? upcomingChoice(list, "del", true) : plainChoice("Eliminar")}</div>`;
  }
  return `<div class="panel delpanel cliask"><b>Eliminar a ${who} de tu lista</b>
   <ul class="dl"><li>Deja de aparecer en Clientes.</li><li>Sus turnos pasados, lo que te pagó, Finanzas y Estadísticas quedan igual.</li><li>Si vuelve a reservarte, aparece de nuevo en tu lista.</li></ul>
   ${list.length ? upcomingChoice(list, "del", false) : plainChoice("Eliminar")}</div>`;
}
// al final de la ficha: las dos acciones, chicas y grises (al contacto cargado a mano, solo Eliminar: D45.6)
export function cliMore(name) {
  const client = store.CLIENTS[name];
  if (client.blocked) {
    return `<div class="cli-more"><button class="lnk" data-act="unblock" data-id="${esc(clientUser(name))}">${ic("bloquear")} Desbloquear</button></div>`;
  }
  return `<div class="cli-more"><button class="lnk" data-act="cliAsk" data-k="del">${ic("borrar")} Eliminar de mi lista</button>${clientUser(name) ? `<button class="lnk" data-act="cliAsk" data-k="block">${ic("bloquear")} Bloquear</button>` : ""}</div>`;
}
// «Bloqueados · N» al final de Clientes y de Seguidores, solo si hay alguien
export const blockedLink = () =>
  (store.BLOCKED || []).length
    ? `<div class="blk-link"><button class="lnk" data-act="ctab" data-t="bloqueados">${ic("bloquear")} Bloqueados · ${store.BLOCKED.length}</button></div>`
    : "";
const sinceTxt = (since) => "Desde el " + dm(LIVE ? isoToLocal(since).date : String(since).slice(0, 10));
const avatarOf = (row) =>
  row.photo
    ? `<img class="av" src="${esc(row.photo)}" alt="" loading="lazy">`
    : `<span class="av" style="background:hsl(${(String(row.name).charCodeAt(0) * 37) % 360} 55% 45%)">${ini(row.name)}</span>`;
// Clientes → Bloqueados
export function vBloqueados() {
  const list = store.BLOCKED || [];
  return `<button class="back" data-act="ctab" data-t="clientes">← Todos los clientes</button>
  <div class="panel"><p class="lbl">${ic("bloquear")} Bloqueados · ${list.length}</p>
   <p class="note" style="text-align:left;margin:0 0 10px">No pueden reservarte, seguirte ni recibir tus novedades, ofertas o mensajes. No saben que los bloqueaste.</p>
   ${
     list.length
       ? `<ul class="clist blist">${list
           .map(
             (row) =>
               `<li><div class="crow">${avatarOf(row)}<span class="cr-m"><b>${esc(row.name)}</b><span>${esc(sinceTxt(row.since))}</span></span><span class="cr-r"><button class="btn btn-ghost btn-sm" data-act="unblock" data-id="${esc(row.id)}">Desbloquear</button></span></div></li>`,
           )
           .join("")}</ul>`
       : '<p class="note">No bloqueaste a nadie.</p>'
   }
   <p class="note" style="text-align:left;margin:10px 0 0">Si lo desbloqueás puede volver a reservarte y a seguirte (no te vuelve a seguir solo: tiene que tocar Seguir).</p></div>`;
}

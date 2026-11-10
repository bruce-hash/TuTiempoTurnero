import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc, ini } from "../../lib/dom.js";
import { TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { skey } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { relBadge } from "../../ui/picker.js";
import { cliBest, cliStamps, stampCfg, stampGoal, stampGrid, stampSvcs } from "../../ui/sellos.js";
import { inApp, vMsgCompose } from "./mensajes.js";
import { demoClients } from "../../demo/clientes.js";
import { vSeguidores } from "./seguidores.js";
import { askPanel, blockedLink, cliMore, vBloqueados } from "./bloqueos.js";
import { ic } from "../../ui/iconos.js";

// nombres de clientes para mostrar: en vivo, todos los de la base con nombre (H21: ya no se descarta nadie por cómo
// se llama); en la demo, además, sin los turnos de relleno de la agenda de ejemplo. D45: sin los que sacó de su lista ni
// los bloqueados (quedan en store.CLIENTS para la Agenda, Finanzas y Estadísticas)
const listed = (name) => name.trim() && !store.CLIENTS[name].hidden && !store.CLIENTS[name].blocked;
export const realClients = () => (LIVE ? Object.keys(store.CLIENTS) : demoClients(ME())).filter(listed);
// “Hace X días/semanas/meses” desde la última visita
export const lastTxt = (days) =>
  days == null
    ? "Todavía no vino"
    : days === 0
      ? "Hoy"
      : days === 1
        ? "Ayer"
        : days < 14
          ? `Hace ${days} días`
          : days < 60
            ? `Hace ${Math.round(days / 7)} semanas`
            : `Hace ${Math.round(days / 30)} meses`;
// pestaña Clientes: resumen, mensajes, contactos, filtros y lista (o un cliente, si hay uno elegido)
export function vBClientes() {
  if (!LIVE) {
    demoClients(ME()); // la demo suma a la lista a los que reservaron por la app (también para ver a uno)
  }
  if (S.cli && store.CLIENTS[S.cli]) {
    return vFicha(S.cli);
  }
  const names = realClients();
  // 4/11 · Bloque 3: Clientes (los que reservaron o agregaste) y Seguidores (los que te siguen), por separado
  const tabs = `<div class="seg3 ctabs" role="group" aria-label="Ver"><button data-act="ctab" data-t="clientes" aria-pressed="${S.ctab !== "seguidores"}">Clientes <span>${names.length}</span></button><button data-act="ctab" data-t="seguidores" aria-pressed="${S.ctab === "seguidores"}">Seguidores <span>${store.COMM.followers || 0}</span></button></div>`;
  if (S.ctab === "seguidores") {
    return tabs + vSeguidores();
  }
  // D45: Clientes → Bloqueados (el link está al final de Clientes y de Seguidores)
  if (S.ctab === "bloqueados") {
    return vBloqueados();
  }
  // 7/11 · Bloque 5: sin el filtro «Cumplen este mes» (el cumpleaños queda en la ficha y en la base)
  const filter = S.cf in { todos: 1, recuperar: 1, fieles: 1, faltas: 1 } ? S.cf : "todos";
  const groups = {
    todos: names,
    recuperar: names.filter((name) => store.CLIENTS[name].last >= 35),
    fieles: names.filter((name) => store.CLIENTS[name].v >= 5),
    faltas: names.filter((name) => store.CLIENTS[name].n >= 1),
  };
  const shown = groups[filter].sort((one, other) =>
    filter === "recuperar" ? store.CLIENTS[other].last - store.CLIENTS[one].last : store.CLIENTS[other].v - store.CLIENTS[one].v,
  );
  const toWin = groups.recuperar.filter((name) => !store.CLIENTS[name].contacted);
  return `${tabs}<div class="stats2"><div><b>${names.length}</b><span>Clientes</span></div><div><b>${groups.fieles.length}</b><span>Fieles (5+ visitas)</span></div><div><b>${groups.recuperar.length}</b><span>Hace 5+ semanas</span></div></div>
  ${
    S.msgOpen
      ? vMsgCompose(names)
      : S.contactOpen
        ? vAddContact()
        : `<div class="cliacts"><button class="btn btn-pri" data-act="msgOpen">${ic("mensaje")} Mandar mensaje</button><button class="btn btn-ghost" data-act="contactOpen">+ Agregar contacto</button></div>
  ${toWin.length ? `<div class="panel winback"><b>${ic("efectivo")} ${toWin.length} cliente${toWin.length > 1 ? "s" : ""} no vienen hace más de 5 semanas</b><p class="note" style="text-align:left;margin:4px 0 10px">Son unos ${money(toWin.reduce((sum, name) => sum + store.CLIENTS[name].spend, 0))} por mes que podés recuperar con un mensaje.</p><button class="btn btn-ghost btn-block" data-act="msgOpen" data-pre="recuperar">${ic("mensaje")} Escribirles</button></div>` : ""}`
  }
  <div class="panel"><input id="csearch" class="search" placeholder="Buscar cliente por nombre o teléfono" autocomplete="off">
   <div class="fchips">${[
     ["todos", "Todos"],
     ["recuperar", "Para recuperar"],
     ["fieles", "Fieles"],
     ["faltas", "Con faltas"],
   ]
     .map(
       ([key, label]) =>
         `<button data-cf="${key}" aria-pressed="${filter === key}">${label} <span>${groups[key].length}</span></button>`,
     )
     .join("")}</div>
   ${
     shown.length
       ? `<ul class="clist">${shown
           .map((name) => {
             const client = store.CLIENTS[name];
             return `<li data-name="${esc((name + " " + client.tel).toLowerCase())}"><button class="crow" data-cli="${esc(name)}"><span class="av" style="background:hsl(${(name.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(name)}</span><span class="cr-m"><b>${esc(name)}</b><span>${lastTxt(client.last)} · ${client.v} visita${client.v === 1 ? "" : "s"}</span></span><span class="cr-r">${(() => {
               const best = cliBest(name);
               if (best) {
                 return `<span class="rb st">${ic("sellos")} ${best.n}/${best.g}</span>`;
               } else {
                 return "";
               }
             })()}${relBadge(name)}${client.contacted ? '<span class="rb new">Contactado</span>' : ""}</span></button></li>`;
           })
           .join("")}</ul><p class="note" id="cnone" hidden>No encontramos clientes con ese nombre.</p>`
       : '<p class="note">No hay clientes en este filtro.</p>'
   }
  </div>${blockedLink()}`;
}
function vAddContact() {
  const draft = S.newC || {};
  return `<form class="panel" id="fContact" novalidate><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">+ Agregar contacto</p><button type="button" class="xbtn" data-act="contactClose" aria-label="Cerrar">✕</button></div>
   ${"contacts" in navigator && "ContactsManager" in window ? `<button type="button" class="btn btn-ghost btn-block" style="margin:10px 0" data-act="pickContact">${ic("contactos")} Elegir de los contactos del celular</button>` : ""}
   <div class="f"><label for="nc_n">Nombre</label><input id="nc_n" maxlength="80" autocomplete="off" value="${esc(draft.n || "")}"></div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="nc_t">Celular</label><input id="nc_t" type="tel" inputmode="tel" maxlength="20" placeholder="2284 123456" autocomplete="off" value="${esc(draft.t || "")}"></div>
    <div class="f"><label for="nc_b">Cumpleaños (DD/MM)</label><input id="nc_b" maxlength="5" placeholder="22/03" autocomplete="off"></div></div>
   <div class="f"><label for="nc_x">Notas</label><input id="nc_x" maxlength="300" autocomplete="off" placeholder="Opcional"></div>
   <div class="err" id="ncerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar contacto</button></form>`;
}
// un cliente: teléfono, números, sellos, próximos turnos e historial (v2: sin la ficha de notas; lo que ya estaba
// cargado queda en la base)
function vFicha(name) {
  const client = store.CLIENTS[name];
  const upcoming = store.BOOK.filter(
    (booking) => booking.cliente === name && booking.status === "confirmed" && booking.date + booking.time >= TODAY() + nowHM(),
  ).sort((one, other) => (one.date + one.time).localeCompare(other.date + other.time));
  const history = store.BOOK.filter((booking) => booking.cliente === name && booking.status !== "confirmed" && booking.status !== "cancelled");
  const head = `<button class="back" data-act="cliBack">← Todos los clientes</button>
  <div class="panel contact" style="gap:14px"><span class="av" style="width:54px;height:54px;font-size:18px;background:hsl(${(name.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(name)}</span><div><b style="font-size:18px">${esc(name)}</b><div class="hint">${ic("telefono")} ${esc(client.tel)}${client.bday ? ` · ${ic("torta")} ${client.bday.slice(3)}/${client.bday.slice(0, 2)}` : ""}</div><div style="margin-top:6px">${relBadge(name)}</div></div></div>`;
  // D45: «Eliminar de mi lista» o «Bloquear»: la ficha queda con la tarjeta del cliente y el recuadro de confirmación
  if (S.cliAsk && S.cliAsk.name === name) {
    return head + askPanel(S.cliAsk);
  }
  return `${head}
  <div class="stats2 s4"><div><b>${client.v}</b><span>Visitas</span></div><div><b>${client.n}</b><span>Faltas</span></div><div><b>${money(client.spend * client.v)}</b><span>Gastó en total</span></div><div><b>${client.last == null ? "—" : esc(lastTxt(client.last))}</b><span>Última visita</span></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ok" data-act="msgOne" ${inApp(name) ? "" : "disabled"}>${inApp(name) ? `${ic("mensaje")} Mandar mensaje` : `${ic("sinapp")} Sin la app`}</button><button class="btn btn-pri" data-act="cliAgendar">+ Agendar turno</button></div>
  ${(() => {
    const conf = stampCfg(ME());
    const svcs = stampSvcs(pr(ME()));
    if (!conf.on || !svcs.length) {
      return "";
    }
    const canStamp = !LIVE || !!client.user;
    return `<div class="panel stampcard"><p class="lbl">${ic("sellos")} Tarjetas de sellos</p>${svcs
      .map((svc) => {
        const goal = stampGoal(ME(), svc);
        const have = cliStamps(name, svc);
        const key = esc(String(skey(svc)));
        return `<div class="scrow"><div class="scrow-h"><b>${esc(svc[0])}</b><b>${Math.min(have, goal)} / ${goal}</b></div>${stampGrid(Math.min(have, goal), goal, "sm")}
       ${canStamp ? `<div class="scacts"><button class="btn btn-ghost btn-sm" data-act="stampAdd" data-sk="${key}">+1 sello</button>${have >= goal ? `<button class="btn btn-pri btn-sm" data-act="stampRedeem" data-sk="${key}">${ic("premio")} Canjear premio</button>` : `<span class="hint">Le faltan ${goal - have} para uno gratis</span>`}</div>` : ""}</div>`;
      })
      .join("")}
     <p class="note" style="text-align:left;margin:10px 0 0">${canStamp ? "Cada turno atendido por la app suma solo en la tarjeta de ese servicio." : "Los sellos se guardan en la cuenta de la app del cliente: este contacto todavía no la tiene."}</p></div>`;
  })()}
  <div class="panel"><p class="lbl">Próximos turnos</p>${upcoming.length ? `<ul class="ag">${upcoming.map((booking) => `<li><span class="ag-t">${booking.time}</span><div><b>${esc(dayLabel(booking.date))}</b><span>${esc(booking.svc)}</span></div><span class="chip ok">✓ Confirmado</span></li>`).join("")}</ul>` : '<p class="note">No tiene turnos reservados.</p>'}</div>
  <div class="panel"><p class="lbl">Historial</p><ul class="ag hist">${history.map((booking) => `<li><span class="ag-t">${esc(dayLabel(booking.date))}</span><div><b>${esc(booking.svc)}</b><span>${money(booking.price)}</span></div>${booking.status === "noshow" ? '<span class="chip bad">No vino</span>' : `<span class="chip ok">${ic("ok")} Atendido</span>`}</li>`).join("")}
   ${client.last != null ? `<li><span class="ag-t">${lastTxt(client.last).replace("Hace ", "")}</span><div><b>Última visita registrada</b><span>Ticket promedio ${money(client.spend)}</span></div><span class="chip ok">${ic("ok")}</span></li>` : ""}</ul>
   ${!history.length && client.last == null ? '<p class="note">Todavía no tiene visitas.</p>' : ""}</div>
  ${cliMore(name)}`;
}

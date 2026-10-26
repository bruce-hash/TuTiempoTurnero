import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc, ini } from "../../lib/dom.js";
import { NOW, TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { RUBRO } from "../../lib/rubros.js";
import { skey } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { relBadge } from "../../ui/picker.js";
import { cliBest, cliStamps, stampCfg, stampGoal, stampGrid, stampSvcs } from "../../ui/sellos.js";
import { inApp, vMsgCompose } from "./mensajes.js";
import { demoClients } from "../../demo/clientes.js";

// nombres de clientes para mostrar: en vivo, todos los de la base con nombre (H21: ya no se descarta nadie por cómo
// se llama); en la demo, además, sin los turnos de relleno de la agenda de ejemplo
export const realClients = () =>
  LIVE
    ? Object.keys(store.CLIENTS).filter((name) => name.trim())
    : demoClients(ME()).filter((name) => name.trim());
export const thisMonthBday = (client) => client.bday && +client.bday.slice(0, 2) === NOW().getMonth() + 1;
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
// pestaña Clientes: resumen, mensajes, contactos, filtros y lista (o la ficha si hay uno elegido)
export function vBClientes() {
  if (!LIVE) {
    demoClients(ME()); // la demo suma a la lista a los que reservaron por la app (también para la ficha)
  }
  if (S.cli && store.CLIENTS[S.cli]) {
    return vFicha(S.cli);
  }
  const filter = S.cf || "todos";
  const names = realClients();
  const groups = {
    todos: names,
    recuperar: names.filter((name) => store.CLIENTS[name].last >= 35),
    fieles: names.filter((name) => store.CLIENTS[name].v >= 5),
    faltas: names.filter((name) => store.CLIENTS[name].n >= 1),
    cumple: names.filter((name) => thisMonthBday(store.CLIENTS[name])),
  };
  const shown = groups[filter].sort((one, other) =>
    filter === "recuperar" ? store.CLIENTS[other].last - store.CLIENTS[one].last : store.CLIENTS[other].v - store.CLIENTS[one].v,
  );
  const toWin = groups.recuperar.filter((name) => !store.CLIENTS[name].contacted);
  return `<div class="stats2"><div><b>${names.length}</b><span>Clientes</span></div><div><b>${groups.fieles.length}</b><span>Fieles (5+ visitas)</span></div><div><b>${groups.recuperar.length}</b><span>Hace 5+ semanas</span></div></div>
  ${
    S.msgOpen
      ? vMsgCompose(names)
      : S.contactOpen
        ? vAddContact()
        : `<div class="cliacts"><button class="btn btn-pri" data-act="msgOpen">💬 Mandar mensaje</button><button class="btn btn-ghost" data-act="contactOpen">+ Agregar contacto</button></div>
  ${toWin.length ? `<div class="panel winback"><b>💸 ${toWin.length} cliente${toWin.length > 1 ? "s" : ""} no vienen hace más de 5 semanas</b><p class="note" style="text-align:left;margin:4px 0 10px">Son unos ${money(toWin.reduce((sum, name) => sum + store.CLIENTS[name].spend, 0))} por mes que podés recuperar con un mensaje.</p><button class="btn btn-ghost btn-block" data-act="msgOpen" data-pre="recuperar">💬 Escribirles</button></div>` : ""}`
  }
  <div class="panel"><input id="csearch" class="search" placeholder="🔍 Buscar cliente por nombre o teléfono" autocomplete="off">
   <div class="fchips">${[
     ["todos", "Todos"],
     ["recuperar", "Para recuperar"],
     ["fieles", "Fieles"],
     ["faltas", "Con faltas"],
     ["cumple", "Cumplen este mes"],
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
             return `<li data-name="${esc((name + " " + client.tel).toLowerCase())}"><button class="crow" data-cli="${esc(name)}"><span class="av" style="background:hsl(${(name.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(name)}</span><span class="cr-m"><b>${esc(name)}</b><span>${lastTxt(client.last)} · ${client.v} visita${client.v === 1 ? "" : "s"}${thisMonthBday(client) ? " · 🎂 cumple" : ""}</span></span><span class="cr-r">${(() => {
               const best = cliBest(name);
               if (best) {
                 return `<span class="rb st">🎟️ ${best.n}/${best.g}</span>`;
               } else {
                 return "";
               }
             })()}${relBadge(name)}${client.contacted ? '<span class="rb new">Contactado</span>' : ""}</span></button></li>`;
           })
           .join("")}</ul><p class="note" id="cnone" hidden>No encontramos clientes con ese nombre.</p>`
       : '<p class="note">No hay clientes en este filtro.</p>'
   }
  </div>`;
}
function vAddContact() {
  const draft = S.newC || {};
  return `<form class="panel" id="fContact" novalidate><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">+ Agregar contacto</p><button type="button" class="xbtn" data-act="contactClose" aria-label="Cerrar">✕</button></div>
   ${"contacts" in navigator && "ContactsManager" in window ? '<button type="button" class="btn btn-ghost btn-block" style="margin:10px 0" data-act="pickContact">📇 Elegir de los contactos del celular</button>' : ""}
   <div class="f"><label for="nc_n">Nombre</label><input id="nc_n" maxlength="80" autocomplete="off" value="${esc(draft.n || "")}"></div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="nc_t">Celular</label><input id="nc_t" type="tel" inputmode="tel" maxlength="20" placeholder="2284 123456" autocomplete="off" value="${esc(draft.t || "")}"></div>
    <div class="f"><label for="nc_b">Cumpleaños (DD/MM)</label><input id="nc_b" maxlength="5" placeholder="22/03" autocomplete="off"></div></div>
   <div class="f"><label for="nc_x">Notas</label><input id="nc_x" maxlength="300" autocomplete="off" placeholder="Opcional"></div>
   <div class="err" id="ncerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar contacto</button></form>`;
}
// campos de la ficha del cliente según los rubros del prestador, sin repetir
export function fichaFields() {
  const fields = [];
  const seen = {};
  pr(ME()).cats.forEach((cat) =>
    (RUBRO[cat] || RUBRO.b).ficha.forEach((field) => {
      if (!seen[field[0]]) {
        seen[field[0]] = 1;
        fields.push(field);
      }
    }),
  );
  return fields;
}
// ficha de un cliente: datos, sellos, notas, próximos turnos e historial
function vFicha(name) {
  const client = store.CLIENTS[name];
  const upcoming = store.BOOK.filter(
    (booking) => booking.cliente === name && booking.status === "confirmed" && booking.date + booking.time >= TODAY() + nowHM(),
  ).sort((one, other) => (one.date + one.time).localeCompare(other.date + other.time));
  const history = store.BOOK.filter((booking) => booking.cliente === name && booking.status !== "confirmed" && booking.status !== "cancelled");
  return `<button class="back" data-act="cliBack">← Todos los clientes</button>
  <div class="panel contact" style="gap:14px"><span class="av" style="width:54px;height:54px;font-size:18px;background:hsl(${(name.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(name)}</span><div><b style="font-size:18px">${esc(name)}</b><div class="hint">📞 ${esc(client.tel)}${client.bday ? ` · 🎂 ${client.bday.slice(3)}/${client.bday.slice(0, 2)}` : ""}</div><div style="margin-top:6px">${relBadge(name)}</div></div></div>
  <div class="stats2"><div><b>${client.v}</b><span>Visitas</span></div><div><b>${client.n}</b><span>Faltas</span></div><div><b>${money(client.spend * client.v)}</b><span>Gastó en total</span></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ok" data-act="msgOne" ${inApp(name) ? "" : "disabled"}>${inApp(name) ? "💬 Mandar mensaje" : "📵 Sin la app"}</button><button class="btn btn-pri" data-act="cliAgendar">+ Agendar turno</button></div>
  ${(() => {
    const conf = stampCfg(ME());
    const svcs = stampSvcs(pr(ME()));
    if (!conf.on || !svcs.length) {
      return "";
    }
    const canStamp = !LIVE || !!client.user;
    return `<div class="panel stampcard"><p class="lbl">🎟️ Tarjetas de sellos</p>${svcs
      .map((svc) => {
        const goal = stampGoal(ME(), svc);
        const have = cliStamps(name, svc);
        const key = esc(String(skey(svc)));
        return `<div class="scrow"><div class="scrow-h"><b>${esc(svc[0])}</b><b>${Math.min(have, goal)} / ${goal}</b></div>${stampGrid(Math.min(have, goal), goal, "sm")}
       ${canStamp ? `<div class="scacts"><button class="btn btn-ghost btn-sm" data-act="stampAdd" data-sk="${key}">+1 sello</button>${have >= goal ? `<button class="btn btn-pri btn-sm" data-act="stampRedeem" data-sk="${key}">🎁 Canjear premio</button>` : `<span class="hint">Le faltan ${goal - have} para uno gratis</span>`}</div>` : ""}</div>`;
      })
      .join("")}
     <p class="note" style="text-align:left;margin:10px 0 0">${canStamp ? "Cada turno atendido por la app suma solo en la tarjeta de ese servicio." : "Los sellos se guardan en la cuenta de la app del cliente: este contacto todavía no la tiene."}</p></div>`;
  })()}
  <form class="panel" id="fNotas" novalidate><p class="lbl">📝 Ficha</p>
   ${fichaFields()
     .map(
       ([key, label]) =>
         `<div class="f"><label for="cf-${key}">${esc(label)}</label><input id="cf-${key}" data-cf2="${key}" maxlength="200" value="${esc((client.profile || {})[key] || "")}" autocomplete="off"></div>`,
     )
     .join("")}
   <div class="f" style="margin:0"><label for="cnotes">Notas</label><textarea id="cnotes" maxlength="1000" placeholder="Lo que quieras recordar de este cliente">${esc(client.notes)}</textarea></div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:10px"><div class="f"><label for="ctel">Celular</label><input id="ctel" value="${esc(client.tel)}" autocomplete="off"></div><div class="f"><label for="cbd">Cumpleaños (DD/MM)</label><input id="cbd" value="${client.bday ? client.bday.slice(3) + "/" + client.bday.slice(0, 2) : ""}" placeholder="22/03" autocomplete="off"></div></div>
   <div class="err" id="nerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar ficha</button>
   <p class="note" style="margin-top:6px">Estas notas te aparecen en la agenda cada vez que viene.</p></form>
  <div class="panel"><p class="lbl">Próximos turnos</p>${upcoming.length ? `<ul class="ag">${upcoming.map((booking) => `<li><span class="ag-t">${booking.time}</span><div><b>${esc(dayLabel(booking.date))}</b><span>${esc(booking.svc)}</span></div><span class="chip ok">✓ Confirmado</span></li>`).join("")}</ul>` : '<p class="note">No tiene turnos reservados.</p>'}</div>
  <div class="panel"><p class="lbl">Historial</p><ul class="ag">${history.map((booking) => `<li><span class="ag-t">${esc(dayLabel(booking.date))}</span><div><b>${esc(booking.svc)}</b><span>${money(booking.price)}</span></div>${booking.status === "noshow" ? '<span class="chip bad">No vino</span>' : '<span class="chip ok">✔ Atendido</span>'}</li>`).join("")}
   ${client.last != null ? `<li><span class="ag-t">${lastTxt(client.last).replace("Hace ", "")}</span><div><b>Última visita registrada</b><span>Ticket promedio ${money(client.spend)}</span></div><span class="chip ok">✔</span></li>` : ""}</ul>
   ${!history.length && client.last == null ? '<p class="note">Todavía no tiene visitas.</p>' : ""}</div>`;
}

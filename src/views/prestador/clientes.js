import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc, ini } from "../../lib/dom.js";
import { NOW, TODAY, dayLabel, daysAgo, nowHM } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { RUBRO } from "../../lib/rubros.js";
import { cli, skey } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { relBadge } from "../../ui/picker.js";
import { cliBest, cliStamps, stampCfg, stampGoal, stampGrid, stampSvcs } from "../../ui/sellos.js";
import { inApp, vMsgCompose } from "./mensajes.js";

function demoLinkClients() {
  if (LIVE) {
    return;
  }
  const e = ME();
  store.BOOK.forEach((a) => {
    if (a.pid != e || a.src !== "app" || !a.cliente || store.CLIENTS[a.cliente] || a.status === "cancelled") {
      return;
    }
    const t = store.BOOK.filter((n) => n.pid == e && n.cliente === a.cliente && n.status === "done");
    const s = cli(a.cliente);
    s.v = t.length;
    s.spend = t.length ? Math.round(t.reduce((n, o) => n + o.price, 0) / t.length) : a.price;
    s.last = t.length
      ? daysAgo(
          t
            .map((n) => n.date)
            .sort()
            .pop(),
        )
      : null;
    s.app = true;
  });
}
export const realClients = () =>
  (demoLinkClients(), Object.keys(store.CLIENTS)).filter(
    (e) =>
      e.trim() &&
      /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(e) &&
      e !== "R" &&
      !/^(Lucas|Matías|Bruno|Iván|Leo|Nahuel|Franco) [A-G]\.$/.test(e),
  );
export const thisMonthBday = (e) => e.bday && +e.bday.slice(0, 2) === NOW().getMonth() + 1;
export const lastTxt = (e) =>
  e == null
    ? "Todavía no vino"
    : e === 0
      ? "Hoy"
      : e === 1
        ? "Ayer"
        : e < 14
          ? `Hace ${e} días`
          : e < 60
            ? `Hace ${Math.round(e / 7)} semanas`
            : `Hace ${Math.round(e / 30)} meses`;
export function vBClientes() {
  demoLinkClients();
  if (S.cli && store.CLIENTS[S.cli]) {
    return vFicha(S.cli);
  }
  const e = S.cf || "todos";
  const a = realClients();
  const t = {
    todos: a,
    recuperar: a.filter((o) => store.CLIENTS[o].last >= 35),
    fieles: a.filter((o) => store.CLIENTS[o].v >= 5),
    faltas: a.filter((o) => store.CLIENTS[o].n >= 1),
    cumple: a.filter((o) => thisMonthBday(store.CLIENTS[o])),
  };
  const s = t[e].sort((o, i) =>
    e === "recuperar" ? store.CLIENTS[i].last - store.CLIENTS[o].last : store.CLIENTS[i].v - store.CLIENTS[o].v,
  );
  const n = t.recuperar.filter((o) => !store.CLIENTS[o].contacted);
  return `<div class="stats2"><div><b>${a.length}</b><span>Clientes</span></div><div><b>${t.fieles.length}</b><span>Fieles (5+ visitas)</span></div><div><b>${t.recuperar.length}</b><span>Hace 5+ semanas</span></div></div>
  ${
    S.msgOpen
      ? vMsgCompose(a)
      : S.contactOpen
        ? vAddContact()
        : `<div class="cliacts"><button class="btn btn-pri" data-act="msgOpen">💬 Mandar mensaje</button><button class="btn btn-ghost" data-act="contactOpen">+ Agregar contacto</button></div>
  ${n.length ? `<div class="panel winback"><b>💸 ${n.length} cliente${n.length > 1 ? "s" : ""} no vienen hace más de 5 semanas</b><p class="note" style="text-align:left;margin:4px 0 10px">Son unos ${money(n.reduce((o, i) => o + store.CLIENTS[i].spend, 0))} por mes que podés recuperar con un mensaje.</p><button class="btn btn-ghost btn-block" data-act="msgOpen" data-pre="recuperar">💬 Escribirles</button></div>` : ""}`
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
       ([o, i]) =>
         `<button data-cf="${o}" aria-pressed="${e === o}">${i} <span>${t[o].length}</span></button>`,
     )
     .join("")}</div>
   ${
     s.length
       ? `<ul class="clist">${s
           .map((o) => {
             const i = store.CLIENTS[o];
             return `<li data-name="${esc((o + " " + i.tel).toLowerCase())}"><button class="crow" data-cli="${esc(o)}"><span class="av" style="background:hsl(${(o.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(o)}</span><span class="cr-m"><b>${esc(o)}</b><span>${lastTxt(i.last)} · ${i.v} visita${i.v === 1 ? "" : "s"}${thisMonthBday(i) ? " · 🎂 cumple" : ""}</span></span><span class="cr-r">${(() => {
               const l = cliBest(o);
               if (l) {
                 return `<span class="rb st">🎟️ ${l.n}/${l.g}</span>`;
               } else {
                 return "";
               }
             })()}${relBadge(o)}${i.contacted ? '<span class="rb new">Contactado</span>' : ""}</span></button></li>`;
           })
           .join("")}</ul><p class="note" id="cnone" hidden>No encontramos clientes con ese nombre.</p>`
       : '<p class="note">No hay clientes en este filtro.</p>'
   }
  </div>`;
}
function vAddContact() {
  const e = S.newC || {};
  return `<form class="panel" id="fContact" novalidate><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">+ Agregar contacto</p><button type="button" class="xbtn" data-act="contactClose" aria-label="Cerrar">✕</button></div>
   ${"contacts" in navigator && "ContactsManager" in window ? '<button type="button" class="btn btn-ghost btn-block" style="margin:10px 0" data-act="pickContact">📇 Elegir de los contactos del celular</button>' : ""}
   <div class="f"><label for="nc_n">Nombre</label><input id="nc_n" maxlength="80" autocomplete="off" value="${esc(e.n || "")}"></div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="nc_t">Celular</label><input id="nc_t" type="tel" inputmode="tel" maxlength="20" placeholder="2284 123456" autocomplete="off" value="${esc(e.t || "")}"></div>
    <div class="f"><label for="nc_b">Cumpleaños (DD/MM)</label><input id="nc_b" maxlength="5" placeholder="22/03" autocomplete="off"></div></div>
   <div class="f"><label for="nc_x">Notas</label><input id="nc_x" maxlength="300" autocomplete="off" placeholder="Opcional"></div>
   <div class="err" id="ncerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar contacto</button></form>`;
}
export function fichaFields() {
  const e = [];
  const a = {};
  pr(ME()).cats.forEach((t) =>
    (RUBRO[t] || RUBRO.b).ficha.forEach((s) => {
      if (!a[s[0]]) {
        a[s[0]] = 1;
        e.push(s);
      }
    }),
  );
  return e;
}
function vFicha(e) {
  const a = store.CLIENTS[e];
  const t = store.BOOK.filter(
    (n) => n.cliente === e && n.status === "confirmed" && n.date + n.time >= TODAY() + nowHM(),
  ).sort((n, o) => (n.date + n.time).localeCompare(o.date + o.time));
  const s = store.BOOK.filter((n) => n.cliente === e && n.status !== "confirmed" && n.status !== "cancelled");
  return `<button class="back" data-act="cliBack">← Todos los clientes</button>
  <div class="panel contact" style="gap:14px"><span class="av" style="width:54px;height:54px;font-size:18px;background:hsl(${(e.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(e)}</span><div><b style="font-size:18px">${esc(e)}</b><div class="hint">📞 ${esc(a.tel)}${a.bday ? ` · 🎂 ${a.bday.slice(3)}/${a.bday.slice(0, 2)}` : ""}</div><div style="margin-top:6px">${relBadge(e)}</div></div></div>
  <div class="stats2"><div><b>${a.v}</b><span>Visitas</span></div><div><b>${a.n}</b><span>Faltas</span></div><div><b>${money(a.spend * a.v)}</b><span>Gastó en total</span></div></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ok" data-act="msgOne" ${inApp(e) ? "" : "disabled"}>${inApp(e) ? "💬 Mandar mensaje" : "📵 Sin la app"}</button><button class="btn btn-pri" data-act="cliAgendar">+ Agendar turno</button></div>
  ${(() => {
    const n = stampCfg(ME());
    const o = stampSvcs(pr(ME()));
    if (!n.on || !o.length) {
      return "";
    }
    const i = !LIVE || !!a.user;
    return `<div class="panel stampcard"><p class="lbl">🎟️ Tarjetas de sellos</p>${o
      .map((l) => {
        const c = stampGoal(ME(), l);
        const d = cliStamps(e, l);
        const p = esc(String(skey(l)));
        return `<div class="scrow"><div class="scrow-h"><b>${esc(l[0])}</b><b>${Math.min(d, c)} / ${c}</b></div>${stampGrid(Math.min(d, c), c, "sm")}
       ${i ? `<div class="scacts"><button class="btn btn-ghost btn-sm" data-act="stampAdd" data-sk="${p}">+1 sello</button>${d >= c ? `<button class="btn btn-pri btn-sm" data-act="stampRedeem" data-sk="${p}">🎁 Canjear premio</button>` : `<span class="hint">Le faltan ${c - d} para uno gratis</span>`}</div>` : ""}</div>`;
      })
      .join("")}
     <p class="note" style="text-align:left;margin:10px 0 0">${i ? "Cada turno atendido por la app suma solo en la tarjeta de ese servicio." : "Los sellos se guardan en la cuenta de la app del cliente: este contacto todavía no la tiene."}</p></div>`;
  })()}
  <form class="panel" id="fNotas" novalidate><p class="lbl">📝 Ficha</p>
   ${fichaFields()
     .map(
       ([n, o]) =>
         `<div class="f"><label for="cf-${n}">${esc(o)}</label><input id="cf-${n}" data-cf2="${n}" maxlength="200" value="${esc((a.profile || {})[n] || "")}" autocomplete="off"></div>`,
     )
     .join("")}
   <div class="f" style="margin:0"><label for="cnotes">Notas</label><textarea id="cnotes" maxlength="1000" placeholder="Lo que quieras recordar de este cliente">${esc(a.notes)}</textarea></div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:10px"><div class="f"><label for="ctel">Celular</label><input id="ctel" value="${esc(a.tel)}" autocomplete="off"></div><div class="f"><label for="cbd">Cumpleaños (DD/MM)</label><input id="cbd" value="${a.bday ? a.bday.slice(3) + "/" + a.bday.slice(0, 2) : ""}" placeholder="22/03" autocomplete="off"></div></div>
   <div class="err" id="nerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar ficha</button>
   <p class="note" style="margin-top:6px">Estas notas te aparecen en la agenda cada vez que viene.</p></form>
  <div class="panel"><p class="lbl">Próximos turnos</p>${t.length ? `<ul class="ag">${t.map((n) => `<li><span class="ag-t">${n.time}</span><div><b>${esc(dayLabel(n.date))}</b><span>${esc(n.svc)}</span></div><span class="chip ok">✓ Confirmado</span></li>`).join("")}</ul>` : '<p class="note">No tiene turnos reservados.</p>'}</div>
  <div class="panel"><p class="lbl">Historial</p><ul class="ag">${s.map((n) => `<li><span class="ag-t">${esc(dayLabel(n.date))}</span><div><b>${esc(n.svc)}</b><span>${money(n.price)}</span></div>${n.status === "noshow" ? '<span class="chip bad">No vino</span>' : '<span class="chip ok">✔ Atendido</span>'}</li>`).join("")}
   ${a.last != null ? `<li><span class="ag-t">${lastTxt(a.last).replace("Hace ", "")}</span><div><b>Última visita registrada</b><span>Ticket promedio ${money(a.spend)}</span></div><span class="chip ok">✔</span></li>` : ""}</ul>
   ${!s.length && a.last == null ? '<p class="note">Todavía no tiene visitas.</p>' : ""}</div>`;
}

import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { dayWord } from "../../lib/fechas.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { lastTxt, realClients, thisMonthBday } from "./clientes.js";
import { STORE } from "./panel.js";

export const MSG_DEF = (e) => [
  {
    k: "conf",
    t: "Confirmación al reservar",
    cuando: "Apenas reserva",
    on: true,
    txt: "¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.",
  },
  {
    k: "r24",
    t: "Recordatorio 24 h antes",
    cuando: "Un día antes",
    on: true,
    txt: "{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¡Te esperamos!",
  },
  {
    k: "r2",
    t: "Recordatorio 2 h antes",
    cuando: "2 horas antes",
    on: true,
    txt: "¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}",
  },
  {
    k: "rev",
    t: "Pedido de reseña",
    cuando: "2 horas después del turno",
    on: true,
    txt: "¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? Nos ayuda muchísimo: {link}",
  },
  {
    k: "bday",
    t: "Cumpleaños",
    cuando: "El día de su cumpleaños",
    on: false,
    txt: "¡Feliz cumpleaños, {nombre}! 🎉 Este mes tenés 15% off en tu próximo turno. Reservá: {link}",
  },
];
store.MSGS = MSG_DEF();
export const MSG_TPL = [
  [
    "extrano",
    "Te extrañamos",
    "¡Hola {nombre}! Hace un tiempo que no te vemos por {negocio}. Esta semana tengo turnos, reservá acá: {link}",
  ],
  [
    "libres",
    "Turnos libres",
    "{nombre}, hoy me quedaron horarios libres. Si querés venir, reservá acá: {link}",
  ],
  ["promo", "Promoción", "{nombre}, esta semana tenés 10% off en {negocio}. Reservá tu turno: {link}"],
  ["aviso", "Aviso", "Hola {nombre}, te aviso que el próximo lunes no voy a atender. ¡Gracias por entender!"],
  [
    "gracias",
    "Gracias",
    "¡Gracias por elegirnos, {nombre}! Te esperamos en {negocio} cuando quieras: {link}",
  ],
];
export function msgGroup(e) {
  return realClients().filter((a) => {
    const t = store.CLIENTS[a];
    if (e === "recuperar") {
      return t.last != null && t.last >= 35;
    } else if (e === "fieles") {
      return t.v >= 5;
    } else {
      return thisMonthBday(t);
    }
  });
}
export function updMsgCount() {
  const e = realClients();
  const a = e.filter((n) => S.msg.sel[n]).length;
  const t = document.querySelector('[data-act="msgSend"]');
  if (t) {
    t.disabled = !a;
    t.textContent = `Enviar a ${a} cliente${a === 1 ? "" : "s"}`;
  }
  const s = document.getElementById("msgAll");
  if (s) {
    s.checked = !!e.length && a === e.length;
  }
}
export const myLink = () => "tutiempo.com.ar/" + (pr(ME()).slug || "p/" + ME());
export const fillMsg2 = (e, a) =>
  e
    .replace(/\{nombre\}/g, String(a || "").split(" ")[0])
    .replace(/\{negocio\}/g, pr(ME()).name)
    .replace(/\{link\}/g, myLink());
export const inApp = (e) =>
  !!store.CLIENTS[e] &&
  (!!store.CLIENTS[e].user ||
    !!store.CLIENTS[e].app ||
    (!LIVE && !!store.BOOK.some((a) => a.cliente === e && a.src === "app" && a.pid == ME())));
export function vMsgCompose(e) {
  const a = S.msg;
  if (a.done) {
    return vMsgDone();
  }
  const t = e.filter((s) => a.sel[s]);
  return `<div class="panel msgc"><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">💬 Mensaje a tus clientes</p><button class="xbtn" data-act="msgClose" aria-label="Cerrar">✕</button></div>
   <p class="hint" style="margin:8px 0 6px">Mensajes listos (podés editarlos):</p>
   <div class="fchips">${MSG_TPL.map(([s, n]) => `<button type="button" data-act="msgTpl" data-k="${s}" aria-pressed="${a.tpl === s}">${n}</button>`).join("")}</div>
   <div class="f" style="margin-top:10px"><label for="msgTxt">Mensaje</label><textarea id="msgTxt" maxlength="500" rows="4">${esc(a.txt)}</textarea>
    <span class="hint">{nombre} se cambia por el nombre de cada cliente. Vista previa: “${esc(fillMsg2(a.txt, t[0] || "Juan"))}”</span></div>
   <div class="msgsel"><label class="chk"><input type="checkbox" id="msgAll" ${t.length === e.length && e.length ? "checked" : ""}> <span>Todos (${e.length})</span></label>
    <div class="fchips">${[
      ["recuperar", "Hace 5+ semanas"],
      ["fieles", "Fieles"],
      ["cumple", "Cumplen este mes"],
    ]
      .map(([s, n]) => {
        const o = msgGroup(s);
        return `<button type="button" data-act="msgPick" data-k="${s}" aria-pressed="${!!o.length && o.every((i) => a.sel[i])}">${o.length && o.every((i) => a.sel[i]) ? "✓ " : "+ "}${n} <span>${o.length}</span></button>`;
      })
      .join("")}</div>
    <p class="hint" style="margin:0">Tocá un grupo para sumarlo; tocalo otra vez para sacarlo.</p></div>
   <ul class="clist msgl">${e
     .map((s) => {
       const n = store.CLIENTS[s];
       return `<li><label class="crow"><input type="checkbox" data-mc="${esc(s)}" ${a.sel[s] ? "checked" : ""}>${avatar(
         {
           name: s,
         },
       )}<span class="cr-m"><b>${esc(s)}</b><span>${lastTxt(n.last)} · ${inApp(s) ? "📱 le llega en la app" : "sin la app: no le llega"}</span></span></label></li>`;
     })
     .join("")}</ul>
   <div class="err" id="msgErr"></div>
   <button class="btn btn-pri btn-block" data-act="msgSend" ${t.length ? "" : "disabled"}>Enviar a ${t.length} cliente${t.length === 1 ? "" : "s"}</button>
  </div>`;
}
function vMsgDone() {
  const e = S.msg;
  return `<div class="panel msgc"><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">✓ Mensaje enviado</p><button class="xbtn" data-act="msgClose" aria-label="Cerrar">✕</button></div>
   ${e.done.app ? `<p style="margin:8px 0">📱 <b>${e.done.app}</b> cliente${e.done.app === 1 ? "" : "s"} lo recibe${e.done.app === 1 ? "" : "n"} en la app.</p>` : ""}
   ${e.done.none ? `<p class="note" style="text-align:left">${e.done.none} no tiene${e.done.none === 1 ? "" : "n"} la app: no les llega. Pasales tu link para que se la bajen: <b>${esc(myLink())}</b></p>` : ""}
   <button class="btn btn-ghost btn-block" data-act="msgClose">Listo</button></div>`;
}
export function fillMsg(e) {
  return e
    .replace(/{nombre}/g, "Martín")
    .replace(/{barberia}/g, pr(ME()).name)
    .replace(/{dia}/g, "jueves 16")
    .replace(/{hora}/g, "18:30")
    .replace(/{direccion}/g, pr(ME()).addr)
    .replace(/{link}/g, "tutiempo.com.ar/t/8F2K");
}
export function vMensajes() {
  return `<div class="panel"><p class="lbl">🔔 Avisos automáticos en la app</p><p class="note" style="text-align:left;margin:-2px 0 10px">Les llegan solos a tus clientes como notificación en TuTiempo.</p>
   <ul class="mlist">${store.MSGS.map(
     (
       e,
       a,
     ) => `<li><div class="m-h"><label class="chk" style="margin:0"><input type="checkbox" data-mon="${a}" ${e.on ? "checked" : ""}> <b>${e.t}</b></label><button class="lnk" data-act="mEdit" data-i="${a}">${S.mEdit === a ? "Cerrar" : "Ver / editar"}</button></div><span class="hint">${e.cuando}</span>
    ${
      S.mEdit === a
        ? `<div class="m-ed"><div class="f"><label for="mtx${a}">Texto</label><textarea id="mtx${a}">${esc(e.txt)}</textarea><span class="hint">Podés usar {nombre}, {barberia}, {dia}, {hora}, {direccion}, {link}</span></div>
      <div class="ntf"><div class="ntf-b"><span class="ntf-i">🔔</span><span><b>${esc(pr(ME()).name)}</b> <small>ahora · TuTiempo</small><span class="ntf-t">${esc(fillMsg(e.txt))}</span></span></div></div>
      <button class="btn btn-pri btn-block" data-act="mSave" data-i="${a}">Guardar mensaje</button></div>`
        : ""
    }</li>`,
   ).join("")}</ul></div>`;
}
function provMsgs(e) {
  if (e == S.me) {
    return store.MSGS;
  } else {
    return (STORE[e] || {}).MSGS || MSG_DEF();
  }
}
function fillTpl(e, a, t) {
  return e
    .replace(/\{nombre\}/g, String(a.cliente || "").split(" ")[0])
    .replace(/\{barberia\}/g, t.name)
    .replace(/\{dia\}/g, dayWord(a.date))
    .replace(/\{hora\}/g, a.time)
    .replace(/\{direccion\}/g, t.addr)
    .replace(/\{link\}/g, "tutiempo.com.ar/" + (t.slug || "p/" + t.id));
}
export function pushNotice(e, a, t, s) {
  if (LIVE || !S.user || !S.inbox) {
    return;
  }
  const n = provMsgs(e).find((i) => i.k === a);
  if (!n || !n.on) {
    return;
  }
  const o = pr(e);
  S.inbox.unshift({
    id: Date.now() + Math.random(),
    pid: e,
    name: o.name,
    photo: o.photo,
    hue: o.hue,
    body: fillTpl(n.txt, t, o) + (s || ""),
    d: "recién",
    read: false,
    auto: true,
  });
  S.inboxSeen = false;
}

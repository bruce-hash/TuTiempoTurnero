import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { dayWord } from "../../lib/fechas.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { lastTxt, realClients, thisMonthBday } from "./clientes.js";
import { STORE } from "./panel.js";

// avisos automáticos por defecto (el parámetro no se usa)
export const MSG_DEF = (cat) => [
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
// mensajes listos para mandar a los clientes: [clave, título, texto]
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
// grupos de clientes: recuperar (35+ días sin venir), fieles (5+ visitas) o cumpleaños del mes
export function msgGroup(group) {
  return realClients().filter((name) => {
    const client = store.CLIENTS[name];
    if (group === "recuperar") {
      return client.last != null && client.last >= 35;
    } else if (group === "fieles") {
      return client.v >= 5;
    } else {
      return thisMonthBday(client);
    }
  });
}
export function updMsgCount() {
  const names = realClients();
  const count = names.filter((name) => S.msg.sel[name]).length;
  const btn = document.querySelector('[data-act="msgSend"]');
  if (btn) {
    btn.disabled = !count;
    btn.textContent = `Enviar a ${count} cliente${count === 1 ? "" : "s"}`;
  }
  const allBox = document.getElementById("msgAll");
  if (allBox) {
    allBox.checked = !!names.length && count === names.length;
  }
}
export const myLink = () => "tutiempo.com.ar/" + (pr(ME()).slug || "p/" + ME());
// texto del mensaje a un cliente con sus datos; fillMsg es la vista previa de un aviso con datos de ejemplo
export const fillMsg2 = (text, name) =>
  text
    .replace(/\{nombre\}/g, String(name || "").split(" ")[0])
    .replace(/\{negocio\}/g, pr(ME()).name)
    .replace(/\{link\}/g, myLink());
// el mensaje solo le llega a quien tiene cuenta en la app
export const inApp = (name) =>
  !!store.CLIENTS[name] &&
  (!!store.CLIENTS[name].user ||
    !!store.CLIENTS[name].app ||
    (!LIVE && !!store.BOOK.some((booking) => booking.cliente === name && booking.src === "app" && booking.pid == ME())));
export function vMsgCompose(names) {
  const msg = S.msg;
  if (msg.done) {
    return vMsgDone();
  }
  const selected = names.filter((name) => msg.sel[name]);
  return `<div class="panel msgc"><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">💬 Mensaje a tus clientes</p><button class="xbtn" data-act="msgClose" aria-label="Cerrar">✕</button></div>
   <p class="hint" style="margin:8px 0 6px">Mensajes listos (podés editarlos):</p>
   <div class="fchips">${MSG_TPL.map(([key, label]) => `<button type="button" data-act="msgTpl" data-k="${key}" aria-pressed="${msg.tpl === key}">${label}</button>`).join("")}</div>
   <div class="f" style="margin-top:10px"><label for="msgTxt">Mensaje</label><textarea id="msgTxt" maxlength="500" rows="4">${esc(msg.txt)}</textarea>
    <span class="hint">{nombre} se cambia por el nombre de cada cliente. Vista previa: “${esc(fillMsg2(msg.txt, selected[0] || "Juan"))}”</span></div>
   <div class="msgsel"><label class="chk"><input type="checkbox" id="msgAll" ${selected.length === names.length && names.length ? "checked" : ""}> <span>Todos (${names.length})</span></label>
    <div class="fchips">${[
      ["recuperar", "Hace 5+ semanas"],
      ["fieles", "Fieles"],
      ["cumple", "Cumplen este mes"],
    ]
      .map(([key, label]) => {
        const members = msgGroup(key);
        return `<button type="button" data-act="msgPick" data-k="${key}" aria-pressed="${!!members.length && members.every((name) => msg.sel[name])}">${members.length && members.every((name) => msg.sel[name]) ? "✓ " : "+ "}${label} <span>${members.length}</span></button>`;
      })
      .join("")}</div>
    <p class="hint" style="margin:0">Tocá un grupo para sumarlo; tocalo otra vez para sacarlo.</p></div>
   <ul class="clist msgl">${names
     .map((name) => {
       const client = store.CLIENTS[name];
       return `<li><label class="crow"><input type="checkbox" data-mc="${esc(name)}" ${msg.sel[name] ? "checked" : ""}>${avatar(
         {
           name: name,
         },
       )}<span class="cr-m"><b>${esc(name)}</b><span>${lastTxt(client.last)} · ${inApp(name) ? "📱 le llega en la app" : "sin la app: no le llega"}</span></span></label></li>`;
     })
     .join("")}</ul>
   <div class="err" id="msgErr"></div>
   <button class="btn btn-pri btn-block" data-act="msgSend" ${selected.length ? "" : "disabled"}>Enviar a ${selected.length} cliente${selected.length === 1 ? "" : "s"}</button>
  </div>`;
}
function vMsgDone() {
  const msg = S.msg;
  return `<div class="panel msgc"><div style="display:flex;justify-content:space-between;align-items:center"><p class="lbl" style="margin:0">✓ Mensaje enviado</p><button class="xbtn" data-act="msgClose" aria-label="Cerrar">✕</button></div>
   ${msg.done.app ? `<p style="margin:8px 0">📱 <b>${msg.done.app}</b> cliente${msg.done.app === 1 ? "" : "s"} lo recibe${msg.done.app === 1 ? "" : "n"} en la app.</p>` : ""}
   ${msg.done.none ? `<p class="note" style="text-align:left">${msg.done.none} no tiene${msg.done.none === 1 ? "" : "n"} la app: no les llega. Pasales tu link para que se la bajen: <b>${esc(myLink())}</b></p>` : ""}
   <button class="btn btn-ghost btn-block" data-act="msgClose">Listo</button></div>`;
}
export function fillMsg(text) {
  return text
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
       msg,
       index,
     ) => `<li><div class="m-h"><label class="chk" style="margin:0"><input type="checkbox" data-mon="${index}" ${msg.on ? "checked" : ""}> <b>${msg.t}</b></label><button class="lnk" data-act="mEdit" data-i="${index}">${S.mEdit === index ? "Cerrar" : "Ver / editar"}</button></div><span class="hint">${msg.cuando}</span>
    ${
      S.mEdit === index
        ? `<div class="m-ed"><div class="f"><label for="mtx${index}">Texto</label><textarea id="mtx${index}">${esc(msg.txt)}</textarea><span class="hint">Podés usar {nombre}, {barberia}, {dia}, {hora}, {direccion}, {link}</span></div>
      <div class="ntf"><div class="ntf-b"><span class="ntf-i">🔔</span><span><b>${esc(pr(ME()).name)}</b> <small>ahora · TuTiempo</small><span class="ntf-t">${esc(fillMsg(msg.txt))}</span></span></div></div>
      <button class="btn btn-pri btn-block" data-act="mSave" data-i="${index}">Guardar mensaje</button></div>`
        : ""
    }</li>`,
   ).join("")}</ul></div>`;
}
function provMsgs(pid) {
  if (pid == S.me) {
    return store.MSGS;
  } else {
    return (STORE[pid] || {}).MSGS || MSG_DEF();
  }
}
function fillTpl(text, booking, prov) {
  return text
    .replace(/\{nombre\}/g, String(booking.cliente || "").split(" ")[0])
    .replace(/\{barberia\}/g, prov.name)
    .replace(/\{dia\}/g, dayWord(booking.date))
    .replace(/\{hora\}/g, booking.time)
    .replace(/\{direccion\}/g, prov.addr)
    .replace(/\{link\}/g, "tutiempo.com.ar/" + (prov.slug || "p/" + prov.id));
}
// demo: simula que al cliente le llega el aviso automático key del prestador
export function pushNotice(pid, key, booking, extra) {
  if (LIVE || !S.user || !S.inbox) {
    return;
  }
  const tpl = provMsgs(pid).find((item) => item.k === key);
  if (!tpl || !tpl.on) {
    return;
  }
  const prov = pr(pid);
  S.inbox.unshift({
    id: Date.now() + Math.random(),
    pid: pid,
    name: prov.name,
    photo: prov.photo,
    hue: prov.hue,
    body: fillTpl(tpl.txt, booking, prov) + (extra || ""),
    d: "recién",
    read: false,
    auto: true,
  });
  S.inboxSeen = false;
}

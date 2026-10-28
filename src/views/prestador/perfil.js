import { LIVE } from "../../config.js";
import { PESOS_ERR, parsePesos, parseWhole, pctTxt } from "../../lib/dinero.js";
import { $, esc } from "../../lib/dom.js";
import { ME } from "../../lib/prestadores.js";
import { CATS, catInfo } from "../../lib/rubros.js";
import { svcMeta } from "../../lib/servicios.js";
import { cfg, skey } from "../../lib/turnero.js";
import { approved, dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";
import { photoPicker } from "../../ui/fotos.js";
import { stampCfg, stampSvcs } from "../../ui/sellos.js";
import { delBox } from "../cliente/cuenta.js";
import { vMensajes } from "./mensajes.js";
import { setupSteps } from "./verificacion.js";

// editor de rubros y servicios: trabaja sobre una copia (S.edSvcs) que se crea al abrirlo
function svcEditor(prov) {
  if (!S.edSvcs || S.edFor !== prov.id) {
    S.edFor = prov.id;
    S.edSvcs = prov.svcs.map((svc) => {
      const copy = svc.slice();
      const meta = svcMeta(svc);
      copy[5] = {
        every: meta.every,
        note: meta.note,
        add: meta.add.map((addon) => addon.slice()),
      };
      return copy;
    });
    S.edCats = prov.cats.slice();
    S.edOpen = {};
  }
  const cats = S.edCats;
  return `<p class="lbl" style="margin-top:6px">Rubros en los que trabajás</p>
   <div class="catpick">${CATS.map(([key, plural, name, icon]) => `<label><input type="checkbox" id="rc-${key}" data-rc="${key}" ${cats.includes(key) ? "checked" : ""}><span>${icon} ${name}</span></label>`).join("")}</div>
   <p class="lbl">Servicios y precios</p>
   <div class="svced">${S.edSvcs
     .map(
       (
         svc,
         index,
       ) => `<div class="svcrow3"><label class="sfl sfn"><span>Nombre del servicio</span><input id="sn${index}" value="${esc(svc[0])}" autocomplete="off" placeholder="Ej: Corte de cabello"></label><button type="button" class="xbtn" data-act="svcDel" data-i="${index}" aria-label="Quitar servicio">✕</button><label class="sfl"><span>Duración (minutos)</span><input id="sd${index}" value="${svc[1]}" inputmode="numeric" placeholder="30"></label><label class="sfl"><span>Precio ($)</span><input id="sp${index}" value="${svc[2]}" inputmode="numeric" placeholder="10000"></label>
     <button type="button" class="lnk svcmore" data-act="svcOpts" data-i="${index}">${(S.edOpen || {})[index] ? "▾ Ocultar" : "▸ Indicaciones antes del turno"}</button>
     ${(S.edOpen || {})[index] ? svcOpts(svc, index) : ""}
     ${cats.length > 1 ? `<select id="sc${index}" aria-label="Rubro del servicio">${cats.map((cat) => `<option value="${cat}" ${svc[3] === cat ? "selected" : ""}>${catInfo(cat).ic} ${catInfo(cat).one}</option>`).join("")}</select>` : ""}</div>`,
     )
     .join("")}</div>
   <p class="note" style="text-align:left;margin:4px 0 6px">${cats.length > 1 ? "Elegí el rubro de cada servicio: así aparecés en cada rubro con sus precios." : ""}</p>
   <button type="button" class="btn btn-ghost btn-block" data-act="svcAdd" style="margin-bottom:12px">+ Agregar servicio</button>
   <p class="note" style="text-align:left;margin:0 0 12px">Los días y horarios en que atendés se configuran en la pestaña Horarios. Tenés una sola agenda para todos tus servicios.</p>`;
}
function svcOpts(svc, index) {
  const meta = (svc[5] ||= svcMeta(svc));
  return `<div class="svcopts"><div class="f"><label for="snt${index}">Indicaciones antes del turno (opcional)</label><input id="snt${index}" maxlength="300" value="${esc(meta.note || "")}" placeholder="Ej: venir sin esmalte"></div></div>`;
}
// un número mal escrito (con centavos, H08) no pisa lo que había: lo marca svcEditorError al guardar
const keepIfBad = (value, before) => (isNaN(value) ? before || 0 : value);
// error de montos o minutos en el editor de servicios (lo escrito, antes de pasarlo a S.edSvcs), o ""
export function svcEditorError() {
  for (const [index] of (S.edSvcs || []).entries()) {
    const bad = (sel, parse) => [...document.querySelectorAll(sel)].some((input) => isNaN(parse(input.value)));
    if (bad(`#sp${index}, [id^="ap${index}_"]`, parsePesos)) {
      return `Revisá el servicio ${index + 1}: ${PESOS_ERR.charAt(0).toLowerCase()}${PESOS_ERR.slice(1)}`;
    }
    if (bad(`#sd${index}, [id^="am${index}_"]`, parseWhole)) {
      return `Revisá el servicio ${index + 1}: los minutos van con números enteros.`;
    }
  }
  return "";
}
// pasa lo escrito en el editor a S.edSvcs (formato svcMeta) antes de guardar o de volver a dibujar;
// un servicio cuyo rubro se desmarcó pasa al primer rubro marcado
export function readSvcEditor() {
  if (!S.edSvcs) {
    return;
  }
  const cats = CATS.map((row) => row[0]).filter((cat) => {
    const box = $("#rc-" + cat);
    if (box) {
      return box.checked;
    } else {
      return S.edCats.includes(cat);
    }
  });
  S.edCats = cats;
  S.edSvcs = S.edSvcs.map((svc, index) => {
    const nameInput = $("#sn" + index);
    if (!nameInput) {
      return svc;
    }
    const catSelect = $("#sc" + index);
    const meta = svc[5]
      ? {
          every: svc[5].every,
          note: svc[5].note,
          add: svc[5].add.map((addon) => addon.slice()),
        }
      : null;
    if (meta && $("#snt" + index)) {
      meta.note = $("#snt" + index)
        .value.trim()
        .slice(0, 300);
      meta.add = meta.add.map((addon, addonIndex) =>
        $("#an" + index + "_" + addonIndex)
          ? [
              $("#an" + index + "_" + addonIndex)
                .value.trim()
                .slice(0, 60),
              keepIfBad(parsePesos($("#ap" + index + "_" + addonIndex).value), addon[1]),
              Math.min(240, keepIfBad(parseWhole($("#am" + index + "_" + addonIndex).value), addon[2])),
              addon[3],
            ]
          : addon,
      );
    }
    return [
      nameInput.value.trim(),
      keepIfBad(parseWhole($("#sd" + index).value), svc[1]),
      keepIfBad(parsePesos($("#sp" + index).value), svc[2]),
      catSelect ? catSelect.value : cats[0] || svc[3],
      svc[4],
      meta,
    ];
  });
  S.edSvcs.forEach((svc) => {
    if (!cats.includes(svc[3])) {
      svc[3] = cats[0] || svc[3];
    }
  });
}
// Bloque 1: qué pasa con los turnos ya pagados si desconecta o si ya desconectó (S.mpSt sale de my_mp_status)
function mpPaidNote(st, past) {
  const n = +st.future_paid || 0;
  if (!n) {
    return "";
  }
  return `<p class="note" style="text-align:left;margin:8px 0 0">Tenés ${n} turno${n === 1 ? "" : "s"} futuro${n === 1 ? "" : "s"} con la seña pagada: ${n === 1 ? "sigue" : "siguen"} en pie y, si hay que devolver una seña, se devuelve desde ${past ? "tu cuenta anterior" : "esta cuenta"}.</p>`;
}
// Verificación: el DNI (o, si TuTiempo no lo pide, si el perfil ya está aprobado); lo que falta se carga en los pasos de arriba
function verifRow(prov) {
  const ok = approved(prov);
  const [label, state] = prov.verified !== false ? ["DNI", "✓ Verificado"] : dniRequired() ? ["DNI", "En revisión"] : ["Perfil", ok ? "✓ Aprobado" : "En revisión"];
  return `<dt>${label}</dt><dd style="color:${prov.verified !== false || ok ? "var(--ok)" : "var(--warn)"}">${state}</dd>`;
}
// pestaña Perfil del panel: Mercado Pago, foto, efectivo, sellos, datos y servicios, avisos, DNI y eliminar.
// En vivo muestra el número de la cuenta conectada; “filo.barber.mp” es solo de la demo.
export function vBPerfil(prov) {
  const mp = S.mp;
  const st = S.mpSt || {};
  return `${setupSteps(prov, "perfil")}<div class="panel"><p class="lbl">Cobros</p>
   ${
     mp === "ok"
       ? `<div class="paym" style="border-color:var(--ok);background:var(--ok-soft)"><span class="mp">MP</span><span>Mercado Pago conectado<br><small class="hint">${LIVE ? (st.account ? `Cuenta n° ${esc(st.account)} · ` : "") : "filo.barber.mp · "}Las señas se acreditan en tu cuenta al reservar.</small></span></div>
     ${
       S.mpAsk
         ? `<div class="mpask" role="alertdialog" aria-label="Desconectar Mercado Pago"><b>¿Desconectar Mercado Pago?</b>
     <p class="note" style="text-align:left;margin:6px 0 0">• No vas a poder recibir reservas nuevas con seña hasta que lo vuelvas a conectar.<br>• Tus turnos ya confirmados siguen en pie.<br>• Si hay que devolver la seña de alguno, se devuelve desde esta cuenta.</p>${mpPaidNote(st, false)}
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn btn-ghost" data-act="mpAskNo">Cancelar</button><button class="btn btn-pri" data-act="mpDescOk">Desconectar</button></div></div>`
         : `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="mpDesc">Desconectar</button>`
     }`
       : mp === "auth"
         ? `<div class="mpauth"><div class="mp" style="width:44px;height:44px;font-size:14px;margin:0 auto">MP</div>
     <b>Mercado Pago</b><p class="note" style="margin:6px 0 12px">TuTiempo quiere acceder a tu cuenta para:<br>• Cobrar los servicios a tu nombre<br>• Sumar al cobro la comisión de TuTiempo (${pctTxt()}%), que paga el cliente: tu seña te llega completa</p>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ghost" data-act="mpCancel">Cancelar</button><button class="btn btn-pri" style="background:#009ee3" data-act="mpOk">Autorizar</button></div>
     <p class="note" style="margin-top:8px">Simulación de la pantalla de Mercado Pago.</p></div>`
         : `<div class="paym" style="border-color:var(--warn);background:var(--warn-soft)"><span class="mp">MP</span><span>Mercado Pago sin conectar<br><small class="hint">${LIVE ? "Hoy no podés cobrar señas: nadie puede reservarte online hasta que lo conectes." : "Sin esto tus clientes no pueden pagar la seña al reservar."}</small></span></div>
     ${st.expired ? '<p class="note" style="text-align:left;margin:8px 0 0">Venció la conexión con tu cuenta de Mercado Pago: volvé a conectarla.</p>' : ""}${mpPaidNote(st, true)}
     <button class="btn btn-pri btn-block" style="margin-top:10px;background:#009ee3" data-act="mpConnect">Conectar Mercado Pago</button>`
   }
  </div>
  <div class="panel"><p class="lbl">Foto de perfil</p><div class="contact" style="gap:14px">${photoPicker(prov, "upPhoto")}<div><b>${esc(prov.name)}</b><p class="note" style="text-align:left;margin:2px 0 0">Aparece en tu perfil, en el listado y en tus historias.</p><label class="btn btn-ghost btn-sm" for="upPhoto" style="margin-top:6px;cursor:pointer">📷 ${prov.photo ? "Cambiar foto" : "Subir foto"}</label></div></div></div>
  <div class="panel"><div class="swrow"><div><b>💵 Aceptar el resto en efectivo</b><div class="hint">${cfg(ME()).cash !== false ? "La seña va por Mercado Pago y el resto lo pueden pagar en efectivo" : "La seña y el resto, con Mercado Pago"}</div></div><button class="tg" data-act="cashToggle" aria-pressed="${cfg(ME()).cash !== false}" aria-label="Aceptar efectivo"></button></div>
   <p class="note" style="text-align:left;margin:8px 0 0">La seña siempre se paga con Mercado Pago al reservar. Si el cliente no viene, la seña queda para vos.</p></div>
  ${(() => {
    const conf = stampCfg(ME());
    const noGoals = !Object.keys(conf.goals || {}).length;
    const earning = stampSvcs(prov);
    return `<form class="panel" id="fStamps" novalidate><div class="swrow"><div><b>🎟️ Tarjetas de sellos</b><div class="hint">${conf.on && earning.length ? `Activas en ${earning.length} servicio${earning.length > 1 ? "s" : ""}` : "Premiá a tus clientes que vuelven"}</div></div>
      <label class="tgl2"><input type="checkbox" id="stOn" ${conf.on ? "checked" : ""}><span>Activa</span></label></div>
     <p class="note" style="text-align:left;margin:8px 0 10px">Cada servicio tiene su propia tarjeta. Marcá los que suman sello y cuántos sellos necesita cada uno (de 15 a 20). Con la tarjeta llena, ese mismo servicio sale gratis. Los sellos son solo tuyos: no sirven con otros prestadores.</p>
     <div class="stlist">${prov.svcs
       .map((svc, index) => {
         const goal = +((conf.goals || {})[skey(svc)] || 0);
         return `<div class="strow"><label class="tgl2"><input type="checkbox" data-sts="${index}" ${goal || noGoals ? "checked" : ""}><span>${esc(svc[0])}</span></label><select data-stg="${index}" aria-label="Sellos para ${esc(svc[0])}">${[15, 16, 17, 18, 19, 20].map((option) => `<option value="${option}" ${option === (goal || 15) ? "selected" : ""}>${option} sellos</option>`).join("")}</select></div>`;
       })
       .join("")}</div>
     <div class="err" id="sterr"></div><button class="btn btn-pri btn-block" type="submit">Guardar tarjetas</button></form>`;
  })()}
  <form class="panel" id="fDatos" novalidate><p class="lbl">Mis datos</p>
   <div class="f"><label for="dn">Nombre visible</label><input id="dn" value="${esc(prov.name)}" autocomplete="off"></div>
   <div class="f"><label for="dd">Descripción</label><textarea id="dd">${esc(prov.bio || "")}</textarea></div>
   <div class="f"><label for="da">Dirección del local</label><input id="da" value="${esc(prov.addr)}" autocomplete="off"></div>
   <div class="f"><label for="di">Instagram</label><input id="di" value="${esc(prov.ig || "")}" autocomplete="off"></div>
   ${svcEditor(prov)}
   <div class="err" id="derr"></div>
   <button class="btn btn-pri btn-block" type="submit">Guardar cambios</button>
  </form>
  ${vMensajes()}
  <div class="panel"><p class="lbl">Verificación</p><dl class="kv">${verifRow(prov)}<dt>Email</dt><dd>${esc(LIVE ? (S.user ? S.user.email : "") : prov.id === 21 ? "sofia@tutiempo.demo" : "filo@tutiempo.demo")}</dd></dl></div>
  ${delBox("pro")}
  <button class="btn btn-ghost btn-block" data-act="preview">👁 Ver mi perfil como lo ve un cliente</button>`;
}

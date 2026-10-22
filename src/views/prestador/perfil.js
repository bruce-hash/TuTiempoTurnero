import { LIVE } from "../../config.js";
import { pctTxt } from "../../lib/dinero.js";
import { $, esc } from "../../lib/dom.js";
import { ME } from "../../lib/prestadores.js";
import { CATS, catInfo } from "../../lib/rubros.js";
import { svcMeta } from "../../lib/servicios.js";
import { cfg, skey } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { photoPicker } from "../../ui/fotos.js";
import { stampCfg, stampSvcs } from "../../ui/sellos.js";
import { delBox } from "../cliente/cuenta.js";
import { vMensajes } from "./mensajes.js";

function svcEditor(e) {
  if (!S.edSvcs || S.edFor !== e.id) {
    S.edFor = e.id;
    S.edSvcs = e.svcs.map((t) => {
      const s = t.slice();
      const n = svcMeta(t);
      s[5] = {
        every: n.every,
        note: n.note,
        add: n.add.map((o) => o.slice()),
      };
      return s;
    });
    S.edCats = e.cats.slice();
    S.edOpen = {};
  }
  const a = S.edCats;
  return `<p class="lbl" style="margin-top:6px">Rubros en los que trabajás</p>
   <div class="catpick">${CATS.map(([t, s, n, o]) => `<label><input type="checkbox" id="rc-${t}" data-rc="${t}" ${a.includes(t) ? "checked" : ""}><span>${o} ${n}</span></label>`).join("")}</div>
   <p class="lbl">Servicios y precios</p>
   <div class="svced">${S.edSvcs
     .map(
       (
         t,
         s,
       ) => `<div class="svcrow3"><label class="sfl sfn"><span>Nombre del servicio</span><input id="sn${s}" value="${esc(t[0])}" autocomplete="off" placeholder="Ej: Corte de cabello"></label><button type="button" class="xbtn" data-act="svcDel" data-i="${s}" aria-label="Quitar servicio">✕</button><label class="sfl"><span>Duración (minutos)</span><input id="sd${s}" value="${t[1]}" inputmode="numeric" placeholder="30"></label><label class="sfl"><span>Precio ($)</span><input id="sp${s}" value="${t[2]}" inputmode="numeric" placeholder="10000"></label>
     <button type="button" class="lnk svcmore" data-act="svcOpts" data-i="${s}">${(S.edOpen || {})[s] ? "▾ Ocultar" : "▸ Indicaciones antes del turno"}</button>
     ${(S.edOpen || {})[s] ? svcOpts(t, s) : ""}
     ${a.length > 1 ? `<select id="sc${s}" aria-label="Rubro del servicio">${a.map((n) => `<option value="${n}" ${t[3] === n ? "selected" : ""}>${catInfo(n).ic} ${catInfo(n).one}</option>`).join("")}</select>` : ""}</div>`,
     )
     .join("")}</div>
   <p class="note" style="text-align:left;margin:4px 0 6px">${a.length > 1 ? "Elegí el rubro de cada servicio: así aparecés en cada rubro con sus precios." : ""}</p>
   <button type="button" class="btn btn-ghost btn-block" data-act="svcAdd" style="margin-bottom:12px">+ Agregar servicio</button>
   <p class="note" style="text-align:left;margin:0 0 12px">Los días y horarios en que atendés se configuran en la pestaña Horarios. Tenés una sola agenda para todos tus servicios.</p>`;
}
function svcOpts(e, a) {
  const t = (e[5] ||= svcMeta(e));
  return `<div class="svcopts"><div class="f"><label for="snt${a}">Indicaciones antes del turno (opcional)</label><input id="snt${a}" maxlength="300" value="${esc(t.note || "")}" placeholder="Ej: venir sin esmalte"></div></div>`;
}
export function readSvcEditor() {
  if (!S.edSvcs) {
    return;
  }
  const e = CATS.map((a) => a[0]).filter((a) => {
    const t = $("#rc-" + a);
    if (t) {
      return t.checked;
    } else {
      return S.edCats.includes(a);
    }
  });
  S.edCats = e;
  S.edSvcs = S.edSvcs.map((a, t) => {
    const s = $("#sn" + t);
    if (!s) {
      return a;
    }
    const n = $("#sc" + t);
    const o = a[5]
      ? {
          every: a[5].every,
          note: a[5].note,
          add: a[5].add.map((i) => i.slice()),
        }
      : null;
    if (o && $("#snt" + t)) {
      o.note = $("#snt" + t)
        .value.trim()
        .slice(0, 300);
      o.add = o.add.map((i, l) =>
        $("#an" + t + "_" + l)
          ? [
              $("#an" + t + "_" + l)
                .value.trim()
                .slice(0, 60),
              parseInt(($("#ap" + t + "_" + l).value || "").replace(/\D/g, "")) || 0,
              Math.min(240, parseInt(($("#am" + t + "_" + l).value || "").replace(/\D/g, "")) || 0),
              i[3],
            ]
          : i,
      );
    }
    return [
      s.value.trim(),
      parseInt(($("#sd" + t).value || "").replace(/\D/g, "")) || 0,
      parseInt(($("#sp" + t).value || "").replace(/\D/g, "")) || 0,
      n ? n.value : e[0] || a[3],
      a[4],
      o,
    ];
  });
  S.edSvcs.forEach((a) => {
    if (!e.includes(a[3])) {
      a[3] = e[0] || a[3];
    }
  });
}
export function vBPerfil(e) {
  const a = S.mp;
  return `<div class="panel"><p class="lbl">Cobros</p>
   ${
     a === "ok"
       ? `<div class="paym" style="border-color:var(--ok);background:var(--ok-soft)"><span class="mp">MP</span><span>Mercado Pago conectado<br><small class="hint">hidro.style.mp · Las señas se acreditan en tu cuenta al reservar.</small></span></div>
     <button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="mpDesc">Desconectar</button>`
       : a === "auth"
         ? `<div class="mpauth"><div class="mp" style="width:44px;height:44px;font-size:14px;margin:0 auto">MP</div>
     <b>Mercado Pago</b><p class="note" style="margin:6px 0 12px">TuTiempo quiere acceder a tu cuenta para:<br>• Cobrar los servicios a tu nombre<br>• Sumar al cobro la comisión de TuTiempo (${pctTxt()}%), que paga el cliente: tu seña te llega completa</p>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ghost" data-act="mpCancel">Cancelar</button><button class="btn btn-pri" style="background:#009ee3" data-act="mpOk">Autorizar</button></div>
     <p class="note" style="margin-top:8px">Simulación de la pantalla de Mercado Pago.</p></div>`
         : `<div class="paym" style="border-color:var(--warn);background:var(--warn-soft)"><span class="mp">MP</span><span>Mercado Pago sin conectar<br><small class="hint">Sin esto tus clientes no pueden pagar la seña al reservar.</small></span></div>
     <button class="btn btn-pri btn-block" style="margin-top:10px;background:#009ee3" data-act="mpConnect">Conectar Mercado Pago</button>`
   }
  </div>
  <div class="panel"><p class="lbl">Foto de perfil</p><div class="contact" style="gap:14px">${photoPicker(e, "upPhoto")}<div><b>${esc(e.name)}</b><p class="note" style="text-align:left;margin:2px 0 0">Aparece en tu perfil, en el listado y en tus historias.</p><label class="btn btn-ghost btn-sm" for="upPhoto" style="margin-top:6px;cursor:pointer">📷 ${e.photo ? "Cambiar foto" : "Subir foto"}</label></div></div></div>
  <div class="panel"><div class="swrow"><div><b>💵 Aceptar el resto en efectivo</b><div class="hint">${cfg(ME()).cash !== false ? "La seña va por Mercado Pago y el resto lo pueden pagar en efectivo" : "La seña y el resto, con Mercado Pago"}</div></div><button class="tg" data-act="cashToggle" aria-pressed="${cfg(ME()).cash !== false}" aria-label="Aceptar efectivo"></button></div>
   <p class="note" style="text-align:left;margin:8px 0 0">La seña siempre se paga con Mercado Pago al reservar. Si el cliente no viene, la seña queda para vos.</p></div>
  ${(() => {
    const t = stampCfg(ME());
    const s = !Object.keys(t.goals || {}).length;
    const n = stampSvcs(e);
    return `<form class="panel" id="fStamps" novalidate><div class="swrow"><div><b>🎟️ Tarjetas de sellos</b><div class="hint">${t.on && n.length ? `Activas en ${n.length} servicio${n.length > 1 ? "s" : ""}` : "Premiá a tus clientes que vuelven"}</div></div>
      <label class="tgl2"><input type="checkbox" id="stOn" ${t.on ? "checked" : ""}><span>Activa</span></label></div>
     <p class="note" style="text-align:left;margin:8px 0 10px">Cada servicio tiene su propia tarjeta. Marcá los que suman sello y cuántos sellos necesita cada uno (de 15 a 20). Con la tarjeta llena, ese mismo servicio sale gratis. Los sellos son solo tuyos: no sirven con otros prestadores.</p>
     <div class="stlist">${e.svcs
       .map((o, i) => {
         const l = +((t.goals || {})[skey(o)] || 0);
         return `<div class="strow"><label class="tgl2"><input type="checkbox" data-sts="${i}" ${l || s ? "checked" : ""}><span>${esc(o[0])}</span></label><select data-stg="${i}" aria-label="Sellos para ${esc(o[0])}">${[15, 16, 17, 18, 19, 20].map((c) => `<option value="${c}" ${c === (l || 15) ? "selected" : ""}>${c} sellos</option>`).join("")}</select></div>`;
       })
       .join("")}</div>
     <div class="err" id="sterr"></div><button class="btn btn-pri btn-block" type="submit">Guardar tarjetas</button></form>`;
  })()}
  <form class="panel" id="fDatos" novalidate><p class="lbl">Mis datos</p>
   <div class="f"><label for="dn">Nombre visible</label><input id="dn" value="${esc(e.name)}" autocomplete="off"></div>
   <div class="f"><label for="dd">Descripción</label><textarea id="dd">${esc(e.bio || "")}</textarea></div>
   <div class="f"><label for="da">Dirección del local</label><input id="da" value="${esc(e.addr)}" autocomplete="off"></div>
   <div class="f"><label for="di">Instagram</label><input id="di" value="${esc(e.ig || "")}" autocomplete="off"></div>
   ${svcEditor(e)}
   <div class="err" id="derr"></div>
   <button class="btn btn-pri btn-block" type="submit">Guardar cambios</button>
  </form>
  ${vMensajes()}
  <div class="panel"><p class="lbl">Verificación</p><dl class="kv"><dt>DNI</dt><dd style="color:${e.verified === false ? "var(--warn)" : "var(--ok)"}">${e.verified === false ? "En revisión" : "✓ Verificado"}</dd><dt>Email</dt><dd>${esc(LIVE && S.user ? S.user.email : e.id === 21 ? "sofia@tutiempo.demo" : "hidro.style@tutiempo.demo")}</dd></dl>
   ${LIVE && e.verified === false ? '<div class="f" style="margin-top:10px"><label for="dniUp">Subí tu DNI (frente y dorso)</label><input id="dniUp" type="file" accept="image/*,application/pdf" multiple><span class="hint">Solo lo ve el equipo de TuTiempo para verificarte.</span></div>' : ""}</div>
  ${delBox("pro")}
  <button class="btn btn-ghost btn-block" data-act="preview">👁 Ver mi perfil como lo ve un cliente</button>`;
}

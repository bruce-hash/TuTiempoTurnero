import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { CATS } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { GLOGO, LOGO } from "../../ui/iconos.js";

export function vRegPrest() {
  const e = S.reg;
  if (e.done) {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">🎉</div><h1 class="h1">¡Cuenta creada, ${esc(e.nombre)}!</h1>
   <p class="lead">${e.confirm ? `Te mandamos un email a <b>${esc(e.email)}</b>. Tocá el link para confirmar y después entrá con tu email y contraseña: tu perfil se crea solo.` : `Estamos verificando tu DNI. Suele tardar menos de 24 horas y te avisamos por email a <b>${esc(e.email)}</b>.`}</p>
   <ol class="steps" style="margin:0 0 16px"><li class="done"><span class="dot">✓</span><div><b>Datos cargados</b></div></li><li class="now"><span class="dot">2</span><div><b>Verificación de DNI</b><span>En revisión</span></div></li><li><span class="dot">3</span><div><b>Conectar Mercado Pago</b><span>Desde tu perfil</span></div></li></ol>
   ${e.confirm ? '<button class="btn btn-pri btn-block" data-go="loginBarbero">Ir al ingreso</button>' : '<button class="btn btn-pri btn-block" data-act="regPanel">Entrar al panel (demo)</button>'}</div></div>`;
  }
  const a = e.errs || {};
  const t = (s) => (a[s] ? `<span class="ferr">${esc(a[s])}</span>` : "");
  return `<div class="narrow"><form class="panel" id="fPrest" novalidate style="margin-top:24px">
   <div class="logo" style="justify-content:center;display:flex">${LOGO}</div>
   <h1 class="h1">Sumate como prestador</h1><p class="lead">Tu agenda online: tus clientes reservan y pagan la seña solos.</p>
   ${
     LIVE
       ? ""
       : `<button type="button" class="gbtn" data-act="regGoogle">${GLOGO} Completar con Google</button>
   <div class="or">o completá tus datos</div>`
   }
   <div class="f"><label>¿Qué servicios das? *</label><div class="catpick" style="margin:0">${CATS.map(([s, n, o, i]) => `<label><input type="checkbox" id="rr-${s}" ${(e.cats || []).includes(s) ? "checked" : ""}><span>${i} ${o}</span></label>`).join("")}</div><span class="hint">Podés elegir varios: aparecés en cada rubro con sus servicios.</span>${t("cats")}</div>
   <div class="f"><label for="pn">Nombre de tu negocio o tu nombre *</label><input id="pn" value="${esc(e.nombre || "")}" autocomplete="off">${t("nombre")}</div>
   <div class="f"><label for="pe">Email *</label><input id="pe" type="email" value="${esc(e.email || "")}" autocomplete="off">${t("email")}</div>
   <div class="f"><label for="pp">Contraseña *</label><input id="pp" type="password" value="${esc(e.pass || "")}" autocomplete="off"><span class="hint">Mínimo 8 caracteres.</span>${t("pass")}</div>
   <div class="f"><label for="pa">Dirección donde atendés</label><input id="pa" value="${esc(e.addr || "")}" autocomplete="off"></div>
   <div class="f"><label for="ptel">Celular * <span class="hint">(privado: solo lo ve TuTiempo)</span></label><input id="ptel" inputmode="tel" value="${esc(e.tel || "")}" autocomplete="off">${t("tel")}</div>
   <div class="f"><label for="pd">DNI *</label><input id="pd" inputmode="numeric" value="${esc(e.dni || "")}" autocomplete="off"><span class="hint">Sin puntos. 7 u 8 dígitos.</span>${t("dni")}</div>
   <div class="f"><label for="pf">Foto del DNI (frente y dorso) *</label><input id="pf" type="file" accept="image/*,application/pdf" multiple><span class="hint">${e.files ? `✓ ${e.files} archivo${e.files > 1 ? "s" : ""} cargado${e.files > 1 ? "s" : ""}` : "Lo verificamos para que tus clientes sepan quién sos."}</span>${t("files")}</div>
   <label class="chk" style="justify-content:flex-start"><input type="checkbox" id="ptc" ${e.tc ? "checked" : ""}> Acepto los <button type="button" class="lnk" data-go="terminos">términos y condiciones</button></label>${t("tc")}
   <button class="btn btn-pri btn-block" type="submit">Crear cuenta de prestador</button>
   <p class="note" style="margin-top:12px">¿Ya tenés cuenta? <button type="button" class="lnk" data-go="loginBarbero">Ingresá</button></p>
  </form></div>`;
}

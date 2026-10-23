import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { CATS } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { GLOGO, LOGO } from "../../ui/iconos.js";

// alta de prestador: formulario con DNI y fotos; al terminar, pantalla de “cuenta creada”
export function vRegPrest() {
  const reg = S.reg;
  if (reg.done) {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">🎉</div><h1 class="h1">¡Cuenta creada, ${esc(reg.nombre)}!</h1>
   <p class="lead">${reg.confirm ? `Te mandamos un email a <b>${esc(reg.email)}</b>. Tocá el link para confirmar y después entrá con tu email y contraseña: tu perfil se crea solo.` : `Estamos verificando tu DNI. Suele tardar menos de 24 horas y te avisamos por email a <b>${esc(reg.email)}</b>.`}</p>
   <ol class="steps" style="margin:0 0 16px"><li class="done"><span class="dot">✓</span><div><b>Datos cargados</b></div></li><li class="now"><span class="dot">2</span><div><b>Verificación de DNI</b><span>En revisión</span></div></li><li><span class="dot">3</span><div><b>Conectar Mercado Pago</b><span>Desde tu perfil</span></div></li></ol>
   ${reg.confirm ? '<button class="btn btn-pri btn-block" data-go="loginBarbero">Ir al ingreso</button>' : '<button class="btn btn-pri btn-block" data-act="regPanel">Entrar al panel (demo)</button>'}</div></div>`;
  }
  const errs = reg.errs || {};
  // error de validación debajo de cada campo
  const errOf = (field) => (errs[field] ? `<span class="ferr">${esc(errs[field])}</span>` : "");
  return `<div class="narrow"><form class="panel" id="fPrest" novalidate style="margin-top:24px">
   <div class="logo" style="justify-content:center;display:flex">${LOGO}</div>
   <h1 class="h1">Sumate como prestador</h1><p class="lead">Tu agenda online: tus clientes reservan y pagan la seña solos.</p>
   ${
     LIVE
       ? ""
       : `<button type="button" class="gbtn" data-act="regGoogle">${GLOGO} Completar con Google</button>
   <div class="or">o completá tus datos</div>`
   }
   <div class="f"><label>¿Qué servicios das? *</label><div class="catpick" style="margin:0">${CATS.map(([key, plural, name, icon]) => `<label><input type="checkbox" id="rr-${key}" ${(reg.cats || []).includes(key) ? "checked" : ""}><span>${icon} ${name}</span></label>`).join("")}</div><span class="hint">Podés elegir varios: aparecés en cada rubro con sus servicios.</span>${errOf("cats")}</div>
   <div class="f"><label for="pn">Nombre de tu negocio o tu nombre *</label><input id="pn" value="${esc(reg.nombre || "")}" autocomplete="off">${errOf("nombre")}</div>
   <div class="f"><label for="pe">Email *</label><input id="pe" type="email" value="${esc(reg.email || "")}" autocomplete="off">${errOf("email")}</div>
   <div class="f"><label for="pp">Contraseña *</label><input id="pp" type="password" value="${esc(reg.pass || "")}" autocomplete="off"><span class="hint">Mínimo 8 caracteres.</span>${errOf("pass")}</div>
   <div class="f"><label for="pa">Dirección donde atendés</label><input id="pa" value="${esc(reg.addr || "")}" autocomplete="off"></div>
   <div class="f"><label for="ptel">Celular * <span class="hint">(privado: solo lo ve TuTiempo)</span></label><input id="ptel" inputmode="tel" value="${esc(reg.tel || "")}" autocomplete="off">${errOf("tel")}</div>
   <div class="f"><label for="pd">DNI *</label><input id="pd" inputmode="numeric" value="${esc(reg.dni || "")}" autocomplete="off"><span class="hint">Sin puntos. 7 u 8 dígitos.</span>${errOf("dni")}</div>
   <div class="f"><label for="pf">Foto del DNI (frente y dorso) *</label><input id="pf" type="file" accept="image/*,application/pdf" multiple><span class="hint">${reg.files ? `✓ ${reg.files} archivo${reg.files > 1 ? "s" : ""} cargado${reg.files > 1 ? "s" : ""}` : "Lo verificamos para que tus clientes sepan quién sos."}</span>${errOf("files")}</div>
   <label class="chk" style="justify-content:flex-start"><input type="checkbox" id="ptc" ${reg.tc ? "checked" : ""}> Acepto los <button type="button" class="lnk" data-go="terminos">términos y condiciones</button></label>${errOf("tc")}
   <button class="btn btn-pri btn-block" type="submit">Crear cuenta de prestador</button>
   <p class="note" style="margin-top:12px">¿Ya tenés cuenta? <button type="button" class="lnk" data-go="loginBarbero">Ingresá</button></p>
  </form></div>`;
}

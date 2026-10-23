import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { GLOGO } from "../../ui/iconos.js";
import { authHead, pwField } from "./campos.js";

// ingreso del cliente según S.login.mode: in (contraseña), up (crear cuenta), code / codeSent (código por email),
// forgot / sent (recuperar contraseña) y confirm (falta activar la cuenta)
export function vLogin() {
  const login = S.login;
  const mode = login.mode || "in";
  if (mode === "codeSent") {
    return `<div class="narrow"><form class="panel" id="fCode" novalidate style="margin-top:24px">
   ${authHead("Revisá tu email", `Te mandamos un código de 6 dígitos a<br><b>${esc(login.email)}</b>`)}
   ${LIVE ? "" : '<div class="demohint">Demo: el código es <b>123456</b></div>'}
   <div class="f"><label for="lc">Código</label><input id="lc" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" style="text-align:center;letter-spacing:.3em;font-size:20px;font-weight:700"></div>
   <div class="err" id="lerr">${esc(login.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit">Verificar e ingresar</button>
   <div class="authrow"><button type="button" class="lnk" data-act="loginBack">Cambiar email</button><button type="button" class="lnk" data-act="reenviar">Reenviar código</button></div>
  </form></div>`;
  }
  if (mode === "forgot") {
    return `<div class="narrow"><form class="panel" id="fForgot" novalidate style="margin-top:24px">
   ${authHead("Recuperar contraseña", "Escribí el email de tu cuenta y te mandamos un link para crear una contraseña nueva.")}
   <div class="f"><label for="af_e">Email</label><input id="af_e" type="email" autocomplete="email" maxlength="120" value="${esc(login.email || "")}"></div>
   <div class="err" id="aerr">${esc(login.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit">Enviarme el link</button>
   <div class="authrow"><button type="button" class="lnk" data-act="authMode" data-m="in">← Volver a ingresar</button></div>
  </form></div>`;
  }
  if (mode === "sent") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">📩</div>${authHead("Revisá tu email", `Si <b>${esc(login.email)}</b> tiene una cuenta, te llega un link para crear una contraseña nueva. Vence en 1 hora. Mirá también en Spam o Promociones.`)}
   ${LIVE ? "" : store.DEMO_USERS[(login.email || "").toLowerCase()] ? '<button class="btn btn-pri btn-block" data-act="demoRecoveryLink">Abrir el link del email (demo)</button>' : '<div class="demohint">Demo: ese email no tiene cuenta, así que no llega nada (y no se lo decimos a nadie: así nadie puede averiguar qué emails están registrados).</div>'}
   <div class="authrow" style="justify-content:center"><button class="lnk" data-act="authMode" data-m="in">Volver a ingresar</button></div></div></div>`;
  }
  if (mode === "confirm") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">✉️</div>${authHead("Activá tu cuenta", `Te mandamos un link a <b>${esc(login.email)}</b>. Tocalo para activar tu cuenta y entrar. Mirá también en Spam o Promociones.`)}
   <button class="btn btn-ghost btn-block" data-act="resendConfirm">Reenviar el email</button>
   <div class="authrow" style="justify-content:center"><button class="lnk" data-act="authMode" data-m="in">Ya la activé · Ingresar</button></div></div></div>`;
  }
  const tabs = `<div class="authtabs" role="tablist"><button type="button" role="tab" class="${mode === "up" ? "" : "on"}" aria-selected="${mode !== "up"}" data-act="authMode" data-m="in">Ingresar</button><button type="button" role="tab" class="${mode === "up" ? "on" : ""}" aria-selected="${mode === "up"}" data-act="authMode" data-m="up">Crear cuenta</button></div>`;
  const provLinks =
    '<p class="note" style="margin-top:14px">¿Ofrecés servicios? <button type="button" class="lnk" data-go="loginBarbero">Entrá a tu panel</button> · <button type="button" class="lnk" data-go="prestador">Sumate</button></p>';
  const google = `<button type="button" class="gbtn" data-act="google">${GLOGO} ${mode === "up" ? "Crear cuenta con Google" : "Continuar con Google"}</button><div class="or">o con tu email</div>`;
  if (mode === "code") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px">
   ${authHead("Entrar con un código", "Te mandamos un código de 6 dígitos a tu email. Sin contraseña.")}
   <form id="fMail" novalidate>
    <div class="f"><label for="le">Email</label><input id="le" type="email" autocomplete="email" maxlength="120" placeholder="tu@email.com" value="${esc(login.email || "")}"></div>
    <div class="err" id="lerr">${esc(login.err || "")}</div>
    <button class="btn btn-pri btn-block" type="submit">Enviarme un código</button>
   </form>
   <div class="authrow"><button type="button" class="lnk" data-act="authMode" data-m="in">← Ingresar con contraseña</button></div></div></div>`;
  } else if (mode === "up") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px">
   ${authHead("Creá tu cuenta", "Reservá turnos y seguí a tus profesionales.")}${tabs}${google}
   <form id="fSignup" novalidate>
    <div class="f"><label for="au_n">Nombre y apellido</label><input id="au_n" autocomplete="name" maxlength="80" value="${esc(login.nombre || "")}"></div>
    <div class="f"><label for="au_e">Email</label><input id="au_e" type="email" autocomplete="email" maxlength="120" value="${esc(login.email || "")}"></div>
    <div class="f"><label for="au_t">Celular <span class="hint">(opcional)</span></label><input id="au_t" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="2284 123456" value="${esc(login.tel || "")}"></div>
    ${pwField("au_p", "Contraseña", "new-password", true)}
    ${pwField("au_p2", "Repetí la contraseña", "new-password", false)}
    <label class="chk"><input type="checkbox" id="au_ok"> <span>Acepto los <u class="lnk" role="link" tabindex="0" data-go="terminos" style="cursor:pointer">términos y la política de privacidad</u>.</span></label>
    <div class="err" id="aerr">${esc(login.err || "")}</div>
    <button class="btn btn-pri btn-block" type="submit">Crear cuenta</button>
   </form>${provLinks}</div></div>`;
  } else {
    return `<div class="narrow"><div class="panel" style="margin-top:24px">
   ${authHead(S.after ? "Ingresá para reservar" : "Ingresá a TuTiempo", S.after ? "Tu horario queda guardado mientras ingresás." : "")}${tabs}${google}
   ${LIVE ? "" : '<div class="demohint">Demo: <b>juan.perez@gmail.com</b> · <b>cliente123</b> (o creá una cuenta nueva)</div>'}
   <form id="fLogin" novalidate>
    <div class="f"><label for="ai_e">Email</label><input id="ai_e" type="email" autocomplete="email" maxlength="120" value="${esc(login.email || "")}"></div>
    ${pwField("ai_p", "Contraseña", "current-password", false)}
    <div class="err" id="aerr">${esc(login.err || "")}</div>
    <button class="btn btn-pri btn-block" type="submit" ${login.locked ? "disabled" : ""}>Ingresar</button>
   </form>
   <div class="authrow"><button type="button" class="lnk" data-act="authMode" data-m="forgot" ${login.fails >= 2 ? 'style="font-weight:700"' : ""}>¿Olvidaste tu contraseña?</button><button type="button" class="lnk" data-act="authMode" data-m="code">Entrar con un código</button></div>
   ${provLinks}</div></div>`;
  }
}

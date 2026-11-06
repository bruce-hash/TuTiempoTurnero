import { LIVE } from "../../config.js";
import { captchaBox } from "../../lib/captcha.js";
import { esc } from "../../lib/dom.js";
import { rememberedEmail } from "../../lib/sesion.js";
import { S } from "../../state.js";
import { P, store } from "../../store.js";
import { CAT } from "../../lib/rubros.js";
import { GLOGO, ic } from "../../ui/iconos.js";
import { ticket } from "../../ui/ticket.js";
import { pwField, rememberBox, resendBtn } from "./campos.js";

// Ingreso y registro (rediseño aprobado el 1/11): lo mismo en la ventana (encima de la página, ui/ingreso.js) y en las
// páginas /ingresar, /crear-cuenta y /registrar-negocio. Para ingresar no se elige nada: email o Google, y la app lleva
// a cada uno a su lugar. S.login.mode: in (contraseña), up (crear cuenta), forgot / sent (recuperar contraseña) y
// confirm (falta tocar el link del email). 4/11: sin "Entrar con un código por email". Si el ingreso lo pidió una acción
// (S.pending), arriba va el ticket; con "negocio", el paso 0 de Registrá tu negocio.

// títulos según la acción pendiente
const TITLE = { reservar: "Ingresá para reservar", seguir: "Ingresá para seguir", lista: "Ingresá para que te avisemos" };
const head = (title, sub) => `<h1 class="am-h" id="amTitle">${title}</h1>${sub ? `<p class="am-sub">${sub}</p>` : ""}`;
const back = (mode) => `<button type="button" class="lnk am-back" data-act="authMode" data-m="${mode}">← Volver</button>`;
// "Continuar con Google": la cuenta que se crea así también acepta los términos (ajuste del 1/11)
const google = () =>
  `<button type="button" class="gbtn" data-act="google">${GLOGO} Continuar con Google</button>
   <p class="gterms">Al continuar, aceptás los <button type="button" class="lnk" data-go="terminos">Términos</button> y la <button type="button" class="lnk" data-go="terminos">Política de privacidad</button>.</p>
   <div class="or">o con tu email</div>`;
const foot = (html) => `<div class="am-foot">${html}</div>`;
// demo: las cuentas de ejemplo (cliente y prestadores)
const demoHint = () =>
  LIVE
    ? ""
    : `<div class="demohint">Demo: cliente <b>juan.perez@tutiempo.demo</b> · <b>cliente123</b>; profesional <b>filo@tutiempo.demo</b> · <b>barbero123</b>.
   <details class="demoprov"><summary>Entrar como un profesional de ejemplo</summary><div class="demologins">${P.filter((prov) => !prov.deleted)
     .map((prov) => `<button type="button" class="cchip seg-${prov.cats[0]}" data-act="demoLogin" data-id="${prov.id}">${(CAT[prov.cats[0]] || CAT.n).ic} ${esc(prov.name)}</button>`)
     .join("")}</div></details></div>`;

export function authBody() {
  const login = S.login;
  const mode = login.mode || "in";
  const pending = S.pending;
  const biz = !!pending && pending.a === "negocio";
  const tk = biz ? "" : ticket(pending);
  const email = esc(login.email || "");
  if (mode === "forgot") {
    return `${back("in")}${head("Olvidé mi contraseña", "Te mandamos un link para crear una contraseña nueva.")}
   <form id="fForgot" novalidate>
    <div class="f"><label for="af_e">Email</label><input id="af_e" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${email}"></div>
    <div class="err" id="aerr">${esc(login.err || "")}</div>
    ${captchaBox("fForgot")}<button class="btn btn-pri btn-block" type="submit">Enviarme el link</button>
   </form>`;
  }
  if (mode === "sent") {
    return `${back("in")}${head("Revisá tu email")}
   <div class="am-ok">Si <b>${email}</b> tiene una cuenta, te llega un link para crear una contraseña nueva. Vence en 1 hora. Mirá también en Spam o Promociones.</div>
   ${LIVE ? "" : store.DEMO_USERS[(login.email || "").toLowerCase()] ? '<button class="btn btn-pri btn-block" data-act="demoRecoveryLink">Abrir el link del email (demo)</button>' : '<div class="demohint">Demo: ese email no tiene cuenta, así que no llega nada (y no se lo decimos a nadie: así nadie puede averiguar qué emails están registrados).</div>'}
`;
  }
  if (mode === "confirm") {
    const goal = !pending ? "" : biz ? " y seguís con tu negocio" : " y seguís donde lo dejaste";
    return `${tk}<div class="am-mail" aria-hidden="true">${ic("email")}</div>${head("Revisá tu email", `Te mandamos un link a <b>${email}</b>. Tocalo para activar la cuenta${goal}.`)}
   <div class="am-ok">Podés abrirlo en este celular o en otro: ${pending ? "lo que estabas haciendo se retoma igual." : "entrás directo."}</div>
   ${captchaBox("resendConfirm")}${resendBtn("resendConfirm", "Reenviar el email", login.resendAt, "btn btn-ghost btn-block")}
   <div class="am-sec" style="justify-content:center"><button type="button" class="lnk" data-act="authMode" data-m="up">Cambiar email</button></div>
   <p class="note am-note">¿No te llega? Si ya tenías cuenta, <button type="button" class="lnk" data-act="authMode" data-m="in">ingresá</button> o <button type="button" class="lnk" data-act="authMode" data-m="forgot">recuperá tu contraseña</button>.</p>
   <p class="note">Mirá también en Spam o Promociones.</p>`;
  }
  if (mode === "up") {
    // D32 (2/11): un solo "Crear cuenta". La casilla de negocio va arriba de Google y del formulario: marcada, al terminar
    // la cuenta sigue a "Tu negocio" (la acción pendiente "negocio", que viaja a Google y al link del email como el
    // ticket). Con un ticket de cliente (reservar, seguir, lista) no se muestra: una cuenta de negocio no reserva (D33).
    const bizBox =
      pending && !biz
        ? ""
        : `<label class="chk bizchk${biz ? " on" : ""}"><input type="checkbox" id="au_biz" ${biz ? "checked" : ""}> <span><b>Tengo un negocio y quiero recibir reservas</b><small>Después de crear la cuenta cargás tu negocio en 5 pasos, unos 10 minutos.</small></span></label>`;
    return `${tk}${head("Creá tu cuenta", biz ? "Tu cuenta personal: con ella entrás siempre a tu negocio." : "Para reservar turnos y seguir a tus profesionales.")}${bizBox}${google()}
   <form id="fSignup" novalidate>
    <div class="f"><label for="au_n">${biz ? "Tu nombre y apellido" : "Nombre y apellido"}</label><input id="au_n" autocomplete="name" maxlength="80" value="${esc(login.nombre || "")}"></div>
    <div class="f"><label for="au_e">Email</label><input id="au_e" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${email}"></div>
    ${
      biz
        ? ""
        : `<div class="f"><label for="au_t">Celular <span class="hint">(opcional)</span></label><input id="au_t" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="2284 123456" value="${esc(login.tel || "")}"><span class="hint">Lo ve solo el profesional con el que reservás, para avisarte si cambia el turno.</span></div>`
    }
    ${pwField("au_p", "Contraseña", "new-password", true)}
    <label class="chk"><input type="checkbox" id="au_ok"> <span>Acepto los <u class="lnk" role="link" tabindex="0" data-go="terminos" style="cursor:pointer">términos y la política de privacidad</u>.</span></label>
    <div class="err" id="aerr">${esc(login.err || "")}</div>
    ${captchaBox("fSignup")}<button class="btn btn-pri btn-block" type="submit">${biz ? "Crear cuenta y seguir con mi negocio" : "Crear cuenta"}</button>
   </form>
   ${foot(
     biz
       ? '¿Ya tenés cuenta? <button type="button" class="lnk" data-act="authMode" data-m="in">Ingresá</button> y seguís con tu negocio.'
       : '¿Ya tenés cuenta? <button type="button" class="lnk" data-act="authMode" data-m="in">Ingresá</button>',
   )}`;
  }
  // ingresar
  const fails = login.fails || 0;
  const left = 5 - fails;
  return `${tk}${
    biz
      ? head("Registrá tu negocio", "Ingresá con tu cuenta y seguís con tu negocio.")
      : head(TITLE[pending && pending.a] || "Ingresá a TuTiempo", pending ? "" : "Clientes y profesionales entran por acá.")
  }${google()}${demoHint()}
   <form id="fLogin" novalidate>
    <div class="f"><label for="ai_e">Email</label><input id="ai_e" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${esc(login.email || rememberedEmail())}"></div>
    ${rememberBox("ai_rem", login)}
    ${pwField("ai_p", "Contraseña", "current-password", false)}
    ${fails >= 3 && !login.locked ? `<p class="tries">Te ${left === 1 ? "queda 1 intento" : `quedan ${left} intentos`}. Después tenés que esperar 30 segundos (o recuperá tu contraseña).</p>` : ""}
    <div class="err" id="aerr">${esc(login.err || "")}</div>
    ${captchaBox("fLogin")}<button class="btn btn-pri btn-block" type="submit" ${login.locked ? "disabled" : ""}>Ingresar</button>
   </form>
   <div class="am-sec"><button type="button" class="lnk" data-act="authMode" data-m="forgot" ${fails >= 3 ? 'style="font-weight:700"' : ""}>Olvidé mi contraseña</button></div>
   ${foot(`¿No tenés cuenta? <button type="button" class="lnk" data-act="authMode" data-m="up">${biz ? "Creála" : "Creá una"}</button>`)}`;
}

// la página (/ingresar, /crear-cuenta, /registrar-negocio sin sesión): el mismo contenido que la ventana
export function vLogin() {
  // 4/11: con "Crear cuenta" abierta en la ventana encima, la página no repite el formulario (mismos campos)
  if (S.authOnPage && S.authModal) {
    return `<div class="narrow"><div class="panel authpage" aria-hidden="true"><h1 class="am-h">Ingresá a TuTiempo</h1><p class="am-sub">Clientes y profesionales entran por acá.</p></div></div>`;
  }
  return `<div class="narrow"><div class="panel authpage">${authBody()}</div></div>`;
}

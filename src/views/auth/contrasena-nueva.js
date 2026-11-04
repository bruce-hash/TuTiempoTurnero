import { LIVE } from "../../config.js";
import { captchaBox } from "../../lib/captcha.js";
import { esc } from "../../lib/dom.js";
import { S } from "../../state.js";
import { authHead, pwField, resendBtn } from "./campos.js";

// contraseña nueva: desde el link de recuperación o desde Seguridad (npMode "change"); sin email, el link venció.
// 4/11 · Bloque 2: cambiarla desde Seguridad pide la contraseña actual y, después, el código de 6 números que Supabase
// manda por email (reautenticación).
export function vNewPass() {
  const isChange = S.npMode === "change";
  const email = S.user ? S.user.email : S.recoverEmail || "";
  if (isChange && S.user && S.npStep === "code") {
    return `<div class="narrow"><form class="panel" id="fNewPassCode" novalidate style="margin-top:24px">
   ${authHead("Revisá tu email", `Para confirmar el cambio te mandamos un código de 6 números a <b>${esc(email)}</b>. Mirá también en Spam o Promociones.`)}
   ${LIVE ? "" : '<div class="demohint">Demo: el código es <b>123456</b></div>'}
   <div class="f"><label for="np_c">Código</label><input id="np_c" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" class="otp"></div>
   <div class="err" id="nperr"></div>
   <button class="btn btn-pri btn-block" type="submit">Cambiar contraseña</button>
   <div class="authrow">${resendBtn("npResend", "Reenviar el código", S.npResendAt)} · <button type="button" class="lnk" data-act="npCancel">Cancelar</button></div>
  </form></div>`;
  }
  if (email) {
    return `<div class="narrow"><form class="panel" id="fNewPass" novalidate style="margin-top:24px">
   ${authHead(isChange ? "Cambiar contraseña" : "Creá tu contraseña nueva", `Para <b>${esc(email)}</b>`)}
   ${isChange ? pwField("np0", "Contraseña actual", "current-password", false) : ""}
   ${pwField("np1", "Contraseña nueva", "new-password", true)}
   ${pwField("np2", "Repetila", "new-password", false)}
   <div class="err" id="nperr"></div>
   ${isChange ? `${captchaBox("fNewPass")}<button class="btn btn-pri btn-block" type="submit">Seguir</button><p class="note" style="margin-top:8px">Después te mandamos un código a tu email para confirmar que sos vos.</p>` : '<button class="btn btn-pri btn-block" type="submit">Guardar contraseña</button>'}
   ${isChange ? '<div class="authrow"><button type="button" class="lnk" data-act="npCancel">Cancelar</button></div>' : ""}
  </form></div>`;
  } else {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">${authHead("El link venció", "Los links para cambiar la contraseña duran 1 hora y sirven una sola vez.")}
   <button class="btn btn-pri btn-block" data-act="authMode" data-m="forgot">Pedir un link nuevo</button></div></div>`;
  }
}

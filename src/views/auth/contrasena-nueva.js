import { esc } from "../../lib/dom.js";
import { S } from "../../state.js";
import { authHead, pwField } from "./campos.js";

// contraseña nueva: desde el link de recuperación o desde Mi perfil (npMode "change"); sin email, el link venció
export function vNewPass() {
  const isChange = S.npMode === "change";
  const email = S.user ? S.user.email : S.recoverEmail || "";
  if (email) {
    return `<div class="narrow"><form class="panel" id="fNewPass" novalidate style="margin-top:24px">
   ${authHead(isChange ? "Cambiar contraseña" : "Creá tu contraseña nueva", `Para <b>${esc(email)}</b>`)}
   ${pwField("np1", "Contraseña nueva", "new-password", true)}
   ${pwField("np2", "Repetila", "new-password", false)}
   <div class="err" id="nperr"></div>
   <button class="btn btn-pri btn-block" type="submit">Guardar contraseña</button>
   ${isChange ? '<div class="authrow"><button type="button" class="lnk" data-go="cuenta">Cancelar</button></div>' : ""}
  </form></div>`;
  } else {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">${authHead("El link venció", "Los links para cambiar la contraseña duran 1 hora y sirven una sola vez.")}
   <button class="btn btn-pri btn-block" data-act="authMode" data-m="forgot">Pedir un link nuevo</button></div></div>`;
  }
}

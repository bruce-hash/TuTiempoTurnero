import { PWRULE } from "../../lib/validar.js";
import { LOGO } from "../../ui/iconos.js";

export const pwField = (e, a, t, s) =>
  `<div class="f"><label for="${e}">${a}</label><div class="pw"><input id="${e}" type="password" autocomplete="${t}" maxlength="72"><button type="button" class="lnk" data-act="pwShow" data-for="${e}">Mostrar</button></div>${s ? `<div class="pwm" aria-hidden="true"><i id="${e}_m"></i></div><span class="hint" id="${e}_h">${PWRULE}</span>` : ""}</div>`;
export function authHead(e, lead) {
  return `<div class="logo" style="justify-content:center;display:flex">${LOGO}</div><h1 class="h1">${e}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}`;
}

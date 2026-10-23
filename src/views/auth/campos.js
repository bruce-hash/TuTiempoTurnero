import { PWRULE } from "../../lib/validar.js";
import { LOGO } from "../../ui/iconos.js";

// campo de contraseña con botón Mostrar; meter = con barra de fuerza y la regla debajo
export const pwField = (id, label, autocomplete, meter) =>
  `<div class="f"><label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${autocomplete}" maxlength="72"><button type="button" class="lnk" data-act="pwShow" data-for="${id}">Mostrar</button></div>${meter ? `<div class="pwm" aria-hidden="true"><i id="${id}_m"></i></div><span class="hint" id="${id}_h">${PWRULE}</span>` : ""}</div>`;
export function authHead(title, lead) {
  return `<div class="logo" style="justify-content:center;display:flex">${LOGO}</div><h1 class="h1">${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}`;
}

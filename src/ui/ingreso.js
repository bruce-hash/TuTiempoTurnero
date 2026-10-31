import { S } from "../state.js";
import { vLoginBarbero } from "../views/auth/acceso-prestadores.js";
import { vLogin } from "../views/auth/login.js";

// V7 (C47–C49): el ingreso en una segunda capa, encima de la página que se está mirando, para clientes y prestadores.
// Usa los mismos formularios que las páginas /ingresar y de acceso de prestadores (mismos ids y acciones); al ingresar
// se cierra y queda la misma página. Las páginas siguen existiendo para los links de los emails y las direcciones
// protegidas (Mis turnos, Mi perfil, reservar).
export const AUTH_PAGES = ["login", "register", "loginBarbero"];

export function authModal() {
  // ni encima de una página que ya muestra un ingreso (mismos ids): las de ingreso, y Mi perfil y Mis turnos sin sesión
  if (!S.authModal || S.user || S.barberAuth || AUTH_PAGES.includes(S.view) || ["cuenta", "misturnos"].includes(S.view)) {
    return "";
  }
  const prov = S.authModal === "prestador";
  const tab = (key, label) =>
    `<button type="button" role="tab" aria-selected="${S.authModal === key}" data-act="authSide" data-k="${key}">${label}</button>`;
  return `<div class="authmodal" role="dialog" aria-modal="true" aria-label="Ingresar a TuTiempo">
   <div class="am-bg" data-act="authClose"></div>
   <div class="am-box"><button type="button" class="am-x" data-act="authClose" aria-label="Cerrar">✕</button>
    <div class="seg3 am-tabs" role="tablist" aria-label="Ingresar como">${tab("cliente", "Soy cliente")}${tab("prestador", "Soy prestador")}</div>
    ${prov ? vLoginBarbero() : vLogin()}
   </div></div>`;
}

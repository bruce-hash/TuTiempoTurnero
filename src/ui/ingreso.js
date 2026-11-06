import { S } from "../state.js";
import { authBody } from "../views/auth/login.js";
import { LOGO } from "./iconos.js";

// Ingreso y registro (rediseño aprobado el 1/11): la ventana de ingreso, la misma para clientes y prestadores. En la
// compu, una ventana centrada de 440 px; en el celular, una hoja que sube desde abajo, casi a pantalla completa. Es
// role="dialog" con título, el foco queda adentro (Tab no se escapa), Esc y tocar afuera cierran y el foco vuelve al
// botón que la abrió. Con el teclado del celular abierto, la hoja se achica hasta el borde del teclado (visualViewport)
// y el campo activo queda a la vista. Las páginas /ingresar, /crear-cuenta y /registrar-negocio muestran lo mismo.
export const AUTH_PAGES = ["login", "register", "negocio"];

// D33: el aviso a una cuenta de negocio que intentó algo de cliente
function businessBlock() {
  return `<div class="authmodal" role="dialog" aria-modal="true" aria-labelledby="amTitle">
   <div class="am-bg" data-act="bizBlockClose"></div>
   <div class="am-box"><div class="am-grab" aria-hidden="true"></div>
    <div class="am-top"><span class="logo am-logo" aria-hidden="true">${LOGO}</span><button type="button" class="am-x" data-act="bizBlockClose" aria-label="Cerrar">✕</button></div>
    <h1 class="am-h" id="amTitle">Las cuentas de negocio no pueden reservar</h1>
    <p class="am-sub">Para reservar, seguir o dejar una reseña, ingresá con tu cuenta personal.</p>
    <button type="button" class="btn btn-pri btn-block" data-act="bizSwitch">Cerrar sesión e ingresar con otra cuenta</button>
    <div class="am-sec" style="justify-content:center"><button type="button" class="lnk" data-act="bizBlockClose">Volver</button></div>
   </div></div>`;
}
export function authModal() {
  if (S.bizBlock && S.user) {
    return businessBlock();
  }
  // ni encima de una página que ya muestra un ingreso (mismos ids): las de ingreso, y Mi perfil y Mis turnos sin sesión
  // (4/11: encima de /ingresar sí, para "Crear cuenta": la página esconde su formulario mientras tanto)
  if (!S.authModal || S.user || S.role !== "cliente" || (AUTH_PAGES.includes(S.view) && !S.authOnPage) || ["cuenta", "misturnos"].includes(S.view)) {
    return "";
  }
  return `<div class="authmodal" role="dialog" aria-modal="true" aria-labelledby="amTitle">
   <div class="am-bg" data-act="authClose"></div>
   <div class="am-box"><div class="am-grab" aria-hidden="true"></div>
    <div class="am-top"><span class="logo am-logo" aria-hidden="true">${LOGO}</span><button type="button" class="am-x" data-act="authClose" aria-label="Cerrar">✕</button></div>
    ${authBody()}
   </div></div>`;
}

// ---------- foco y teclado ----------
let opener = null;
// recuerda el botón que abrió la ventana (para devolverle el foco al cerrar). Como la pantalla se vuelve a dibujar, se
// guarda también cómo encontrarlo: la zona (cabecera, footer, la página), su acción y su texto.
export function rememberOpener(el) {
  const btn = el && el.closest ? el.closest("button, a, [tabindex]") : null;
  const zone = btn && btn.closest("#nav, footer, #app");
  opener = btn ? { el: btn, zone: zone ? (zone.id ? "#" + zone.id : zone.tagName.toLowerCase()) : "body", act: btn.getAttribute("data-act"), text: btn.textContent.trim() } : null;
}
export function returnFocus() {
  const from = opener;
  opener = null;
  if (!from) {
    return;
  }
  const el = document.contains(from.el)
    ? from.el
    : [...document.querySelectorAll(`${from.zone} [data-act="${from.act}"]`)].find((item) => item.textContent.trim() === from.text);
  if (el) {
    el.focus();
  }
}
// foco en el primer campo solo en la compu: en el celular abriría el teclado tapando la ventana
export function focusFirstField() {
  if (!window.matchMedia || !window.matchMedia("(min-width: 700px)").matches) {
    const box = document.querySelector(".am-box");
    if (box) {
      box.setAttribute("tabindex", "-1");
      box.focus({ preventScroll: true });
    }
    return;
  }
  const field = document.querySelector(".am-box input:not([type=checkbox]), .authpage input:not([type=checkbox])");
  if (field) {
    field.focus();
  }
}
const focusables = (root) =>
  [...root.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
// Tab y Shift+Tab dan la vuelta adentro de la ventana
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Tab") {
    return;
  }
  const box = document.querySelector(".authmodal .am-box");
  if (!box) {
    return;
  }
  const items = focusables(box);
  if (!items.length) {
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (!box.contains(document.activeElement)) {
    ev.preventDefault();
    first.focus();
  } else if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
});
// teclado del celular: la hoja llega hasta el borde del teclado y el campo activo se ve
function fitKeyboard() {
  const vv = window.visualViewport;
  const modal = document.querySelector(".authmodal");
  if (!vv || !modal) {
    return;
  }
  const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  modal.style.setProperty("--kb", covered + "px");
  modal.classList.toggle("kb", covered > 80);
  const el = document.activeElement;
  if (covered > 80 && el && modal.contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.scrollIntoView) {
    el.scrollIntoView({ block: "center" });
  }
}
if (typeof window !== "undefined" && window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitKeyboard);
  document.addEventListener("focusin", () => setTimeout(fitKeyboard, 50));
}

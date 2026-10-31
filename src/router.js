// Enrutador (Bloque B): cada pantalla tiene su dirección, sin "#".
// - Después de cada render(), syncUrl() arma la dirección que corresponde al estado S y la pone en la barra (pushState
//   si es otra pantalla, replaceState si es la misma con otra forma, por ejemplo /p/7 → /filo-barber-club).
// - Al abrir una dirección (carga, recarga o atrás/adelante), applyUrl() arma el estado desde la URL: pantalla,
//   prestador, pestaña, horario elegido… Si la pantalla pide sesión y no la hay, va al ingreso y vuelve después.
// - Las historias y la ficha de un cliente abren una entrada propia: "atrás" las cierra. Las confirmaciones no.
import { applyUrl } from "./router/pantallas.js";
import { META, describe } from "./router/direcciones.js";
import { S } from "./state.js";
import { render } from "./ui/render.js";

export { afterPathFor, profileLinkText, profilePath, profileUrl } from "./router/direcciones.js";
export { applyUrl };

let started = false;
let applying = false;
let nextReplace = false;
let ownBack = false;

function setMeta(title, desc) {
  document.title = title;
  const meta = document.querySelector('meta[name="description"]');
  if (meta) {
    meta.setAttribute("content", desc || META.homeDesc);
  }
}

// la llama render() después de dibujar
export function syncUrl() {
  if (!started || applying) {
    return;
  }
  const target = describe();
  setMeta(target.title, target.desc);
  const current = location.pathname + location.search;
  const state = history.state || {};
  const replace = nextReplace;
  nextReplace = false;
  if (replace || target.key === state.k) {
    if (target.url !== current || target.key !== state.k) {
      history.replaceState({ k: target.key, prev: state.prev, overlay: target.overlay }, "", target.url);
    }
    return;
  }
  // se cerró la historia o la ficha y la entrada anterior es justo la pantalla a la que se vuelve: es "atrás"
  if (state.overlay && !target.overlay && state.prev === target.key) {
    ownBack = true;
    history.back();
    return;
  }
  history.pushState({ k: target.key, prev: state.k, overlay: target.overlay }, "", target.url);
}

// ---------- Arranque, atrás/adelante y navegación desde el código ----------
async function onPopState() {
  if (ownBack) {
    ownBack = false;
    return;
  }
  // V7: atrás/adelante cierra el ingreso en segunda capa
  if (S.authModal) {
    S.authModal = null;
    S.after = null;
  }
  applying = true;
  try {
    await applyUrl(location.href);
  } finally {
    applying = false;
  }
  nextReplace = true;
  render();
  window.scrollTo(0, 0);
}
// href: la dirección con la que arranca (null = el estado ya lo decidió el arranque, por ejemplo la vuelta de
// Mercado Pago o el link de recuperación de contraseña)
export async function startRouter(href) {
  META.homeDesc = (document.querySelector('meta[name="description"]') || { getAttribute: () => "" }).getAttribute("content");
  if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
  }
  if (href !== null) {
    applying = true;
    try {
      await applyUrl(href || location.href);
    } finally {
      applying = false;
    }
  }
  started = true;
  nextReplace = true;
  window.addEventListener("popstate", onPopState);
  render();
}
// ir a una dirección desde el código (por ejemplo, después de ingresar): queda en el historial
export async function navigate(href) {
  applying = true;
  try {
    await applyUrl(href);
  } finally {
    applying = false;
  }
  render();
  window.scrollTo(0, 0);
}
// después de ingresar al panel: si venía de una dirección del panel, a esa
export function afterPanelLogin() {
  const back = S.after;
  if (back && String(back).startsWith("/panel")) {
    S.after = null;
    navigate(back);
    return true;
  }
  return false;
}

import { SW_ON } from "../config.js";
import { S } from "../state.js";

// Bloque C: la app instalable. Registra el service worker (public/… → /sw.js, lo escribe el build), ofrece instalar la
// app (Android y compu: el aviso del navegador; iPhone: la guía "Agregar a inicio") y aplica las versiones nuevas sin
// dejar a nadie con la vieja: revisa cada hora y al volver al frente, y recarga en un momento seguro (nunca en medio de
// un pago).
// Con serviceWorker: false en config.js, desinstala el service worker y borra su caché (el freno de emergencia).

const HOUR = 3600 * 1000;
let registration = null;
let installPrompt = null;
let rerender = () => {};
let lastPath = "";

export const isStandalone = () =>
  (typeof matchMedia == "function" && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
// navegador de Instagram, Facebook, WhatsApp…: ahí no se puede instalar
export const inAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Twitter|TikTok/i.test(navigator.userAgent);
// en el iPhone, fuera de la app agregada a inicio: no hay notificaciones ni aviso de instalación (hay que guiar)
export const needsIosInstall = () => isIOS() && !isStandalone();

// la pantalla de pago o un formulario a medio escribir: no se recarga ahí
function safeToReload() {
  if (S.view === "checkoutT") {
    return false;
  }
  const el = document.activeElement;
  return !(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.value);
}
function applyUpdate() {
  if (S.updateReady && safeToReload()) {
    location.reload();
  }
}

export function startPwa(onChange) {
  rerender = onChange || rerender;
  if (typeof navigator == "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  if (!SW_ON) {
    // freno de emergencia (o demo y pruebas): sin service worker y sin su caché
    navigator.serviceWorker.getRegistrations().then((list) => list.forEach((reg) => reg.unregister())).catch(() => {});
    if (typeof caches != "undefined") {
      caches.keys().then((keys) => keys.filter((key) => key.startsWith("tt-")).forEach((key) => caches.delete(key))).catch(() => {});
    }
    return;
  }
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((reg) => {
      registration = reg;
      setInterval(() => reg.update().catch(() => {}), HOUR);
    })
    .catch(() => {});
  // una versión nueva tomó el control (la primera instalación no cuenta): se aplica al volver al frente o al cambiar
  // de pantalla; mientras tanto, la barra "Hay una versión nueva"
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    S.updateReady = true;
    rerender();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    applyUpdate();
    if (registration) {
      registration.update().catch(() => {});
    }
  });
  window.addEventListener("beforeinstallprompt", (ev) => {
    ev.preventDefault();
    installPrompt = ev;
    S.canInstall = true;
    rerender();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    S.canInstall = false;
    rerender();
  });
}
// después de cada render(): al cambiar de pantalla con una versión nueva lista, se recarga
export function pwaAfterRender() {
  const path = location.pathname;
  if (lastPath && path !== lastPath) {
    applyUpdate();
  }
  lastPath = path;
}
export const reloadNow = () => location.reload();

// "Instalar la app": el aviso del navegador (solo existe en Android y compu, y una vez por carga)
export async function promptInstall() {
  if (!installPrompt) {
    return false;
  }
  const ev = installPrompt;
  installPrompt = null;
  S.canInstall = false;
  ev.prompt();
  const choice = await ev.userChoice.catch(() => null);
  rerender();
  return !!choice && choice.outcome === "accepted";
}

// recuerda en este dispositivo qué tarjeta se cerró (try/catch: sin almacenamiento, se vuelve a mostrar y listo)
export function dismissed(key, days) {
  try {
    const at = +localStorage.getItem("tt_" + key) || 0;
    return !!at && (days == null || Date.now() - at < days * 864e5);
  } catch (err) {
    return false;
  }
}
export function dismiss(key) {
  try {
    localStorage.setItem("tt_" + key, String(Date.now()));
  } catch (err) {}
}

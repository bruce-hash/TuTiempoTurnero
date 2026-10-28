import { api } from "../api/index.js";
import { SW_ON, VAPID_KEY } from "../config.js";
import { S } from "../state.js";
import { isIOS, needsIosInstall } from "./pwa.js";

// Bloque C: las notificaciones push de este dispositivo. El permiso se pide SOLO cuando la persona toca "Activar avisos"
// (enablePush se llama directo desde ese toque: Safari y Chrome lo exigen), nunca al abrir la página.
// S.push = { avail, on }:
//   avail: "none" (sin vapidPublicKey en config.js, o en la demo) · "ios-install" (iPhone sin la app agregada a inicio)
//          · "ios-old" (iOS < 16.4) · "unsupported" · "denied" (bloqueadas en el navegador) · "ok"
//   on: este dispositivo está suscripto a esta cuenta

export function pushAvailability() {
  if (!VAPID_KEY || !SW_ON || typeof navigator == "undefined") {
    return "none";
  }
  if (needsIosInstall()) {
    return "ios-install";
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return isIOS() ? "ios-old" : "unsupported";
  }
  return Notification.permission === "denied" ? "denied" : "ok";
}

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
// "Chrome en Android", "Safari en iPhone"…: para que la persona reconozca el dispositivo (no se usa para nada más)
export function deviceLabel(ua = navigator.userAgent) {
  const browser = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "Navegador";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPod/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "otro sistema";
  return `${browser} en ${os}`;
}

// estado de este dispositivo (al iniciar la sesión y al abrir Mi perfil o el panel)
export async function refreshPush() {
  const avail = pushAvailability();
  let on = false;
  if (avail === "ok" && S.user && Notification.permission === "granted") {
    const sub = await currentSubscription().catch(() => null);
    on = !!sub && (await api.pushRegistered(sub.endpoint).catch(() => false));
  }
  S.push = { avail, on };
  return S.push;
}

// "Activar avisos": permiso → suscripción del navegador → la base (push_subscribe). Devuelve "on", "denied" o "error".
export async function enablePush() {
  if (pushAvailability() !== "ok") {
    return "error";
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    S.push = { avail: permission === "denied" ? "denied" : "ok", on: false };
    return "denied";
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey) {
      // si cambiaron las claves VAPID, la suscripción vieja ya no sirve
      const old = new Uint8Array(sub.options.applicationServerKey);
      const now = keyBytes(VAPID_KEY);
      if (old.length !== now.length || old.some((b, i) => b !== now[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) }));
    const json = sub.toJSON();
    await api.m.pushSubscribe(json.endpoint, json.keys.p256dh, json.keys.auth, deviceLabel());
    S.push = { avail: "ok", on: true };
    return "on";
  } catch (err) {
    return "error";
  }
}

// "Desactivar en este dispositivo" y al cerrar sesión (antes del signOut: la base solo deja borrar la suscripción propia)
export async function disablePush() {
  if (pushAvailability() === "none" || !("serviceWorker" in navigator)) {
    return;
  }
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await api.m.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  S.push = { avail: pushAvailability(), on: false };
}

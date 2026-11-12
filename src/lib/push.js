import { api } from "../api/index.js";
import { SW_ON, VAPID_KEY } from "../config.js";
import { S } from "../state.js";
import { isIOS, needsIosInstall } from "./pwa.js";

// Bloque C: las notificaciones push de este dispositivo. El permiso se pide SOLO cuando la persona toca "Activar avisos"
// (enablePush se llama directo desde ese toque: Safari y Chrome lo exigen), nunca al abrir la página. 12/11: con el permiso
// ya dado, al ingresar o al abrir la app el dispositivo se vuelve a suscribir solo (refreshPush).
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

// 12/11 · «Desactivar en este dispositivo»: queda anotado en el dispositivo (no en la cuenta) y los avisos no se
// reactivan solos acá hasta que la persona toque «Activar avisos» de nuevo
const OPT_OUT = "tt_push_off";
export function pushOptedOut() {
  try {
    return localStorage.getItem(OPT_OUT) === "1";
  } catch (err) {
    return false;
  }
}
function setOptOut(off) {
  try {
    if (off) {
      localStorage.setItem(OPT_OUT, "1");
    } else {
      localStorage.removeItem(OPT_OUT);
    }
  } catch (err) {}
}

// la suscripción del navegador, si sirve con las claves VAPID de ahora (si cambiaron, la vieja ya no sirve)
async function usableSubscription(reg) {
  const sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    const now = keyBytes(VAPID_KEY);
    if (old.length !== now.length || old.some((b, i) => b !== now[i])) {
      await sub.unsubscribe().catch(() => {});
      return null;
    }
  }
  return sub;
}
const newSubscription = (reg) => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_KEY) });
// liga este dispositivo a la cuenta que ingresó (push_subscribe: una suscripción por dispositivo; si era de otra cuenta,
// pasa a esta y la anterior deja de recibir). Si el servicio de push ya la había dado por vencida (404/410, la base
// contesta push_gone), se pide una nueva. quiet: sin avisos en pantalla (al ingresar o al abrir la app).
async function register(reg, sub, quiet) {
  const send = (s) => {
    const json = s.toJSON();
    const args = [json.endpoint, json.keys.p256dh, json.keys.auth, deviceLabel()];
    return quiet ? api.pushSubscribeQuiet(...args) : api.m.pushSubscribe(...args);
  };
  sub = sub || (await newSubscription(reg));
  try {
    await send(sub);
  } catch (err) {
    if (!/push_gone/.test((err && err.message) || "")) {
      throw err;
    }
    await sub.unsubscribe().catch(() => {});
    await send(await newSubscription(reg));
  }
}

// estado de este dispositivo: al abrir la app con la sesión guardada, al ingresar (contraseña o Google) y al renovarse la
// sesión. 12/11: con el permiso ya concedido, el dispositivo se vuelve a ligar solo a la cuenta que ingresó (sin tarjeta
// ni pedir permiso), salvo que la persona lo haya desactivado acá. Con el permiso sin dar o rechazado, nada.
// una vuelta a la vez por cuenta (al abrir la app pueden llegar juntos el arranque y la renovación de la sesión)
let syncing = null;
export function refreshPush() {
  const uid = S.user && S.user.id;
  if (syncing && syncing.uid === uid) {
    return syncing.run;
  }
  const run = syncPush().finally(() => {
    if (syncing && syncing.run === run) {
      syncing = null;
    }
  });
  syncing = { uid, run };
  return run;
}
async function syncPush() {
  const avail = pushAvailability();
  let on = false;
  if (avail === "ok" && S.user && Notification.permission === "granted") {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await usableSubscription(reg);
      on = !!sub && (await api.pushRegistered(sub.endpoint));
      if (!on && !pushOptedOut()) {
        await register(reg, sub, true);
        on = true;
      }
    } catch (err) {
      // sin red o el navegador no deja suscribir sin un toque (queda la tarjeta «Activar avisos», como antes)
    }
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
    await register(reg, await usableSubscription(reg), false);
    setOptOut(false);
    S.push = { avail: "ok", on: true };
    return "on";
  } catch (err) {
    return "error";
  }
}

// "Desactivar en este dispositivo": se borra de la base y del navegador, y no se reactiva solo acá (OPT_OUT)
export async function disablePush() {
  if (pushAvailability() === "none" || !("serviceWorker" in navigator)) {
    return;
  }
  setOptOut(true);
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await api.m.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  S.push = { avail: pushAvailability(), on: false };
}

// al cerrar sesión (antes del signOut: la base solo deja borrar la suscripción propia): la cuenta que sale deja de recibir
// en este dispositivo. 12/11: la suscripción del navegador queda (sin cuenta en la base no le llega nada), así la próxima
// cuenta que ingrese la vuelve a usar sin pedir un toque (el iPhone no deja suscribir de nuevo sin uno).
export async function forgetPushHere() {
  if (pushAvailability() === "none" || !("serviceWorker" in navigator)) {
    return;
  }
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    await api.m.pushUnsubscribe(sub.endpoint).catch(() => {});
  }
  S.pushTestNote = null;
  S.push = { avail: pushAvailability(), on: false };
}

// 12/11 · «Mandarme una de prueba»: manda una push a este dispositivo y espera a ver cómo salió (hasta ~40 s).
// Devuelve { result, detail }: result = "sent" | "failed" | "pending" | "gone" | "wait" | "off" | "error".
export async function testPush() {
  const sub = pushAvailability() === "ok" ? await currentSubscription().catch(() => null) : null;
  if (!sub) {
    return { result: "off" };
  }
  let id;
  try {
    id = await api.pushTest(sub.endpoint);
  } catch (err) {
    const msg = (err && err.message) || "";
    return { result: /push_test_wait/.test(msg) ? "wait" : /push_not_registered/.test(msg) ? "off" : "error", detail: msg };
  }
  let st = { status: "pending" };
  for (let i = 0; i < 20 && st.status === "pending"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    st = await api.pushTestStatus(id).catch(() => st);
  }
  if (st.status === "gone") {
    // el servicio de push dio la suscripción por vencida: se pide una nueva (refreshPush) para la próxima
    await refreshPush().catch(() => {});
  }
  const detail = st.code || st.error ? [st.code, st.error].filter(Boolean).join(" · ") : "";
  return { result: st.status, detail };
}

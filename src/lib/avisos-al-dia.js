// 10/11 · avisos de seguidores: la campanita al día sin tener que salir y volver a la app.
// - Cliente: con la app abierta, los avisos (turno libre que ofrece un profesional, sus novedades, recordatorios) se
//   vuelven a pedir cada minuto; antes llegaban solo al volver a primer plano. Se dibuja solo si cambió algo y nunca
//   con un guardado pendiente o alguien escribiendo.
// - Cuando llega un push con la app abierta, el service worker le avisa a la app (mensaje "tt-push") y se ponen al día
//   en el momento: los avisos del cliente, o los del profesional (seguidores y avisos del panel) y su Agenda.
import { api } from "../api/index.js";
import { pending } from "../api/saved.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { refreshAgendaNow, refreshCommunityNow } from "./agenda-al-dia.js";
import { typing } from "./precios.js";

const EVERY = 60000;
const busy = () => pending.n > 0 || typing() || S.msgOpen || !!document.querySelector(".authmodal");
const isClient = () => !!S.user && S.role !== "barbero" && S.role !== "admin";
const inboxKey = () => JSON.stringify((S.inbox || []).map((msg) => [msg.id, msg.read]));

let running = false;
export async function refreshInboxNow() {
  if (!LIVE || running || document.visibilityState !== "visible" || !isClient() || busy()) {
    return false;
  }
  running = true;
  try {
    const before = inboxKey();
    await api.myMessages();
    const changed = inboxKey() !== before;
    if (changed && isClient() && !busy()) {
      render();
    }
    return changed;
  } catch {
    return false;
  } finally {
    running = false;
  }
}

// lo que llega por push mientras la app está abierta
export function onPushMessage(ev) {
  if (!ev || !ev.data || ev.data.type !== "tt-push") {
    return;
  }
  if (S.role === "barbero") {
    refreshCommunityNow();
    refreshAgendaNow();
  } else {
    refreshInboxNow();
  }
}

export function startInboxRefresh() {
  if (!LIVE) {
    return;
  }
  setInterval(refreshInboxNow, EVERY);
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", onPushMessage);
  }
}

// 4/11 · Bloque 1: la app instalada no tiene botón de recargar (en iPhone, ni siquiera la barra del navegador).
// - Cada vez que la app vuelve a primer plano: primero, si quedó un cobro de Mercado Pago pendiente, a confirmarlo
//   (cobro-pendiente.js); si no, se vuelven a pedir los datos de la pantalla actual, sin recargar (los turnos del panel,
//   Mis turnos y los avisos, el panel de TuTiempo). Nunca con un guardado en curso o alguien escribiendo.
// - Deslizar hacia abajo desde arriba de todo (solo en la app instalada; en el navegador ya existe el gesto del
//   navegador): aparece "Soltá para actualizar" y al soltar recarga la página entera (misma dirección, misma pantalla).
//   También está "Actualizar" en el menú de cuenta, por si el gesto choca con algo.
import { api } from "../api/index.js";
import { pending } from "../api/saved.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { go, render } from "../ui/render.js";
import { resumePendingPay } from "./cobro-pendiente.js";
import { typing } from "./precios.js";
import { isStandalone } from "./pwa.js";
import { pushAvailability, refreshPush } from "./push.js";

const EVERY = 15000; // a lo sumo una vez cada 15 s (volver a primer plano dispara varios eventos juntos)
const PULL = 70; // px para soltar y actualizar

const busy = () => pending.n > 0 || typing() || S.manOpen || S.blockOpen || S.prodOpen || S.gOpen || S.msgOpen || !!document.querySelector(".authmodal");
let last = 0;

// los datos de la pantalla actual, sin recargar
export async function refreshScreen() {
  if (!LIVE || busy()) {
    return false;
  }
  last = Date.now();
  const done = () => {
    if (!busy()) {
      render();
    }
  };
  // la Agenda y el perfil del profesional ya se ponen al día solos al volver (agenda-al-dia.js, precios.js)
  if (S.role === "admin") {
    await api.adminLoad().then(done).catch(() => {});
  } else if (S.role === "barbero" && S.me) {
    if (S.btab !== "agenda") {
      // los turnos (lo que cambia solo: reservas y pagos); el resto del panel lo cambia el mismo profesional
      await api
        .refreshAgenda()
        .then((changed) => changed && done())
        .catch(() => {});
    }
  } else if (S.user && ["misturnos", "turnoOk", "cuenta"].includes(S.view)) {
    await Promise.all([api.myBookings(), api.myMessages()]).then(done).catch(() => {});
  } else if (S.user) {
    // 4/11: la campanita de avisos está en todas las pantallas
    await api.myMessages().then(done).catch(() => {});
  }
  return true;
}

async function onForeground() {
  if (document.visibilityState !== "visible") {
    return;
  }
  // el cobro pendiente siempre (tiene su propio freno); los datos de la pantalla, a lo sumo cada 15 s
  if ((await resumePendingPay(go)) || Date.now() - last < EVERY) {
    return;
  }
  refreshScreen();
}

function pullToRefresh() {
  let startY = null;
  let dy = 0;
  const bar = document.createElement("div");
  bar.className = "ptr";
  bar.setAttribute("aria-hidden", "true");
  document.body.appendChild(bar);
  const reset = () => {
    startY = null;
    dy = 0;
    bar.style.transform = "";
    bar.classList.remove("on", "ready");
  };
  window.addEventListener(
    "touchstart",
    (ev) => {
      // solo arriba de todo y fuera de ventanas, historias y campos
      if (window.scrollY > 0 || ev.touches.length !== 1 || ev.target.closest(".authmodal, .story, input, textarea, select, .tl")) {
        return;
      }
      startY = ev.touches[0].clientY;
    },
    { passive: true },
  );
  window.addEventListener(
    "touchmove",
    (ev) => {
      if (startY == null) {
        return;
      }
      dy = ev.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        return reset();
      }
      const shown = Math.min(dy, PULL * 1.6);
      bar.classList.add("on");
      bar.classList.toggle("ready", dy >= PULL);
      bar.textContent = dy >= PULL ? "Soltá para actualizar" : "Deslizá para actualizar";
      bar.style.transform = `translate(-50%, ${shown * 0.6}px)`;
    },
    { passive: true },
  );
  window.addEventListener("touchend", () => {
    if (startY != null && dy >= PULL && !busy()) {
      bar.textContent = "Actualizando…";
      location.reload();
      return;
    }
    reset();
  });
}

export function startAppRefresh() {
  if (!LIVE) {
    return;
  }
  document.addEventListener("visibilitychange", onForeground);
  // 12/11: si la persona habilitó las notificaciones en la configuración y vuelve a la app, se activan solas (sin recargar)
  document.addEventListener("visibilitychange", () => {
    const push = S.push || {};
    if (document.visibilityState !== "visible" || !S.user || push.on || pushAvailability() === push.avail) {
      return;
    }
    refreshPush()
      .then(() => render())
      .catch(() => {});
  });
  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted) {
      onForeground();
    }
  });
  window.addEventListener("focus", onForeground);
  if (isStandalone()) {
    pullToRefresh();
  }
}

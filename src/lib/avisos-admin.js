// v2 (3/11) · Avisos del panel de TuTiempo que se pueden borrar. Cada aviso tiene una clave que cambia si cambia lo que
// dice (por ejemplo, la lista de profesionales sin Mercado Pago): uno borrado no vuelve, salvo que haya algo nuevo.
// store.ADM_MARKS = { clave: { seen, dismissed } } (en vivo, admin_alert_marks_get; en la demo, en memoria). Un aviso es
// "leído" si ya se vio antes de esta visita; al dibujarlo se marca visto.
import { api } from "../api/index.js";
import { esc } from "./dom.js";
import { store } from "../store.js";

store.ADM_MARKS = store.ADM_MARKS || {};
const seenNow = new Set(); // vistos en esta visita (para no volver a marcarlos)

export const alertDismissed = (key) => !!(store.ADM_MARKS[key] && store.ADM_MARKS[key].dismissed);
export const alertRead = (key) => !!store.ADM_MARKS[key] && !seenNow.has(key);

// los avisos que siguen (sin los borrados), con su ✕ y la marca de nuevo; y el botón «Borrar los leídos»
export function alertItems(items) {
  const shown = items.filter((item) => item && item.html && !alertDismissed(item.key));
  const html = shown
    .map((item) => `<li class="admal${alertRead(item.key) ? "" : " new"}" data-k="${esc(item.key)}"><div>${alertRead(item.key) ? "" : '<span class="chip warn">Nuevo</span> '}${item.html}</div><button type="button" class="xbtn" data-act="admAlertDel" data-k="${esc(item.key)}" aria-label="Borrar este aviso" title="Borrar">✕</button></li>`)
    .join("");
  const anyRead = shown.some((item) => alertRead(item.key));
  return { html, count: shown.length, clearBtn: anyRead ? '<button type="button" class="lnk" data-act="admAlertsClear">Borrar los leídos</button>' : "" };
}

// después de dibujar: los avisos nuevos quedan vistos (en la próxima visita ya son "leídos")
export function markShownAlerts() {
  const keys = [...document.querySelectorAll("li.admal[data-k]")].map((li) => li.dataset.k).filter((key) => !store.ADM_MARKS[key] && !seenNow.has(key));
  if (!keys.length) {
    return;
  }
  keys.forEach((key) => seenNow.add(key));
  api.m.adminAlertMark({ keys, dismiss: false }).then(() => {
    keys.forEach((key) => {
      store.ADM_MARKS[key] = store.ADM_MARKS[key] || { seen: new Date().toISOString(), dismissed: null };
    });
  }).catch(() => {});
}

export function dismissAlerts(keys) {
  return api.m.adminAlertMark({ keys, dismiss: true }).then(() => {
    keys.forEach((key) => {
      store.ADM_MARKS[key] = { seen: (store.ADM_MARKS[key] || {}).seen || new Date().toISOString(), dismissed: new Date().toISOString() };
    });
  });
}
// los leídos que se ven ahora (para «Borrar los leídos»)
export const readShownKeys = () => [...document.querySelectorAll("li.admal[data-k]")].map((li) => li.dataset.k).filter(alertRead);

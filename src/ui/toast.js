import { $ } from "../lib/dom.js";

// aviso corto abajo; el temporizador se guarda en la propia función para reiniciarlo si llega otro
export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2400);
}
// aviso arriba con HTML (ya escapado por quien llama)
export function notif(html) {
  const el = $("#notif");
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(notif.t);
  notif.t = setTimeout(() => (el.hidden = true), 4500);
}

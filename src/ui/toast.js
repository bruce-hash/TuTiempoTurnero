import { $ } from "../lib/dom.js";

export function toast(e) {
  const a = $("#toast");
  a.textContent = e;
  a.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (a.hidden = true), 2400);
}
export function notif(html) {
  const a = $("#notif");
  a.innerHTML = html;
  a.hidden = false;
  clearTimeout(notif.t);
  notif.t = setTimeout(() => (a.hidden = true), 4500);
}

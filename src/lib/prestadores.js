import { LIVE } from "../config.js";
import { money } from "./dinero.js";
import { esc, ini } from "./dom.js";
import { TODAY, addDays, dkey } from "./fechas.js";
import { S } from "../state.js";
import { P, store } from "../store.js";

export const pr = (id) => P.find((prov) => prov.id == id);
// Prestador que se está viendo en el panel (en la demo, el 7 si no se eligió otro).
export const ME = () => S.me || 7;
export const ph = (prov, cls = "", price) =>
  `<div class="ph ${cls}" style="--h:${+prov.hue || 0}">${prov.photo ? `<img class="ph-img" src="${esc(prov.photo)}" alt="" loading="lazy">` : `<span class="ph-i">${ini(prov.name)}</span>`}<span class="badge">Disponible</span>${price ? `<span class="ph-price">Desde <b>${money(price)}</b></span>` : ""}</div>`;
const minPrice = (prov) =>
  (prov.svcs || []).length
    ? Math.min(...prov.svcs.map((svc) => svc[2]))
    : (prov.card && prov.card.todos && prov.card.todos.min) || 0;
export const avatar = (who, cls = "") =>
  who && who.photo
    ? `<span class="av av-img ${cls}"><img src="${esc(who.photo)}" alt=""></span>`
    : `<span class="av ${cls}" style="background:hsl(${+((who && who.hue) || 0) || (String((who && who.name) || "?").charCodeAt(0) * 37) % 360} 55% 45%)">${ini(who && who.name)}</span>`;
export const p0cat = (id) => ((pr(id) || {}).cats || ["b"])[0];
export const FOLLOW = {};
export const isFol = (id) => (LIVE ? !!FOLLOW[id] : !!(S.followingBy || {})[id]);
export const norm = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
// Servicios hechos por la app en los últimos 30 días: ordena el listado (en vivo lo calcula la base).
export function activity(prov) {
  if (!prov) {
    return 0;
  }
  if (LIVE) {
    return +prov.activity || 0;
  }
  const since = dkey(addDays(-30));
  return (
    (prov.jobs30 || 0) +
    store.BOOK.filter((booking) => booking.pid == prov.id && booking.src === "app" && booking.status === "done" && booking.date >= since).length
  );
}
// Orden rotativo diario entre prestadores con la misma actividad: un hash del día y del id, igual para todos ese día.
export function rot(id) {
  const seed = TODAY() + "|" + id;
  let hash = 7;
  for (const ch of seed) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash;
}

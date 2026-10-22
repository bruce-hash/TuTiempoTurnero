import { LIVE } from "../config.js";
import { money } from "./dinero.js";
import { esc, ini } from "./dom.js";
import { TODAY, addDays, dkey } from "./fechas.js";
import { S } from "../state.js";
import { P, store } from "../store.js";

export const pr = (e) => P.find((a) => a.id == e);
export const ME = () => S.me || 7;
export const ph = (e, a = "", t) =>
  `<div class="ph ${a}" style="--h:${+e.hue || 0}">${e.photo ? `<img class="ph-img" src="${esc(e.photo)}" alt="" loading="lazy">` : `<span class="ph-i">${ini(e.name)}</span>`}<span class="badge">Disponible</span>${t ? `<span class="ph-price">Desde <b>${money(t)}</b></span>` : ""}</div>`;
const minPrice = (e) =>
  (e.svcs || []).length
    ? Math.min(...e.svcs.map((a) => a[2]))
    : (e.card && e.card.todos && e.card.todos.min) || 0;
export const avatar = (e, a = "") =>
  e && e.photo
    ? `<span class="av av-img ${a}"><img src="${esc(e.photo)}" alt=""></span>`
    : `<span class="av ${a}" style="background:hsl(${+((e && e.hue) || 0) || (String((e && e.name) || "?").charCodeAt(0) * 37) % 360} 55% 45%)">${ini(e && e.name)}</span>`;
export const p0cat = (e) => ((pr(e) || {}).cats || ["b"])[0];
export const FOLLOW = {};
export const isFol = (e) => (LIVE ? !!FOLLOW[e] : !!(S.followingBy || {})[e]);
export const norm = (e) =>
  String(e || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
export function activity(e) {
  if (!e) {
    return 0;
  }
  if (LIVE) {
    return +e.activity || 0;
  }
  const a = dkey(addDays(-30));
  return (
    (e.jobs30 || 0) +
    store.BOOK.filter((t) => t.pid == e.id && t.src === "app" && t.status === "done" && t.date >= a).length
  );
}
export function rot(id) {
  const a = TODAY() + "|" + id;
  let t = 7;
  for (const s of a) {
    t = (t * 31 + s.charCodeAt(0)) >>> 0;
  }
  return t;
}

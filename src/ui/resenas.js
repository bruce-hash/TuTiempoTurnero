import { esc } from "../lib/dom.js";
import { store } from "../store.js";

function stars(e) {
  return "★★★★★".slice(0, Math.round(e)) + "☆☆☆☆☆".slice(0, 5 - Math.round(e));
}
export function rating(e) {
  const a = (e || store.COMM).reviews;
  if (a.length) {
    return a.reduce((t, s) => t + s.s, 0) / a.length;
  } else {
    return 0;
  }
}
export function gallery(edit, a) {
  a = a || store.COMM;
  const t = (s) =>
    edit
      ? `<button class="gi-del" data-act="mediaDel" data-i="${s}" aria-label="Borrar trabajo">✕</button>`
      : "";
  return `<div class="gal">${a.media.map((s, n) => (s.url ? (s.video ? `<div class="gi"><video src="${esc(s.url)}" controls playsinline></video>${t(n)}</div>` : `<div class="gi"><img src="${esc(s.url)}" alt="${esc(s.label)}">${t(n)}</div>`) : `<div class="gi gi-ph" style="--h:${+s.hue || 0}"><span>${s.video ? "▶ " : ""}${esc(s.label)}</span>${t(n)}</div>`)).join("")}
   ${edit ? '<label class="gi gi-add" for="upMedia"><span>+<br>Subir trabajo</span></label>' : ""}</div>
   ${edit ? '<input id="upMedia" type="file" accept="image/*,video/*" multiple hidden>' : ""}`;
}
export function reviewsHtml(edit, a) {
  a = a || store.COMM;
  if (a.reviews.length) {
    return `<ul class="rv">${a.reviews
      .map(
        (
          t,
          s,
        ) => `<li><div class="rv-h"><b>${esc(t.n)}</b><span class="st">${stars(t.s)}</span></div><p>${esc(t.t)}</p><span class="hint">${esc(t.d)}</span>
   ${t.reply ? `<div class="rv-r"><b>Respuesta:</b> ${esc(t.reply)}</div>` : edit ? `<div class="rv-form"><input id="rep${s}" placeholder="Responder…" autocomplete="off"><button class="btn btn-ghost" data-act="responder" data-i="${s}">Enviar</button></div>` : ""}</li>`,
      )
      .join("")}</ul>`;
  } else {
    return '<p class="note">Todavía no tiene reseñas.</p>';
  }
}

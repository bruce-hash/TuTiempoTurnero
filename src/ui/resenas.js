import { esc } from "../lib/dom.js";
import { store } from "../store.js";

function stars(avg) {
  return "★★★★★".slice(0, Math.round(avg)) + "☆☆☆☆☆".slice(0, 5 - Math.round(avg));
}
// promedio de estrellas (0 si no hay reseñas); sin argumento, el del perfil abierto (store.COMM)
export function rating(comm) {
  const reviews = (comm || store.COMM).reviews;
  if (reviews.length) {
    return reviews.reduce((sum, review) => sum + review.s, 0) / reviews.length;
  } else {
    return 0;
  }
}
// trabajos del prestador; edit = panel propio, con botones para borrar y subir
export function gallery(edit, comm) {
  comm = comm || store.COMM;
  const delBtn = (index) =>
    edit
      ? `<button class="gi-del" data-act="mediaDel" data-i="${index}" aria-label="Borrar trabajo">✕</button>`
      : "";
  return `<div class="gal">${comm.media.map((item, index) => (item.url ? (item.video ? `<div class="gi"><video src="${esc(item.url)}" controls playsinline></video>${delBtn(index)}</div>` : `<div class="gi"><img src="${esc(item.url)}" alt="${esc(item.label)}">${delBtn(index)}</div>`) : `<div class="gi gi-ph" style="--h:${+item.hue || 0}"><span>${item.video ? "▶ " : ""}${esc(item.label)}</span>${delBtn(index)}</div>`)).join("")}
   ${edit ? '<label class="gi gi-add" for="upMedia"><span>+<br>Subir trabajo</span></label>' : ""}</div>
   ${edit ? '<input id="upMedia" type="file" accept="image/*,video/*" multiple hidden>' : ""}`;
}
export function reviewsHtml(edit, comm) {
  comm = comm || store.COMM;
  if (comm.reviews.length) {
    return `<ul class="rv">${comm.reviews
      .map(
        (
          review,
          index,
        ) => `<li><div class="rv-h"><b>${esc(review.n)}</b><span class="st">${stars(review.s)}</span></div><p>${esc(review.t)}</p><span class="hint">${esc(review.d)}</span>
   ${review.reply ? `<div class="rv-r"><b>Respuesta:</b> ${esc(review.reply)}</div>` : edit ? `<div class="rv-form"><input id="rep${index}" placeholder="Responder…" autocomplete="off"><button class="btn btn-ghost" data-act="responder" data-i="${index}">Enviar</button></div>` : ""}</li>`,
      )
      .join("")}</ul>`;
  } else {
    return '<p class="note">Todavía no tiene reseñas.</p>';
  }
}

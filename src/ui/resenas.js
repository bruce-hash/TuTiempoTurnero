import { esc } from "../lib/dom.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { ic } from "./iconos.js";

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
  // C26 (V5): en el panel cada trabajo muestra su nombre y ✎ abre el editor (nombre y borrar, con confirmación)
  const delBtn = (index) =>
    edit
      ? `<button class="gi-del gi-ed" data-act="mediaEdit" data-i="${index}" aria-label="Editar o borrar ${esc(comm.media[index].label || "trabajo")}">${ic("editar")}</button>${comm.media[index].label && comm.media[index].url ? `<span class="gi-cap">${esc(comm.media[index].label)}</span>` : ""}`
      : "";
  return `<div class="gal">${comm.media.map((item, index) => (item.url ? (item.video ? `<div class="gi"><video src="${esc(item.url)}" controls playsinline></video>${delBtn(index)}</div>` : `<div class="gi"><img src="${esc(item.url)}" alt="${esc(item.label)}">${delBtn(index)}</div>`) : `<div class="gi gi-ph" style="--h:${+item.hue || 0}"><span>${item.video ? "▶ " : ""}${esc(item.label)}</span>${delBtn(index)}</div>`)).join("")}
   ${edit ? '<label class="gi gi-add" for="upMedia"><span>+<br>Subir trabajo</span></label>' : ""}</div>
   ${edit ? '<input id="upMedia" type="file" accept="image/*,video/*" multiple hidden>' : ""}${edit ? mediaEditor(comm) : ""}`;
}
// C26 (V5): el trabajo elegido con ✎: su nombre (lo ven tus clientes en tu perfil y en las historias) y borrarlo
function mediaEditor(comm) {
  const index = S.mediaEd;
  const item = index == null ? null : comm.media[index];
  if (!item) {
    return "";
  }
  if (S.mediaDelAsk === index) {
    return `<div class="movask mediaed"><div><b>¿Borrar ${item.label ? "«" + esc(item.label) + "»" : "este trabajo"}?</b><span>Sale de tu perfil y de tus historias. No se puede deshacer.</span></div><span style="display:flex;gap:6px"><button type="button" class="btn btn-ghost btn-sm" data-act="mediaDelNo">No</button><button type="button" class="btn btn-bad btn-sm" data-act="mediaDelYes" data-i="${index}">Sí, borrar</button></span></div>`;
  }
  return `<form id="fMedia" class="mediaed" data-i="${index}" novalidate>
   <div class="f"><label for="mdName">Nombre del trabajo</label><input id="mdName" maxlength="80" autocomplete="off" placeholder="Ej: Degradé con diseño" value="${esc(item.label || "")}"><span class="hint">Lo ven tus clientes debajo de la foto y en las historias. Podés dejarlo vacío.</span></div>
   <div class="rs-btns"><button type="button" class="btn btn-ghost" data-act="mediaEdClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar nombre</button></div>
   <button type="button" class="btn btn-ghost btn-block mediadel" data-act="mediaDel" data-i="${index}">${ic("borrar")} Borrar este trabajo</button></form>`;
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

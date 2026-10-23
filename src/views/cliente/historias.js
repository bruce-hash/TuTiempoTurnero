import { esc } from "../../lib/dom.js";
import { avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { comm } from "../prestador/comunidad.js";

store.STORY_T = null;
// historias: los trabajos del prestador a pantalla completa, uno tras otro (S.story = { pid, i })
export function vStory() {
  const story = S.story;
  if (!story) {
    return "";
  }
  const provComm = comm(story.pid);
  const prov = pr(story.pid);
  const media = provComm.media;
  const item = media[story.i];
  if (item) {
    return `<div class="story" role="dialog" aria-modal="true" aria-label="Trabajos de ${esc(prov.name)}">
   <div class="st-bars">${media.map((bar, index) => `<i class="${index < story.i ? "done" : index === story.i ? "run" : ""}"><b></b></i>`).join("")}</div>
   <div class="st-top">${avatar(prov)}<b>${esc(prov.name)}</b><span class="hint">${story.i + 1}/${media.length}</span><button class="st-x" data-act="storyClose" aria-label="Cerrar">✕</button></div>
   <div class="st-media">${item.url ? (item.video ? `<video src="${esc(item.url)}" autoplay muted playsinline></video>` : `<img src="${esc(item.url)}" alt="${esc(item.label)}">`) : `<div class="st-ph" style="--h:${+item.hue || 0}"><span>${esc(item.label)}</span></div>`}</div>
   ${item.label ? `<p class="st-cap">${esc(item.label)}</p>` : ""}
   <button class="st-nav st-prev" data-act="storyPrev" aria-label="Anterior"></button><button class="st-nav st-next" data-act="storyNext" aria-label="Siguiente"></button>
   <button class="btn btn-pri st-cta" data-act="storyBook">Reservar turno</button>
  </div>`;
  } else {
    S.story = null;
    return "";
  }
}
// pasa a la siguiente historia a los 5 segundos; después de la última, cierra
export function storyTick() {
  clearTimeout(store.STORY_T);
  if (S.story) {
    store.STORY_T = setTimeout(() => {
      if (!S.story) {
        return;
      }
      const media = comm(S.story.pid).media;
      if (S.story.i < media.length - 1) {
        S.story.i++;
      } else {
        S.story = null;
      }
      render();
    }, 5e3);
  }
}

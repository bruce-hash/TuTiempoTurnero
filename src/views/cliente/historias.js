import { esc } from "../../lib/dom.js";
import { avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { comm } from "../prestador/comunidad.js";

store.STORY_T = null;
export function vStory() {
  const e = S.story;
  if (!e) {
    return "";
  }
  const a = comm(e.pid);
  const t = pr(e.pid);
  const s = a.media;
  const n = s[e.i];
  if (n) {
    return `<div class="story" role="dialog" aria-modal="true" aria-label="Trabajos de ${esc(t.name)}">
   <div class="st-bars">${s.map((o, i) => `<i class="${i < e.i ? "done" : i === e.i ? "run" : ""}"><b></b></i>`).join("")}</div>
   <div class="st-top">${avatar(t)}<b>${esc(t.name)}</b><span class="hint">${e.i + 1}/${s.length}</span><button class="st-x" data-act="storyClose" aria-label="Cerrar">✕</button></div>
   <div class="st-media">${n.url ? (n.video ? `<video src="${esc(n.url)}" autoplay muted playsinline></video>` : `<img src="${esc(n.url)}" alt="${esc(n.label)}">`) : `<div class="st-ph" style="--h:${+n.hue || 0}"><span>${esc(n.label)}</span></div>`}</div>
   ${n.label ? `<p class="st-cap">${esc(n.label)}</p>` : ""}
   <button class="st-nav st-prev" data-act="storyPrev" aria-label="Anterior"></button><button class="st-nav st-next" data-act="storyNext" aria-label="Siguiente"></button>
   <button class="btn btn-pri st-cta" data-act="storyBook">Reservar turno</button>
  </div>`;
  } else {
    S.story = null;
    return "";
  }
}
export function storyTick() {
  clearTimeout(store.STORY_T);
  if (S.story) {
    store.STORY_T = setTimeout(() => {
      if (!S.story) {
        return;
      }
      const e = comm(S.story.pid).media;
      if (S.story.i < e.length - 1) {
        S.story.i++;
      } else {
        S.story = null;
      }
      render();
    }, 5e3);
  }
}

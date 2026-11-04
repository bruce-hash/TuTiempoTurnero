import { api } from "../../api/index.js";
import { esc, ini } from "../../lib/dom.js";
import { dayLabel, dm, fromMin, isoToLocal } from "../../lib/fechas.js";
import { nextGaps } from "../../lib/huecos.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";

// 4/11 · Bloque 3: Clientes → Seguidores. Quienes siguen al prestador ("Ana G.", con la foto y desde cuándo), cuántos son
// y, a cada uno, "Ofrecer turno": elige un hueco libre de los próximos 7 días y a esa persona le llega un aviso en la app
// y un push con el horario y "Reservar" (offer_slot). Seguir no lo suma a Clientes: Clientes son los que reservaron.
let loading = false;
export function loadFollowers(force) {
  if (loading || (store.FOLLOWERS && !force)) {
    return;
  }
  loading = true;
  api
    .followers()
    .catch(() => {
      store.FOLLOWERS = store.FOLLOWERS || [];
    })
    .finally(() => {
      loading = false;
      render();
    });
}
const sinceTxt = (iso) => "Te sigue desde el " + dm(isoToLocal(iso).date);
const avatarOf = (fol) =>
  fol.photo
    ? `<img class="av" src="${esc(fol.photo)}" alt="" loading="lazy">`
    : `<span class="av" style="background:hsl(${(fol.name.charCodeAt(0) * 37) % 360} 55% 45%)">${ini(fol.name)}</span>`;
// los huecos de los próximos días para ofrecerle a un seguidor (los ya ofrecidos a esa persona, marcados)
function offerPicker(fol) {
  const gaps = nextGaps(7);
  return `<div class="folpick"><p class="lbl" style="margin:0 0 6px">Elegí un turno libre para ofrecerle a ${esc(fol.name)}</p>${
    gaps.length
      ? `<div class="folgaps">${gaps
          .map(({ day, from, to }) => {
            const key = day + "|" + fromMin(from);
            const done = S.offeredTo[fol.id + "|" + key];
            return `<button type="button" class="slot" data-act="folOfferGo" data-id="${esc(fol.id)}" data-g="${key}" data-z="${fromMin(to)}" ${done ? "disabled" : ""}>${esc(dayLabel(day, true))} · ${fromMin(from)}–${fromMin(to)}${done ? " ✓" : ""}</button>`;
          })
          .join("")}</div>`
      : '<p class="note" style="text-align:left">No tenés huecos libres en los próximos 7 días.</p>'
  }<button type="button" class="lnk" data-act="folOfferClose" style="margin-top:6px">Cerrar</button></div>`;
}
export function vSeguidores() {
  const list = store.FOLLOWERS;
  if (list == null) {
    loadFollowers();
  }
  const count = store.COMM.followers || 0;
  const clients = (list || []).filter((fol) => fol.client).length;
  return `<div class="stats2"><div><b>${count}</b><span>Seguidores</span></div><div><b>${clients}</b><span>Ya reservaron</span></div></div>
  <div class="panel">
   <p class="note" style="text-align:left;margin:0 0 10px">Te siguen desde tu perfil. Cuando ofrecés un hueco en la Agenda les llega un aviso en la app y una notificación para reservarlo. También podés ofrecerle un turno a una persona.</p>
   ${
     list == null
       ? '<div class="skel" style="min-height:120px"></div>'
       : list.length
         ? `<ul class="clist folist">${list
             .map(
               (fol) =>
                 `<li><div class="crow">${avatarOf(fol)}<span class="cr-m"><b>${esc(fol.name)}</b><span>${sinceTxt(fol.since)}${fol.client ? " · ya reservó" : ""}</span></span><span class="cr-r"><button type="button" class="btn btn-ghost btn-sm" data-act="folOffer" data-id="${esc(fol.id)}" ${S.offerFor === fol.id ? 'aria-expanded="true"' : ""}>📣 Ofrecer</button></span></div>${S.offerFor === fol.id ? offerPicker(fol) : ""}</li>`,
             )
             .join("")}</ul>${count > list.length ? `<p class="note">Se muestran los últimos ${list.length}.</p>` : ""}`
         : '<p class="note">Todavía no te sigue nadie. Compartí tu perfil (el QR está en Perfil) para que te sigan y te enteres cuando tengas lugar.</p>'
   }
  </div>`;
}

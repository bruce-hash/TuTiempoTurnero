import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { errMsg } from "../../lib/errores.js";
import { dayLabel } from "../../lib/fechas.js";
import { FOLLOW, avatar, ph, pr } from "../../lib/prestadores.js";
import { CAT, RAMP, catInfo, catName, pcat } from "../../lib/rubros.js";
import { svcMeta } from "../../lib/servicios.js";
import { cfg } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { bookBar } from "../../ui/bookbar.js";
import { vPicker } from "../../ui/picker.js";
import { render } from "../../ui/render.js";
import { rating, reviewsHtml } from "../../ui/resenas.js";
import { myStamps, stampBox, stampEarns, stampGoal, svcByKey } from "../../ui/sellos.js";
import { toast } from "../../ui/toast.js";
import { comm } from "../prestador/comunidad.js";

// en vivo el listado trae datos resumidos: el perfil completo se pide al abrirlo
async function ensureProvider(id) {
  if (!LIVE) {
    return;
  }
  const prov = pr(id);
  if ((!prov || !prov.full) && S.pLoading != id) {
    S.pLoading = id;
    try {
      await api.loadProvider(id);
    } catch (err) {
      toast(errMsg(err));
    } finally {
      S.pLoading = null;
    }
    render();
  }
}
// perfil del prestador para el cliente: cabecera, pestañas (servicios con selector de horario, trabajos, reseñas).
// Si se llega desde “Reservar mi premio”, preselecciona el servicio del premio.
export function vPerfil() {
  const prov = pr(S.pid);
  if (LIVE && (!prov || !prov.full)) {
    ensureProvider(S.pid);
    return '<div class="narrow stack" style="margin-top:20px"><div class="skel" style="min-height:220px"></div><div class="skel" style="min-height:160px"></div></div>';
  }
  if (!prov || prov.deleted) {
    return '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Este perfil ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Ver otros profesionales</button></div></div>';
  }
  if (S.svc >= prov.svcs.length) {
    S.svc = 0;
  }
  if (S.rewardFor && S.rewardFor.pid === prov.id) {
    const rewardSvc = svcByKey(prov, S.rewardFor.sk);
    S.rewardFor = null;
    if (rewardSvc) {
      S.svc = prov.svcs.indexOf(rewardSvc);
    }
  }
  const seg = pcat(prov, S.pctx);
  const conf = cfg(prov.id);
  const happyOn = conf.on && conf.happy.on;
  const provComm = comm(prov.id);
  const following = LIVE ? !!FOLLOW[prov.id] : (S.followingBy || {})[prov.id];
  const tab = S.ptab || "svc";
  const nMedia = provComm.media.length;
  const nReviews = provComm.reviews.length;
  // servicios agrupados por rubro, con su índice en prov.svcs
  const groups = prov.cats
    .map((cat) => [cat, prov.svcs.map((svc, index) => [svc, index]).filter(([svc]) => svc[3] === cat)])
    .filter((group) => group[1].length);
  const svcBtn = ([svc, index]) =>
    `<button class="svci" data-svc="${index}" aria-pressed="${index === S.svc}"><span><b>${esc(svc[0])}</b><small>${svc[1]} min${happyOn ? ` · ${money(Math.round(svc[2] * (1 - conf.happy.pct / 100)))} en happy hour` : ""}${stampEarns(prov.id, svc) ? (S.user ? ` · 🎟️ ${Math.min(myStamps(prov.id, svc), stampGoal(prov.id, svc))}/${stampGoal(prov.id, svc)}` : " · 🎟️ suma sello") : ""}</small></span><span class="price">${money(svc[2])}</span></button>`;
  const head = `<div class="phero">${ph(prov, "prof-ph")}
     <button class="pav ${nMedia ? "ring" : ""}" ${nMedia ? `data-act="story" data-i="0" aria-label="Ver trabajos de ${esc(prov.name)}"` : 'tabindex="-1" aria-hidden="true"'}>${avatar(prov, "av-xl")}</button></div>
   <div class="panel pcard">
    <h1 class="h1">${esc(prov.name)}</h1>
    <div class="prow"><div class="cchips">${prov.cats.map((cat) => `<button class="cchip seg-${cat}" data-pctx="${cat}" aria-pressed="${cat === seg}">${CAT[cat] ? catInfo(cat).ic : ""} ${esc(catName(cat))}</button>`).join("")}</div>
     <button class="btn btn-sm ${following ? "btn-ghost" : "btn-pri"} folbtn" data-act="seguir" aria-pressed="${!!following}">${following ? "✓ Siguiendo" : "+ Seguir"}</button></div>
    ${prov.bio ? `<p class="pbio">${esc(prov.bio)}</p>` : ""}
    <div class="pstats"><span><b>★ ${rating(provComm).toFixed(1)}</b> ${nReviews} reseña${nReviews === 1 ? "" : "s"}</span><span><b>${provComm.followers}</b> seguidores</span><span><b>${nMedia}</b> trabajos</span></div>
    <div class="chips" style="margin-top:8px"><span class="chip ok">Identidad verificada</span>${prov.ig ? `<span class="chip">Instagram: ${esc(prov.ig)}</span>` : ""}</div>
    <dl class="kv" style="margin-top:12px"><dt>Dirección</dt><dd>${esc(prov.addr)}</dd><dt>Pago</dt><dd>Seña con Mercado Pago${conf.cash !== false ? " · resto en efectivo o Mercado Pago" : ""}</dd></dl>
   </div>
   <div class="ptabs" role="tablist">${[
     ["svc", "Servicios"],
     ["works", "Trabajos" + (nMedia ? ` · ${nMedia}` : "")],
     ["reviews", "Reseñas" + (nReviews ? ` · ${nReviews}` : "")],
   ]
     .map(
       ([id, label]) =>
         `<button role="tab" data-act="ptab" data-t="${id}" aria-selected="${tab === id}">${label}</button>`,
     )
     .join("")}</div>`;
  let body = "";
  if (tab === "works") {
    body = `<div class="panel">${
      nMedia
        ? `<div class="gal">${provComm.media.map((item, index) => `<button class="gi" data-act="story" data-i="${index}" aria-label="Ver ${esc(item.label || "trabajo")}">${item.url ? (item.video ? `<video src="${esc(item.url)}" muted playsinline preload="metadata"></video><span class="gi-play">▶</span>` : `<img src="${esc(item.url)}" alt="${esc(item.label)}" loading="lazy">`) : `<span class="gi-ph" style="--h:${+item.hue || 0}"><span>${item.video ? "▶ " : ""}${esc(item.label)}</span></span>`}</button>`).join("")}</div>
      <p class="note" style="margin:10px 0 0">Tocá una foto para verlas como historia.</p>`
        : '<p class="note">Todavía no subió trabajos.</p>'
    }</div>`;
  } else if (tab === "reviews") {
    const toRate = S.user ? store.BOOK.find((booking) => booking.mine && booking.pid == prov.id && booking.status === "done" && !booking.reviewed) : null;
    body = `<div class="panel rvhead"><div><b class="rvbig">★ ${rating(provComm).toFixed(1)}</b><span class="hint">${nReviews} reseña${nReviews === 1 ? "" : "s"} de clientes que fueron</span></div></div>
     ${toRate ? `<div class="panel"><p class="lbl">Calificá tu turno del ${esc(dayLabel(toRate.date))}</p>${rateForm(toRate)}</div>` : `<p class="note">${S.user ? "Después de tu turno vas a poder dejar tu reseña acá." : "Las reseñas las dejan clientes que fueron. Ingresá después de tu turno para calificar."}</p>`}
     <div class="panel">${reviewsHtml(false, provComm)}</div>`;
  } else {
    body = prov.svcs.length
      ? `${prov.cats.length > 1 ? `<p class="note" style="margin:0">Hace ${prov.cats.length} rubros: todos sus servicios están acá, con una sola agenda.</p>` : ""}<div><p class="lbl">1 · Elegí el servicio</p><div class="stack" style="gap:10px">
    ${groups.map(([cat, items]) => `<div class="sgroup seg-${cat}"><p class="sg-h">${CAT[cat] ? catInfo(cat).ic : ""} ${esc(catName(cat))}${RAMP}</p>${items.map(svcBtn).join("")}</div>`).join("")}
   </div></div>
   ${stampBox(prov)}
   ${(() => {
     const svc = prov.svcs[S.svc];
     const meta = svcMeta(svc);
     if (meta.note) {
       return `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(meta.note)}</p></div>`;
     } else {
       return "";
     }
   })()}
   ${vPicker(prov)}
   ${bookBar(prov)}`
      : '<div class="panel" style="text-align:center"><p class="note">Todavía no cargó sus servicios. Seguilo para enterarte cuando abra su agenda.</p></div>';
  }
  return `<button class="back" data-go="home">← Volver</button>
  <div class="narrow stack">
   ${S.reprog ? '<div class="okbanner" style="background:var(--brand-soft);color:var(--fg)">Elegí el nuevo horario para tu turno <button class="lnk" data-act="reprogCancel">Volver</button></div>' : ""}
   ${head}${body}
  </div>`;
}
// formulario de reseña de un turno hecho (estrellas y texto)
export function rateForm(booking) {
  if (S.rateFor === booking.id) {
    return `<div class="rateform"><div class="stars5">${[1, 2, 3, 4, 5].map((stars) => `<button type="button" data-rate="${stars}" aria-label="${stars} estrellas" class="${stars <= (S.rateN || 0) ? "on" : ""}">★</button>`).join("")}</div><textarea id="rateTxt" maxlength="600" placeholder="¿Cómo te atendieron? (opcional)"></textarea><button class="btn btn-pri" data-act="sendReview" data-id="${booking.id}" ${S.rateN ? "" : "disabled"}>Publicar reseña</button></div>`;
  } else {
    return `<button class="btn btn-ghost btn-block" data-act="rateOpen" data-id="${booking.id}">★ Escribir reseña</button>`;
  }
}

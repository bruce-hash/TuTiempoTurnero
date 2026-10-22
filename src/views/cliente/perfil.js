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

async function ensureProvider(id) {
  if (!LIVE) {
    return;
  }
  const a = pr(id);
  if ((!a || !a.full) && S.pLoading != id) {
    S.pLoading = id;
    try {
      await api.loadProvider(id);
    } catch (t) {
      toast(errMsg(t));
    } finally {
      S.pLoading = null;
    }
    render();
  }
}
export function vPerfil() {
  const e = pr(S.pid);
  if (LIVE && (!e || !e.full)) {
    ensureProvider(S.pid);
    return '<div class="narrow stack" style="margin-top:20px"><div class="skel" style="min-height:220px"></div><div class="skel" style="min-height:160px"></div></div>';
  }
  if (!e || e.deleted) {
    return '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Este perfil ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Ver otros profesionales</button></div></div>';
  }
  if (S.svc >= e.svcs.length) {
    S.svc = 0;
  }
  if (S.rewardFor && S.rewardFor.pid === e.id) {
    const k = svcByKey(e, S.rewardFor.sk);
    S.rewardFor = null;
    if (k) {
      S.svc = e.svcs.indexOf(k);
    }
  }
  const a = pcat(e, S.pctx);
  const t = cfg(e.id);
  const s = t.on && t.happy.on;
  const n = comm(e.id);
  const o = LIVE ? !!FOLLOW[e.id] : (S.followingBy || {})[e.id];
  const i = S.ptab || "svc";
  const l = n.media.length;
  const c = n.reviews.length;
  const d = e.cats
    .map((k) => [k, e.svcs.map((h, j) => [h, j]).filter(([h]) => h[3] === k)])
    .filter((k) => k[1].length);
  const p = ([k, h]) =>
    `<button class="svci" data-svc="${h}" aria-pressed="${h === S.svc}"><span><b>${esc(k[0])}</b><small>${k[1]} min${s ? ` · ${money(Math.round(k[2] * (1 - t.happy.pct / 100)))} en happy hour` : ""}${stampEarns(e.id, k) ? (S.user ? ` · 🎟️ ${Math.min(myStamps(e.id, k), stampGoal(e.id, k))}/${stampGoal(e.id, k)}` : " · 🎟️ suma sello") : ""}</small></span><span class="price">${money(k[2])}</span></button>`;
  const w = `<div class="phero">${ph(e, "prof-ph")}
     <button class="pav ${l ? "ring" : ""}" ${l ? `data-act="story" data-i="0" aria-label="Ver trabajos de ${esc(e.name)}"` : 'tabindex="-1" aria-hidden="true"'}>${avatar(e, "av-xl")}</button></div>
   <div class="panel pcard">
    <h1 class="h1">${esc(e.name)}</h1>
    <div class="prow"><div class="cchips">${e.cats.map((k) => `<button class="cchip seg-${k}" data-pctx="${k}" aria-pressed="${k === a}">${CAT[k] ? catInfo(k).ic : ""} ${esc(catName(k))}</button>`).join("")}</div>
     <button class="btn btn-sm ${o ? "btn-ghost" : "btn-pri"} folbtn" data-act="seguir" aria-pressed="${!!o}">${o ? "✓ Siguiendo" : "+ Seguir"}</button></div>
    ${e.bio ? `<p class="pbio">${esc(e.bio)}</p>` : ""}
    <div class="pstats"><span><b>★ ${rating(n).toFixed(1)}</b> ${c} reseña${c === 1 ? "" : "s"}</span><span><b>${n.followers}</b> seguidores</span><span><b>${l}</b> trabajos</span></div>
    <div class="chips" style="margin-top:8px"><span class="chip ok">Identidad verificada</span>${e.ig ? `<span class="chip">Instagram: ${esc(e.ig)}</span>` : ""}</div>
    <dl class="kv" style="margin-top:12px"><dt>Dirección</dt><dd>${esc(e.addr)}</dd><dt>Pago</dt><dd>Seña con Mercado Pago${t.cash !== false ? " · resto en efectivo o Mercado Pago" : ""}</dd></dl>
   </div>
   <div class="ptabs" role="tablist">${[
     ["svc", "Servicios"],
     ["works", "Trabajos" + (l ? ` · ${l}` : "")],
     ["reviews", "Reseñas" + (c ? ` · ${c}` : "")],
   ]
     .map(
       ([k, h]) =>
         `<button role="tab" data-act="ptab" data-t="${k}" aria-selected="${i === k}">${h}</button>`,
     )
     .join("")}</div>`;
  let y = "";
  if (i === "works") {
    y = `<div class="panel">${
      l
        ? `<div class="gal">${n.media.map((k, h) => `<button class="gi" data-act="story" data-i="${h}" aria-label="Ver ${esc(k.label || "trabajo")}">${k.url ? (k.video ? `<video src="${esc(k.url)}" muted playsinline preload="metadata"></video><span class="gi-play">▶</span>` : `<img src="${esc(k.url)}" alt="${esc(k.label)}" loading="lazy">`) : `<span class="gi-ph" style="--h:${+k.hue || 0}"><span>${k.video ? "▶ " : ""}${esc(k.label)}</span></span>`}</button>`).join("")}</div>
      <p class="note" style="margin:10px 0 0">Tocá una foto para verlas como historia.</p>`
        : '<p class="note">Todavía no subió trabajos.</p>'
    }</div>`;
  } else if (i === "reviews") {
    const k = S.user ? store.BOOK.find((h) => h.mine && h.pid == e.id && h.status === "done" && !h.reviewed) : null;
    y = `<div class="panel rvhead"><div><b class="rvbig">★ ${rating(n).toFixed(1)}</b><span class="hint">${c} reseña${c === 1 ? "" : "s"} de clientes que fueron</span></div></div>
     ${k ? `<div class="panel"><p class="lbl">Calificá tu turno del ${esc(dayLabel(k.date))}</p>${rateForm(k)}</div>` : `<p class="note">${S.user ? "Después de tu turno vas a poder dejar tu reseña acá." : "Las reseñas las dejan clientes que fueron. Ingresá después de tu turno para calificar."}</p>`}
     <div class="panel">${reviewsHtml(false, n)}</div>`;
  } else {
    y = e.svcs.length
      ? `${e.cats.length > 1 ? `<p class="note" style="margin:0">Hace ${e.cats.length} rubros: todos sus servicios están acá, con una sola agenda.</p>` : ""}<div><p class="lbl">1 · Elegí el servicio</p><div class="stack" style="gap:10px">
    ${d.map(([k, h]) => `<div class="sgroup seg-${k}"><p class="sg-h">${CAT[k] ? catInfo(k).ic : ""} ${esc(catName(k))}${RAMP}</p>${h.map(p).join("")}</div>`).join("")}
   </div></div>
   ${stampBox(e)}
   ${(() => {
     const k = e.svcs[S.svc];
     const h = svcMeta(k);
     if (h.note) {
       return `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(h.note)}</p></div>`;
     } else {
       return "";
     }
   })()}
   ${vPicker(e)}
   ${bookBar(e)}`
      : '<div class="panel" style="text-align:center"><p class="note">Todavía no cargó sus servicios. Seguilo para enterarte cuando abra su agenda.</p></div>';
  }
  return `<button class="back" data-go="home">← Volver</button>
  <div class="narrow stack">
   ${S.reprog ? '<div class="okbanner" style="background:var(--brand-soft);color:var(--fg)">Elegí el nuevo horario para tu turno <button class="lnk" data-act="reprogCancel">Volver</button></div>' : ""}
   ${w}${y}
  </div>`;
}
export function rateForm(e) {
  if (S.rateFor === e.id) {
    return `<div class="rateform"><div class="stars5">${[1, 2, 3, 4, 5].map((a) => `<button type="button" data-rate="${a}" aria-label="${a} estrellas" class="${a <= (S.rateN || 0) ? "on" : ""}">★</button>`).join("")}</div><textarea id="rateTxt" maxlength="600" placeholder="¿Cómo te atendieron? (opcional)"></textarea><button class="btn btn-pri" data-act="sendReview" data-id="${e.id}" ${S.rateN ? "" : "disabled"}>Publicar reseña</button></div>`;
  } else {
    return `<button class="btn btn-ghost btn-block" data-act="rateOpen" data-id="${e.id}">★ Escribir reseña</button>`;
  }
}

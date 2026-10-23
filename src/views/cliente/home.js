import { api } from "../../api/index.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { errMsg } from "../../lib/errores.js";
import { TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { ph, pr } from "../../lib/prestadores.js";
import { CAT, CATS, RAMP, catInfo, catName, pcat } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { cardInfo } from "../../ui/tarjetas.js";

// turnos confirmados del cliente que todavía no pasaron, del más cercano al más lejano
export function myUpcoming() {
  if (!S.user) {
    return [];
  }
  const now = TODAY() + nowHM();
  return store.BOOK.filter((booking) => booking.mine && booking.status === "confirmed" && booking.date + booking.time >= now).sort((one, other) =>
    (one.date + one.time).localeCompare(other.date + other.time),
  );
}
const listKey = () => (S.cat || "todos") + "|" + (S.q || "");
// listado de prestadores por rubro y búsqueda, por páginas (more = la página siguiente).
// Si mientras tanto cambió el rubro o la búsqueda, la respuesta vieja se descarta.
export async function loadList(more) {
  const key = listKey();
  if (S.listBusy !== key + (more ? "+" : "")) {
    S.listBusy = key + (more ? "+" : "");
    if (more) {
      S.list.loadingMore = true;
    } else {
      S.list = {
        key: key,
        items: [],
        next: null,
        loading: true,
      };
    }
    try {
      const res = await api.listProviders({
        cat: S.cat || "todos",
        q: S.q,
        after: more ? S.list.next : null,
      });
      if (listKey() !== key) {
        return;
      }
      S.list = {
        key: key,
        items: (more ? S.list.items : []).concat(res.items),
        next: res.next,
        loading: false,
      };
    } catch (err) {
      if (listKey() === key) {
        S.list = {
          key: key,
          items: more ? S.list.items : [],
          next: null,
          loading: false,
          error: errMsg(err),
        };
      }
    } finally {
      S.listBusy = null;
    }
    if (S.role === "cliente" && (S.view === "home" || !S.view)) {
      render();
    }
  }
}
async function loadCounts() {
  try {
    S.counts = await api.counts();
  } catch (err) {
    S.counts = S.counts || {};
  }
  if (S.role === "cliente" && S.view === "home") {
    render();
  }
}
// inicio: próximo turno, buscador, rubros con su cantidad de prestadores y el listado
export function vHome() {
  const cat = S.cat || "todos";
  const key = listKey();
  if (!S.counts) {
    loadCounts();
  }
  if (!S.list || S.list.key !== key) {
    loadList(false);
  }
  const list =
    S.list && S.list.key === key
      ? S.list
      : {
          items: [],
          loading: true,
        };
  const countOf = (catId) => (S.counts ? S.counts[catId] || 0 : "…");
  const card = (prov) => {
    const seg = pcat(prov, cat === "todos" ? null : cat);
    const info = cardInfo(prov, cat === "todos" ? null : seg);
    return `<article class="card seg-${seg}">${ph(prov, "")}<div class="cb"><div class="cchips">${prov.cats.map((catId) => `<span class="cchip seg-${catId}">${CAT[catId] ? catInfo(catId).ic : ""} ${esc(catName(catId))}</span>`).join("")}</div><h3>${esc(prov.name)}</h3>
    <div class="addr">${esc(prov.addr)}</div>
    <div class="pbox"><span class="plabel">Desde · ${esc(info.minName)}</span><span class="price">${money(info.min)}</span></div>
    <div class="nextt">${info.next ? `Próximo turno: <b>${esc(dayLabel(info.next.date))} ${info.next.time}</b>` : "Sin turnos libres esta semana"}${info.happy ? `<span class="hhtag">-${info.happy}% happy hour</span>` : ""}</div>
    <button class="btn btn-pri" data-go="perfil" data-id="${prov.id}" data-ctx="${seg}">Reservar turno</button></div></article>`;
  };
  const next = myUpcoming()[0];
  const segTile = (catId) =>
    `<button class="segtile seg-${catId}" data-cat="${cat === catId ? "todos" : catId}" aria-pressed="${cat === catId}"><span class="st-k">${catInfo(catId).ic}</span><b>${catInfo(catId).name}</b><span>${countOf(catId)} con turnos online</span><em>${cat === catId ? "✓ Elegido" : "Ver"}</em>${RAMP}</button>`;
  const title = S.q
    ? `Resultados para “${esc(S.q)}”`
    : cat === "todos"
      ? "Todos los profesionales"
      : catInfo(cat).name;
  return `${
    next
      ? `<button class="nextbar seg-${
          (
            pr(next.pid) || {
              cats: ["n"],
            }
          ).cats[0]
        }" data-act="verTurno" data-id="${next.id}"><span>📅</span><span class="nb-t">Tu próximo turno: <b>${esc(dayLabel(next.date, true))} · ${next.time}</b> en ${esc((pr(next.pid) || {}).name || "")}</span><span class="nb-go">Ver ›</span></button>`
      : ""
  }
  <section class="hero"><span class="tag">Olavarría · ${cat === "todos" ? "Turnos online" : esc(catInfo(cat).name)}</span>
  <h1>Reservá tu turno <em>en segundos</em></h1>
  <p>${cat === "todos" ? "Barberías, peluquerías, masajes, pestañas, uñas y depilación" : esc(catInfo(cat).name)}. Elegí día y horario, pagá la seña con Mercado Pago y el resto como prefieras.</p>
  <form class="srch" id="fSearch" role="search"><input id="q" type="search" placeholder="Buscá un servicio o un nombre" value="${esc(S.q)}" autocomplete="off" aria-label="Buscar"><button class="btn btn-pri" type="submit">Buscar</button></form>
  <div class="segpick" role="group" aria-label="Rubros">${CATS.map((row) => segTile(row[0])).join("")}</div>
  ${cat !== "todos" || S.q ? `<button class="hero-all" data-act="verTodos">Ver todos los profesionales (${countOf("todos")})</button>` : ""}
  </section>
  <section class="sec">
   <div class="sec-h"><h2>${title}</h2></div>
   <p class="note" style="margin:0 0 14px">${list.loading ? "Cargando…" : `${list.items.length}${list.next ? "+" : ""} con turnos online`} · primero los más activos: los que más servicios hicieron en los últimos 30 días.</p>
   ${list.loading ? `<div class="grid">${'<div class="skel"></div>'.repeat(3)}</div>` : list.error ? `<p class="empty">${esc(list.error)} <button class="lnk" data-act="reloadList">Reintentar</button></p>` : list.items.length ? `<div class="grid">${list.items.map(card).join("")}</div>${list.next ? `<button class="btn btn-ghost more" data-act="moreList" ${list.loadingMore ? "disabled" : ""}>${list.loadingMore ? "Cargando…" : "Ver más"}</button>` : ""}` : `<p class="empty">${S.q ? "No encontramos profesionales con esa búsqueda." : "Todavía no hay profesionales en este rubro."}</p>`}
  </section>`;
}

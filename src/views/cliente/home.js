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

export function myUpcoming() {
  if (!S.user) {
    return [];
  }
  const e = TODAY() + nowHM();
  return store.BOOK.filter((a) => a.mine && a.status === "confirmed" && a.date + a.time >= e).sort((a, t) =>
    (a.date + a.time).localeCompare(t.date + t.time),
  );
}
const listKey = () => (S.cat || "todos") + "|" + (S.q || "");
export async function loadList(more) {
  const a = listKey();
  if (S.listBusy !== a + (more ? "+" : "")) {
    S.listBusy = a + (more ? "+" : "");
    if (more) {
      S.list.loadingMore = true;
    } else {
      S.list = {
        key: a,
        items: [],
        next: null,
        loading: true,
      };
    }
    try {
      const t = await api.listProviders({
        cat: S.cat || "todos",
        q: S.q,
        after: more ? S.list.next : null,
      });
      if (listKey() !== a) {
        return;
      }
      S.list = {
        key: a,
        items: (more ? S.list.items : []).concat(t.items),
        next: t.next,
        loading: false,
      };
    } catch (t) {
      if (listKey() === a) {
        S.list = {
          key: a,
          items: more ? S.list.items : [],
          next: null,
          loading: false,
          error: errMsg(t),
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
  } catch (e) {
    S.counts = S.counts || {};
  }
  if (S.role === "cliente" && S.view === "home") {
    render();
  }
}
export function vHome() {
  const e = S.cat || "todos";
  const a = listKey();
  if (!S.counts) {
    loadCounts();
  }
  if (!S.list || S.list.key !== a) {
    loadList(false);
  }
  const t =
    S.list && S.list.key === a
      ? S.list
      : {
          items: [],
          loading: true,
        };
  const s = (c) => (S.counts ? S.counts[c] || 0 : "…");
  const n = (c) => {
    const d = pcat(c, e === "todos" ? null : e);
    const p = cardInfo(c, e === "todos" ? null : d);
    return `<article class="card seg-${d}">${ph(c, "")}<div class="cb"><div class="cchips">${c.cats.map((w) => `<span class="cchip seg-${w}">${CAT[w] ? catInfo(w).ic : ""} ${esc(catName(w))}</span>`).join("")}</div><h3>${esc(c.name)}</h3>
    <div class="addr">${esc(c.addr)}</div>
    <div class="pbox"><span class="plabel">Desde · ${esc(p.minName)}</span><span class="price">${money(p.min)}</span></div>
    <div class="nextt">${p.next ? `Próximo turno: <b>${esc(dayLabel(p.next.date))} ${p.next.time}</b>` : "Sin turnos libres esta semana"}${p.happy ? `<span class="hhtag">-${p.happy}% happy hour</span>` : ""}</div>
    <button class="btn btn-pri" data-go="perfil" data-id="${c.id}" data-ctx="${d}">Reservar turno</button></div></article>`;
  };
  const o = myUpcoming()[0];
  const i = (c) =>
    `<button class="segtile seg-${c}" data-cat="${e === c ? "todos" : c}" aria-pressed="${e === c}"><span class="st-k">${catInfo(c).ic}</span><b>${catInfo(c).name}</b><span>${s(c)} con turnos online</span><em>${e === c ? "✓ Elegido" : "Ver"}</em>${RAMP}</button>`;
  const l = S.q
    ? `Resultados para “${esc(S.q)}”`
    : e === "todos"
      ? "Todos los profesionales"
      : catInfo(e).name;
  return `${
    o
      ? `<button class="nextbar seg-${
          (
            pr(o.pid) || {
              cats: ["n"],
            }
          ).cats[0]
        }" data-act="verTurno" data-id="${o.id}"><span>📅</span><span class="nb-t">Tu próximo turno: <b>${esc(dayLabel(o.date, true))} · ${o.time}</b> en ${esc((pr(o.pid) || {}).name || "")}</span><span class="nb-go">Ver ›</span></button>`
      : ""
  }
  <section class="hero"><span class="tag">Olavarría · ${e === "todos" ? "Turnos online" : esc(catInfo(e).name)}</span>
  <h1>Reservá tu turno <em>en segundos</em></h1>
  <p>${e === "todos" ? "Barberías, peluquerías, masajes, pestañas, uñas y depilación" : esc(catInfo(e).name)}. Elegí día y horario, pagá la seña con Mercado Pago y el resto como prefieras.</p>
  <form class="srch" id="fSearch" role="search"><input id="q" type="search" placeholder="Buscá un servicio o un nombre" value="${esc(S.q)}" autocomplete="off" aria-label="Buscar"><button class="btn btn-pri" type="submit">Buscar</button></form>
  <div class="segpick" role="group" aria-label="Rubros">${CATS.map((c) => i(c[0])).join("")}</div>
  ${e !== "todos" || S.q ? `<button class="hero-all" data-act="verTodos">Ver todos los profesionales (${s("todos")})</button>` : ""}
  </section>
  <section class="sec">
   <div class="sec-h"><h2>${l}</h2></div>
   <p class="note" style="margin:0 0 14px">${t.loading ? "Cargando…" : `${t.items.length}${t.next ? "+" : ""} con turnos online`} · primero los más activos: los que más servicios hicieron en los últimos 30 días.</p>
   ${t.loading ? `<div class="grid">${'<div class="skel"></div>'.repeat(3)}</div>` : t.error ? `<p class="empty">${esc(t.error)} <button class="lnk" data-act="reloadList">Reintentar</button></p>` : t.items.length ? `<div class="grid">${t.items.map(n).join("")}</div>${t.next ? `<button class="btn btn-ghost more" data-act="moreList" ${t.loadingMore ? "disabled" : ""}>${t.loadingMore ? "Cargando…" : "Ver más"}</button>` : ""}` : `<p class="empty">${S.q ? "No encontramos profesionales con esa búsqueda." : "Todavía no hay profesionales en este rubro."}</p>`}
  </section>`;
}

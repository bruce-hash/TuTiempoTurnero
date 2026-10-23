import { api } from "../../api/index.js";
import { liveApi } from "../../api/live/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MESES, NOW, TODAY, dayLabel, longLabel, nowHM, pad } from "../../lib/fechas.js";
import { ME } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";

store.FIN = [];
store.GASTOS = [];
store.GID = 1;
store.CLOSINGS = {};
export const ymk = (e) => e.slice(0, 7);
export const feeOf = (e) => e.feeIn || 0;
export const YEARS = () => {
  const e = NOW().getFullYear();
  const a = [];
  for (let t = e - 1; t <= Math.max(2028, e); t++) {
    a.push(t);
  }
  return a;
};
export function dayLines(e) {
  const a = [];
  store.BOOK.filter((t) => t.pid == ME() && t.date === e && t.status === "done" && t.type !== "block")
    .sort((t, s) => t.time.localeCompare(s.time))
    .forEach((t) => {
      if (t.src === "app") {
        const s = (t.paid || 0) - feeOf(t);
        if (s > 0) {
          a.push({
            h: t.time,
            t: "Seña · " + t.cliente,
            s: t.svc,
            m: s,
            medio: "Mercado Pago",
          });
        }
        const n = Math.max(0, (t.price || 0) - (t.paid || 0));
        if (n > 0) {
          a.push({
            h: t.time,
            t: "Resto · " + t.cliente,
            s: t.svc,
            m: n,
            medio: t.pay === "cash" ? "Efectivo" : "Mercado Pago",
          });
        }
      } else {
        a.push({
          h: t.time,
          t: t.cliente || "Cliente",
          s: t.svc,
          m: t.price || 0,
          medio: "Efectivo",
        });
      }
    });
  if (e === TODAY()) {
    S.walk.forEach((t) =>
      a.push({
        h: t.hora,
        t: t.kind === "prod" ? t.svc : t.cliente || "Sin turno",
        s: t.kind === "prod" ? "Venta de producto" : t.svc,
        m: t.precio + (t.propina || 0),
        medio: t.medio,
      }),
    );
  }
  return a.sort((t, s) => String(t.h).localeCompare(String(s.h)));
}
export const finTot = (e) => e.app + e.man + e.walk + e.prod;
export function closeDay(e, a, t, s, n) {
  const o = {
    income: a,
    cash: t,
    mp: s,
    counted: n == null ? null : n,
    at: nowHM(),
  };
  store.CLOSINGS["day|" + e] = o;
  api.m.closeCash("day", e, o);
}
function todayFin() {
  const e = TODAY();
  const a = store.BOOK.filter((s) => s.date === e && s.status === "done");
  const t = {
    date: e,
    app: 0,
    man: 0,
    walk: 0,
    prod: 0,
  };
  a.forEach((s) => {
    if (s.pid == ME()) {
      if (s.src === "app") {
        t.app += (s.price || 0) - feeOf(s);
      } else {
        t.man += s.price || 0;
      }
    }
  });
  S.walk.forEach((s) => {
    if (s.kind === "prod") {
      t.prod += s.precio;
    } else {
      t.walk += s.precio + s.propina;
    }
  });
  return t;
}
export function monthTotals(e, a) {
  const t = NOW().getFullYear();
  const s = NOW().getMonth();
  if (e > t || (e === t && a > s)) {
    return null;
  }
  const n = e + "-" + pad(a + 1);
  const o = store.GASTOS.filter((d) => d.d.slice(0, 7) === n);
  const i = o.reduce((d, p) => d + p.m, 0);
  if (e === t && a === s) {
    return {
      ing: [...store.FIN.filter((p) => p.date.slice(0, 7) === n && p.date < TODAY()), todayFin()].reduce(
        (p, w) => p + finTot(w),
        0,
      ),
      gas: i,
      partial: true,
    };
  }
  if (LIVE) {
    if (!store.MTOT[e]) {
      store.MTOT[e] = "loading";
      liveApi
        .monthTotals(e)
        .then(render)
        .catch(() => {
          store.MTOT[e] = null;
        });
    }
    const d = Array.isArray(store.MTOT[e]) ? store.MTOT[e][a] : null;
    return {
      ing: d ? d.ing : 0,
      gas: o.length ? i : d ? d.gas : 0,
    };
  }
  const l = ((e * 12 + a) * 7919) % 97;
  const c = [0.85, 0.8, 0.95, 1, 1, 0.95, 1.05, 1, 1, 1.05, 1.1, 1.35][a];
  return {
    ing: Math.round(((115e4 + l * 5200) * c) / 1e3) * 1e3,
    gas: o.length ? i : Math.round((235e3 + (l % 23) * 2600) / 100) * 100,
  };
}
export function vBFinanzas() {
  const e = ["dia", "mes", "anio"].includes(S.fp) ? S.fp : "dia";
  return `<div class="seg3" role="group" aria-label="Período"><button data-fp="dia" aria-pressed="${e === "dia"}">Caja del día</button><button data-fp="mes" aria-pressed="${e === "mes"}">Mes</button><button data-fp="anio" aria-pressed="${e === "anio"}">Año</button></div>${e === "mes" ? vFinMes() : e === "anio" ? vFinAnio() : vCajaDia()}`;
}
function vCajaDia() {
  const e = TODAY();
  const a = dayLines(e);
  const t = a.reduce((c, d) => c + d.m, 0);
  const s = a.filter((c) => c.medio === "Efectivo").reduce((c, d) => c + d.m, 0);
  const n = t - s;
  const o = store.CLOSINGS["day|" + e];
  const i = o && o.counted != null ? o.counted - o.cash : null;
  const l = store.FIN.filter(
    (c) => ymk(c.date) === ymk(e) && c.date < e && finTot(c) > 0 && !store.CLOSINGS["day|" + c.date],
  );
  return `<div class="kpis"><div class="kpi big"><span>${esc(longLabel(e))}</span><b>${money(t)}</b><small>Lo que entró hoy (las señas te llegan completas)</small></div><div class="kpi"><span>💵 Efectivo</span><b>${money(s)}</b></div><div class="kpi"><span>📱 Mercado Pago</span><b>${money(n)}</b></div></div>
  <div class="panel"><p class="lbl">Movimientos de hoy · ${a.length}</p>${a.length ? `<ul class="ag">${a.map((c) => `<li><span class="ag-t">${esc(c.h || "")}</span><div><b>${c.medio === "Efectivo" ? "💵" : "📱"} ${esc(c.t)}</b><span>${esc(c.s || "")} · ${esc(c.medio)}</span></div><b class="price" style="font-size:15px">${money(c.m)}</b></li>`).join("")}</ul>` : '<p class="note">Todavía no entró nada hoy. Se suma solo cuando marcás “Asistió” en la agenda o cargás algo en Caja.</p>'}
   <button class="btn btn-ghost btn-block" style="margin-top:10px" data-btab="caja">+ Cargar servicio sin turno o venta</button></div>
  ${
    o
      ? `<div class="panel cclosed"><b>✓ Caja de hoy cerrada a las ${esc(o.at || "")}</b><p class="note" style="text-align:left;margin:4px 0 0">Total ${money(o.income)} · efectivo ${money(o.cash)} · Mercado Pago ${money(o.mp)}${i != null ? ` · contaste ${money(o.counted)} en efectivo: ${i === 0 ? "justo ✓" : i > 0 ? "te sobran " + money(i) : "te faltan " + money(-i)}` : ""}</p>
     ${o.income !== t ? `<p class="alert">Después del cierre entraron ${money(t - o.income)} más. Volvé a cerrarla para que quede exacta.</p>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="reopenDay">Volver a cerrar la caja</button></div>`
      : `<form class="panel" id="fCloseDay" novalidate><p class="lbl">Cerrar la caja de hoy</p>
     <div class="f"><label for="cdCount">Efectivo que contaste en la caja (opcional)</label><input id="cdCount" inputmode="numeric" placeholder="${money(s)}" autocomplete="off"><span class="hint">Si lo cargás, te decimos si te sobra o te falta plata.</span></div>
     <div class="err" id="cderr"></div><button class="btn btn-pri btn-block" type="submit">Cerrar la caja · ${money(t)}</button></form>`
  }
  ${
    l.length
      ? `<div class="panel"><p class="lbl">Días de este mes sin cerrar · ${l.length}</p><ul class="ag">${l.map((c) => `<li><span class="ag-t">${esc(dayLabel(c.date))}</span><div><b>${money(finTot(c))}</b><span>Entró ese día</span></div><button class="btn btn-ghost btn-sm" data-act="closePast" data-d="${c.date}">Cerrar</button></li>`).join("")}</ul>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="closeAllPast">Cerrar todos</button></div>`
      : ""
  }`;
}
function vFinMes() {
  const e = ymk(TODAY());
  const a = S.fm && S.fm <= e ? S.fm : e;
  const [t, s] = a.split("-").map(Number);
  const n = monthTotals(t, s - 1) || {
    ing: 0,
    gas: 0,
  };
  const o = n.ing - n.gas;
  const i = store.GASTOS.filter((g) => g.d.slice(0, 7) === a).sort((g, M) => g.d.localeCompare(M.d));
  const l = new Date(t, s - 2, 1);
  const c = l.getFullYear() + "-" + pad(l.getMonth() + 1);
  const d = store.GASTOS.filter((g) => g.d.slice(0, 7) === c && g.cat !== "Productos");
  const p = i.filter((g) => g.cat !== "Productos");
  const w = i.filter((g) => g.cat === "Productos");
  const y = a === e ? [...store.FIN.filter((g) => ymk(g.date) === a && g.date < TODAY()), todayFin()] : [];
  const k = Math.max(1, ...y.map(finTot));
  const h = y.filter((g) => store.CLOSINGS["day|" + g.date]).length;
  const j = y.filter((g) => finTot(g) > 0).length;
  const b = store.CLOSINGS["month|" + a];
  return `<div class="wnav"><button class="pk-nav" data-fm="-1" aria-label="Mes anterior">‹</button><div><b style="text-transform:capitalize">${MESES[s - 1]} ${t}</b><span>${a === e ? "Mes en curso" : b ? "✓ Mes cerrado" : "Mes terminado"}</span></div><button class="pk-nav" data-fm="1" ${a >= e ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>
  <div class="kpis"><div class="kpi big"><span>Balance de ${MESES[s - 1]}</span><b style="color:${o >= 0 ? "var(--ok)" : "var(--bad)"}">${money(o)}</b><small>Ingresos − gastos${a === e ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Ingresos</span><b>${money(n.ing)}</b></div><div class="kpi"><span>Gastos</span><b>${money(n.gas)}</b></div></div>
  <div class="panel"><p class="lbl">Gastos del mes</p>
   <p class="note" style="text-align:left;margin:-2px 0 10px">Cargá acá los gastos fijos del mes una sola vez (alquiler, luz, internet…). Las compras de productos se cargan solas desde Productos → “Compré más”.</p>
   ${p.length ? `<ul class="ag">${p.map((g) => `<li><span class="ag-t">${esc(dayLabel(g.d))}</span><div><b>${esc(g.c)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(g.m)}</b>${b ? "" : `<button class="xbtn" data-act="gDel" data-id="${g.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`).join("")}</ul>` : `<p class="note" style="text-align:left">Todavía no cargaste gastos este mes.</p>${d.length && !b ? `<button class="btn btn-ghost btn-block" data-act="copyPrevG">📋 Copiar los ${d.length} gastos de ${MESES[l.getMonth()]} (${money(d.reduce((g, M) => g + M.m, 0))})</button>` : ""}`}
   ${w.length ? `<p class="lbl" style="margin:12px 0 6px">🧴 Compras de productos</p><ul class="ag">${w.map((g) => `<li><span class="ag-t">${esc(dayLabel(g.d))}</span><div><b>${esc(g.c.replace(/^Compra: /, ""))}</b><span>Desde Productos</span></div><b class="price" style="font-size:15px">${money(g.m)}</b></li>`).join("")}</ul>` : ""}
   ${
     b
       ? '<p class="note" style="text-align:left;margin:10px 0 0">🔒 El mes está cerrado. Para agregar, borrar o cambiar gastos, desbloquealo abajo.</p>'
       : `<form class="gform" id="fGasto" novalidate><input id="gc" maxlength="80" placeholder="Concepto (ej: Alquiler)" autocomplete="off" aria-label="Concepto"><input id="gm" inputmode="numeric" placeholder="$ Monto" autocomplete="off" aria-label="Monto"><button class="btn btn-pri" type="submit">Agregar</button></form>
   <div class="err" id="gerr"></div>`
   }</div>
  ${
    y.length
      ? `<div class="panel"><p class="lbl">Ingresos por día</p><div class="bars thin">${y
          .map((g) => {
            const M = finTot(g);
            const _ = /* @__PURE__ */ new Date(g.date + "T12:00:00");
            const D = store.CLOSINGS["day|" + g.date];
            return `<div class="bar-c ${g.date === TODAY() ? "today" : ""}" title="${esc(dayLabel(g.date))}: ${money(M)}${D ? " · caja cerrada" : ""}"><i style="height:${Math.round((M / k) * 100)}%"></i><span>${_.getDate() % 5 === 0 || g.date === TODAY() ? _.getDate() : ""}</span></div>`;
          })
          .join("")}</div>
    <p class="note" style="margin-top:6px">Cajas cerradas: ${h} de ${j} días con ingresos.${h < j ? ' <button class="lnk" data-fp="dia">Cerrar las que faltan</button>' : ""}</p></div>`
      : ""
  }
  ${b ? `<div class="panel cclosed"><b>✓ ${MESES[s - 1]} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Ingresos ${money(b.income)} · gastos ${money(b.expenses)} · balance ${money(b.income - b.expenses)}</p>${b.income !== n.ing || b.expenses !== n.gas ? `<p class="alert">Entraron ingresos después del cierre. Actualizá el cierre para que quede exacto.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="closeMonth" data-m="${a}">Actualizar el cierre</button>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="unlockMonth" data-m="${a}">🔓 Desbloquear para editar</button></div>` : `<button class="btn btn-pri btn-block" data-act="closeMonth" data-m="${a}">Cerrar ${MESES[s - 1]} · balance ${money(o)}</button>`}`;
}
function vFinAnio() {
  const e = NOW().getFullYear();
  const a = YEARS().includes(S.fy) ? S.fy : e;
  const t = Array.from(
    {
      length: 12,
    },
    (c, d) => monthTotals(a, d),
  );
  const s = t.filter(Boolean);
  const n = s.reduce((c, d) => c + d.ing, 0);
  const o = s.reduce((c, d) => c + d.gas, 0);
  const i = Math.max(...s.map((c) => c.ing), 1);
  const l = t.reduce(
    (c, d, p) =>
      d && (!c || d.ing > c.x.ing)
        ? {
            x: d,
            i: p,
          }
        : c,
    null,
  );
  return `<div class="yearsel">${YEARS()
    .map((c) => `<button data-fy="${c}" aria-pressed="${a === c}">${c}</button>`)
    .join("")}</div>
  <div class="kpis"><div class="kpi big"><span>Balance ${a}${a === e ? " (hasta hoy)" : ""}</span><b style="color:${n - o >= 0 ? "var(--ok)" : "var(--bad)"}">${money(n - o)}</b><small>Ingresos − gastos</small></div><div class="kpi"><span>Ingresos</span><b>${money(n)}</b></div><div class="kpi"><span>Gastos</span><b>${money(o)}</b></div></div>
  ${
    s.length
      ? `<div class="panel"><p class="lbl">Ingresos por mes</p><div class="bars ybars">${t.map((c, d) => `<div class="bar-c ${a === e && d === NOW().getMonth() ? "today" : ""}" title="${MESES[d]}: ${c ? money(c.ing) : "sin datos"}"><i style="height:${c ? Math.round((c.ing / i) * 100) : 0}%"></i><span>${MESES[d].slice(0, 3)}</span></div>`).join("")}</div>
   ${l ? `<p class="note" style="margin-top:6px">Mejor mes: ${MESES[l.i]} con ${money(l.x.ing)}</p>` : ""}</div>
  <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th><th></th></tr></thead><tbody>${t.map((c, d) => (c ? `<tr><td><button class="lnk" data-act="goMonth" data-m="${a}-${pad(d + 1)}">${MESES[d].charAt(0).toUpperCase() + MESES[d].slice(1)}</button>${c.partial ? " *" : ""}</td><td>${money(c.ing)}</td><td>${money(c.gas)}</td><td><b>${money(c.ing - c.gas)}</b></td><td>${store.CLOSINGS["month|" + a + "-" + pad(d + 1)] ? "✓" : ""}</td></tr>` : "")).join("")}</tbody></table></div>
   <p class="note" style="text-align:left;margin-top:6px">${a === e ? "* Mes en curso, hasta hoy. " : ""}✓ = mes cerrado. Tocá un mes para ver el detalle.</p></div>`
      : `<div class="panel" style="text-align:center"><p class="note" style="margin:0">${a > e ? `${a} todavía no empezó: acá vas a ver el balance de cada mes.` : "Sin datos de este año."}</p></div>`
  }`;
}

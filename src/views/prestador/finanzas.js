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
import { demoMonthTotals } from "../../demo/estadisticas.js";

store.FIN = [];
store.GASTOS = [];
store.GID = 1;
store.CLOSINGS = {};
export const ymk = (date) => date.slice(0, 7);
// comisión que el cliente pagó en un turno de la app (no es del prestador)
export const feeOf = (booking) => booking.feeIn || 0;
export const YEARS = () => {
  const year = NOW().getFullYear();
  const years = [];
  for (let value = year - 1; value <= Math.max(2028, year); value++) {
    years.push(value);
  }
  return years;
};
// movimientos de caja de un día: seña y resto de los turnos de la app, turnos agendados a mano y lo cobrado
// sin turno (solo hoy)
export function dayLines(day) {
  const lines = [];
  store.BOOK.filter((booking) => booking.pid == ME() && booking.date === day && booking.status === "done" && booking.type !== "block")
    .sort((one, other) => one.time.localeCompare(other.time))
    .forEach((booking) => {
      if (booking.src === "app") {
        const deposit = (booking.paid || 0) - feeOf(booking);
        if (deposit > 0) {
          lines.push({
            h: booking.time,
            t: "Seña · " + booking.cliente,
            s: booking.svc,
            m: deposit,
            medio: "Mercado Pago",
          });
        }
        const rest = Math.max(0, (booking.price || 0) - (booking.paid || 0));
        if (rest > 0) {
          lines.push({
            h: booking.time,
            t: "Resto · " + booking.cliente,
            s: booking.svc,
            m: rest,
            medio: booking.pay === "cash" ? "Efectivo" : "Mercado Pago",
          });
        }
      } else {
        lines.push({
          h: booking.time,
          t: booking.cliente || "Cliente",
          s: booking.svc,
          m: booking.price || 0,
          medio: "Efectivo",
        });
      }
    });
  if (day === TODAY()) {
    S.walk.forEach((walk) =>
      lines.push({
        h: walk.hora,
        t: walk.kind === "prod" ? walk.svc : walk.cliente || "Sin turno",
        s: walk.kind === "prod" ? "Venta de producto" : walk.svc,
        m: walk.precio + (walk.propina || 0),
        medio: walk.medio,
      }),
    );
  }
  return lines.sort((one, other) => String(one.h).localeCompare(String(other.h)));
}
export const finTot = (day) => day.app + day.man + day.walk + day.prod;
// cierre de caja de un día; counted = efectivo contado (opcional)
export function closeDay(day, income, cash, mp, counted) {
  const closing = {
    income: income,
    cash: cash,
    mp: mp,
    counted: counted == null ? null : counted,
    at: nowHM(),
  };
  store.CLOSINGS["day|" + day] = closing;
  api.m.closeCash("day", day, closing);
}
function todayFin() {
  const today = TODAY();
  const done = store.BOOK.filter((booking) => booking.date === today && booking.status === "done");
  const fin = {
    date: today,
    app: 0,
    man: 0,
    walk: 0,
    prod: 0,
  };
  done.forEach((booking) => {
    if (booking.pid == ME()) {
      if (booking.src === "app") {
        fin.app += (booking.price || 0) - feeOf(booking);
      } else {
        fin.man += booking.price || 0;
      }
    }
  });
  S.walk.forEach((walk) => {
    if (walk.kind === "prod") {
      fin.prod += walk.precio;
    } else {
      fin.walk += walk.precio + walk.propina;
    }
  });
  return fin;
}
// ingresos y gastos de un mes (month de 0 a 11). El mes en curso se calcula acá, hasta hoy; en vivo los meses
// anteriores los trae la base (una vez por año) y en la demo se inventan. null para meses futuros.
export function monthTotals(year, month) {
  const nowYear = NOW().getFullYear();
  const nowMonth = NOW().getMonth();
  if (year > nowYear || (year === nowYear && month > nowMonth)) {
    return null;
  }
  const ym = year + "-" + pad(month + 1);
  const expenses = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === ym);
  const expTotal = expenses.reduce((sum, exp) => sum + exp.m, 0);
  if (year === nowYear && month === nowMonth) {
    return {
      ing: [...store.FIN.filter((day) => day.date.slice(0, 7) === ym && day.date < TODAY()), todayFin()].reduce(
        (sum, day) => sum + finTot(day),
        0,
      ),
      gas: expTotal,
      partial: true,
    };
  }
  if (LIVE) {
    if (!store.MTOT[year]) {
      store.MTOT[year] = "loading";
      liveApi
        .monthTotals(year)
        .then(render)
        .catch(() => {
          store.MTOT[year] = null;
        });
    }
    const live = Array.isArray(store.MTOT[year]) ? store.MTOT[year][month] : null;
    return {
      ing: live ? live.ing : 0,
      gas: expenses.length ? expTotal : live ? live.gas : 0,
    };
  }
  return demoMonthTotals(year, month, expenses.length ? expTotal : null);
}
// pestaña Finanzas: caja del día, mes o año
export function vBFinanzas() {
  const period = ["dia", "mes", "anio"].includes(S.fp) ? S.fp : "dia";
  return `<div class="seg3" role="group" aria-label="Período"><button data-fp="dia" aria-pressed="${period === "dia"}">Caja del día</button><button data-fp="mes" aria-pressed="${period === "mes"}">Mes</button><button data-fp="anio" aria-pressed="${period === "anio"}">Año</button></div>${period === "mes" ? vFinMes() : period === "anio" ? vFinAnio() : vCajaDia()}`;
}
function vCajaDia() {
  const today = TODAY();
  const lines = dayLines(today);
  const total = lines.reduce((sum, line) => sum + line.m, 0);
  const cash = lines.filter((line) => line.medio === "Efectivo").reduce((sum, line) => sum + line.m, 0);
  const mp = total - cash;
  const closing = store.CLOSINGS["day|" + today];
  const diff = closing && closing.counted != null ? closing.counted - closing.cash : null;
  const open = store.FIN.filter(
    (day) => ymk(day.date) === ymk(today) && day.date < today && finTot(day) > 0 && !store.CLOSINGS["day|" + day.date],
  );
  return `<div class="kpis"><div class="kpi big"><span>${esc(longLabel(today))}</span><b>${money(total)}</b><small>Lo que entró hoy (las señas te llegan completas)</small></div><div class="kpi"><span>💵 Efectivo</span><b>${money(cash)}</b></div><div class="kpi"><span>📱 Mercado Pago</span><b>${money(mp)}</b></div></div>
  <div class="panel"><p class="lbl">Movimientos de hoy · ${lines.length}</p>${lines.length ? `<ul class="ag">${lines.map((line) => `<li><span class="ag-t">${esc(line.h || "")}</span><div><b>${line.medio === "Efectivo" ? "💵" : "📱"} ${esc(line.t)}</b><span>${esc(line.s || "")} · ${esc(line.medio)}</span></div><b class="price" style="font-size:15px">${money(line.m)}</b></li>`).join("")}</ul>` : '<p class="note">Todavía no entró nada hoy. Se suma solo cuando marcás “Asistió” en la agenda o cargás algo en Caja.</p>'}
   <button class="btn btn-ghost btn-block" style="margin-top:10px" data-btab="caja">+ Cargar servicio sin turno o venta</button></div>
  ${
    closing
      ? `<div class="panel cclosed"><b>✓ Caja de hoy cerrada a las ${esc(closing.at || "")}</b><p class="note" style="text-align:left;margin:4px 0 0">Total ${money(closing.income)} · efectivo ${money(closing.cash)} · Mercado Pago ${money(closing.mp)}${diff != null ? ` · contaste ${money(closing.counted)} en efectivo: ${diff === 0 ? "justo ✓" : diff > 0 ? "te sobran " + money(diff) : "te faltan " + money(-diff)}` : ""}</p>
     ${closing.income !== total ? `<p class="alert">Después del cierre entraron ${money(total - closing.income)} más. Volvé a cerrarla para que quede exacta.</p>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="reopenDay">Volver a cerrar la caja</button></div>`
      : `<form class="panel" id="fCloseDay" novalidate><p class="lbl">Cerrar la caja de hoy</p>
     <div class="f"><label for="cdCount">Efectivo que contaste en la caja (opcional)</label><input id="cdCount" inputmode="numeric" placeholder="${money(cash)}" autocomplete="off"><span class="hint">Si lo cargás, te decimos si te sobra o te falta plata.</span></div>
     <div class="err" id="cderr"></div><button class="btn btn-pri btn-block" type="submit">Cerrar la caja · ${money(total)}</button></form>`
  }
  ${
    open.length
      ? `<div class="panel"><p class="lbl">Días de este mes sin cerrar · ${open.length}</p><ul class="ag">${open.map((day) => `<li><span class="ag-t">${esc(dayLabel(day.date))}</span><div><b>${money(finTot(day))}</b><span>Entró ese día</span></div><button class="btn btn-ghost btn-sm" data-act="closePast" data-d="${day.date}">Cerrar</button></li>`).join("")}</ul>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="closeAllPast">Cerrar todos</button></div>`
      : ""
  }`;
}
// balance del mes: ingresos, gastos (fijos y compras de productos), ingresos por día y cierre del mes
function vFinMes() {
  const current = ymk(TODAY());
  const ym = S.fm && S.fm <= current ? S.fm : current;
  const [year, month] = ym.split("-").map(Number);
  const totals = monthTotals(year, month - 1) || {
    ing: 0,
    gas: 0,
  };
  const balance = totals.ing - totals.gas;
  const expenses = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === ym).sort((one, other) => one.d.localeCompare(other.d));
  const prev = new Date(year, month - 2, 1);
  const prevYm = prev.getFullYear() + "-" + pad(prev.getMonth() + 1);
  const prevFixed = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === prevYm && exp.cat !== "Productos");
  const fixed = expenses.filter((exp) => exp.cat !== "Productos");
  const prodBuys = expenses.filter((exp) => exp.cat === "Productos");
  const days = ym === current ? [...store.FIN.filter((day) => ymk(day.date) === ym && day.date < TODAY()), todayFin()] : [];
  const maxDay = Math.max(1, ...days.map(finTot));
  const closedDays = days.filter((day) => store.CLOSINGS["day|" + day.date]).length;
  const activeDays = days.filter((day) => finTot(day) > 0).length;
  const closing = store.CLOSINGS["month|" + ym];
  return `<div class="wnav"><button class="pk-nav" data-fm="-1" aria-label="Mes anterior">‹</button><div><b style="text-transform:capitalize">${MESES[month - 1]} ${year}</b><span>${ym === current ? "Mes en curso" : closing ? "✓ Mes cerrado" : "Mes terminado"}</span></div><button class="pk-nav" data-fm="1" ${ym >= current ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>
  <div class="kpis"><div class="kpi big"><span>Balance de ${MESES[month - 1]}</span><b style="color:${balance >= 0 ? "var(--ok)" : "var(--bad)"}">${money(balance)}</b><small>Ingresos − gastos${ym === current ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Ingresos</span><b>${money(totals.ing)}</b></div><div class="kpi"><span>Gastos</span><b>${money(totals.gas)}</b></div></div>
  <div class="panel"><p class="lbl">Gastos del mes</p>
   <p class="note" style="text-align:left;margin:-2px 0 10px">Cargá acá los gastos fijos del mes una sola vez (alquiler, luz, internet…). Las compras de productos se cargan solas desde Productos → “Compré más”.</p>
   ${fixed.length ? `<ul class="ag">${fixed.map((exp) => `<li><span class="ag-t">${esc(dayLabel(exp.d))}</span><div><b>${esc(exp.c)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(exp.m)}</b>${closing ? "" : `<button class="xbtn" data-act="gDel" data-id="${exp.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`).join("")}</ul>` : `<p class="note" style="text-align:left">Todavía no cargaste gastos este mes.</p>${prevFixed.length && !closing ? `<button class="btn btn-ghost btn-block" data-act="copyPrevG">📋 Copiar los ${prevFixed.length} gastos de ${MESES[prev.getMonth()]} (${money(prevFixed.reduce((sum, exp) => sum + exp.m, 0))})</button>` : ""}`}
   ${prodBuys.length ? `<p class="lbl" style="margin:12px 0 6px">🧴 Compras de productos</p><ul class="ag">${prodBuys.map((exp) => `<li><span class="ag-t">${esc(dayLabel(exp.d))}</span><div><b>${esc(exp.c.replace(/^Compra: /, ""))}</b><span>Desde Productos</span></div><b class="price" style="font-size:15px">${money(exp.m)}</b></li>`).join("")}</ul>` : ""}
   ${
     closing
       ? '<p class="note" style="text-align:left;margin:10px 0 0">🔒 El mes está cerrado. Para agregar, borrar o cambiar gastos, desbloquealo abajo.</p>'
       : `<form class="gform" id="fGasto" novalidate><input id="gc" maxlength="80" placeholder="Concepto (ej: Alquiler)" autocomplete="off" aria-label="Concepto"><input id="gm" inputmode="numeric" placeholder="$ Monto" autocomplete="off" aria-label="Monto"><button class="btn btn-pri" type="submit">Agregar</button></form>
   <div class="err" id="gerr"></div>`
   }</div>
  ${
    days.length
      ? `<div class="panel"><p class="lbl">Ingresos por día</p><div class="bars thin">${days
          .map((day) => {
            const total = finTot(day);
            const jsDate = /* @__PURE__ */ new Date(day.date + "T12:00:00");
            const closed = store.CLOSINGS["day|" + day.date];
            return `<div class="bar-c ${day.date === TODAY() ? "today" : ""}" title="${esc(dayLabel(day.date))}: ${money(total)}${closed ? " · caja cerrada" : ""}"><i style="height:${Math.round((total / maxDay) * 100)}%"></i><span>${jsDate.getDate() % 5 === 0 || day.date === TODAY() ? jsDate.getDate() : ""}</span></div>`;
          })
          .join("")}</div>
    <p class="note" style="margin-top:6px">Cajas cerradas: ${closedDays} de ${activeDays} días con ingresos.${closedDays < activeDays ? ' <button class="lnk" data-fp="dia">Cerrar las que faltan</button>' : ""}</p></div>`
      : ""
  }
  ${closing ? `<div class="panel cclosed"><b>✓ ${MESES[month - 1]} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Ingresos ${money(closing.income)} · gastos ${money(closing.expenses)} · balance ${money(closing.income - closing.expenses)}</p>${closing.income !== totals.ing || closing.expenses !== totals.gas ? `<p class="alert">Entraron ingresos después del cierre. Actualizá el cierre para que quede exacto.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="closeMonth" data-m="${ym}">Actualizar el cierre</button>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="unlockMonth" data-m="${ym}">🔓 Desbloquear para editar</button></div>` : `<button class="btn btn-pri btn-block" data-act="closeMonth" data-m="${ym}">Cerrar ${MESES[month - 1]} · balance ${money(balance)}</button>`}`;
}
// balance del año, mes por mes
function vFinAnio() {
  const nowYear = NOW().getFullYear();
  const year = YEARS().includes(S.fy) ? S.fy : nowYear;
  const months = Array.from(
    {
      length: 12,
    },
    (slot, month) => monthTotals(year, month),
  );
  const known = months.filter(Boolean);
  const ing = known.reduce((sum, tot) => sum + tot.ing, 0);
  const gas = known.reduce((sum, tot) => sum + tot.gas, 0);
  const maxIng = Math.max(...known.map((tot) => tot.ing), 1);
  const best = months.reduce(
    (acc, tot, month) =>
      tot && (!acc || tot.ing > acc.x.ing)
        ? {
            x: tot,
            i: month,
          }
        : acc,
    null,
  );
  return `<div class="yearsel">${YEARS()
    .map((option) => `<button data-fy="${option}" aria-pressed="${year === option}">${option}</button>`)
    .join("")}</div>
  <div class="kpis"><div class="kpi big"><span>Balance ${year}${year === nowYear ? " (hasta hoy)" : ""}</span><b style="color:${ing - gas >= 0 ? "var(--ok)" : "var(--bad)"}">${money(ing - gas)}</b><small>Ingresos − gastos</small></div><div class="kpi"><span>Ingresos</span><b>${money(ing)}</b></div><div class="kpi"><span>Gastos</span><b>${money(gas)}</b></div></div>
  ${
    known.length
      ? `<div class="panel"><p class="lbl">Ingresos por mes</p><div class="bars ybars">${months.map((tot, month) => `<div class="bar-c ${year === nowYear && month === NOW().getMonth() ? "today" : ""}" title="${MESES[month]}: ${tot ? money(tot.ing) : "sin datos"}"><i style="height:${tot ? Math.round((tot.ing / maxIng) * 100) : 0}%"></i><span>${MESES[month].slice(0, 3)}</span></div>`).join("")}</div>
   ${best ? `<p class="note" style="margin-top:6px">Mejor mes: ${MESES[best.i]} con ${money(best.x.ing)}</p>` : ""}</div>
  <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th><th></th></tr></thead><tbody>${months.map((tot, month) => (tot ? `<tr><td><button class="lnk" data-act="goMonth" data-m="${year}-${pad(month + 1)}">${MESES[month].charAt(0).toUpperCase() + MESES[month].slice(1)}</button>${tot.partial ? " *" : ""}</td><td>${money(tot.ing)}</td><td>${money(tot.gas)}</td><td><b>${money(tot.ing - tot.gas)}</b></td><td>${store.CLOSINGS["month|" + year + "-" + pad(month + 1)] ? "✓" : ""}</td></tr>` : "")).join("")}</tbody></table></div>
   <p class="note" style="text-align:left;margin-top:6px">${year === nowYear ? "* Mes en curso, hasta hoy. " : ""}✓ = mes cerrado. Tocá un mes para ver el detalle.</p></div>`
      : `<div class="panel" style="text-align:center"><p class="note" style="margin:0">${year > nowYear ? `${year} todavía no empezó: acá vas a ver el balance de cada mes.` : "Sin datos de este año."}</p></div>`
  }`;
}

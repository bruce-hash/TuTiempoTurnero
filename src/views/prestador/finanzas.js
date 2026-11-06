import { api } from "../../api/index.js";
import { liveApi } from "../../api/live/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MESES, NOW, TODAY, capW, dayLabel, longLabel, nowHM, pad } from "../../lib/fechas.js";
import { MEDIOS, medioIcon } from "../../lib/medios.js";
import { restMissing, restOf, restSplit } from "../../lib/resto.js";
import { FIXED_CATS, demoSyncFixed, fixedFor, fixedRow } from "../../lib/fijos.js";
import { restEditor } from "./resto.js";
import { ME, pr } from "../../lib/prestadores.js";
import { walkEditForm, walkForm } from "./caja.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { demoMonthTotals } from "../../demo/estadisticas.js";
import { ic } from "../../ui/iconos.js";

store.FIN = [];
store.GASTOS = [];
store.GID = 1;
store.CLOSINGS = {};
store.MBRK = {};
export const ymk = (date) => date.slice(0, 7);
// C32 (V4): los meses con mayúscula en Finanzas
const mes = (index) => capW(MESES[index]);
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
            b: booking.id,
          });
        }
      }
      // C25: el resto, en el medio con que se cobró en el local (V4b: en uno o dos medios; si no se anotó, lo que
      // eligió el cliente). Lo que quedó sin cobrar se muestra pero no entra en la caja.
      const title = booking.src === "app" ? "Resto · " + booking.cliente : booking.cliente || "Cliente";
      const { parts, missing } = restSplit(booking);
      const own = parts.map((part) => ({ h: booking.time, t: title, s: booking.svc, m: part.m, medio: part.medio, b: booking.id, rest: true }));
      if (missing > 0) {
        own.push({ h: booking.time, t: "Sin cobrar · " + (booking.cliente || "Cliente"), s: booking.svc, m: missing, medio: "Sin cobrar", b: booking.id, rest: true, missing: true });
      }
      if (own.length) {
        // el editor va debajo del último movimiento del turno
        own[own.length - 1].tail = true;
      }
      lines.push(...own);
    });
  if (day === TODAY()) {
    S.walk.forEach((walk, index) =>
      lines.push({
        h: walk.hora,
        t: walk.kind === "prod" ? walk.svc : walk.cliente || "Sin turno",
        s: walk.kind === "prod" ? "Venta de producto" : walk.svc,
        m: walk.precio + (walk.propina || 0),
        medio: walk.medio,
        w: index,
      }),
    );
  }
  return lines.sort((one, other) => String(one.h).localeCompare(String(other.h)));
}
export const finTot = (day) => day.app + day.man + day.walk + day.prod;
// lo que entró de verdad (V4b: sin lo que quedó sin cobrar del resto)
export const cashLines = (lines) => lines.filter((line) => !line.missing);
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
        fin.app += (booking.price || 0) - feeOf(booking) - restMissing(booking);
      } else {
        fin.man += (booking.price || 0) - restMissing(booking);
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
// C33 (V4): el mes separado por origen (ingresos) y por tipo (gastos). El mes en curso se calcula acá; en vivo, los
// anteriores los trae la base (provider_month_breakdown, una vez por año); en la demo, solo los totales.
export function monthBreakdown(year, month) {
  const ym = year + "-" + pad(month + 1);
  const nowYm = ymk(TODAY());
  const expenses = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === ym);
  const fromGastos = expenses.length
    ? { fixed: expenses.filter((exp) => exp.cat !== "Productos").reduce((sum, exp) => sum + exp.m, 0), buys: expenses.filter((exp) => exp.cat === "Productos").reduce((sum, exp) => sum + exp.m, 0) }
    : null;
  if (ym === nowYm) {
    const days = [...store.FIN.filter((day) => ymk(day.date) === ym && day.date < TODAY()), todayFin()];
    const sum = (key) => days.reduce((acc, day) => acc + (day[key] || 0), 0);
    return { app: sum("app"), man: sum("man"), walk: sum("walk"), prod: sum("prod"), fixed: fromGastos ? fromGastos.fixed : 0, buys: fromGastos ? fromGastos.buys : 0 };
  }
  if (!LIVE) {
    return null;
  }
  if (!store.MBRK[year]) {
    store.MBRK[year] = "loading";
    liveApi
      .monthBreakdown(year)
      .then(render)
      .catch(() => {
        store.MBRK[year] = null;
      });
  }
  const row = Array.isArray(store.MBRK[year]) ? store.MBRK[year][month] : null;
  return row ? Object.assign({}, row, fromGastos || {}) : null;
}
function monthSummary(year, month, totals) {
  const br = monthBreakdown(year, month);
  const ing = br ? [["Turnos por TuTiempo", br.app], ["Turnos agendados", br.man], ["Sin turno", br.walk], ["Productos", br.prod]] : [["Ingresos", totals.ing]];
  const gas = br ? [["Gastos fijos", br.fixed], ["Compras de productos", br.buys]] : [["Gastos", totals.gas]];
  const max = Math.max(1, ...ing.map((row) => row[1]), ...gas.map((row) => row[1]));
  const bar = (label, value, kind) =>
    `<div class="mrow"><span>${esc(label)}</span><i class="mbar ${kind}" style="width:${Math.round((value / max) * 100)}%"></i><b>${money(value)}</b></div>`;
  const balance = totals.ing - totals.gas;
  return `<div class="panel msum"><p class="lbl">Resumen de ${mes(month)}</p>
   <p class="mhead">Ingresos · ${money(totals.ing)}</p>${ing.map(([label, value]) => bar(label, value, "in")).join("")}
   <p class="mhead">Gastos · ${money(totals.gas)}</p>${gas.map(([label, value]) => bar(label, value, "out")).join("")}
   <p class="mbal ${balance >= 0 ? "pos" : "neg"}">Balance: ${money(balance)}</p></div>`;
}
// pestaña Finanzas: caja del día, mes o año
export function vBFinanzas() {
  const period = ["dia", "mes", "anio"].includes(S.fp) ? S.fp : "dia";
  return `<div class="seg3" role="group" aria-label="Período"><button data-fp="dia" aria-pressed="${period === "dia"}">Caja del día</button><button data-fp="mes" aria-pressed="${period === "mes"}">Mes</button><button data-fp="anio" aria-pressed="${period === "anio"}">Año</button></div>${period === "mes" ? vFinMes() : period === "anio" ? vFinAnio() : vCajaDia()}`;
}
// C34 (V4): la Caja del día, con lo que se carga en el local (antes era la pestaña Caja). C25: cada movimiento se edita
// y se borra (los de un turno: el medio con que se cobró el resto; la seña entra siempre por Mercado Pago).
function movLine(line) {
  const key = line.w != null ? "w" + line.w : line.rest ? "b" + line.b : null;
  // V4b: un turno puede tener dos o tres movimientos (dos medios y lo que falta); el editor va una vez, debajo del último
  const editing = key && S.movEd === key && (line.w != null || line.tail);
  const deleting = key && S.movDel === key;
  const actions =
    line.w != null
      ? `<button class="xbtn" data-act="movEdit" data-k="${key}" aria-label="Editar">${ic("editar")}</button><button class="xbtn" data-act="movDel" data-k="${key}" aria-label="Borrar">✕</button>`
      : line.rest
        ? `<button class="xbtn" data-act="movEdit" data-k="${key}" aria-label="Cambiar cómo te pagó el resto">${ic("editar")}</button>`
        : "";
  const head = `<li class="${editing || deleting ? "on" : ""}"><span class="ag-t">${esc(line.h || "")}</span><div><b>${line.missing ? ic("espera") : medioIcon(line.medio)} ${esc(line.t)}</b><span>${esc(line.s || "")} · ${esc(line.medio)}</span></div><span style="display:flex;gap:6px;align-items:center"><b class="price ${line.missing ? "rs-miss" : ""}" style="font-size:15px">${money(line.m)}</b>${actions}</span></li>`;
  if (deleting) {
    return `${head}<li class="movask"><div><b>¿Borrar ${esc(line.t)} de las ${esc(line.h)}?</b><span>${S.walk[line.w] && S.walk[line.w].kind === "prod" ? "La unidad vuelve al stock." : "Sale de la caja y de tus finanzas."}</span></div><span style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" data-act="movDelNo">No</button><button class="btn btn-pri btn-sm" data-act="movDelYes" data-k="${key}">Sí, borrar</button></span></li>`;
  }
  if (editing && line.w != null) {
    return `${head}<li class="movform">${walkEditForm(S.walk[line.w])}</li>`;
  }
  if (editing) {
    const booking = store.BOOK.find((item) => item.id === line.b);
    return booking ? `${head}<li class="movform">${restEditor(booking, "movEdClose")}</li>` : head;
  }
  return head;
}
// C30 (V4 resto): lo que falta antes de cerrar el día: los turnos de hoy que ya empezaron y no están marcados (vino o no
// vino) y los cobros del resto sin medio de pago anotado
function dayPending(today) {
  const now = nowHM();
  const mine = store.BOOK.filter((booking) => booking.pid == ME() && booking.date === today && booking.type !== "block");
  return {
    unmarked: mine.filter((booking) => booking.status === "confirmed" && booking.time <= now).sort((one, other) => one.time.localeCompare(other.time)),
    noMedio: mine.filter((booking) => booking.status === "done" && restOf(booking) > 0 && !booking.restMethod && !(booking.restParts && booking.restParts.length)),
  };
}
function pendingPanel(pending) {
  if (!pending.unmarked.length && !pending.noMedio.length) {
    return "";
  }
  const who = (booking) => `<span class="ag-t">${esc(booking.time)}</span><div><b>${esc(booking.cliente || "Cliente")}</b><span>${esc(booking.svc || "")}</span></div>`;
  return `<div class="panel pendday"><p class="lbl">Antes de cerrar · ${pending.unmarked.length + pending.noMedio.length} pendiente${pending.unmarked.length + pending.noMedio.length === 1 ? "" : "s"}</p>
   <ul class="ag movs">${pending.unmarked
     .map((booking) => `<li>${who(booking)}<span class="medios"><button type="button" class="btn btn-ok btn-sm" data-act="bDone" data-id="${booking.id}">✓ Vino</button><button type="button" class="btn btn-ghost btn-sm" data-act="bNoShow" data-id="${booking.id}">No vino</button></span></li>`)
     .join("")}${pending.noMedio
     .map((booking) => `<li>${who(booking)}<span class="medios"><span class="hint">¿Cómo te pagó ${money(restOf(booking))}?</span>${MEDIOS.map((medio) => `<button type="button" class="btn btn-ghost btn-sm" data-act="restMedio" data-id="${booking.id}" data-m="${medio}">${medio}</button>`).join("")}<button type="button" class="btn btn-ghost btn-sm" data-act="movEdit" data-k="b${booking.id}">En dos medios</button></span></li>`)
     .join("")}</ul>
   <p class="note" style="text-align:left;margin:6px 0 0">${pending.unmarked.length ? "Marcá si vinieron: los que vinieron suman a la caja. " : ""}${pending.noMedio.length ? "Anotá con qué te pagaron el resto, así la caja da justo por medio." : ""}</p></div>`;
}
function vCajaDia() {
  const today = TODAY();
  const lines = dayLines(today);
  const total = cashLines(lines).reduce((sum, line) => sum + line.m, 0);
  const byMedio = (medio) => lines.filter((line) => line.medio === medio).reduce((sum, line) => sum + line.m, 0);
  const cash = byMedio("Efectivo");
  const closing = store.CLOSINGS["day|" + today];
  const diff = closing && closing.counted != null ? closing.counted - closing.cash : null;
  const open = store.FIN.filter(
    (day) => ymk(day.date) === ymk(today) && day.date < today && finTot(day) > 0 && !store.CLOSINGS["day|" + day.date],
  );
  const pending = dayPending(today);
  const nPending = pending.unmarked.length + pending.noMedio.length;
  return `<div class="kpis"><div class="kpi big"><span>${esc(longLabel(today))}</span><b>${money(total)}</b><small>Lo que entró hoy (las señas te llegan completas)</small></div>${MEDIOS.map((medio) => `<div class="kpi"><span>${medioIcon(medio)} ${medio}</span><b>${money(byMedio(medio))}</b></div>`).join("")}</div>
  <div class="panel"><p class="lbl">Movimientos de hoy · ${lines.length}</p>${lines.length ? `<ul class="ag movs">${lines.map(movLine).join("")}</ul>` : '<p class="note">Todavía no entró nada hoy. Se suma solo cuando marcás “Asistió” en la agenda o cargás algo acá.</p>'}
   ${walkForm(pr(ME()))}</div>
  ${closing ? "" : pendingPanel(pending)}
  ${
    closing
      ? `<div class="panel cclosed"><b>✓ Caja de hoy cerrada a las ${esc(closing.at || "")}</b><p class="note" style="text-align:left;margin:4px 0 0">Total ${money(closing.income)} · efectivo ${money(closing.cash)} · transferencias y Mercado Pago ${money(closing.mp)}${diff != null ? ` · contaste ${money(closing.counted)} en efectivo: ${diff === 0 ? "justo ✓" : diff > 0 ? "te sobran " + money(diff) : "te faltan " + money(-diff)}` : ""}</p>
     ${closing.income !== total ? `<p class="alert">Después del cierre cambió la caja (${money(total - closing.income)}). Volvé a cerrarla para que quede exacta.</p>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="reopenDay">Volver a cerrar la caja</button></div>`
      : `<form class="panel" id="fCloseDay" novalidate><p class="lbl">Cerrar la caja de hoy</p>
     <div class="f"><label for="cdCount">Efectivo que contaste en la caja (opcional)</label><input id="cdCount" inputmode="numeric" placeholder="${money(cash)}" autocomplete="off"><span class="hint">Si lo cargás, te decimos si te sobra o te falta plata.</span></div>
     <div class="err" id="cderr"></div><button class="btn btn-pri btn-block" type="submit">${nPending ? "Cerrar igual" : "Cerrar la caja"} · ${money(total)}</button>${nPending ? `<p class="note" style="margin-top:6px">Te ${nPending === 1 ? "queda 1 pendiente" : `quedan ${nPending} pendientes`} arriba: si cerrás igual, lo que cambie después te avisa que la caja cambió.</p>` : ""}</form>`
  }
  ${
    open.length
      ? `<div class="panel"><p class="lbl">Días de este mes sin cerrar · ${open.length}</p><ul class="ag">${open.map((day) => `<li><span class="ag-t">${esc(dayLabel(day.date))}</span><div><b>${money(finTot(day))}</b><span>Entró ese día</span></div><button class="btn btn-ghost btn-sm" data-act="closePast" data-d="${day.date}">Cerrar</button></li>`).join("")}</ul>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="closeAllPast">Cerrar todos</button></div>`
      : ""
  }`;
}
// C31 (V4 resto): los gastos fijos del mes. Se repiten solos; ✎ cambia el monto "desde este mes en adelante" (los meses
// cerrados no cambian) y "Dejar de repetirlo" lo saca desde este mes. Los precargados empiezan sin monto.
function fixedPanel(ym, current, closing) {
  const items = fixedFor(ym);
  const editable = !closing && ym <= current;
  const line = (item) => {
    const row = fixedRow(item, ym);
    const amount = row ? row.m : 0;
    const editing = editable && S.fxEd === item.id;
    const head = `<li class="${editing ? "on" : ""}"><span class="ag-t">${esc(item.cat)}</span><div><b>${esc(item.c)}</b>${row ? "" : `<span class="hint">Sin monto: tocá ${ic("editar")} para cargarlo</span>`}</div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${row ? money(amount) : "—"}</b>${editable ? `<button class="xbtn" data-act="fxEdit" data-id="${item.id}" aria-label="Cambiar ${esc(item.c)}">${ic("editar")}</button>` : ""}</span></li>`;
    return editing ? head + `<li class="movform">${fixedForm(item, ym, amount)}</li>` : head;
  };
  const total = items.reduce((sum, item) => sum + ((fixedRow(item, ym) || {}).m || 0), 0);
  return `<div class="panel"><p class="lbl">Gastos fijos · ${money(total)}</p>
   <p class="note" style="text-align:left;margin:-2px 0 10px">Se repiten solos todos los meses. Si aumentan, cambialos con ${ic("editar")}: vale desde ${esc(mes(+ym.slice(5) - 1))} en adelante y los meses cerrados quedan como estaban.</p>
   ${items.length ? `<ul class="ag movs">${items.map(line).join("")}</ul>` : '<p class="note" style="text-align:left">No tenés gastos fijos este mes.</p>'}
   ${editable ? (S.fxEd === "new" ? fixedForm(null, ym, "") : '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="fxNew">+ Otro gasto fijo</button>') : closing ? `<p class="note" style="text-align:left;margin:8px 0 0">${ic("candado")} Mes cerrado: los gastos fijos de este mes quedan como están.</p>` : ""}</div>`;
}
function fixedForm(item, ym, amount) {
  return `<form id="fFixed" class="mediaed" data-id="${item ? item.id : ""}" data-ym="${ym}" novalidate>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="fxc">Concepto</label><input id="fxc" maxlength="80" autocomplete="off" value="${esc(item ? item.c : "")}" placeholder="Ej: Seguro del local"></div>
   <div class="f"><label for="fxm">Monto por mes</label><input id="fxm" inputmode="numeric" autocomplete="off" placeholder="$" value="${amount || ""}"></div></div>
   <div class="f"><label for="fxk">Rubro</label><select id="fxk">${FIXED_CATS.map((cat) => `<option ${item && item.cat === cat ? "selected" : ""}>${cat}</option>`).join("")}</select></div>
   <p class="hint">Vale desde ${esc(mes(+ym.slice(5) - 1))} ${ym.slice(0, 4)} en adelante. Los meses cerrados no cambian.</p>
   <div class="err" id="fxerr"></div>
   <div class="rs-btns"><button type="button" class="btn btn-ghost" data-act="fxClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar</button></div>
   ${item ? `<button type="button" class="btn btn-ghost btn-block mediadel" data-act="fxStop" data-id="${item.id}" data-ym="${ym}">Dejar de repetirlo desde este mes</button>` : ""}</form>`;
}
// balance del mes: ingresos, gastos (fijos y compras de productos), ingresos por día y cierre del mes
function vFinMes() {
  const current = ymk(TODAY());
  // demo: los gastos fijos precargados y los de cada mes (en vivo los carga la base al abrir el panel)
  demoSyncFixed(current);
  const ym = S.fm && S.fm <= current ? S.fm : current;
  const [year, month] = ym.split("-").map(Number);
  const totals = monthTotals(year, month - 1) || {
    ing: 0,
    gas: 0,
  };
  const balance = totals.ing - totals.gas;
  const expenses = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === ym).sort((one, other) => one.d.localeCompare(other.d));
  // C31: los gastos fijos tienen su propio panel; acá van los otros gastos del mes (sin las compras de productos)
  const fixed = expenses.filter((exp) => exp.cat !== "Productos" && !exp.fixed);
  const prodBuys = expenses.filter((exp) => exp.cat === "Productos");
  const days = ym === current ? [...store.FIN.filter((day) => ymk(day.date) === ym && day.date < TODAY()), todayFin()] : [];
  const maxDay = Math.max(1, ...days.map(finTot));
  const closedDays = days.filter((day) => store.CLOSINGS["day|" + day.date]).length;
  const activeDays = days.filter((day) => finTot(day) > 0).length;
  const closing = store.CLOSINGS["month|" + ym];
  return `<div class="wnav"><button class="pk-nav" data-fm="-1" aria-label="Mes anterior">‹</button><div><b style="text-transform:capitalize">${mes(month - 1)} ${year}</b><span>${ym === current ? "Mes en curso" : closing ? "✓ Mes cerrado" : "Mes terminado"}</span></div><button class="pk-nav" data-fm="1" ${ym >= current ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>
  <div class="kpis"><div class="kpi big"><span>Balance de ${mes(month - 1)}</span><b style="color:${balance >= 0 ? "var(--ok)" : "var(--bad)"}">${money(balance)}</b><small>Ingresos − gastos${ym === current ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Ingresos</span><b>${money(totals.ing)}</b></div><div class="kpi"><span>Gastos</span><b>${money(totals.gas)}</b></div></div>
  ${monthSummary(year, month - 1, totals)}
  ${fixedPanel(ym, current, closing)}
  <div class="panel"><p class="lbl">Otros gastos del mes</p>
   <p class="note" style="text-align:left;margin:-2px 0 10px">Lo que no se repite todos los meses. Las compras de productos se cargan solas desde Productos → “Compré más”.</p>
   ${fixed.length ? `<ul class="ag">${fixed.map((exp) => `<li><span class="ag-t">${esc(dayLabel(exp.d))}</span><div><b>${esc(exp.c)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(exp.m)}</b>${closing ? "" : `<button class="xbtn" data-act="gDel" data-id="${exp.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`).join("")}</ul>` : `<p class="note" style="text-align:left">Todavía no cargaste otros gastos este mes.</p>`}
   ${prodBuys.length ? `<p class="lbl" style="margin:12px 0 6px">${ic("productos")} Compras de productos</p><ul class="ag">${prodBuys.map((exp) => `<li><span class="ag-t">${esc(dayLabel(exp.d))}</span><div><b>${esc(exp.c.replace(/^Compra: /, ""))}</b><span>Desde Productos</span></div><b class="price" style="font-size:15px">${money(exp.m)}</b></li>`).join("")}</ul>` : ""}
   ${
     closing
       ? `<p class="note" style="text-align:left;margin:10px 0 0">${ic("candado")} El mes está cerrado. Para agregar, borrar o cambiar gastos, desbloquealo abajo.</p>`
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
  ${closing ? `<div class="panel cclosed"><b>✓ ${mes(month - 1)} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Ingresos ${money(closing.income)} · gastos ${money(closing.expenses)} · balance ${money(closing.income - closing.expenses)}</p>${closing.income !== totals.ing || closing.expenses !== totals.gas ? `<p class="alert">Entraron ingresos después del cierre. Actualizá el cierre para que quede exacto.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="closeMonth" data-m="${ym}">Actualizar el cierre</button>` : ""}<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="unlockMonth" data-m="${ym}">${ic("abierto")} Desbloquear para editar</button></div>` : `<button class="btn btn-pri btn-block" data-act="closeMonth" data-m="${ym}">Cerrar ${mes(month - 1)} · balance ${money(balance)}</button>`}`;
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
      ? `<div class="panel"><p class="lbl">Ingresos por mes</p><div class="bars ybars">${months.map((tot, month) => `<div class="bar-c ${year === nowYear && month === NOW().getMonth() ? "today" : ""}" title="${mes(month)}: ${tot ? money(tot.ing) : "sin datos"}"><i style="height:${tot ? Math.round((tot.ing / maxIng) * 100) : 0}%"></i><span>${mes(month).slice(0, 3)}</span></div>`).join("")}</div>
   ${best ? `<p class="note" style="margin-top:6px">Mejor mes: ${mes(best.i)} con ${money(best.x.ing)}</p>` : ""}</div>
  <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Balance</th><th></th></tr></thead><tbody>${months.map((tot, month) => (tot ? `<tr><td><button class="lnk" data-act="goMonth" data-m="${year}-${pad(month + 1)}">${mes(month)}</button>${tot.partial ? " *" : ""}</td><td>${money(tot.ing)}</td><td>${money(tot.gas)}</td><td><b class="${tot.ing - tot.gas >= 0 ? "pos" : "neg"}">${money(tot.ing - tot.gas)}</b></td><td>${store.CLOSINGS["month|" + year + "-" + pad(month + 1)] ? "✓" : ""}</td></tr>` : "")).join("")}</tbody></table></div>
   <p class="note" style="text-align:left;margin-top:6px">${year === nowYear ? "* Mes en curso, hasta hoy. " : ""}✓ = mes cerrado. Tocá un mes para ver el detalle.</p></div>`
      : `<div class="panel" style="text-align:center"><p class="note" style="margin:0">${year > nowYear ? `${year} todavía no empezó: acá vas a ver el balance de cada mes.` : "Sin datos de este año."}</p></div>`
  }`;
}

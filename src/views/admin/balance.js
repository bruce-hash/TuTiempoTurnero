import { LIVE } from "../../config.js";
import { ADM_LAUNCH } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MESES, NOW, TODAY, capW, dm, dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { admFin } from "./datos.js";
import { YEARS } from "../prestador/finanzas.js";

// mes sin movimientos
export const Z5 = () => ({
  bookings: 0,
  charged: 0,
  deposits: 0,
  commission: 0,
  expenses: 0,
});
// balance de la plataforma por año: comisiones menos gastos, mes por mes y año por año, con cierres
export function admBal() {
  const nowYear = NOW().getFullYear();
  const year = YEARS().includes(S.admY) ? S.admY : nowYear;
  const fin = admFin(year);
  const yearSel = `<div class="yearsel">${YEARS()
    .map((option) => `<button data-act="admY" data-y="${option}" aria-pressed="${year === option}">${option}</button>`)
    .join("")}</div>`;
  if (!fin) {
    return yearSel + '<div class="skel" style="min-height:240px"></div>';
  }
  if (fin.err) {
    return yearSel + '<div class="panel"><b>No pudimos cargar el balance.</b></div>';
  }
  if (S.admM && S.admM.slice(0, 4) === String(year)) {
    return yearSel + admBalMonth(fin, S.admM);
  }
  const months = fin.months || [];
  const past = months.filter((row) => row.state !== "future");
  const commission = past.reduce((sum, row) => sum + (+row.commission || 0), 0);
  const expenses = past.reduce((sum, row) => sum + (+row.expenses || 0), 0);
  const result = commission - expenses;
  const bookings = past.reduce((sum, row) => sum + (+row.bookings || 0), 0);
  const toClose = months.filter((row) => row.state === "ended");
  const years = (fin.years || []).slice();
  if (!fin.year_closed_at && year <= nowYear) {
    years.push({
      year: year,
      commission: commission,
      expenses: expenses,
      open: true,
    });
  }
  years.sort((one, other) => one.year - other.year);
  if (year > nowYear) {
    return `${yearSel}<div class="panel" style="text-align:center"><p class="note" style="margin:0">${year} todavía no empezó. Acá vas a ver el balance de cada mes y cerrarlo.</p></div>`;
  } else {
    return `${yearSel}
   <div class="kpis"><div class="kpi big"><span>Resultado ${year}${year === nowYear ? " (hasta hoy)" : ""}</span><b style="color:${result >= 0 ? "var(--ok)" : "var(--bad)"}">${money(result)}</b><small>Comisiones − gastos de TuTiempo</small></div>
    <div class="kpi"><span>Comisiones</span><b>${money(commission)}</b><small>${bookings.toLocaleString("es-AR")} reservas pagadas</small></div><div class="kpi"><span>Gastos</span><b>${money(expenses)}</b></div></div>
   <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Mes</th><th>Comisión</th><th>Gastos</th><th>Resultado</th></tr></thead><tbody>
    ${months.map((row, index) => (row.state === "future" ? "" : `<tr><td><button class="lnk" data-act="admM" data-m="${row.month}">${capW(MESES[index])}</button>${row.state === "open" ? " *" : row.state === "closed" ? ' <span class="okc" title="Cerrado">✓</span>' : row.state === "ended" ? ' <span class="dotw" title="Falta cerrarlo">•</span>' : ""}</td><td>${money(+row.commission || 0)}</td><td>${money(+row.expenses || 0)}</td><td><b>${money((+row.commission || 0) - (+row.expenses || 0))}</b></td></tr>`)).join("")}
    <tr class="ttot"><td><b>Total</b></td><td><b>${money(commission)}</b></td><td><b>${money(expenses)}</b></td><td><b>${money(result)}</b></td></tr></tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">${year === nowYear ? "* Mes en curso. " : ""}✓ cerrado · • terminó y falta cerrarlo. Tocá un mes para ver sus cuentas, cargar gastos y cerrarlo.</p>
    ${toClose.length ? `<button class="btn btn-pri btn-block" style="margin-top:8px" data-act="admM" data-m="${toClose[0].month}">Cerrar ${MESES[+toClose[0].month.slice(5) - 1]}${toClose.length > 1 ? ` (faltan ${toClose.length} meses)` : ""}</button>` : ""}</div>
   ${fin.year_closed_at ? `<div class="panel cclosed"><b>✓ Año ${year} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(fin.year_closed_at)} · resultado ${money(result)}. Los números quedaron fijos.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="year" data-p="${year}-01-01">Reabrir el año</button></div>` : fin.can_close_year ? `<button class="btn ${toClose.length ? "btn-ghost" : "btn-pri"} btn-block" data-act="admClose" data-k="year" data-p="${year}-01-01">Cerrar el año ${year} · resultado ${money(result)}</button><p class="note" style="margin:0">Cierra también los meses que falten.</p>` : `<p class="note" style="margin:0">El año ${year} se cierra cuando termina (desde el 1° de enero de ${year + 1}).</p>`}
   <div class="panel"><p class="lbl">Año por año</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Año</th><th>Comisión</th><th>Gastos</th><th>Resultado</th></tr></thead><tbody>
    ${years.map((row) => `<tr><td><button class="lnk" data-act="admY" data-y="${row.year}">${row.year}</button> ${row.open ? '<span class="hint">abierto</span>' : '<span class="okc">✓</span>'}</td><td>${money(+row.commission || 0)}</td><td>${money(+row.expenses || 0)}</td><td><b>${money((+row.commission || 0) - (+row.expenses || 0))}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">✓ = año cerrado.</p></div>`;
  }
}
// cuentas de un mes (ym = AAAA-MM): reservas, cobrado, señas, comisión, gastos y cierre
function admBalMonth(fin, ym) {
  const current = TODAY().slice(0, 7);
  const month = (fin.months || []).find((row) => row.month === ym) || Z5();
  const monthIndex = +ym.slice(5) - 1;
  const year = +ym.slice(0, 4);
  const expenses = (fin.expenses || []).filter((exp) => String(exp.day).slice(0, 7) === ym);
  const result = (+month.commission || 0) - (+month.expenses || 0);
  const closed = month.state === "closed";
  return `<button class="back" data-act="admM" data-m="">← Volver a ${year}</button>
  <div class="wnav"><button class="pk-nav" data-act="admMn" data-d="-1" aria-label="Mes anterior" ${ym <= ADM_LAUNCH.slice(0, 7) && !LIVE ? "disabled" : ""}>‹</button><div><b style="text-transform:capitalize">${MESES[monthIndex]} ${year}</b><span>${month.state === "open" ? "Mes en curso" : closed ? "✓ Mes cerrado" : "Terminó · falta cerrarlo"}</span></div><button class="pk-nav" data-act="admMn" data-d="1" aria-label="Mes siguiente" ${ym >= current ? "disabled" : ""}>›</button></div>
  <div class="kpis"><div class="kpi big"><span>Resultado de ${MESES[monthIndex]}</span><b style="color:${result >= 0 ? "var(--ok)" : "var(--bad)"}">${money(result)}</b><small>Comisión − gastos${month.state === "open" ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Comisión</span><b>${money(+month.commission || 0)}</b></div><div class="kpi"><span>Gastos</span><b>${money(+month.expenses || 0)}</b></div></div>
  <div class="panel"><p class="lbl">Cuentas del mes</p><div class="sum">
    <div><span>Reservas pagadas por la app</span><span>${(+month.bookings || 0).toLocaleString("es-AR")}</span></div>
    <div><span>Cobrado a clientes por Mercado Pago</span><span>${money(+month.charged || 0)}</span></div>
    <div><span>Señas para los prestadores</span><span>−${money(+month.deposits || 0)}</span></div>
    <div class="tot"><span>Comisión de TuTiempo</span><span>${money(+month.commission || 0)}</span></div></div>
   <p class="note" style="text-align:left;margin:6px 0 0">No cuenta los turnos que canceló el profesional: esa plata se devolvió.</p></div>
  <div class="panel"><p class="lbl">Gastos de TuTiempo</p>
   ${expenses.length ? `<ul class="ag">${expenses.map((exp) => `<li><span class="ag-t">${dm(exp.day)}</span><div><b>${esc(exp.concept)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(+exp.amount)}</b>${closed ? "" : `<button class="xbtn" data-act="admExpDel" data-id="${exp.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`).join("")}</ul>` : '<p class="note" style="text-align:left">No hay gastos cargados este mes.</p>'}
   ${closed ? '<p class="note" style="text-align:left;margin:8px 0 0">El mes está cerrado: para cambiar los gastos, reabrilo.</p>' : `<form class="gform" id="fAdmExp" data-m="${ym}" novalidate><input id="aec" maxlength="80" placeholder="Concepto (ej: Hosting)" autocomplete="off" aria-label="Concepto"><input id="aem" inputmode="numeric" placeholder="$ Monto" autocomplete="off" aria-label="Monto"><button class="btn btn-pri" type="submit">Agregar gasto</button></form><div class="err" id="aeerr"></div>`}</div>
  ${closed ? `<div class="panel cclosed"><b>✓ ${capW(MESES[monthIndex])} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(month.closed_at)}. Los números quedaron fijos.</p>${fin.year_closed_at ? '<p class="note" style="text-align:left;margin:4px 0 0">El año está cerrado: reabrí el año para cambiar este mes.</p>' : `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="month" data-p="${ym}-01">Reabrir el mes</button>`}</div>` : month.state === "ended" ? `<button class="btn btn-pri btn-block" data-act="admClose" data-k="month" data-p="${ym}-01">Cerrar ${MESES[monthIndex]} · resultado ${money(result)}</button>` : `<p class="note" style="margin:0">${capW(MESES[monthIndex])} se cierra cuando termina el mes.</p>`}`;
}

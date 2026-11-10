import { LIVE } from "../../config.js";
import { ADM_LAUNCH } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MESES, NOW, TODAY, capW, dm, dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { admFin } from "./datos.js";
import { YEARS } from "../prestador/finanzas.js";
import { ic } from "../../ui/iconos.js";

// mes sin movimientos
export const Z5 = () => ({
  bookings: 0,
  charged: 0,
  deposits: 0,
  commission: 0,
  expenses: 0,
  fixed: 0,
  variable: 0,
});
// D44: gastos de un mes o de un año (fijos y variables por separado) y el resultado: comisiones − fijos − variables
const num = (value) => +value || 0;
const resultOf = (row) => num(row.commission) - num(row.fixed) - num(row.variable);
const expCell = (row) => `<td>${money(num(row.fixed))}</td><td>${money(num(row.variable))}</td>`;
// balance de la plataforma por año: comisiones menos gastos fijos y variables, mes por mes y año por año, con cierres
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
  const total = (key) => past.reduce((sum, row) => sum + num(row[key]), 0);
  const commission = total("commission");
  const fixed = total("fixed");
  const variable = total("variable");
  const result = commission - fixed - variable;
  const bookings = total("bookings");
  const toClose = months.filter((row) => row.state === "ended");
  const years = (fin.years || []).slice();
  if (!fin.year_closed_at && year <= nowYear) {
    years.push({
      year: year,
      commission: commission,
      fixed: fixed,
      variable: variable,
      open: true,
    });
  }
  years.sort((one, other) => one.year - other.year);
  if (year > nowYear) {
    return `${yearSel}<div class="panel" style="text-align:center"><p class="note" style="margin:0">${year} todavía no empezó. Acá vas a ver el balance de cada mes y cerrarlo.</p></div>`;
  } else {
    return `${yearSel}
   <div class="kpis"><div class="kpi big"><span>Resultado ${year}${year === nowYear ? " (hasta hoy)" : ""}</span><b style="color:${result >= 0 ? "var(--ok)" : "var(--bad)"}">${money(result)}</b><small>Comisiones − gastos fijos − gastos variables</small></div>
    <div class="kpi"><span>Comisiones</span><b>${money(commission)}</b><small>${bookings.toLocaleString("es-AR")} reservas pagadas</small></div><div class="kpi"><span>Gastos</span><b>${money(fixed + variable)}</b><small>Fijos ${money(fixed)} · variables ${money(variable)}</small></div></div>
   <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl abal"><thead><tr><th>Mes</th><th>Comisión</th><th>Fijos</th><th>Variables</th><th>Resultado</th></tr></thead><tbody>
    ${months.map((row, index) => (row.state === "future" ? "" : `<tr><td><button class="lnk" data-act="admM" data-m="${row.month}">${capW(MESES[index])}</button>${row.state === "open" ? " *" : row.state === "closed" ? ' <span class="okc" title="Cerrado">✓</span>' : row.state === "ended" ? ' <span class="dotw" title="Falta cerrarlo">•</span>' : ""}</td><td>${money(num(row.commission))}</td>${expCell(row)}<td><b>${money(resultOf(row))}</b></td></tr>`)).join("")}
    <tr class="ttot"><td><b>Total</b></td><td><b>${money(commission)}</b></td><td><b>${money(fixed)}</b></td><td><b>${money(variable)}</b></td><td><b>${money(result)}</b></td></tr></tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">${year === nowYear ? "* Mes en curso. " : ""}✓ cerrado · • terminó y falta cerrarlo. Tocá un mes para ver sus cuentas, cargar gastos y cerrarlo.</p>
    ${toClose.length ? `<button class="btn btn-pri btn-block" style="margin-top:8px" data-act="admM" data-m="${toClose[0].month}">Cerrar ${MESES[+toClose[0].month.slice(5) - 1]}${toClose.length > 1 ? ` (faltan ${toClose.length} meses)` : ""}</button>` : ""}</div>
   ${fin.year_closed_at ? `<div class="panel cclosed"><b>✓ Año ${year} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(fin.year_closed_at)} · resultado ${money(result)}. Los números quedaron fijos.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="year" data-p="${year}-01-01">Reabrir el año</button></div>` : fin.can_close_year ? `<button class="btn ${toClose.length ? "btn-ghost" : "btn-pri"} btn-block" data-act="admClose" data-k="year" data-p="${year}-01-01">Cerrar el año ${year} · resultado ${money(result)}</button><p class="note" style="margin:0">Cierra también los meses que falten.</p>` : `<p class="note" style="margin:0">El año ${year} se cierra cuando termina (desde el 1° de enero de ${year + 1}).</p>`}
   <div class="panel"><p class="lbl">Año por año</p><div class="tblwrap"><table class="ftbl abal"><thead><tr><th>Año</th><th>Comisión</th><th>Fijos</th><th>Variables</th><th>Resultado</th></tr></thead><tbody>
    ${years.map((row) => `<tr><td><button class="lnk" data-act="admY" data-y="${row.year}">${row.year}</button> ${row.open ? '<span class="hint">abierto</span>' : '<span class="okc">✓</span>'}</td><td>${money(num(row.commission))}</td>${expCell(row)}<td><b>${money(resultOf(row))}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">✓ = año cerrado.</p></div>`;
  }
}
// D44: los gastos fijos que corren en un mes y la fila de ese mes (o null: sin monto o todavía sin cargar)
export const admFixedFor = (fin, ym) => (fin.fixed_items || []).filter((item) => item.since <= ym && (!item.until || item.until >= ym));
export const admFixedRow = (fin, item, ym) => (fin.expenses || []).find((exp) => exp.fixed_id === item.id && String(exp.day).slice(0, 7) === ym) || null;
// D44: gastos fijos de TuTiempo en un mes, como en Finanzas del profesional (C31, S17): se repiten solos; se cambian
// con ✎ solo en el mes actual y valen de ahí en adelante; los precargados sin monto dicen «Completá el monto»
function admFixedPanel(fin, ym, current, closed, total) {
  const items = admFixedFor(fin, ym);
  const editable = !closed && ym === current;
  const line = (item) => {
    const row = admFixedRow(fin, item, ym);
    const editing = editable && S.admFxEd === item.id;
    const missing = !row && !item.amount;
    const head = `<li class="${editing ? "on" : ""}${missing ? " afx-missing" : ""}" data-fx="${item.id}"><span class="ag-t">Fijo</span><div><b>${esc(item.concept)}</b>${missing ? `<span class="hint">Completá el monto${editable ? ` con ${ic("editar")}` : ""}</span>` : ""}</div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${row ? money(+row.amount) : "—"}</b>${editable ? `<button class="xbtn" data-act="admFxEdit" data-id="${item.id}" aria-label="Cambiar ${esc(item.concept)}">${ic("editar")}</button>` : ""}</span></li>`;
    return editing ? head + `<li class="movform">${admFixedForm(item, ym, row ? +row.amount : item.amount)}</li>` : head;
  };
  return `<div class="panel afix"><p class="lbl">Gastos fijos · ${money(total)}</p>
   ${editable ? `<p class="note" style="text-align:left;margin:-2px 0 10px">Se repiten solos todos los meses. Si cambian, tocá ${ic("editar")}: vale desde ${esc(MESES[+ym.slice(5) - 1])} en adelante y los meses cerrados quedan como estaban.</p>` : ""}
   ${items.length ? `<ul class="ag movs">${items.map(line).join("")}</ul>` : '<p class="note" style="text-align:left">No hay gastos fijos este mes.</p>'}
   ${editable ? (S.admFxEd === "new" ? admFixedForm(null, ym, "") : '<button class="btn btn-ghost btn-block" style="margin-top:8px" data-act="admFxNew">+ Otro gasto fijo</button>') : closed ? `<p class="note" style="text-align:left;margin:8px 0 0">${ic("candado")} Mes cerrado: los gastos fijos de este mes quedan como están.</p>` : ym < current ? '<p class="note" style="text-align:left;margin:8px 0 0">Los gastos fijos se cambian desde el mes actual en adelante: este mes queda como está.</p>' : ""}</div>`;
}
function admFixedForm(item, ym, amount) {
  return `<form id="fAdmFixed" class="mediaed" data-id="${item ? item.id : ""}" data-ym="${ym}" novalidate>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="afc">Concepto</label><input id="afc" maxlength="80" autocomplete="off" value="${esc(item ? item.concept : "")}" placeholder="Ej: Contador"></div>
   <div class="f"><label for="afm">Monto por mes</label><input id="afm" inputmode="numeric" autocomplete="off" placeholder="$" value="${amount || ""}"></div></div>
   <p class="hint">Vale desde ${esc(MESES[+ym.slice(5) - 1])} ${ym.slice(0, 4)} en adelante. Los meses cerrados no cambian.</p>
   <div class="err" id="aferr"></div>
   <div class="rs-btns"><button type="button" class="btn btn-ghost" data-act="admFxClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar</button></div>
   ${item ? `<button type="button" class="btn btn-ghost btn-block mediadel" data-act="admFxStop" data-id="${item.id}" data-ym="${ym}">Dejar de repetirlo desde este mes</button>` : ""}</form>`;
}
// D44: gastos variables de un mes (los que no se repiten): agregar, cambiar (✎) y borrar (✕), salvo en un mes cerrado
function admVariablePanel(fin, ym, closed, total) {
  const rows = (fin.expenses || []).filter((exp) => !exp.fixed_id && String(exp.day).slice(0, 7) === ym);
  const line = (exp) => {
    const editing = !closed && S.admExpEd === exp.id;
    const head = `<li class="${editing ? "on" : ""}" data-exp="${exp.id}"><span class="ag-t">${dm(exp.day)}</span><div><b>${esc(exp.concept)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(+exp.amount)}</b>${closed ? "" : `<button class="xbtn" data-act="admExpEdit" data-id="${exp.id}" aria-label="Cambiar ${esc(exp.concept)}">${ic("editar")}</button><button class="xbtn" data-act="admExpDel" data-id="${exp.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`;
    return editing
      ? head +
          `<li class="movform"><form id="fAdmExpEd" class="mediaed" data-id="${exp.id}" novalidate><div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="aeec">Concepto</label><input id="aeec" maxlength="80" autocomplete="off" value="${esc(exp.concept)}"></div><div class="f"><label for="aeem">Monto</label><input id="aeem" inputmode="numeric" autocomplete="off" value="${+exp.amount}"></div></div><div class="err" id="aeeerr"></div><div class="rs-btns"><button type="button" class="btn btn-ghost" data-act="admExpEdit" data-id="">Cancelar</button><button class="btn btn-pri" type="submit">Guardar</button></div></form></li>`
      : head;
  };
  return `<div class="panel avar"><p class="lbl">Gastos variables · ${money(total)}</p>
   <p class="note" style="text-align:left;margin:-2px 0 10px">Lo que no se repite todos los meses (publicidad, diseño…); se suma en el resultado del mes.</p>
   ${rows.length ? `<ul class="ag movs">${rows.map(line).join("")}</ul>` : '<p class="note" style="text-align:left">No hay gastos variables este mes.</p>'}
   ${closed ? `<p class="note" style="text-align:left;margin:8px 0 0">${ic("candado")} El mes está cerrado: para cambiar los gastos, reabrilo.</p>` : `<form class="gform" id="fAdmExp" data-m="${ym}" novalidate><input id="aec" maxlength="80" placeholder="Concepto (ej: Publicidad)" autocomplete="off" aria-label="Concepto"><input id="aem" inputmode="numeric" placeholder="$ Monto" autocomplete="off" aria-label="Monto"><button class="btn btn-pri" type="submit">Agregar</button></form><div class="err" id="aeerr"></div>`}</div>`;
}
// D44: el resumen del mes como en Finanzas del profesional: la comisión, los gastos fijos y variables y el resultado
function admMonthSummary(monthName, commission, fixed, variable) {
  const max = Math.max(1, commission, fixed, variable);
  const bar = (label, value, kind) =>
    `<div class="mrow"><span>${esc(label)}</span><i class="mbar ${kind}" style="width:${Math.round((value / max) * 100)}%"></i><b>${money(value)}</b></div>`;
  const result = commission - fixed - variable;
  return `<div class="panel msum asum"><p class="lbl">Resumen de ${esc(capW(monthName))}</p>
   <p class="mhead">Ingresos · ${money(commission)}</p>${bar("Comisión de TuTiempo", commission, "in")}
   <p class="mhead">Gastos · ${money(fixed + variable)}</p>${bar("Gastos fijos", fixed, "out")}${bar("Gastos variables", variable, "out")}
   <p class="mbal ${result >= 0 ? "pos" : "neg"}">Resultado: ${money(result)}</p></div>`;
}
// cuentas de un mes (ym = AAAA-MM): reservas, cobrado, señas, comisión, gastos fijos y variables y cierre
function admBalMonth(fin, ym) {
  const current = fin.current_month || TODAY().slice(0, 7);
  const month = (fin.months || []).find((row) => row.month === ym) || Z5();
  const monthIndex = +ym.slice(5) - 1;
  const year = +ym.slice(0, 4);
  const commission = num(month.commission);
  const fixed = num(month.fixed);
  const variable = num(month.variable);
  const result = commission - fixed - variable;
  const closed = month.state === "closed";
  return `<button class="back" data-act="admM" data-m="">← Volver a ${year}</button>
  <div class="wnav"><button class="pk-nav" data-act="admMn" data-d="-1" aria-label="Mes anterior" ${ym <= ADM_LAUNCH.slice(0, 7) && !LIVE ? "disabled" : ""}>‹</button><div><b style="text-transform:capitalize">${MESES[monthIndex]} ${year}</b><span>${month.state === "open" ? "Mes en curso" : closed ? "✓ Mes cerrado" : "Terminó · falta cerrarlo"}</span></div><button class="pk-nav" data-act="admMn" data-d="1" aria-label="Mes siguiente" ${ym >= current ? "disabled" : ""}>›</button></div>
  <div class="kpis"><div class="kpi big"><span>Resultado de ${MESES[monthIndex]}</span><b style="color:${result >= 0 ? "var(--ok)" : "var(--bad)"}">${money(result)}</b><small>Comisión − gastos fijos − gastos variables${month.state === "open" ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Comisión</span><b>${money(commission)}</b></div><div class="kpi"><span>Gastos</span><b>${money(fixed + variable)}</b><small>Fijos ${money(fixed)} · variables ${money(variable)}</small></div></div>
  ${admMonthSummary(MESES[monthIndex], commission, fixed, variable)}
  <div class="panel"><p class="lbl">Cuentas del mes</p><div class="sum">
    <div><span>Reservas pagadas por la app</span><span>${num(month.bookings).toLocaleString("es-AR")}</span></div>
    <div><span>Cobrado a clientes por Mercado Pago</span><span>${money(num(month.charged))}</span></div>
    <div><span>Señas para los profesionales</span><span>−${money(num(month.deposits))}</span></div>
    <div class="tot"><span>Comisión de TuTiempo</span><span>${money(commission)}</span></div></div>
   <p class="note" style="text-align:left;margin:6px 0 0">No cuenta los turnos que canceló el profesional: esa plata se devolvió.</p></div>
  ${admFixedPanel(fin, ym, current, closed, fixed)}
  ${admVariablePanel(fin, ym, closed, variable)}
  ${closed ? `<div class="panel cclosed"><b>✓ ${capW(MESES[monthIndex])} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(month.closed_at)}. Los números quedaron fijos.</p>${fin.year_closed_at ? '<p class="note" style="text-align:left;margin:4px 0 0">El año está cerrado: reabrí el año para cambiar este mes.</p>' : `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="month" data-p="${ym}-01">Reabrir el mes</button>`}</div>` : month.state === "ended" ? `<button class="btn btn-pri btn-block" data-act="admClose" data-k="month" data-p="${ym}-01">Cerrar ${MESES[monthIndex]} · resultado ${money(result)}</button>` : `<p class="note" style="margin:0">${capW(MESES[monthIndex])} se cierra cuando termina el mes.</p>`}`;
}

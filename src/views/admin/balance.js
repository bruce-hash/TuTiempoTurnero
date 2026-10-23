import { LIVE } from "../../config.js";
import { ADM_LAUNCH } from "../../demo/admin.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MESES, NOW, TODAY, capW, dm, dmyIso } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { admFin } from "./datos.js";
import { YEARS } from "../prestador/finanzas.js";

export const Z5 = () => ({
  bookings: 0,
  charged: 0,
  deposits: 0,
  commission: 0,
  expenses: 0,
});
export function admBal() {
  const e = NOW().getFullYear();
  const a = YEARS().includes(S.admY) ? S.admY : e;
  const t = admFin(a);
  const s = `<div class="yearsel">${YEARS()
    .map((y) => `<button data-act="admY" data-y="${y}" aria-pressed="${a === y}">${y}</button>`)
    .join("")}</div>`;
  if (!t) {
    return s + '<div class="skel" style="min-height:240px"></div>';
  }
  if (t.err) {
    return s + '<div class="panel"><b>No pudimos cargar el balance.</b></div>';
  }
  if (S.admM && S.admM.slice(0, 4) === String(a)) {
    return s + admBalMonth(t, S.admM);
  }
  const n = t.months || [];
  const o = n.filter((y) => y.state !== "future");
  const i = o.reduce((y, k) => y + (+k.commission || 0), 0);
  const l = o.reduce((y, k) => y + (+k.expenses || 0), 0);
  const c = i - l;
  const d = o.reduce((y, k) => y + (+k.bookings || 0), 0);
  const p = n.filter((y) => y.state === "ended");
  const w = (t.years || []).slice();
  if (!t.year_closed_at && a <= e) {
    w.push({
      year: a,
      commission: i,
      expenses: l,
      open: true,
    });
  }
  w.sort((y, k) => y.year - k.year);
  if (a > e) {
    return `${s}<div class="panel" style="text-align:center"><p class="note" style="margin:0">${a} todavía no empezó. Acá vas a ver el balance de cada mes y cerrarlo.</p></div>`;
  } else {
    return `${s}
   <div class="kpis"><div class="kpi big"><span>Resultado ${a}${a === e ? " (hasta hoy)" : ""}</span><b style="color:${c >= 0 ? "var(--ok)" : "var(--bad)"}">${money(c)}</b><small>Comisiones − gastos de TuTiempo</small></div>
    <div class="kpi"><span>Comisiones</span><b>${money(i)}</b><small>${d.toLocaleString("es-AR")} reservas pagadas</small></div><div class="kpi"><span>Gastos</span><b>${money(l)}</b></div></div>
   <div class="panel"><p class="lbl">Mes por mes</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Mes</th><th>Comisión</th><th>Gastos</th><th>Resultado</th></tr></thead><tbody>
    ${n.map((y, k) => (y.state === "future" ? "" : `<tr><td><button class="lnk" data-act="admM" data-m="${y.month}">${capW(MESES[k])}</button>${y.state === "open" ? " *" : y.state === "closed" ? ' <span class="okc" title="Cerrado">✓</span>' : y.state === "ended" ? ' <span class="dotw" title="Falta cerrarlo">•</span>' : ""}</td><td>${money(+y.commission || 0)}</td><td>${money(+y.expenses || 0)}</td><td><b>${money((+y.commission || 0) - (+y.expenses || 0))}</b></td></tr>`)).join("")}
    <tr class="ttot"><td><b>Total</b></td><td><b>${money(i)}</b></td><td><b>${money(l)}</b></td><td><b>${money(c)}</b></td></tr></tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">${a === e ? "* Mes en curso. " : ""}✓ cerrado · • terminó y falta cerrarlo. Tocá un mes para ver sus cuentas, cargar gastos y cerrarlo.</p>
    ${p.length ? `<button class="btn btn-pri btn-block" style="margin-top:8px" data-act="admM" data-m="${p[0].month}">Cerrar ${MESES[+p[0].month.slice(5) - 1]}${p.length > 1 ? ` (faltan ${p.length} meses)` : ""}</button>` : ""}</div>
   ${t.year_closed_at ? `<div class="panel cclosed"><b>✓ Año ${a} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(t.year_closed_at)} · resultado ${money(c)}. Los números quedaron fijos.</p><button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="year" data-p="${a}-01-01">Reabrir el año</button></div>` : t.can_close_year ? `<button class="btn ${p.length ? "btn-ghost" : "btn-pri"} btn-block" data-act="admClose" data-k="year" data-p="${a}-01-01">Cerrar el año ${a} · resultado ${money(c)}</button><p class="note" style="margin:0">Cierra también los meses que falten.</p>` : `<p class="note" style="margin:0">El año ${a} se cierra cuando termina (desde el 1° de enero de ${a + 1}).</p>`}
   <div class="panel"><p class="lbl">Año por año</p><div class="tblwrap"><table class="ftbl"><thead><tr><th>Año</th><th>Comisión</th><th>Gastos</th><th>Resultado</th></tr></thead><tbody>
    ${w.map((y) => `<tr><td><button class="lnk" data-act="admY" data-y="${y.year}">${y.year}</button> ${y.open ? '<span class="hint">abierto</span>' : '<span class="okc">✓</span>'}</td><td>${money(+y.commission || 0)}</td><td>${money(+y.expenses || 0)}</td><td><b>${money((+y.commission || 0) - (+y.expenses || 0))}</b></td></tr>`).join("")}</tbody></table></div>
    <p class="note" style="text-align:left;margin-top:6px">✓ = año cerrado.</p></div>`;
  }
}
function admBalMonth(e, a) {
  const t = TODAY().slice(0, 7);
  const s = (e.months || []).find((d) => d.month === a) || Z5();
  const n = +a.slice(5) - 1;
  const o = +a.slice(0, 4);
  const i = (e.expenses || []).filter((d) => String(d.day).slice(0, 7) === a);
  const l = (+s.commission || 0) - (+s.expenses || 0);
  const c = s.state === "closed";
  return `<button class="back" data-act="admM" data-m="">← Volver a ${o}</button>
  <div class="wnav"><button class="pk-nav" data-act="admMn" data-d="-1" aria-label="Mes anterior" ${a <= ADM_LAUNCH.slice(0, 7) && !LIVE ? "disabled" : ""}>‹</button><div><b style="text-transform:capitalize">${MESES[n]} ${o}</b><span>${s.state === "open" ? "Mes en curso" : c ? "✓ Mes cerrado" : "Terminó · falta cerrarlo"}</span></div><button class="pk-nav" data-act="admMn" data-d="1" aria-label="Mes siguiente" ${a >= t ? "disabled" : ""}>›</button></div>
  <div class="kpis"><div class="kpi big"><span>Resultado de ${MESES[n]}</span><b style="color:${l >= 0 ? "var(--ok)" : "var(--bad)"}">${money(l)}</b><small>Comisión − gastos${s.state === "open" ? " (hasta hoy)" : ""}</small></div><div class="kpi"><span>Comisión</span><b>${money(+s.commission || 0)}</b></div><div class="kpi"><span>Gastos</span><b>${money(+s.expenses || 0)}</b></div></div>
  <div class="panel"><p class="lbl">Cuentas del mes</p><div class="sum">
    <div><span>Reservas pagadas por la app</span><span>${(+s.bookings || 0).toLocaleString("es-AR")}</span></div>
    <div><span>Cobrado a clientes por Mercado Pago</span><span>${money(+s.charged || 0)}</span></div>
    <div><span>Señas para los prestadores</span><span>−${money(+s.deposits || 0)}</span></div>
    <div class="tot"><span>Comisión de TuTiempo</span><span>${money(+s.commission || 0)}</span></div></div>
   <p class="note" style="text-align:left;margin:6px 0 0">No cuenta los turnos que canceló el profesional: esa plata se devolvió.</p></div>
  <div class="panel"><p class="lbl">Gastos de TuTiempo</p>
   ${i.length ? `<ul class="ag">${i.map((d) => `<li><span class="ag-t">${dm(d.day)}</span><div><b>${esc(d.concept)}</b></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(+d.amount)}</b>${c ? "" : `<button class="xbtn" data-act="admExpDel" data-id="${d.id}" aria-label="Borrar gasto">✕</button>`}</span></li>`).join("")}</ul>` : '<p class="note" style="text-align:left">No hay gastos cargados este mes.</p>'}
   ${c ? '<p class="note" style="text-align:left;margin:8px 0 0">El mes está cerrado: para cambiar los gastos, reabrilo.</p>' : `<form class="gform" id="fAdmExp" data-m="${a}" novalidate><input id="aec" maxlength="80" placeholder="Concepto (ej: Hosting)" autocomplete="off" aria-label="Concepto"><input id="aem" inputmode="numeric" placeholder="$ Monto" autocomplete="off" aria-label="Monto"><button class="btn btn-pri" type="submit">Agregar gasto</button></form><div class="err" id="aeerr"></div>`}</div>
  ${c ? `<div class="panel cclosed"><b>✓ ${capW(MESES[n])} cerrado</b><p class="note" style="text-align:left;margin:4px 0 0">Cerrado el ${dmyIso(s.closed_at)}. Los números quedaron fijos.</p>${e.year_closed_at ? '<p class="note" style="text-align:left;margin:4px 0 0">El año está cerrado: reabrí el año para cambiar este mes.</p>' : `<button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="admReopen" data-k="month" data-p="${a}-01">Reabrir el mes</button>`}</div>` : s.state === "ended" ? `<button class="btn btn-pri btn-block" data-act="admClose" data-k="month" data-p="${a}-01">Cerrar ${MESES[n]} · resultado ${money(l)}</button>` : `<p class="note" style="margin:0">${capW(MESES[n])} se cierra cuando termina el mes.</p>`}`;
}

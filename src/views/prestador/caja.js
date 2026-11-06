import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { nowHM } from "../../lib/fechas.js";
import { MEDIOS } from "../../lib/medios.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";

// C34 (V4): la Caja es parte de Finanzas ("Caja del día"). Acá quedan los formularios de lo que se cobra en el local:
// cargar un servicio sin turno o una venta, y editar lo ya cargado (C25).
const medioButtons = (current) =>
  `<div class="f"><label>Medio de pago</label><div class="opts" style="grid-template-columns:repeat(3,minmax(0,1fr))">${MEDIOS.map((medio) => `<button type="button" class="opt" data-medio="${medio}" aria-pressed="${(current || "Efectivo") === medio}">${medio}</button>`).join("")}</div></div>`;

// 7/11: dos botones propios en la Caja del día: un servicio sin turno y vender un producto (antes iban juntos)
export function walkForm(prov) {
  if (S.saleOpen) {
    return saleForm();
  }
  if (!S.walkOpen) {
    return `<div class="cajabtns"><button class="btn btn-pri" data-act="walkOpen">+ Servicio sin turno</button><button class="btn btn-pri" data-act="saleOpen" ${store.PRODS.length ? "" : "disabled"}>${ic("productos")} Vender producto</button></div>${store.PRODS.length ? "" : '<p class="note salenote" style="margin-top:6px">Para vender, cargá tus productos en Productos.</p>'}`;
  }
  return `<form class="panel" id="fWalk" novalidate style="background:var(--bg);margin-top:10px"><p class="lbl">Servicio sin turno</p>
    <div class="f"><label for="wsv">¿Qué hiciste?</label><select id="wsv">${prov.svcs.map((svc, index) => `<option value="${index}">${esc(svc[0])} · ${money(svc[2])}</option>`).join("")}<option value="otro">Otro servicio</option></select></div>
    <div class="f" id="wotroBox" hidden><label for="wotro">¿Qué servicio?</label><input id="wotro" placeholder="Ej: Diseño en la ceja" autocomplete="off"></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
     <div class="f"><label for="wpr">Cobraste</label><input id="wpr" inputmode="numeric" value="${(prov.svcs[0] || [0, 0, 0])[2]}" autocomplete="off"></div>
     <div class="f"><label for="whr">Hora</label><input id="whr" type="time" value="${nowHM()}"></div></div>
    ${medioButtons(S.walkMedio)}
    <div class="f"><label for="wcl">Cliente (opcional)</label><input id="wcl" placeholder="Nombre" autocomplete="off"></div>
    <div class="err" id="werr"></div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="walkClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar</button></div>
    <p class="note" style="margin-top:8px">Los servicios sin turno no pagan comisión.</p></form>`;
}
// vender un producto: cuál (con su stock), cuántos (1 por defecto) y cómo te pagó; el total es precio × cantidad.
// Descuenta del stock y entra en la Caja del día como una venta.
export const saleTotal = (prod, qty) => (prod && qty > 0 ? prod.p * qty : 0);
function saleForm() {
  const prods = store.PRODS;
  const index = Math.min(Math.max(0, S.saleI || prods.findIndex((prod) => prod.stock > 0)), prods.length - 1);
  const prod = prods[index];
  return `<form class="panel" id="fSale" novalidate style="background:var(--bg);margin-top:10px"><p class="lbl">${ic("productos")} Vender producto</p>
    <div class="f"><label for="spr">Producto</label><select id="spr">${prods.map((item, i) => `<option value="${i}" ${i === index ? "selected" : ""} ${item.stock > 0 ? "" : "disabled"}>${esc(item.n)} · ${money(item.p)}${item.stock > 0 ? ` (${item.stock} en stock)` : " · sin stock"}</option>`).join("")}</select></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
     <div class="f"><label for="sqty">Cantidad</label><input id="sqty" inputmode="numeric" value="1" autocomplete="off"></div>
     <div class="f"><label>Total</label><p class="saletot" id="stot">${money(saleTotal(prod, 1))}</p></div></div>
    ${medioButtons(S.walkMedio)}
    <div class="err" id="serr"></div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="saleClose">Cancelar</button><button class="btn btn-pri" type="submit">Vender</button></div>
    <p class="note" style="margin-top:8px">Se descuenta del stock y suma a la caja de hoy.</p></form>`;
}
// editar algo cargado sin turno (o una venta): qué, cuánto, a qué hora, con qué medio y quién
export function walkEditForm(walk) {
  return `<form class="panel movedit" id="fWalkEd" novalidate style="background:var(--bg)"><p class="lbl">Editar movimiento</p>
    <div class="f"><label for="wed_d">Qué</label><input id="wed_d" maxlength="80" value="${esc(walk.svc)}" autocomplete="off" ${walk.kind === "prod" ? "disabled" : ""}></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
     <div class="f"><label for="wed_m">Cobraste</label><input id="wed_m" inputmode="numeric" value="${walk.precio}" autocomplete="off"></div>
     <div class="f"><label for="wed_h">Hora</label><input id="wed_h" type="time" value="${esc(walk.hora)}"></div></div>
    ${medioButtons(S.walkMedio || walk.medio)}
    <div class="f"><label for="wed_c">Cliente (opcional)</label><input id="wed_c" maxlength="80" value="${esc(walk.cliente || "")}" autocomplete="off"></div>
    <div class="err" id="wederr"></div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="movEdClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar cambios</button></div></form>`;
}

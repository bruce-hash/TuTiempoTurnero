import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { nowHM } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { store } from "../../store.js";

const MEDIOS = ["Efectivo", "Mercado Pago"];
// caja del día: lo cobrado en el local sin turno (S.walk) más lo que entró por TuTiempo, por medio de pago
export function vCaja(prov) {
  const walks = S.walk;
  const walkTotal = walks.reduce((sum, walk) => sum + walk.precio + walk.propina, 0);
  const online = S.earnToday;
  const byMedio = {};
  walks.forEach((walk) => (byMedio[walk.medio] = (byMedio[walk.medio] || 0) + walk.precio + walk.propina));
  const form = S.walkOpen
    ? `<form class="panel" id="fWalk" novalidate style="background:var(--bg)"><p class="lbl">Servicio sin turno o venta</p>
    <div class="f"><label for="wsv">¿Qué hiciste?</label><select id="wsv"><optgroup label="Servicios">${prov.svcs.map((svc, index) => `<option value="${index}">${esc(svc[0])} · ${money(svc[2])}</option>`).join("")}<option value="otro">Otro servicio</option></optgroup><optgroup label="Productos">${store.PRODS.map((prod, index) => `<option value="p${index}" ${prod.stock ? "" : "disabled"}>${esc(prod.n)} · ${money(prod.p)}${prod.stock ? ` (${prod.stock} en stock)` : " · sin stock"}</option>`).join("")}</optgroup></select></div>
    <div class="f" id="wotroBox" hidden><label for="wotro">¿Qué servicio?</label><input id="wotro" placeholder="Ej: Diseño en la ceja" autocomplete="off"></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))">
     <div class="f"><label for="wpr">Cobraste</label><input id="wpr" inputmode="numeric" value="${(prov.svcs[0] || [0, 0, 0])[2]}" autocomplete="off"></div>
     <div class="f"><label for="whr">Hora</label><input id="whr" type="time" value="${nowHM()}"></div></div>
    <div class="f"><label>Medio de pago</label><div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))">${MEDIOS.map((medio, index) => `<button type="button" class="opt" data-medio="${medio}" aria-pressed="${(S.walkMedio || "Efectivo") === medio}">${medio}</button>`).join("")}</div></div>
    <div class="f"><label for="wcl">Cliente (opcional)</label><input id="wcl" placeholder="Nombre" autocomplete="off"></div>
    <div class="err" id="werr"></div>
    <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="walkClose">Cancelar</button><button class="btn btn-pri" type="submit">Guardar servicio</button></div>
    <p class="note" style="margin-top:8px">Los servicios sin turno no pagan comisión.</p></form>`
    : '<button class="btn btn-pri btn-block" data-act="walkOpen">+ Cargar servicio sin turno o venta</button>';
  return `<div class="panel stack" style="gap:12px"><p class="lbl" style="margin:0">Caja de hoy</p>
   <div class="stats2"><div><b>${S.jobsToday + walks.length}</b><span>Servicios</span></div><div><b>${money(walkTotal)}</b><span>En el local, sin turno</span></div><div><b>${money(online)}</b><span>Por TuTiempo</span></div></div>
   <div class="sum"><div class="tot" style="border-top:0;padding-top:0"><span>Total del día</span><span style="color:var(--ok)">${money(walkTotal + online)}</span></div>
    ${Object.keys(byMedio)
      .map((medio) => `<div><span>${medio}</span><span>${money(byMedio[medio])}</span></div>`)
      .join("")}</div>
   ${form}
   ${walks.length ? `<ul class="ag">${walks.map((walk, index) => `<li><span class="ag-t">${esc(walk.hora)}</span><div><b>${walk.kind === "prod" ? "🧴 " : ""}${esc(walk.svc)}</b><span>${esc(walk.cliente || "Cliente sin turno")} · ${esc(walk.medio)}</span></div><span style="display:flex;gap:6px;align-items:center"><b class="price" style="font-size:15px">${money(walk.precio)}</b><button class="xbtn" data-act="walkDel" data-i="${index}" aria-label="Borrar">✕</button></span></li>`).join("")}</ul>` : '<p class="note">Cuando te cae alguien sin turno, cargalo acá en 10 segundos. Así tus estadísticas y tu caja quedan completas.</p>'}
  </div>`;
}

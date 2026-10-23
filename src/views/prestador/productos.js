import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { S } from "../../state.js";
import { store } from "../../store.js";

store.PRODS = [];
// productos vendidos hoy (se cargan en la caja como movimientos de tipo prod)
function soldToday() {
  return S.walk.filter((item) => item.kind === "prod");
}
// stock de productos para vender: alerta de reposición, sumar/restar, compras (van a gastos) y alta
export function vBProductos() {
  const low = store.PRODS.filter((prod) => prod.stock <= prod.min);
  const units = store.PRODS.reduce((sum, prod) => sum + prod.stock, 0);
  const value = store.PRODS.reduce((sum, prod) => sum + prod.stock * prod.p, 0);
  const sold = soldToday();
  return `<div class="stats2"><div><b>${store.PRODS.length}</b><span>Productos</span></div><div><b>${units}</b><span>Unidades en stock</span></div><div><b>${money(value)}</b><span>Valor de venta</span></div></div>
  ${low.length ? `<p class="alert" style="margin:0">⚠ Reponer: ${low.map((prod) => `${esc(prod.n)} (${prod.stock} u.)`).join(", ")}</p>` : ""}
  <div class="panel"><p class="lbl">Tus productos</p>
   <ul class="plist">${store.PRODS.map(
     (
       prod,
       index,
     ) => `<li><div class="pl-m"><b>${esc(prod.n)}</b><span>${money(prod.p)} · mínimo ${prod.min} u.${prod.stock <= prod.min ? ' · <em class="lowtag">reponer</em>' : ""}</span></div>
     <div class="pl-s"><button class="xbtn" data-act="stk" data-i="${index}" data-d="-1" aria-label="Restar uno">−</button><b>${prod.stock}</b><button class="xbtn" data-act="stk" data-i="${index}" data-d="1" aria-label="Sumar uno">+</button></div>
     <button class="btn btn-ghost pl-buy" data-act="buyOpen" data-i="${index}">🛒 Compré más</button>
     ${
       S.buyI === index
         ? `<form class="buyform" id="fBuy" novalidate><div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="bq">Cantidad</label><input id="bq" inputmode="numeric" placeholder="Ej: 6" autocomplete="off"></div><div class="f"><label for="bc">Cuánto pagaste</label><input id="bc" inputmode="numeric" placeholder="$" autocomplete="off"></div></div>
       <div class="err" id="berr2"></div><div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="buyClose">Cancelar</button><button class="btn btn-pri" type="submit">Sumar al stock</button></div>
       <p class="note" style="margin-top:6px">Se suma al stock y se carga sola en los gastos del mes (Finanzas). Las compras de productos se cargan solo desde acá.</p></form>`
         : ""
     }</li>`,
   ).join("")}</ul>
   ${
     S.prodOpen
       ? `<form id="fProd" novalidate style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px"><p class="lbl">Producto nuevo</p>
     <div class="f"><label for="pnn">Nombre</label><input id="pnn" placeholder="Ej: Cera de brillo negra" autocomplete="off"></div>
     <div class="opts" style="grid-template-columns:repeat(3,minmax(0,1fr))"><div class="f"><label for="pnp">Precio de venta</label><input id="pnp" inputmode="numeric" placeholder="$" autocomplete="off"></div><div class="f"><label for="pns">Stock inicial</label><input id="pns" inputmode="numeric" value="0" autocomplete="off"></div><div class="f"><label for="pnm">Avisar con</label><input id="pnm" inputmode="numeric" value="2" autocomplete="off"></div></div>
     <div class="err" id="perr2"></div><div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="prodClose">Cancelar</button><button class="btn btn-pri" type="submit">Agregar producto</button></div></form>`
       : '<button class="btn btn-pri btn-block" style="margin-top:12px" data-act="prodOpen">+ Agregar producto para vender</button>'
   }</div>
  <div class="panel"><p class="lbl">Vendidos hoy</p>${sold.length ? `<ul class="ag">${sold.map((item) => `<li><span class="ag-t">${esc(item.hora)}</span><div><b>${esc(item.svc)}</b><span>${esc(item.medio)}</span></div><b class="price" style="font-size:15px">${money(item.precio)}</b></li>`).join("")}</ul>` : '<p class="note">Las ventas se cargan desde la pestaña Caja, y el stock baja solo.</p>'}</div>`;
}

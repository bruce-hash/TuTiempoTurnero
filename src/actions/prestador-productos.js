import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { PESOS_ERR, money, parsePesos, parseWhole } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, nowHM } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("stk", (ev, el, act) => {
  const prod = store.PRODS[+el.dataset.i];
  prod.stock = Math.max(0, prod.stock + +el.dataset.d);
  api.m.setStock(prod);
  render();
});
// C35 (V4): eliminar un producto, con aviso antes; las ventas y compras ya cargadas no se tocan
registerClick("prodDel", (ev, el, act) => {
  S.prodDel = +el.dataset.i;
  S.buyI = null;
  render();
});
registerClick("prodDelNo", (ev, el, act) => {
  S.prodDel = null;
  render();
});
registerClick("prodDelYes", (ev, el, act) => {
  const prod = store.PRODS.splice(+el.dataset.i, 1)[0];
  S.prodDel = null;
  if (prod) {
    api.m.delProduct(prod);
    toast("Eliminaste " + prod.n + ". Las ventas que ya cargaste quedan.");
  }
  render();
});
registerClick("buyOpen", (ev, el, act) => {
  S.buyI = +el.dataset.i;
  S.prodOpen = false;
  render();
  const input = $("#bq");
  if (input) {
    input.focus();
  }
});
registerClick("buyClose", (ev, el, act) => {
  S.buyI = null;
  render();
});
registerClick("prodOpen", (ev, el, act) => {
  S.prodOpen = true;
  S.buyI = null;
  render();
  const input = $("#pnn");
  if (input) {
    input.focus();
  }
});
registerClick("prodClose", (ev, el, act) => {
  S.prodOpen = false;
  render();
});
// compra de un producto: suma al stock y se carga sola como gasto del mes
registerSubmit("fBuy", (ev) => {
  const prod = store.PRODS[S.buyI];
  const qty = parseWhole($("#bq").value);
  const cost = parsePesos($("#bc").value);
  if (isNaN(qty)) {
    $("#berr2").textContent = "Escribí las unidades con números enteros.";
    return;
  }
  if (isNaN(cost)) {
    $("#berr2").textContent = PESOS_ERR;
    return;
  }
  if (qty <= 0) {
    $("#berr2").textContent = "Ingresá cuántas unidades compraste.";
    return;
  }
  if (cost <= 0) {
    $("#berr2").textContent = "Ingresá cuánto pagaste: se carga solo en los gastos del mes.";
    return;
  }
  prod.stock += qty;
  api.m.setStock(prod);
  {
    const expense = {
      id: store.GID++,
      c: `Compra: ${prod.n} × ${qty}`.slice(0, 80),
      m: cost,
      cat: "Productos",
      d: TODAY(),
    };
    store.GASTOS.push(expense);
    api.m.addExpense(expense);
  }
  S.buyI = null;
  toast(`Sumaste ${qty} u. de ${prod.n}. Stock: ${prod.stock}.${cost ? " Gasto cargado: " + money(cost) : ""}`);
  render();
  return;
});
registerSubmit("fProd", (ev) => {
  const name = $("#pnn").value.trim();
  const price = parsePesos($("#pnp").value);
  const stock = parseWhole($("#pns").value);
  const min = parseWhole($("#pnm").value);
  const costTxt = ($("#pnc").value || "").trim();
  const cost = costTxt === "" ? null : parsePesos(costTxt);
  if (cost != null && isNaN(cost)) {
    $("#perr2").textContent = PESOS_ERR;
    return;
  }
  if (isNaN(price)) {
    $("#perr2").textContent = PESOS_ERR;
    return;
  }
  if (isNaN(stock) || isNaN(min)) {
    $("#perr2").textContent = "Escribí el stock con números enteros.";
    return;
  }
  if (!name) {
    $("#perr2").textContent = "Escribí el nombre del producto.";
    return;
  }
  if (store.PRODS.some((item) => item.n.toLowerCase() === name.toLowerCase())) {
    $("#perr2").textContent = "Ya tenés un producto con ese nombre.";
    return;
  }
  if (price <= 0) {
    $("#perr2").textContent = "Ingresá el precio de venta.";
    return;
  }
  {
    const prod = {
      n: name.slice(0, 80),
      p: price,
      stock: stock,
      min: min,
      cost: cost,
    };
    store.PRODS.push(prod);
    api.m.addProduct(prod);
  }
  S.prodOpen = false;
  toast(`Agregaste ${name}. Cuando vendas uno, tocá «Vendí uno» (o cargalo en Finanzas → Caja del día).`);
  render();
  return;
});

// C36 (V4): "Vendí uno" desde Productos: elige el medio y la venta entra en la Caja del día (un movimiento de producto)
registerClick("prodSell", (ev, el, act) => {
  S.sellI = +el.dataset.i;
  S.buyI = null;
  S.prodDel = null;
  render();
});
registerClick("prodSellNo", (ev, el, act) => {
  S.sellI = null;
  render();
});
registerClick("prodSellMedio", (ev, el, act) => {
  const prod = store.PRODS[+el.dataset.i];
  S.sellI = null;
  if (!prod || prod.stock <= 0) {
    toast("No te queda stock de ese producto.");
    return render();
  }
  prod.stock--;
  const walk = { svc: prod.n, precio: prod.p, propina: 0, hora: nowHM(), medio: el.dataset.m, cliente: "", kind: "prod", pid: prod.id || null };
  S.walk.push(walk);
  S.walk.sort((one, other) => one.hora.localeCompare(other.hora));
  api.m.addWalk(walk);
  api.m.setStock(prod);
  toast(`Venta cargada en la Caja del día: ${prod.n} · ${money(prod.p)} (${el.dataset.m.toLowerCase()}). Quedan ${prod.stock}.`);
  render();
});
// C36: con el precio de compra cargado, "Compré más" calcula el total al escribir la cantidad (se puede cambiar)
registerInput("bq", () => {
  const prod = store.PRODS[S.buyI];
  const qty = parseWhole($("#bq").value);
  if (prod && prod.cost != null && qty > 0) {
    $("#bc").value = String(qty * prod.cost);
  }
});

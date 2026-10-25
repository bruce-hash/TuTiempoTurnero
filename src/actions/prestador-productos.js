import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { PESOS_ERR, money, parsePesos, parseWhole } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
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
    };
    store.PRODS.push(prod);
    api.m.addProduct(prod);
  }
  S.prodOpen = false;
  toast(`Agregaste ${name}. Ya lo podés vender desde la caja.`);
  render();
  return;
});

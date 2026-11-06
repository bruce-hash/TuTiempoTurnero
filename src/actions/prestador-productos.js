import { registerClick, registerInput, registerSubmit } from "./registro.js";
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
    // 4/11 · Bloque 4: el stock inicial, con su precio de compra, entra en los gastos de productos del mes
    const spent = cost && stock > 0 ? stock * cost : 0;
    const expense = spent ? { id: store.GID++, c: `Stock inicial: ${prod.n} × ${stock}`.slice(0, 80), m: spent, cat: "Productos", d: TODAY(), qty: stock } : null;
    if (expense) {
      store.GASTOS.push(expense);
    }
    Promise.resolve(api.m.addProduct(prod))
      .then(() => {
        if (expense) {
          expense.prodId = prod.id || null;
          return api.m.addExpense(expense);
        }
      })
      .catch(() => {});
    S.prodOpen = false;
    toast(`Agregaste ${name}.${spent ? ` Gasto de productos cargado: ${money(spent)}.` : ""} Las ventas se cargan en Finanzas → Caja del día.`);
    render();
    return;
  }
  S.prodOpen = false;
  toast(`Agregaste ${name}. Las ventas se cargan en Finanzas → Caja del día.`);
  render();
  return;
});

// C36: con el precio de compra cargado, "Compré más" calcula el total al escribir la cantidad (se puede cambiar)
registerInput("bq", () => {
  const prod = store.PRODS[S.buyI];
  const qty = parseWhole($("#bq").value);
  if (prod && prod.cost != null && qty > 0) {
    $("#bc").value = String(qty * prod.cost);
  }
});

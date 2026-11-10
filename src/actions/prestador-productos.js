import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { PESOS_ERR, money, parsePesos, parseWhole } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
import { ymk } from "../views/prestador/finanzas.js";
import { ADJ_REASONS } from "../views/prestador/productos.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// 10/11 · punto 9: el stock no se toca a mano. Sube con «Cargar compra», baja con «Vender producto» (Caja del día) o con
// «Ajustar stock» (roto, vencido, uso en el local). En vivo lo cambia la base (product_buy, la venta, product_adjust) y la
// app muestra el stock que devuelve; acá se adelanta igual, para la demo y para que se vea enseguida.
const monthClosed = () => !!store.CLOSINGS["month|" + ymk(TODAY())];
// C35 (V4): eliminar un producto, con aviso antes; las ventas y compras ya cargadas no se tocan
registerClick("prodDel", (ev, el, act) => {
  S.prodDel = +el.dataset.i;
  S.buyI = null;
  S.adjI = null;
  S.prodEdit = null;
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
  S.adjI = null;
  S.prodEdit = null;
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
  if (monthClosed()) {
    $("#berr2").textContent = "El mes está cerrado: desbloquealo para cargar compras.";
    return;
  }
  prod.stock += qty;
  const expense = {
    id: store.GID++,
    c: `Compra: ${prod.n} × ${qty}`.slice(0, 80),
    m: cost,
    cat: "Productos",
    d: TODAY(),
    prodId: prod.id || null,
    qty,
  };
  store.GASTOS.push(expense);
  // la base suma al stock y carga el gasto juntos (product_buy); después, el stock que quedó en la base
  api.m
    .buyProduct(prod, qty, cost, expense)
    .then((res) => {
      if (res && res.stock != null && prod.stock !== res.stock) {
        prod.stock = res.stock;
        render();
      }
    })
    .catch(() => {});
  S.buyI = null;
  toast(`Sumaste ${qty} u. de ${prod.n}. Stock: ${prod.stock}. Gasto cargado: ${money(cost)}`);
  render();
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
    // 4/11 · Bloque 4: el stock inicial, con su precio de compra, entra en los gastos de productos del mes. 10/11: el
    // producto y el gasto los guarda la base juntos (product_add)
    const spent = cost && stock > 0 ? stock * cost : 0;
    if (spent && monthClosed()) {
      $("#perr2").textContent = "El mes está cerrado: cargá el producto con stock 0 o desbloquealo.";
      return;
    }
    store.PRODS.push(prod);
    const expense = spent ? { id: store.GID++, c: `Stock inicial: ${prod.n} × ${stock}`.slice(0, 80), m: spent, cat: "Productos", d: TODAY(), qty: stock } : null;
    if (expense) {
      store.GASTOS.push(expense);
    }
    Promise.resolve(api.m.addProduct(prod, expense)).catch(() => {});
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

// C36: con el precio de compra cargado, «Cargar compra» calcula el total al escribir la cantidad (se puede cambiar)
registerInput("bq", () => {
  const prod = store.PRODS[S.buyI];
  const qty = parseWhole($("#bq").value);
  if (prod && prod.cost != null && qty > 0) {
    $("#bc").value = String(qty * prod.cost);
  }
});

// 7/11: editar un producto (nombre, precio de venta y de compra). Las ventas y compras ya cargadas no cambian: cada
// una guarda su monto.
registerClick("prodEdit", (ev, el, act) => {
  S.prodEdit = +el.dataset.i;
  S.buyI = null;
  S.adjI = null;
  S.prodDel = null;
  render();
  const first = $("#pen");
  if (first) {
    first.focus();
  }
});
registerClick("prodEditClose", (ev, el, act) => {
  S.prodEdit = null;
  render();
});
registerSubmit("fProdEdit", (ev) => {
  const index = S.prodEdit;
  const prod = store.PRODS[index];
  if (!prod) {
    return;
  }
  const showErr = (msg) => {
    $("#perr3").textContent = msg;
  };
  const name = $("#pen").value.trim().slice(0, 80);
  const price = parsePesos($("#pep").value);
  const costTxt = ($("#pec").value || "").trim();
  const cost = costTxt === "" ? null : parsePesos(costTxt);
  if (name.length < 2) {
    return showErr("Escribí el nombre del producto.");
  }
  if (store.PRODS.some((item, i) => i !== index && item.n.toLowerCase() === name.toLowerCase())) {
    return showErr("Ya tenés otro producto con ese nombre.");
  }
  if (isNaN(price) || (cost != null && isNaN(cost))) {
    return showErr(PESOS_ERR);
  }
  if (price <= 0) {
    return showErr("Ingresá el precio de venta.");
  }
  const before = { n: prod.n, p: prod.p, cost: prod.cost };
  Object.assign(prod, { n: name, p: price, cost: cost });
  S.prodEdit = null;
  api.m
    .editProduct(prod)
    .then(() => toast("Producto guardado. Las ventas y compras anteriores no cambian."))
    .catch(() => {
      Object.assign(prod, before);
      render();
    });
  render();
});

// 10/11 · punto 9: «Ajustar stock»: cuántas unidades salen sin venderse y por qué (roto, vencido, uso en el local).
// Solo resta; no entra en la caja ni en los gastos. Queda anotado en el producto (los últimos, debajo).
registerClick("adjOpen", (ev, el, act) => {
  S.adjI = +el.dataset.i;
  S.adjWhy = null;
  S.buyI = null;
  S.prodEdit = null;
  S.prodDel = null;
  render();
  const input = $("#aq");
  if (input) {
    input.focus();
  }
});
registerClick("adjClose", (ev, el, act) => {
  S.adjI = null;
  render();
});
registerClick("adjWhy", (ev, el, act) => {
  S.adjWhy = el.dataset.r;
  document.querySelectorAll("#fAdj [data-act=adjWhy]").forEach((btn) => btn.setAttribute("aria-pressed", String(btn === el)));
  $("#aerr").textContent = "";
});
registerSubmit("fAdj", (ev) => {
  const prod = store.PRODS[S.adjI];
  if (!prod) {
    return;
  }
  const qty = parseWhole($("#aq").value);
  const showErr = (msg) => {
    $("#aerr").textContent = msg;
  };
  if (isNaN(qty) || qty < 1) {
    return showErr("Escribí cuántas unidades salen, con números enteros (1 o más).");
  }
  if (qty > prod.stock) {
    return showErr(`Te ${prod.stock === 1 ? "queda 1 unidad" : `quedan ${prod.stock} unidades`} de ${prod.n}.`);
  }
  if (!ADJ_REASONS[S.adjWhy]) {
    return showErr("Elegí el motivo: roto, vencido o uso en el local.");
  }
  const reason = S.adjWhy;
  prod.stock -= qty;
  prod.adj = [{ d: TODAY(), qty, reason }, ...(prod.adj || [])];
  S.adjI = null;
  S.adjWhy = null;
  api.m
    .adjustStock(prod, qty, reason)
    .then((res) => {
      if (res && res.stock != null && prod.stock !== res.stock) {
        prod.stock = res.stock;
        render();
      }
    })
    .catch(() => {});
  toast(`Restaste ${qty} u. de ${prod.n} (${ADJ_REASONS[reason].toLowerCase()}). Stock: ${prod.stock}.`);
  render();
});

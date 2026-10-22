import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { money } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("stk", (e, x, v) => {
  const r = store.PRODS[+x.dataset.i];
  r.stock = Math.max(0, r.stock + +x.dataset.d);
  api.m.setStock(r);
  render();
});
registerClick("buyOpen", (e, x, v) => {
  S.buyI = +x.dataset.i;
  S.prodOpen = false;
  render();
  const r = $("#bq");
  if (r) {
    r.focus();
  }
});
registerClick("buyClose", (e, x, v) => {
  S.buyI = null;
  render();
});
registerClick("prodOpen", (e, x, v) => {
  S.prodOpen = true;
  S.buyI = null;
  render();
  const r = $("#pnn");
  if (r) {
    r.focus();
  }
});
registerClick("prodClose", (e, x, v) => {
  S.prodOpen = false;
  render();
});
registerSubmit("fBuy", (e) => {
  const a = store.PRODS[S.buyI];
  const t = parseInt(($("#bq").value || "").replace(/\D/g, "")) || 0;
  const s = parseInt(($("#bc").value || "").replace(/\D/g, "")) || 0;
  if (t <= 0) {
    $("#berr2").textContent = "Ingresá cuántas unidades compraste.";
    return;
  }
  if (s <= 0) {
    $("#berr2").textContent = "Ingresá cuánto pagaste: se carga solo en los gastos del mes.";
    return;
  }
  a.stock += t;
  api.m.setStock(a);
  {
    const n = {
      id: store.GID++,
      c: `Compra: ${a.n} × ${t}`.slice(0, 80),
      m: s,
      cat: "Productos",
      d: TODAY(),
    };
    store.GASTOS.push(n);
    api.m.addExpense(n);
  }
  S.buyI = null;
  toast(`Sumaste ${t} u. de ${a.n}. Stock: ${a.stock}.${s ? " Gasto cargado: " + money(s) : ""}`);
  render();
  return;
});
registerSubmit("fProd", (e) => {
  const a = $("#pnn").value.trim();
  const t = parseInt(($("#pnp").value || "").replace(/\D/g, "")) || 0;
  const s = parseInt(($("#pns").value || "0").replace(/\D/g, "")) || 0;
  const n = parseInt(($("#pnm").value || "0").replace(/\D/g, "")) || 0;
  if (!a) {
    $("#perr2").textContent = "Escribí el nombre del producto.";
    return;
  }
  if (store.PRODS.some((o) => o.n.toLowerCase() === a.toLowerCase())) {
    $("#perr2").textContent = "Ya tenés un producto con ese nombre.";
    return;
  }
  if (t <= 0) {
    $("#perr2").textContent = "Ingresá el precio de venta.";
    return;
  }
  {
    const o = {
      n: a.slice(0, 80),
      p: t,
      stock: s,
      min: n,
    };
    store.PRODS.push(o);
    api.m.addProduct(o);
  }
  S.prodOpen = false;
  toast(`Agregaste ${a}. Ya lo podés vender desde la caja.`);
  render();
  return;
});

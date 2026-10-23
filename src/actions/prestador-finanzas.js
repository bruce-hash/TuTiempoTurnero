import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { money } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { MESES, TODAY, nowHM, pad } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { monthTotals, ymk } from "../views/prestador/finanzas.js";

registerClick("closeMonth", (ev, el, act) => {
  const ym = el.dataset.m;
  const [year, month] = ym.split("-").map(Number);
  const totals = monthTotals(year, month - 1) || {
    ing: 0,
    gas: 0,
  };
  const closing = {
    income: totals.ing,
    expenses: totals.gas,
    at: nowHM(),
  };
  store.CLOSINGS["month|" + ym] = closing;
  api.m.closeCash("month", ym, closing);
  toast(
    `${MESES[month - 1].charAt(0).toUpperCase() + MESES[month - 1].slice(1)} cerrado: balance ${money(totals.ing - totals.gas)}.`,
  );
  render();
  return;
});
registerClick("unlockMonth", (ev, el, act) => {
  const ym = el.dataset.m;
  if (!store.CLOSINGS["month|" + ym]) {
    return;
  }
  delete store.CLOSINGS["month|" + ym];
  api.m.reopenCash("month", ym);
  const monthIndex = +ym.slice(5, 7) - 1;
  toast(
    `${MESES[monthIndex].charAt(0).toUpperCase() + MESES[monthIndex].slice(1)} desbloqueado: ya podés editarlo. Cuando termines, cerralo de nuevo.`,
  );
  render();
  return;
});
registerClick("goMonth", (ev, el, act) => {
  S.fm = el.dataset.m;
  S.fp = "mes";
  render();
  return;
});
// copia los gastos fijos del mes anterior (no las compras de productos) al mes que se está viendo
registerClick("copyPrevG", (ev, el, act) => {
  const current = ymk(TODAY());
  const ym = S.fm && S.fm <= current ? S.fm : current;
  if (store.CLOSINGS["month|" + ym]) {
    toast("El mes está cerrado: desbloquealo para editar.");
    return;
  }
  const [year, month] = ym.split("-").map(Number);
  const prev = new Date(year, month - 2, 1);
  const prevYm = prev.getFullYear() + "-" + pad(prev.getMonth() + 1);
  const prevFixed = store.GASTOS.filter((exp) => exp.d.slice(0, 7) === prevYm && exp.cat !== "Productos");
  const day = ym === current ? TODAY() : ym + "-01";
  prevFixed.forEach((exp) => {
    const copy = {
      id: store.GID++,
      c: exp.c,
      m: exp.m,
      cat: exp.cat === "Productos" ? "Otros" : exp.cat,
      d: day,
    };
    store.GASTOS.push(copy);
    api.m.addExpense(copy);
  });
  toast(`Copiamos ${prevFixed.length} gastos. Revisá los montos si cambiaron.`);
  render();
  return;
});
registerClick("gOpen", (ev, el, act) => {
  S.gOpen = true;
  render();
});
registerClick("gClose", (ev, el, act) => {
  S.gOpen = false;
  render();
});
registerClick("gDel", (ev, el, act) => {
  if (act === "gDel" &&
    (() => {
      const exp = store.GASTOS.find((item) => item.id === +el.dataset.id);
      return exp && store.CLOSINGS["month|" + exp.d.slice(0, 7)];
    })()) {
    toast("El mes está cerrado: desbloquealo para editar.");
  } else if (act === "gDel") {
    const exp = store.GASTOS.find((item) => item.id === +el.dataset.id);
    store.GASTOS = store.GASTOS.filter((item) => item.id !== +el.dataset.id);
    if (exp) {
      api.m.delExpense(exp);
    }
    toast("Gasto borrado");
    render();
  }
});
registerChange("gcat", (ev) => {
  const box = $("#gprodBox");
  if (box) {
    box.hidden = ev.target.value !== "Productos";
  }
  return;
});
registerSubmit("fGasto", (ev) => {
  const concept = $("#gc").value.trim();
  const amount = parseInt($("#gm").value.replace(/\D/g, "")) || 0;
  if (!concept) {
    $("#gerr").textContent = "Escribí el concepto (ej: Alquiler).";
    return;
  }
  if (amount <= 0) {
    $("#gerr").textContent = "Ingresá el monto.";
    return;
  }
  const current = ymk(TODAY());
  const ym = S.fm && S.fm <= current ? S.fm : current;
  if (store.CLOSINGS["month|" + ym]) {
    $("#gerr").textContent = "El mes está cerrado: desbloquealo para editar.";
    return;
  }
  {
    const expense = {
      id: store.GID++,
      c: concept.slice(0, 80),
      m: amount,
      cat: "Otros",
      d: ym === current ? TODAY() : ym + "-01",
    };
    store.GASTOS.push(expense);
    api.m.addExpense(expense);
  }
  toast("Gasto cargado: " + concept + " · " + money(amount));
  render();
  return;
});

import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { PESOS_ERR, money, parsePesos } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { MESES, TODAY, nowHM, pad } from "../lib/fechas.js";
import { LIVE } from "../config.js";
import { demoSaveFixed, demoStopFixed } from "../lib/fijos.js";
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
// C31 (V4 resto): gastos fijos. ✎ abre el editor; guardar vale desde el mes que se está mirando en adelante (los meses
// cerrados no cambian); "Dejar de repetirlo" lo saca desde ese mes. En vivo lo hace la base y vuelven los gastos.
const fixedById = (id) => store.FIXED.find((item) => String(item.id) === String(id));
registerClick("fxEdit", (ev, el, act) => {
  S.fxEd = S.fxEd === fixedById(el.dataset.id)?.id ? null : fixedById(el.dataset.id)?.id;
  render();
  const input = $("#fxm");
  if (input) {
    input.focus();
  }
});
registerClick("fxNew", (ev, el, act) => {
  S.fxEd = "new";
  render();
  $("#fxc") && $("#fxc").focus();
});
registerClick("fxClose", (ev, el, act) => {
  S.fxEd = null;
  render();
});
registerSubmit("fFixed", (ev) => {
  const form = ev.target;
  const ym = form.dataset.ym;
  const item = form.dataset.id ? fixedById(form.dataset.id) : null;
  const concept = $("#fxc").value.trim();
  const amountTxt = ($("#fxm").value || "").trim();
  const amount = amountTxt === "" ? 0 : parsePesos(amountTxt);
  const err = (msg) => {
    $("#fxerr").textContent = msg;
  };
  if (!concept) {
    return err("Escribí qué gasto es.");
  }
  if (isNaN(amount) || amount < 0) {
    return err(PESOS_ERR);
  }
  if (!item && amount <= 0) {
    return err("Ingresá cuánto pagás por mes.");
  }
  if (store.CLOSINGS["month|" + ym]) {
    return err("El mes está cerrado: sus gastos quedan como están.");
  }
  const fields = { c: concept.slice(0, 80), cat: $("#fxk").value, m: amount };
  S.fxEd = null;
  if (LIVE) {
    api.m
      .saveFixed(Object.assign({ id: item ? item.id : null }, fields), ym)
      .then(() => {
        toast(amount ? `Guardado: ${fields.c} · ${money(amount)} por mes, desde ${MESES[+ym.slice(5) - 1]}.` : `${fields.c} quedó sin monto desde ${MESES[+ym.slice(5) - 1]}.`);
        render();
      })
      .catch(() => {});
    return;
  }
  demoSaveFixed(item, fields, ym, ymk(TODAY()));
  toast(amount ? `Guardado: ${fields.c} · ${money(amount)} por mes, desde ${MESES[+ym.slice(5) - 1]}.` : `${fields.c} quedó sin monto desde ${MESES[+ym.slice(5) - 1]}.`);
  render();
});
registerClick("fxStop", (ev, el, act) => {
  const item = fixedById(el.dataset.id);
  const ym = el.dataset.ym;
  if (!item) {
    return;
  }
  S.fxEd = null;
  const done = () => {
    toast(`${item.c} deja de repetirse desde ${MESES[+ym.slice(5) - 1]}.`);
    render();
  };
  if (LIVE) {
    api.m.stopFixed(item, ym).then(done).catch(() => {});
    return;
  }
  demoStopFixed(item, ym);
  done();
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
  const amount = parsePesos($("#gm").value);
  if (!concept) {
    $("#gerr").textContent = "Escribí el concepto (ej: Alquiler).";
    return;
  }
  if (isNaN(amount)) {
    $("#gerr").textContent = PESOS_ERR;
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

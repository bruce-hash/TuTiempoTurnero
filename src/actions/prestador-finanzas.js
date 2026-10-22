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

registerClick("closeMonth", (e, x, v) => {
  const r = x.dataset.m;
  const [m, f] = r.split("-").map(Number);
  const u = monthTotals(m, f - 1) || {
    ing: 0,
    gas: 0,
  };
  const E = {
    income: u.ing,
    expenses: u.gas,
    at: nowHM(),
  };
  store.CLOSINGS["month|" + r] = E;
  api.m.closeCash("month", r, E);
  toast(
    `${MESES[f - 1].charAt(0).toUpperCase() + MESES[f - 1].slice(1)} cerrado: balance ${money(u.ing - u.gas)}.`,
  );
  render();
  return;
});
registerClick("unlockMonth", (e, x, v) => {
  const r = x.dataset.m;
  if (!store.CLOSINGS["month|" + r]) {
    return;
  }
  delete store.CLOSINGS["month|" + r];
  api.m.reopenCash("month", r);
  const m = +r.slice(5, 7) - 1;
  toast(
    `${MESES[m].charAt(0).toUpperCase() + MESES[m].slice(1)} desbloqueado: ya podés editarlo. Cuando termines, cerralo de nuevo.`,
  );
  render();
  return;
});
registerClick("goMonth", (e, x, v) => {
  S.fm = x.dataset.m;
  S.fp = "mes";
  render();
  return;
});
registerClick("copyPrevG", (e, x, v) => {
  const r = ymk(TODAY());
  const m = S.fm && S.fm <= r ? S.fm : r;
  if (store.CLOSINGS["month|" + m]) {
    toast("El mes está cerrado: desbloquealo para editar.");
    return;
  }
  const [f, u] = m.split("-").map(Number);
  const E = new Date(f, u - 2, 1);
  const O = E.getFullYear() + "-" + pad(E.getMonth() + 1);
  const N = store.GASTOS.filter((F) => F.d.slice(0, 7) === O && F.cat !== "Productos");
  const B = m === r ? TODAY() : m + "-01";
  N.forEach((F) => {
    const V = {
      id: store.GID++,
      c: F.c,
      m: F.m,
      cat: F.cat === "Productos" ? "Otros" : F.cat,
      d: B,
    };
    store.GASTOS.push(V);
    api.m.addExpense(V);
  });
  toast(`Copiamos ${N.length} gastos. Revisá los montos si cambiaron.`);
  render();
  return;
});
registerClick("gOpen", (e, x, v) => {
  S.gOpen = true;
  render();
});
registerClick("gClose", (e, x, v) => {
  S.gOpen = false;
  render();
});
registerClick("gDel", (e, x, v) => {
  if (v === "gDel" &&
    (() => {
      const r = store.GASTOS.find((m) => m.id === +x.dataset.id);
      return r && store.CLOSINGS["month|" + r.d.slice(0, 7)];
    })()) {
    toast("El mes está cerrado: desbloquealo para editar.");
  } else if (v === "gDel") {
    const r = store.GASTOS.find((m) => m.id === +x.dataset.id);
    store.GASTOS = store.GASTOS.filter((m) => m.id !== +x.dataset.id);
    if (r) {
      api.m.delExpense(r);
    }
    toast("Gasto borrado");
    render();
  }
});
registerChange("gcat", (e) => {
  const n = $("#gprodBox");
  if (n) {
    n.hidden = e.target.value !== "Productos";
  }
  return;
});
registerSubmit("fGasto", (e) => {
  const a = $("#gc").value.trim();
  const t = parseInt($("#gm").value.replace(/\D/g, "")) || 0;
  if (!a) {
    $("#gerr").textContent = "Escribí el concepto (ej: Alquiler).";
    return;
  }
  if (t <= 0) {
    $("#gerr").textContent = "Ingresá el monto.";
    return;
  }
  const s = ymk(TODAY());
  const n = S.fm && S.fm <= s ? S.fm : s;
  if (store.CLOSINGS["month|" + n]) {
    $("#gerr").textContent = "El mes está cerrado: desbloquealo para editar.";
    return;
  }
  {
    const o = {
      id: store.GID++,
      c: a.slice(0, 80),
      m: t,
      cat: "Otros",
      d: n === s ? TODAY() : n + "-01",
    };
    store.GASTOS.push(o);
    api.m.addExpense(o);
  }
  toast("Gasto cargado: " + a + " · " + money(t));
  render();
  return;
});

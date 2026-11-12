// C31 · Gastos fijos (V4 resto): alquiler, luz, gas, internet y monotributo vienen precargados (sin monto); se repiten
// solos cada mes y se cambian "desde este mes en adelante" sin tocar los meses cerrados. En vivo lo hace la base
// (fixed_expenses, fixed_expenses_sync, fixed_expense_save, fixed_expense_stop) y la app vuelve a pedir los gastos; acá
// están las cuentas para mostrarlos y, en la demo, la misma regla sobre los datos de ejemplo.
// store.FIXED: [{ id, c (concepto), cat, m (monto actual, 0 = sin monto), since "AAAA-MM", until "AAAA-MM" | null }]
// Las filas de gastos que vienen de un gasto fijo llevan fixed (su id) en store.GASTOS.
import { LIVE } from "../config.js";
import { store } from "../store.js";

export const FIXED_CATS = ["Alquiler", "Servicios", "Insumos", "Otros"];
const PRELOADED = [
  ["Alquiler", "Alquiler"],
  ["Luz", "Servicios"],
  ["Gas", "Servicios"],
  ["Internet", "Servicios"],
  ["Monotributo", "Otros"],
];
store.FIXED = store.FIXED || [];
let demoId = 1;

const closed = (ym) => !!store.CLOSINGS["month|" + ym];
const nextYm = (ym) => {
  const [year, month] = ym.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
};

// los gastos fijos que corren en un mes
export const fixedFor = (ym) => store.FIXED.filter((item) => item.since <= ym && (!item.until || item.until >= ym));
// la fila del mes de un gasto fijo (o null si todavía no se cargó: sin monto)
export const fixedRow = (item, ym) => store.GASTOS.find((exp) => exp.fixed === item.id && exp.d.slice(0, 7) === ym) || null;

// demo: los precargados la primera vez y la fila de cada mes hasta el actual (en vivo lo hace fixed_expenses_sync)
export function demoSyncFixed(currentYm) {
  if (LIVE) {
    return;
  }
  if (!store.FIXED.length) {
    PRELOADED.forEach(([c, cat]) => store.FIXED.push({ id: "f" + demoId++, c, cat, m: 0, since: currentYm, until: null }));
  }
  store.FIXED.forEach((item) => {
    if (!item.m) {
      return;
    }
    for (let ym = item.since; ym <= currentYm && (!item.until || ym <= item.until); ym = nextYm(ym)) {
      if (!closed(ym) && !fixedRow(item, ym)) {
        store.GASTOS.push({ id: "g" + item.id + ym, c: item.c, m: item.m, cat: item.cat, d: ym + "-01", fixed: item.id });
      }
    }
  });
}

// demo: crear o cambiar un gasto fijo desde un mes (los meses cerrados no cambian)
export function demoSaveFixed(item, fields, fromYm, currentYm) {
  if (!item) {
    item = { id: "f" + demoId++, since: fromYm, until: null };
    store.FIXED.push(item);
  }
  Object.assign(item, fields, { since: item.since < fromYm ? item.since : fromYm, until: null });
  store.GASTOS = store.GASTOS.filter((exp) => !(exp.fixed === item.id && exp.d.slice(0, 7) >= fromYm && !closed(exp.d.slice(0, 7)) && !item.m));
  store.GASTOS.forEach((exp) => {
    if (exp.fixed === item.id && exp.d.slice(0, 7) >= fromYm && !closed(exp.d.slice(0, 7))) {
      Object.assign(exp, { c: item.c, m: item.m, cat: item.cat });
    }
  });
  demoSyncFixed(currentYm);
  return item;
}

// demo: dejar de repetirlo desde un mes
export function demoStopFixed(item, fromYm) {
  if (fromYm <= item.since) {
    item.m = 0;
    item.until = null;
  } else {
    const [year, month] = fromYm.split("-").map(Number);
    item.until = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  }
  store.GASTOS = store.GASTOS.filter((exp) => !(exp.fixed === item.id && exp.d.slice(0, 7) >= fromYm && !closed(exp.d.slice(0, 7))));
}

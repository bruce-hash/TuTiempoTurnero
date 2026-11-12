// Solo la demo (H21): ocupación de días pasados e ingresos y gastos de meses pasados inventados con una fórmula. En vivo
// los da la base (store.OCCD y liveApi.monthTotals).
export function demoOcc(date, dow, hour, real) {
  const dowFactor = {
    0: 0.5,
    1: 0.85,
    2: 0.8,
    3: 0.9,
    4: 1,
    5: 1.2,
    6: 1.1,
  }[dow];
  const base = hour < 12 ? 22 + (hour - 9) * 10 : hour < 15 ? 30 : hour < 17 ? 32 + (hour - 15) * 14 : 68 + (hour - 17) * 7;
  const noise = ((+date.replace(/-/g, "") + hour * 7) % 17) - 8;
  return Math.max(0, Math.min(100, Math.max(real, Math.round(base * dowFactor + noise))));
}
// expTotal: los gastos cargados ese mes (null si no hay ninguno)
export function demoMonthTotals(year, month, expTotal) {
  const seed = ((year * 12 + month) * 7919) % 97;
  const season = [0.85, 0.8, 0.95, 1, 1, 0.95, 1.05, 1, 1, 1.05, 1.1, 1.35][month];
  return {
    ing: Math.round(((115e4 + seed * 5200) * season) / 1e3) * 1e3,
    gas: expTotal != null ? expTotal : Math.round((235e3 + (seed % 23) * 2600) / 100) * 100,
  };
}

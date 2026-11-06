// Modo demo · feriados (7/11, D39): una lista de ejemplo como la que trae holidays-sync, con 2026 confirmado y 2027
// sin confirmar. En vivo la trae el servidor de la fuente pública y la confirma el admin.
const Y2026 = [
  ["2026-01-01", "inamovible", "Año nuevo"],
  ["2026-02-16", "inamovible", "Carnaval"],
  ["2026-02-17", "inamovible", "Carnaval"],
  ["2026-03-23", "puente", "Día no laborable con fines turísticos"],
  ["2026-03-24", "inamovible", "Día Nacional de la Memoria por la Verdad y la Justicia"],
  ["2026-04-02", "inamovible", "Día del Veterano y de los Caídos en la Guerra de Malvinas"],
  ["2026-04-03", "inamovible", "Viernes Santo"],
  ["2026-05-01", "inamovible", "Día del Trabajador"],
  ["2026-05-25", "inamovible", "Día de la Revolución de Mayo"],
  ["2026-06-15", "trasladable", "Paso a la Inmortalidad del General Martín Miguel de Güemes"],
  ["2026-06-20", "inamovible", "Paso a la Inmortalidad del General Manuel Belgrano"],
  ["2026-07-09", "inamovible", "Día de la Independencia"],
  ["2026-07-10", "puente", "Día no laborable con fines turísticos"],
  ["2026-08-17", "trasladable", "Paso a la Inmortalidad del General José de San Martín"],
  ["2026-10-12", "trasladable", "Día del Respeto a la Diversidad Cultural"],
  ["2026-11-23", "trasladable", "Día de la Soberanía Nacional"],
  ["2026-12-07", "puente", "Día no laborable con fines turísticos"],
  ["2026-12-08", "inamovible", "Día de la Inmaculada Concepción de María"],
  ["2026-12-25", "inamovible", "Navidad"],
];
const Y2027 = [
  ["2027-01-01", "inamovible", "Año nuevo"],
  ["2027-02-08", "inamovible", "Carnaval"],
  ["2027-02-09", "inamovible", "Carnaval"],
  ["2027-03-24", "inamovible", "Día Nacional de la Memoria por la Verdad y la Justicia"],
];
const demoHolidayRows = (list) => list.map(([day, kind, name]) => ({ day, kind, name, source: "api" }));
// lo que ve el admin (Comisión → Feriados)
export const demoHolidayYears = () => [
  { year: 2026, fetched_at: "2026-10-19T09:23:00Z", fetch_error: null, fetched_count: Y2026.length, source_changed: false, confirmed_at: "2026-01-05T13:00:00Z", days: demoHolidayRows(Y2026) },
  { year: 2027, fetched_at: "2026-10-19T09:23:00Z", fetch_error: null, fetched_count: Y2027.length, source_changed: false, confirmed_at: null, days: demoHolidayRows(Y2027) },
];
// lo que ve el profesional: los de los años confirmados (en la demo atiende todos los días)
export const demoHolidays = () => demoHolidayRows(Y2026).map((h) => ({ ...h, open: null, works: true }));

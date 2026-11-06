// 7/11 · Feriados (D39): cuentas puras que comparten Horarios, la campanita y el panel de TuTiempo.
// Las fechas las trae el servidor (holidays-sync) y el admin las confirma una vez por año; acá solo se muestran.

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
// tipos que entran (los mismos que acepta la base)
export const HOLIDAY_KINDS = [
  ["inamovible", "Inamovible"],
  ["trasladable", "Trasladable"],
  ["puente", "No laborable turístico"],
];
export const kindName = (kind) => (HOLIDAY_KINDS.find(([id]) => id === kind) || [kind, kind])[1];
// "lunes 23/11" (el mismo formato que el aviso de la base)
export function holidayLabel(day) {
  const date = new Date(day + "T12:00:00");
  return `${WEEKDAYS[date.getDay()]} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
// los próximos feriados que tocan a un profesional: desde hoy y en un día que atiende, los primeros `limit`
export const upcomingHolidays = (list, today, limit = 6) =>
  (list || []).filter((h) => h.day >= today && h.works !== false).sort((a, b) => a.day.localeCompare(b.day)).slice(0, limit);
// lo que eligió, en palabras
export const holidayState = (h) => (h.open === true ? "Abrís" : h.open === false ? "Cerrado" : "Sin elegir: queda abierto");
// texto del bloqueo de un feriado ("Feriado: <nombre>", hasta 40 letras como cualquier motivo de Bloquear días)
export const holidayReason = (h) => ("Feriado: " + (h ? h.name : "")).slice(0, 40);

import { LIVE, TZ } from "../config.js";

export const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const pad = (num) => String(num).padStart(2, "0");
// "Ahora" en hora de Argentina (UTC−3), sea cual sea la zona del dispositivo: los getters locales del Date que
// devuelve (getHours, getDate…) dan la hora de Buenos Aires.
export const NOW = () => new Date(Date.now() + /* @__PURE__ */ (new Date().getTimezoneOffset() - 180) * 6e4);
// Fecha como clave "AAAA-MM-DD" (la que usan la agenda y la base).
export const dkey = (date) => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
// Fecha a `days` días de hoy (o de la fecha `from`), al mediodía: así un cambio de horario no la mueve de día.
export const addDays = (days, from) => {
  const date = from ? /* @__PURE__ */ new Date(from + "T12:00:00") : NOW();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};
export const TODAY = () => dkey(NOW());
export const toMin = (hm) => {
  const [hours, mins] = hm.split(":").map(Number);
  return hours * 60 + mins;
};
export const fromMin = (mins) => pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
export function dayLabel(key, short) {
  const today = TODAY();
  const tomorrow = dkey(addDays(1));
  if (key === today) {
    return "Hoy";
  }
  if (key === tomorrow) {
    return "Mañana";
  }
  const date = /* @__PURE__ */ new Date(key + "T12:00:00");
  return (
    (short ? DOW[date.getDay()] : DOW[date.getDay()].toLowerCase()) + " " + date.getDate() + "/" + (date.getMonth() + 1)
  );
}
export function longLabel(key) {
  const date = /* @__PURE__ */ new Date(key + "T12:00:00");
  const dayName = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][date.getDay()];
  const monthName = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ][date.getMonth()];
  const label =
    (key === TODAY() ? "Hoy, " : key === dkey(addDays(1)) ? "Mañana, " : "") + dayName + " " + date.getDate() + " de " + monthName;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
export const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
export const hoursUntil = (booking) => /* @__PURE__ */ (new Date(booking.date + "T" + booking.time + ":00") - NOW()) / 36e5;
export function prevMonthDay(day) {
  const date = NOW();
  date.setDate(1);
  date.setMonth(date.getMonth() - 1);
  date.setDate(day);
  return dkey(date);
}
const _fmt =
  typeof Intl != "undefined"
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    : null;
// Fecha y hora de un timestamp de la base, en hora de Argentina.
export function isoToLocal(iso) {
  const parts = {};
  _fmt.formatToParts(new Date(iso)).forEach((part) => (parts[part.type] = part.value));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`,
  };
}
// Al revés: fecha y hora de Argentina → timestamp para la base (Argentina no tiene horario de verano).
export const localToIso = (date, time) => `${date}T${time}:00-03:00`;
export const minsBetween = (from, to) => Math.round((new Date(to) - new Date(from)) / 6e4);
export const daysAgo = (key) =>
  key
    ? Math.max(
        0,
        Math.round(
          /* @__PURE__ */ (new Date(TODAY() + "T12:00:00") - /* @__PURE__ */ new Date(key + "T12:00:00")) /
            864e5,
        ),
      )
    : null;
export function relDate(iso) {
  const days = daysAgo(iso.slice(0, 10));
  if (days === 0) {
    return "hoy";
  } else if (days === 1) {
    return "ayer";
  } else if (days < 7) {
    return `hace ${days} días`;
  } else if (days < 30) {
    return `hace ${Math.round(days / 7)} semana${Math.round(days / 7) > 1 ? "s" : ""}`;
  } else {
    return `hace ${Math.round(days / 30)} mes${Math.round(days / 30) > 1 ? "es" : ""}`;
  }
}
export function nowHM() {
  const now = NOW();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}
export const capW = (word) => word.charAt(0).toUpperCase() + word.slice(1);
export const dm = (key) => +String(key).slice(8, 10) + "/" + +String(key).slice(5, 7);
export const dmy = (key) => String(key).slice(8, 10) + "/" + String(key).slice(5, 7) + "/" + String(key).slice(0, 4);
export const dmyIso = (iso) => (iso ? dmy(LIVE ? isoToLocal(iso).date : String(iso).slice(0, 10)) : "");
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const dayWord = (key) => {
  const date = /* @__PURE__ */ new Date(key + "T12:00:00");
  return DIAS[date.getDay()] + " " + date.getDate() + "/" + (date.getMonth() + 1);
};

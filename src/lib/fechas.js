import { LIVE, TZ } from "../config.js";

export const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export const pad = (e) => String(e).padStart(2, "0");
export const NOW = () => new Date(Date.now() + /* @__PURE__ */ (new Date().getTimezoneOffset() - 180) * 6e4);
export const dkey = (e) => e.getFullYear() + "-" + pad(e.getMonth() + 1) + "-" + pad(e.getDate());
export const addDays = (e, a) => {
  const t = a ? /* @__PURE__ */ new Date(a + "T12:00:00") : NOW();
  t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() + e);
  return t;
};
export const TODAY = () => dkey(NOW());
export const toMin = (e) => {
  const [a, t] = e.split(":").map(Number);
  return a * 60 + t;
};
export const fromMin = (e) => pad(Math.floor(e / 60)) + ":" + pad(e % 60);
export function dayLabel(e, short) {
  const t = TODAY();
  const s = dkey(addDays(1));
  if (e === t) {
    return "Hoy";
  }
  if (e === s) {
    return "Mañana";
  }
  const n = /* @__PURE__ */ new Date(e + "T12:00:00");
  return (
    (short ? DOW[n.getDay()] : DOW[n.getDay()].toLowerCase()) + " " + n.getDate() + "/" + (n.getMonth() + 1)
  );
}
export function longLabel(e) {
  const a = /* @__PURE__ */ new Date(e + "T12:00:00");
  const t = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][a.getDay()];
  const s = [
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
  ][a.getMonth()];
  const n =
    (e === TODAY() ? "Hoy, " : e === dkey(addDays(1)) ? "Mañana, " : "") + t + " " + a.getDate() + " de " + s;
  return n.charAt(0).toUpperCase() + n.slice(1);
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
export const hoursUntil = (e) => /* @__PURE__ */ (new Date(e.date + "T" + e.time + ":00") - NOW()) / 36e5;
export function prevMonthDay(e) {
  const a = NOW();
  a.setDate(1);
  a.setMonth(a.getMonth() - 1);
  a.setDate(e);
  return dkey(a);
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
export function isoToLocal(iso) {
  const a = {};
  _fmt.formatToParts(new Date(iso)).forEach((t) => (a[t.type] = t.value));
  return {
    date: `${a.year}-${a.month}-${a.day}`,
    time: `${a.hour === "24" ? "00" : a.hour}:${a.minute}`,
  };
}
export const localToIso = (e, a) => `${e}T${a}:00-03:00`;
export const minsBetween = (e, a) => Math.round((new Date(a) - new Date(e)) / 6e4);
export const daysAgo = (e) =>
  e
    ? Math.max(
        0,
        Math.round(
          /* @__PURE__ */ (new Date(TODAY() + "T12:00:00") - /* @__PURE__ */ new Date(e + "T12:00:00")) /
            864e5,
        ),
      )
    : null;
export function relDate(iso) {
  const a = daysAgo(iso.slice(0, 10));
  if (a === 0) {
    return "hoy";
  } else if (a === 1) {
    return "ayer";
  } else if (a < 7) {
    return `hace ${a} días`;
  } else if (a < 30) {
    return `hace ${Math.round(a / 7)} semana${Math.round(a / 7) > 1 ? "s" : ""}`;
  } else {
    return `hace ${Math.round(a / 30)} mes${Math.round(a / 30) > 1 ? "es" : ""}`;
  }
}
export function nowHM() {
  const e = NOW();
  return String(e.getHours()).padStart(2, "0") + ":" + String(e.getMinutes()).padStart(2, "0");
}
export const capW = (e) => e.charAt(0).toUpperCase() + e.slice(1);
export const dm = (e) => +String(e).slice(8, 10) + "/" + +String(e).slice(5, 7);
export const dmy = (e) => String(e).slice(8, 10) + "/" + String(e).slice(5, 7) + "/" + String(e).slice(0, 4);
export const dmyIso = (e) => (e ? dmy(LIVE ? isoToLocal(e).date : String(e).slice(0, 10)) : "");
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
export const dayWord = (e) => {
  const a = /* @__PURE__ */ new Date(e + "T12:00:00");
  return DIAS[a.getDay()] + " " + a.getDate() + "/" + (a.getMonth() + 1);
};

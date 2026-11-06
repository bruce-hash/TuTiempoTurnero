import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
import { holidayReason } from "../lib/feriados.js";
import { ME } from "../lib/prestadores.js";
import { busy, cfg, isDayBlock, ranges } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { blockDays, setHolidayChoice } from "../views/prestador/bloqueo-dias.js";
import { setBtab } from "../views/prestador/panel.js";

// 7/11 · Feriados (D39): Abro / Cierro, desde Horarios (Próximos feriados) o desde el aviso de la campanita.
const holidayOf = (day) => (store.HOLIDAYS || []).find((h) => h.day === day) || { day, name: "" };
// desde la campanita: al panel, en Horarios, con la lista de feriados a la vista
function toHorarios() {
  if (S.btab === "horarios" && S.role === "barbero" && !S.preview) {
    return;
  }
  S.role = "barbero";
  S.preview = false;
  setBtab("horarios");
}
function scrollTo(sel) {
  const box = $(sel);
  if (box && box.scrollIntoView) {
    box.scrollIntoView({ block: "start" });
  }
}

registerClick("holOpen", (ev, el, act) => {
  const day = el.dataset.d;
  const h = holidayOf(day);
  const done = () => {
    toast(`Listo: el ${day.slice(8, 10)}/${day.slice(5, 7)} abrís como cualquier día.`);
    render();
  };
  if (LIVE) {
    el.disabled = true;
    api.m
      .holidayDecide(day, true)
      .then(() => {
        setHolidayChoice(day, true);
        return h.open === false ? api.loadMine() : null;
      })
      .then(done)
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  // demo: si lo había cerrado desde acá, se desbloquea
  if (h.open === false) {
    store.BOOK = store.BOOK.filter((item) => !(item.pid == ME() && item.date === day && isDayBlock(item) && item.svc.slice(item.svc.indexOf(" ") + 1).startsWith("Feriado")));
  }
  setHolidayChoice(day, true);
  done();
});

registerClick("holClose", (ev, el, act) => {
  const day = el.dataset.d;
  if (day < TODAY()) {
    return;
  }
  const h = holidayOf(day);
  const pid = ME();
  const why = holidayReason(h);
  // los turnos de ese día: si hay, primero la lista (lo mismo que «Bloquear días»)
  const open = ranges(cfg(pid), new Date(day + "T12:00:00").getDay()).length && !busy(pid, day).some((item) => isDayBlock(item));
  const affected = open ? busy(pid, day).filter((item) => item.type !== "block" && item.type !== "walk" && item.status === "confirmed") : [];
  toHorarios();
  if (affected.length) {
    S.db = { from: day, to: day, why };
    S.dbAsk = { from: day, to: day, why, holiday: day, list: affected.sort((one, other) => one.time.localeCompare(other.time)) };
    render();
    scrollTo("#fDayBlock");
    return;
  }
  blockDays(day, day, why, day);
  render();
  scrollTo("#holPanel");
});

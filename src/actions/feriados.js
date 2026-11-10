import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { TODAY } from "../lib/fechas.js";
import { holidayBookingsNote } from "../lib/feriados.js";
import { ME } from "../lib/prestadores.js";
import { isDayBlock } from "../lib/turnero.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { setHolidayChoice } from "../views/prestador/bloqueo-dias.js";
import { holidayBookings } from "../views/prestador/feriados.js";

// 7/11 · Feriados (D39); 10/11: cerrados por defecto. «Voy a trabajar este día» / «Abrir el día» (holOpen) y «Cerrar el
// día de nuevo» / «Dejarlo cerrado» (holClose), desde Horarios (Próximos feriados), la Agenda o el aviso de la campanita.
// Cerrar nunca cancela turnos: los que ya tenía ese día se mantienen.
const holidayOf = (day) => (store.HOLIDAYS || []).find((h) => h.day === day) || { day, name: "" };
const dd = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

registerClick("holOpen", (ev, el, act) => {
  const day = el.dataset.d;
  if (!day || day < TODAY()) {
    return;
  }
  const h = holidayOf(day);
  const done = () => {
    toast(`Listo: el ${dd(day)} abrís y te pueden reservar como cualquier día.`);
    render();
  };
  if (LIVE) {
    el.disabled = true;
    api.m
      .holidayDecide(day, true)
      .then(() => {
        setHolidayChoice(day, true);
        // si lo había cerrado con el «Cierro» de antes (bloqueo de block_days), la base sacó ese bloqueo
        return h.open === false ? api.loadMine() : null;
      })
      .then(done)
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  // demo: si lo había bloqueado con el «Cierro» de antes, se desbloquea
  if (h.open === false) {
    store.BOOK = store.BOOK.filter((item) => !(item.pid == ME() && item.date === day && isDayBlock(item) && item.svc.slice(item.svc.indexOf(" ") + 1).startsWith("Feriado")));
  }
  setHolidayChoice(day, true);
  done();
});

registerClick("holClose", (ev, el, act) => {
  const day = el.dataset.d;
  if (!day || day < TODAY()) {
    return;
  }
  const done = (count) => {
    toast(`Listo: el ${dd(day)} queda cerrado.${count ? ` ${holidayBookingsNote(count)}: si no vas a trabajar, avisales y cancelalos desde la Agenda.` : ""}`);
    render();
  };
  if (LIVE) {
    el.disabled = true;
    api.m
      .holidayDecide(day, false)
      .then((res) => {
        setHolidayChoice(day, false);
        done((res && +res.bookings) || 0);
      })
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  setHolidayChoice(day, false);
  done(holidayBookings(holidayOf(day)));
});

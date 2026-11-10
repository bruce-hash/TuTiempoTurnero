import { esc } from "../../lib/dom.js";
import { TODAY } from "../../lib/fechas.js";
import { holidayBookingsNote, holidayIsOpen, holidayLabel, holidayState, upcomingHolidays } from "../../lib/feriados.js";
import { ME } from "../../lib/prestadores.js";
import { busy } from "../../lib/turnero.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";

// los turnos que ya tiene ese día (por la app o agendados a mano): en vivo los cuenta la base (my_holidays), en la demo
// salen de la agenda en memoria
export function holidayBookings(h) {
  if (h && h.bookings != null) {
    return +h.bookings || 0;
  }
  return busy(ME(), h.day).filter((item) => item.type !== "block" && item.type !== "walk" && item.status === "confirmed").length;
}

// 7/11 · Feriados (D39), en Horarios debajo de "Bloquear días o semanas": los próximos feriados que caen en un día que
// atendés. 10/11: quedan cerrados solos (nadie te reserva); «Voy a trabajar este día» lo abre y «Cerrar el día de nuevo»
// lo vuelve a cerrar. Los turnos que ya tenías ese día se mantienen siempre.
export function vHolidays() {
  const list = upcomingHolidays(store.HOLIDAYS, TODAY());
  if (!list.length) {
    return "";
  }
  return `<div class="panel holpanel" id="holPanel"><p class="lbl">${ic("agenda")} Próximos feriados</p>
   <p class="note" style="text-align:left;margin:0 0 10px">Los feriados quedan cerrados: nadie te puede reservar ese día. Si vas a trabajar, abrilo acá. Los turnos que ya tenías ese día se mantienen; si no vas a trabajar, avisales y cancelalos desde la Agenda (con devolución). Siete días antes te avisamos.</p>
   <ul class="ag hollist">${list
     .map((h) => {
       const open = holidayIsOpen(h);
       const count = holidayBookings(h);
       return `<li data-hol="${esc(h.day)}"><span class="ag-t">${esc(h.day.slice(8, 10))}/${esc(h.day.slice(5, 7))}</span><div><b>${esc(holidayLabel(h.day))} · ${esc(h.name)}</b><span class="hint holset">${open ? "✓ " : ""}${esc(holidayState(h))}${count ? ` · ${esc(holidayBookingsNote(count))}` : ""}</span></div>
     <div class="holbtns">${
       open
         ? `<button type="button" class="btn btn-sm btn-ghost" data-act="holClose" data-d="${esc(h.day)}">Cerrar el día de nuevo</button>`
         : `<button type="button" class="btn btn-sm btn-pri" data-act="holOpen" data-d="${esc(h.day)}">Voy a trabajar este día</button>`
     }</div></li>`;
     })
     .join("")}</ul></div>`;
}

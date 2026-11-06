import { esc } from "../../lib/dom.js";
import { TODAY } from "../../lib/fechas.js";
import { holidayLabel, holidayState, upcomingHolidays } from "../../lib/feriados.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";

// 7/11 · Feriados (D39), en Horarios debajo de "Bloquear días o semanas": los próximos feriados que caen en un día que
// atendés, con Abro / Cierro. Si no elegís, el feriado queda abierto; 7 días antes te llega el aviso.
export function vHolidays() {
  const list = upcomingHolidays(store.HOLIDAYS, TODAY());
  if (!list.length) {
    return "";
  }
  return `<div class="panel holpanel" id="holPanel"><p class="lbl">${ic("agenda")} Próximos feriados</p>
   <p class="note" style="text-align:left;margin:0 0 10px">Si no elegís nada, ese día queda abierto como cualquier otro. Siete días antes te avisamos. «Cierro» lo bloquea igual que «Bloquear días»: si tenés turnos ese día, antes te mostramos la lista.</p>
   <ul class="ag hollist">${list
     .map(
       (h) => `<li data-hol="${esc(h.day)}"><span class="ag-t">${esc(h.day.slice(8, 10))}/${esc(h.day.slice(5, 7))}</span><div><b>${esc(holidayLabel(h.day))} · ${esc(h.name)}</b><span class="hint ${h.open == null ? "" : "holset"}">${h.open == null ? "" : "✓ "}${esc(holidayState(h))}</span></div>
     <div class="holbtns"><button type="button" class="btn btn-sm ${h.open === true ? "btn-pri" : "btn-ghost"}" data-act="holOpen" data-d="${esc(h.day)}" aria-pressed="${h.open === true}">Abro</button><button type="button" class="btn btn-sm ${h.open === false ? "btn-pri" : "btn-ghost"}" data-act="holClose" data-d="${esc(h.day)}" aria-pressed="${h.open === false}">Cierro</button></div></li>`,
     )
     .join("")}</ul></div>`;
}

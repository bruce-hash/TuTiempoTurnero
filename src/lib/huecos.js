import { NOW, TODAY, addDays, dkey, toMin } from "./fechas.js";
import { ME } from "./prestadores.js";
import { busy, cfg, ranges } from "./turnero.js";

// Huecos libres del prestador en un día: 30 minutos o más dentro de su horario, sin turnos, reservas en pago ni
// bloqueos (y desde ahora, si es hoy, redondeado a la media hora). [[desde, hasta]] en minutos del día. Los usa la Agenda
// ("Ofrecer") y Clientes → Seguidores ("Ofrecer turno"). La base vuelve a controlar que estén libres (offer_slot).
export function freeGaps(day, pid = ME()) {
  const conf = cfg(pid);
  const dow = new Date(day + "T12:00:00").getDay();
  const rngs = ranges(conf, dow);
  if (!rngs.length) {
    return [];
  }
  const taken = busy(pid, day).map((item) => [toMin(item.time), toMin(item.time) + item.dur]);
  for (let index = 1; index < rngs.length; index++) {
    if (rngs[index][0] > rngs[index - 1][1]) {
      taken.push([rngs[index - 1][1], rngs[index][0]]);
    }
  }
  const top = Math.min(rngs[0][0], ...taken.map((range) => range[0]));
  const bottom = Math.max(rngs[rngs.length - 1][1], ...taken.map((range) => range[1]));
  if (top < rngs[0][0]) {
    taken.push([top, rngs[0][0]]);
  }
  if (bottom > rngs[rngs.length - 1][1]) {
    taken.push([rngs[rngs.length - 1][1], bottom]);
  }
  taken.sort((one, other) => one[0] - other[0]);
  const isToday = day === TODAY();
  const earliest = isToday ? Math.ceil((NOW().getHours() * 60 + NOW().getMinutes()) / 30) * 30 : 0;
  const gaps = [];
  let cursor = top;
  const push = (to) => {
    const start = Math.max(cursor, earliest);
    if (to - start >= 30) {
      gaps.push([start, to]);
    }
  };
  for (const [from, to] of taken) {
    if (from - cursor >= 30) {
      push(from);
    }
    cursor = Math.max(cursor, to);
  }
  if (bottom - cursor >= 30) {
    push(bottom);
  }
  return gaps;
}

// los huecos de los próximos días (para ofrecerle un turno a un seguidor): [{day, from, to}] en minutos
export function nextGaps(days = 7, pid = ME()) {
  const out = [];
  for (let offset = 0; offset < days; offset++) {
    const day = dkey(addDays(offset));
    freeGaps(day, pid).forEach(([from, to]) => out.push({ day, from, to }));
  }
  return out;
}

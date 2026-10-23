import { LIVE } from "../config.js";
import { esc } from "./dom.js";
import { NOW, TODAY, addDays, dayLabel, dkey, fromMin, toMin } from "./fechas.js";
import { pr } from "./prestadores.js";
import { RUBRO } from "./rubros.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { notif } from "../ui/toast.js";

// Franja horaria de un turno de atención (mañana o tarde).
export const R = (enabled, start, end) => ({
  on: enabled,
  from: start,
  to: end,
});
const dayCfg = (enabled, morning, afternoon) => ({
  on: enabled,
  m: morning,
  t: afternoon,
});
// Clave estable de un servicio: su id (en vivo) o su nombre (en la demo).
export function skey(svc) {
  if (svc) {
    return svc[4] || svc[0];
  } else {
    return "";
  }
}
// Configuración de agenda de un prestador cuando todavía no se cargó la suya (en vivo la trae la base).
export const defCfg = () => ({
  on: true,
  cash: true,
  stamps: {
    on: !LIVE,
    goals: {},
  },
  days: {
    0: dayCfg(false, R(true, "09:00", "13:00"), R(false, "15:00", "21:00")),
    1: dayCfg(true, R(true, "09:00", "12:00"), R(true, "15:00", "21:00")),
    2: dayCfg(true, R(true, "09:00", "12:00"), R(true, "15:00", "21:00")),
    3: dayCfg(true, R(true, "09:00", "12:00"), R(true, "15:00", "21:00")),
    4: dayCfg(true, R(true, "09:00", "12:00"), R(true, "15:00", "21:00")),
    5: dayCfg(true, R(true, "09:00", "12:00"), R(true, "15:00", "21:00")),
    6: dayCfg(true, R(true, "09:00", "13:00"), R(false, "15:00", "21:00")),
  },
  step: 30,
  ahead: 31,
  notice: 60,
  pay: "sena",
  pct: 50,
  buffer: 0,
  happy: {
    on: true,
    pct: 20,
    days: [1, 2, 3, 4],
    from: "09:00",
    to: "12:00",
  },
  strict: false,
});
// Franjas de atención de un día de la semana, en minutos desde las 0 h, de la más temprana a la más tarde.
export function ranges(conf, dow) {
  const day = conf.days[dow];
  if (!day || !day.on) {
    return [];
  } else {
    return [day.m, day.t]
      .filter((shift) => shift && shift.on && shift.from && shift.to && toMin(shift.to) > toMin(shift.from))
      .map((shift) => [toMin(shift.from), toMin(shift.to)])
      .sort((left, right) => left[0] - right[0]);
  }
}
export const rangesTxt = (list) => list.map(([from, to]) => fromMin(from) + "–" + fromMin(to)).join(" y ");
store.CFGS = {};
store.BOOK = [];
store.WAIT = [];
store.BID = 1;
store.CLIENTS = {};
store.SID = 1;
// Configuración de agenda de cada prestador, creada la primera vez que se pide (en la demo, con valores de ejemplo).
export const cfg = (pid) =>
  (store.CFGS[pid] ||= (() => {
    const conf = defCfg();
    if (!LIVE && pr(pid)) {
      conf.buffer = (RUBRO[pr(pid).cats[0]] || RUBRO.b).buffer;
    }
    if (+pid != 7 && +pid != 21) {
      conf.happy.on = false;
    }
    if (!LIVE && pr(pid)) {
      pr(pid).svcs.forEach((svc) => {
        if (+pid != 7 || svc[0] !== "Arreglo de barba") {
          conf.stamps.goals[skey(svc)] = +pid == 21 ? 20 : 15;
        }
      });
    }
    if (+pid == 21) {
      conf.happy = {
        on: true,
        pct: 15,
        days: [2, 3],
        from: "09:00",
        to: "12:00",
      };
    }
    return conf;
  })());
export const cli = (name) =>
  (store.CLIENTS[name] ||= {
    v: 0,
    n: 0,
    last: null,
    spend: 0,
    tel: "",
    notes: "",
    bday: "",
  });
export const uname = () =>
  S.user ? (S.user.name.split(" ")[0] + " " + (S.user.name.split(" ")[1] || "").charAt(0) + ".").trim() : "";
export const isDayBlock = (booking) => booking.type === "block" && String(booking.svc || "").startsWith("🏖️");
export const busy = (pid, date) => store.BOOK.filter((booking) => booking.pid == pid && booking.date === date && booking.status !== "cancelled");
export function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}
export function happyAt(pid, date, min) {
  const happy = cfg(pid).happy;
  if (!happy.on) {
    return 0;
  }
  const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (happy.days.includes(dow) && min >= toMin(happy.from) && min < toMin(happy.to)) {
    return happy.pct;
  } else {
    return 0;
  }
}
// Horarios de un día para un servicio de `dur` minutos: libres u ocupados (contando el descanso entre turnos) y con
// el descuento de happy hour. Si el día está cerrado, devuelve el motivo.
export function slotsFor(pid, date, dur, ignoreId, anyDate) {
  const conf = cfg(pid);
  const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (!conf.on) {
    return {
      closed: true,
      reason: "El profesional no tiene turnos online activos",
      list: [],
    };
  }
  const shifts = ranges(conf, dow);
  if (!shifts.length) {
    return {
      closed: true,
      reason: "Cerrado",
      list: [],
    };
  }
  if (busy(pid, date).some((booking) => isDayBlock(booking) || booking.dayBlock)) {
    return {
      closed: true,
      reason: "El profesional no atiende este día",
      list: [],
    };
  }
  if (!anyDate && date > dkey(addDays(conf.ahead - 1))) {
    return {
      closed: true,
      reason: "Todavía no abrió la agenda",
      list: [],
    };
  }
  const now = NOW();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const taken = busy(pid, date).filter((booking) => booking.id !== ignoreId);
  const list = [];
  for (const [from, to] of shifts) {
    for (let start = from; start + dur <= to; start += conf.step) {
      if (date === TODAY() && start <= nowMin + conf.notice) {
        continue;
      }
      const clash = taken.some((booking) =>
        overlaps(
          start,
          start + dur + (conf.buffer || 0),
          toMin(booking.time),
          toMin(booking.time) + booking.dur + (booking.busy ? 0 : (booking.buf ?? (conf.buffer || 0))),
        ),
      );
      list.push({
        time: fromMin(start),
        free: !clash,
        disc: happyAt(pid, date, start),
      });
    }
  }
  return {
    closed: false,
    list: list,
  };
}
export const freeCount = (pid, date, dur, ignoreId) => slotsFor(pid, date, dur, ignoreId).list.filter((slot) => slot.free).length;
export function nextFree(pid, dur, ig) {
  const conf = cfg(pid);
  for (let day = 0; day < conf.ahead; day++) {
    const date = dkey(addDays(day));
    const slot = slotsFor(pid, date, dur, ig).list.find((item) => item.free);
    if (slot) {
      return {
        date: date,
        time: slot.time,
        disc: slot.disc,
      };
    }
  }
  return null;
}
export const priceAt = (pid, price, date, time) => Math.round(price * (1 - happyAt(pid, date, toMin(time)) / 100));
export function seriesDates(date, weeks, count) {
  const dates = [];
  for (let rep = 1; rep <= count; rep++) {
    dates.push(dkey(addDays(weeks * 7 * rep, date)));
  }
  return dates;
}
// Se liberó un horario: saca de la lista de espera a los de ese día y avisa.
export function freed(booking) {
  const waiting = store.WAIT.filter((entry) => entry.pid == booking.pid && entry.date === booking.date);
  if (waiting.length) {
    store.WAIT = store.WAIT.filter((entry) => entry.pid != booking.pid || entry.date !== booking.date);
    notif(
      `<span class="mp" style="background:var(--ok)">🔔</span><div><b>Se liberó un turno</b><br><span class="hint">${esc(pr(booking.pid).name)} · ${esc(dayLabel(booking.date))} ${booking.time}. Avisamos a quienes estaban en lista de espera.</span></div>`,
    );
  }
  return waiting.length;
}

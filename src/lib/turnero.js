import { LIVE } from "../config.js";
import { esc } from "./dom.js";
import { NOW, TODAY, addDays, dayLabel, dkey, fromMin, toMin } from "./fechas.js";
import { pr } from "./prestadores.js";
import { RUBRO } from "./rubros.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { notif } from "../ui/toast.js";

export const R = (e, a, t) => ({
  on: e,
  from: a,
  to: t,
});
const dayCfg = (e, a, t) => ({
  on: e,
  m: a,
  t,
});
export function skey(e) {
  if (e) {
    return e[4] || e[0];
  } else {
    return "";
  }
}
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
export function ranges(e, dow) {
  const t = e.days[dow];
  if (!t || !t.on) {
    return [];
  } else {
    return [t.m, t.t]
      .filter((s) => s && s.on && s.from && s.to && toMin(s.to) > toMin(s.from))
      .map((s) => [toMin(s.from), toMin(s.to)])
      .sort((s, n) => s[0] - n[0]);
  }
}
export const rangesTxt = (e) => e.map(([a, t]) => fromMin(a) + "–" + fromMin(t)).join(" y ");
store.CFGS = {};
store.BOOK = [];
store.WAIT = [];
store.BID = 1;
store.CLIENTS = {};
store.SID = 1;
export const cfg = (e) =>
  (store.CFGS[e] ||= (() => {
    const a = defCfg();
    if (!LIVE && pr(e)) {
      a.buffer = (RUBRO[pr(e).cats[0]] || RUBRO.b).buffer;
    }
    if (+e != 7 && +e != 21) {
      a.happy.on = false;
    }
    if (!LIVE && pr(e)) {
      pr(e).svcs.forEach((t) => {
        if (+e != 7 || t[0] !== "Arreglo de barba") {
          a.stamps.goals[skey(t)] = +e == 21 ? 20 : 15;
        }
      });
    }
    if (+e == 21) {
      a.happy = {
        on: true,
        pct: 15,
        days: [2, 3],
        from: "09:00",
        to: "12:00",
      };
    }
    return a;
  })());
export const cli = (e) =>
  (store.CLIENTS[e] ||= {
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
export const isDayBlock = (e) => e.type === "block" && String(e.svc || "").startsWith("🏖️");
export const busy = (e, a) => store.BOOK.filter((t) => t.pid == e && t.date === a && t.status !== "cancelled");
export function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}
export function happyAt(pid, date, min) {
  const s = cfg(pid).happy;
  if (!s.on) {
    return 0;
  }
  const n = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (s.days.includes(n) && min >= toMin(s.from) && min < toMin(s.to)) {
    return s.pct;
  } else {
    return 0;
  }
}
export function slotsFor(pid, date, dur, ignoreId, anyDate) {
  const o = cfg(pid);
  const i = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (!o.on) {
    return {
      closed: true,
      reason: "El profesional no tiene turnos online activos",
      list: [],
    };
  }
  const l = ranges(o, i);
  if (!l.length) {
    return {
      closed: true,
      reason: "Cerrado",
      list: [],
    };
  }
  if (busy(pid, date).some((y) => isDayBlock(y) || y.dayBlock)) {
    return {
      closed: true,
      reason: "El profesional no atiende este día",
      list: [],
    };
  }
  if (!anyDate && date > dkey(addDays(o.ahead - 1))) {
    return {
      closed: true,
      reason: "Todavía no abrió la agenda",
      list: [],
    };
  }
  const c = NOW();
  const d = c.getHours() * 60 + c.getMinutes();
  const p = busy(pid, date).filter((y) => y.id !== ignoreId);
  const w = [];
  for (const [y, k] of l) {
    for (let h = y; h + dur <= k; h += o.step) {
      if (date === TODAY() && h <= d + o.notice) {
        continue;
      }
      const j = p.some((b) =>
        overlaps(
          h,
          h + dur + (o.buffer || 0),
          toMin(b.time),
          toMin(b.time) + b.dur + (b.busy ? 0 : (b.buf ?? (o.buffer || 0))),
        ),
      );
      w.push({
        time: fromMin(h),
        free: !j,
        disc: happyAt(pid, date, h),
      });
    }
  }
  return {
    closed: false,
    list: w,
  };
}
export const freeCount = (e, a, t, s) => slotsFor(e, a, t, s).list.filter((n) => n.free).length;
export function nextFree(pid, dur, ig) {
  const s = cfg(pid);
  for (let n = 0; n < s.ahead; n++) {
    const o = dkey(addDays(n));
    const i = slotsFor(pid, o, dur, ig).list.find((l) => l.free);
    if (i) {
      return {
        date: o,
        time: i.time,
        disc: i.disc,
      };
    }
  }
  return null;
}
export const priceAt = (e, a, t, s) => Math.round(a * (1 - happyAt(e, t, toMin(s)) / 100));
export function seriesDates(date, weeks, t) {
  const s = [];
  for (let n = 1; n <= t; n++) {
    s.push(dkey(addDays(weeks * 7 * n, date)));
  }
  return s;
}
export function freed(e) {
  const a = store.WAIT.filter((t) => t.pid == e.pid && t.date === e.date);
  if (a.length) {
    store.WAIT = store.WAIT.filter((t) => t.pid != e.pid || t.date !== e.date);
    notif(
      `<span class="mp" style="background:var(--ok)">🔔</span><div><b>Se liberó un turno</b><br><span class="hint">${esc(pr(e.pid).name)} · ${esc(dayLabel(e.date))} ${e.time}. Avisamos a quienes estaban en lista de espera.</span></div>`,
    );
  }
  return a.length;
}

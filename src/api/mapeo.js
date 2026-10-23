import { R, defCfg } from "../lib/turnero.js";
import { P } from "../store.js";

export function upsertP(e) {
  const a = P.findIndex((t) => t.id == e.id);
  if (a < 0) {
    P.push(e);
    return e;
  } else {
    Object.assign(P[a], e);
    return P[a];
  }
}
export function svcsFromDb(list) {
  return (list || []).map((a) => [
    a.name,
    a.duration,
    a.price,
    a.category,
    a.id,
    {
      every: a.repeat_days || 0,
      note: a.prep_note || "",
      add: (a.addons || []).map((t) => [t.name, t.price, t.duration, t.id]),
    },
  ]);
}
export function cfgFromDb(st, hours) {
  const t = defCfg();
  if (!st) {
    return t;
  }
  t.on = !!st.online;
  t.step = st.step_min;
  t.ahead = st.ahead_days;
  t.notice = st.notice_min;
  t.pay = st.pay_mode === "full" ? "total" : "sena";
  t.pct = st.deposit_pct;
  t.strict = st.strict_no_show;
  t.happy = {
    on: !!st.happy_on,
    pct: st.happy_pct,
    days: st.happy_days || [],
    from: String(st.happy_from).slice(0, 5),
    to: String(st.happy_to).slice(0, 5),
  };
  t.buffer = st.buffer_min || 0;
  t.cash = st.cash_ok !== false;
  t.stamps = {
    on: !!st.stamps_on,
    goals: {},
  };
  for (let s = 0; s < 7; s++) {
    const n = (hours || []).filter((l) => l.dow === s);
    const o = n.find((l) => l.shift === 1);
    const i = n.find((l) => l.shift === 2);
    t.days[s] = {
      on: !!o || !!i,
      m: o ? R(true, o.opens, o.closes) : R(false, "09:00", "12:00"),
      t: i ? R(true, i.opens, i.closes) : R(false, "15:00", "21:00"),
    };
  }
  return t;
}
export function cfgToDb(pid, a) {
  const t = {
    provider_id: pid,
    online: a.on,
    step_min: a.step,
    ahead_days: a.ahead,
    notice_min: a.notice,
    pay_mode: a.pay === "total" ? "full" : "deposit",
    deposit_pct: a.pct || 50,
    strict_no_show: !!a.strict,
    happy_on: !!a.happy.on,
    happy_pct: a.happy.pct,
    happy_days: a.happy.days,
    happy_from: a.happy.from,
    happy_to: a.happy.to,
    buffer_min: a.buffer || 0,
    cash_ok: a.cash !== false,
    stamps_on: !!a.stamps && !!a.stamps.on,
  };
  const s = [];
  for (let n = 0; n < 7; n++) {
    const o = a.days[n];
    if (!!o && !!o.on) {
      [
        ["m", 1],
        ["t", 2],
      ].forEach(([i, l]) => {
        const c = o[i];
        if (c && c.on) {
          s.push({
            provider_id: pid,
            dow: n,
            shift: l,
            opens: c.from,
            closes: c.to,
          });
        }
      });
    }
  }
  return {
    st: t,
    hours: s,
  };
}

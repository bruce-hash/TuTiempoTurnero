import { R, defCfg } from "../lib/turnero.js";
import { P } from "../store.js";

// Agrega un prestador al array compartido P o actualiza el que ya está (mismo objeto, para no perder referencias).
export function upsertP(prov) {
  const idx = P.findIndex((item) => item.id == prov.id);
  if (idx < 0) {
    P.push(prov);
    return prov;
  } else {
    Object.assign(P[idx], prov);
    return P[idx];
  }
}
// Servicios de la base → tuplas [nombre, minutos, precio, rubro, id, meta] que usa la app.
export function svcsFromDb(list) {
  return (list || []).map((svc) => [
    svc.name,
    svc.duration,
    svc.price,
    svc.category,
    svc.id,
    {
      every: svc.repeat_days || 0,
      note: svc.prep_note || "",
      add: (svc.addons || []).map((addon) => [addon.name, addon.price, addon.duration, addon.id]),
    },
  ]);
}
// Configuración de agenda de la base (provider_settings + provider_hours) → la de la app (ver defCfg). Turno 1 =
// mañana (m), turno 2 = tarde (t).
export function cfgFromDb(st, hours) {
  const conf = defCfg();
  if (!st) {
    return conf;
  }
  conf.on = !!st.online;
  conf.step = st.step_min;
  conf.ahead = st.ahead_days;
  conf.notice = st.notice_min;
  conf.pay = st.pay_mode === "full" ? "total" : "sena";
  conf.pct = st.deposit_pct;
  conf.strict = st.strict_no_show;
  conf.happy = {
    on: !!st.happy_on,
    pct: st.happy_pct,
    days: st.happy_days || [],
    from: String(st.happy_from).slice(0, 5),
    to: String(st.happy_to).slice(0, 5),
  };
  conf.buffer = st.buffer_min || 0;
  conf.cash = st.cash_ok !== false;
  conf.stamps = {
    on: !!st.stamps_on,
    goals: {},
  };
  for (let dow = 0; dow < 7; dow++) {
    const dayHours = (hours || []).filter((row) => row.dow === dow);
    const morning = dayHours.find((row) => row.shift === 1);
    const afternoon = dayHours.find((row) => row.shift === 2);
    conf.days[dow] = {
      on: !!morning || !!afternoon,
      m: morning ? R(true, morning.opens, morning.closes) : R(false, "09:00", "12:00"),
      t: afternoon ? R(true, afternoon.opens, afternoon.closes) : R(false, "15:00", "21:00"),
    };
  }
  return conf;
}
// Al revés, para guardar: la configuración de la app → filas de provider_settings y provider_hours.
export function cfgToDb(pid, conf) {
  const st = {
    provider_id: pid,
    online: conf.on,
    step_min: conf.step,
    ahead_days: conf.ahead,
    notice_min: conf.notice,
    pay_mode: conf.pay === "total" ? "full" : "deposit",
    deposit_pct: conf.pct || 50,
    strict_no_show: !!conf.strict,
    happy_on: !!conf.happy.on,
    happy_pct: conf.happy.pct,
    happy_days: conf.happy.days,
    happy_from: conf.happy.from,
    happy_to: conf.happy.to,
    buffer_min: conf.buffer || 0,
    cash_ok: conf.cash !== false,
    stamps_on: !!conf.stamps && !!conf.stamps.on,
  };
  const hours = [];
  for (let dow = 0; dow < 7; dow++) {
    const day = conf.days[dow];
    if (!!day && !!day.on) {
      [
        ["m", 1],
        ["t", 2],
      ].forEach(([part, shift]) => {
        const range = day[part];
        if (range && range.on) {
          hours.push({
            provider_id: pid,
            dow: dow,
            shift: shift,
            opens: range.from,
            closes: range.to,
          });
        }
      });
    }
  }
  return {
    st: st,
    hours: hours,
  };
}

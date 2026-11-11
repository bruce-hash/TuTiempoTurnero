import { TODAY, addDays, dkey, nowHM, pad } from "../lib/fechas.js";
import { store } from "../store.js";
import { Z5 } from "../views/admin/balance.js";
import { feeOf } from "../lib/finanzas-base.js";

export const demoPending0 = () => [
  {
    id: 901,
    name: "Barbería El Turco",
    cats: ["b"],
    addr: "Necochea 2950",
    created: "hace 1 día",
    status: "pending",
    verified: false,
  },
  {
    id: 902,
    name: "Brillo Nails",
    cats: ["u"],
    addr: "Rivadavia 2410",
    created: "hace 3 días",
    status: "pending",
    verified: false,
  },
];
export const ADM_LAUNCH = "2025-03-01";
// "Para revisar · cobros" de la demo: una devolución que se está reintentando y un pago con la comisión distinta
export function admReviewDemo() {
  store.DEMO_REV ||= {
    refunds: [
      { id: 1, amount: 7200, reason: "slot_taken", status: "pending", attempts: 2, last_error: "400 insufficient_amount",
        next_attempt_at: dkey(addDays(1)), mp_payment_id: "1324567890", provider_name: "Barbería de ejemplo", client_name: "Cliente de ejemplo" },
    ],
    payments: [
      { id: 2, mp_payment_id: "1324567999", amount: 7500, refundable: 1500, refundable_from_app: true, review_reasons: ["amount_over"], provider_name: "Barbería de ejemplo", client_name: "Cliente de ejemplo" },
    ],
    webhook_events: [{ id: 3, mp_payment_id: "1324568000", reason: "payment_not_found", created_at: dkey(addDays(-1)), provider_name: "Barbería de ejemplo" }],
  };
  return store.DEMO_REV;
}
// historial inventado de la plataforma desde ADM_LAUNCH hasta ayer (turnos, facturado, comisión del 10 %, señas
// del 50 %), por día y por mes; se calcula una vez por día
export function admHist() {
  const today = TODAY();
  if (admHist.d === today) {
    return admHist.c;
  }
  const byDay = {};
  const byMonth = {};
  const nDays = Math.max(
    1,
    Math.round(
      /* @__PURE__ */ (new Date(today + "T12:00:00") - /* @__PURE__ */ new Date(ADM_LAUNCH + "T12:00:00")) /
        864e5,
    ),
  );
  for (let daysAgo = nDays; daysAgo >= 1; daysAgo--) {
    const date = dkey(addDays(-daysAgo));
    const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
    const ramp = daysAgo <= 75 ? 1 : Math.max(0.22, 1 - (daysAgo - 75) / 520);
    const count = Math.round(
      (dow === 0 ? 3 : Math.round((20 + ((daysAgo * 37) % 13)) * (dow === 6 ? 1.3 : dow === 5 ? 1.15 : 1))) * ramp,
    );
    const ticket = 12e3 + ((daysAgo * 53) % 9) * 600;
    const day = (byDay[date] = {
      n: count,
      gross: count * ticket,
      fee: Math.round(count * ticket * 0.1),
      dep: Math.round(count * ticket * 0.5),
      ns: Math.round(count * 0.04),
      cx: Math.round(count * 0.06),
    });
    const ym = date.slice(0, 7);
    const month = (byMonth[ym] ||= {
      n: 0,
      dep: 0,
      fee: 0,
    });
    month.n += day.n;
    month.dep += day.dep;
    month.fee += day.fee;
  }
  admHist.c = byDay;
  admHist.m = byMonth;
  admHist.d = today;
  return byDay;
}
// cuentas de un mes: historial inventado más los turnos reales de la demo
function admMonthDemo(ym) {
  admHist();
  const hist = admHist.m[ym] || {
    n: 0,
    dep: 0,
    fee: 0,
  };
  const live = store.BOOK.filter(
    (booking) =>
      booking.src === "app" &&
      booking.type !== "block" &&
      (booking.paid || 0) > 0 &&
      booking.date.slice(0, 7) === ym &&
      (["confirmed", "done", "noshow"].includes(booking.status) || (booking.status === "cancelled" && !booking.byProv)),
  );
  const deposits = hist.dep + live.reduce((sum, booking) => sum + (booking.paid || 0) - feeOf(booking), 0);
  const commission = hist.fee + live.reduce((sum, booking) => sum + (booking.fee || 0) + feeOf(booking), 0);
  return {
    bookings: hist.n + live.length,
    charged: deposits + commission,
    deposits: deposits,
    commission: commission,
    // D44: gastos fijos y variables aparte (expenses es el total)
    ...admExpDemo(ym),
  };
}
// gastos de TuTiempo de un mes: total, fijos y variables
function admExpDemo(ym) {
  const rows = store.DEMO_AEXP.filter((exp) => exp.day.slice(0, 7) === ym);
  const fixed = rows.filter((exp) => exp.fixed_id).reduce((sum, exp) => sum + exp.amount, 0);
  const variable = rows.filter((exp) => !exp.fixed_id).reduce((sum, exp) => sum + exp.amount, 0);
  return { expenses: fixed + variable, fixed: fixed, variable: variable };
}
const nextM = (ym) => {
  const date = /* @__PURE__ */ new Date(ym + "-15T12:00:00");
  date.setMonth(date.getMonth() + 1);
  return dkey(date).slice(0, 7);
};
// datos de ejemplo del admin: notas, gastos mensuales y meses ya cerrados hasta el anteúltimo
export function admDemo() {
  if (store.ADM_READY) {
    return;
  }
  store.ADM_READY = true;
  store.DEMO_NOTES = {
    7: [
      {
        id: store.NID++,
        body: "Muy buena atención. Pidió aparecer en las historias de Instagram de TuTiempo.",
        d: dkey(addDays(-12)),
        t: "15:20",
      },
    ],
  };
  store.DEMO_AEXP = [];
  store.DEMO_ACL = {};
  const current = TODAY().slice(0, 7);
  const launch = ADM_LAUNCH.slice(0, 7);
  // D44: los gastos fijos de ejemplo (los emails, sin monto: «Completá el monto»); se cargan solos cada mes
  store.DEMO_AFIX = [
    ["Hosting (Hostinger)", 15e3, "hosting"],
    ["Base de datos (Supabase)", 25e3, "database"],
    ["Emails (Resend)", 0, "email"],
    ["Dominio", 5e3, "domain"],
  ].map(([concept, amount, preset]) => ({ id: store.AEID++, concept, amount, since: launch, from: launch, until: null, preset: true, key: preset }));
  admFixedSyncDemo();
  for (let ym = launch; ym <= current; ym = nextM(ym)) {
    if (ym < current || +TODAY().slice(8) >= 10) {
      store.DEMO_AEXP.push({
        id: store.AEID++,
        day: ym + "-10",
        concept: "Publicidad en Instagram",
        amount: ym < "2025-09" ? 8e4 : 15e4,
      });
    }
  }
  const prev = (() => {
    const date = /* @__PURE__ */ new Date(current + "-15T12:00:00");
    date.setMonth(date.getMonth() - 1);
    return dkey(date).slice(0, 7);
  })();
  for (let ym = ADM_LAUNCH.slice(0, 7); ym < prev; ym = nextM(ym)) {
    store.DEMO_ACL["month|" + ym] = Object.assign(admMonthDemo(ym), {
      closed_at: nextM(ym) + "-03T10:00:00",
    });
  }
}
// D44 · gastos fijos de TuTiempo en la demo, con la misma regla que la base (admin_fixed_sync, admin_fixed_save,
// admin_fixed_stop): la fila de cada mes desde que vale el monto actual, nunca en un mes cerrado; se cambian solo desde
// el mes actual. store.DEMO_AFIX: [{ id, concept, amount, since "AAAA-MM", from "AAAA-MM", until "AAAA-MM" | null, preset }]
const aClosed = (ym) => !!store.DEMO_ACL["month|" + ym];
export function admFixedSyncDemo() {
  const current = TODAY().slice(0, 7);
  (store.DEMO_AFIX || []).forEach((item) => {
    if (!item.amount) {
      return;
    }
    for (let ym = item.from > item.since ? item.from : item.since; ym <= current && (!item.until || ym <= item.until); ym = nextM(ym)) {
      if (!aClosed(ym) && !store.DEMO_AEXP.some((exp) => exp.fixed_id === item.id && exp.day.slice(0, 7) === ym)) {
        store.DEMO_AEXP.push({ id: store.AEID++, day: ym + "-01", concept: item.concept, amount: item.amount, fixed_id: item.id });
      }
    }
  });
}
// crear (item null) o cambiar un gasto fijo desde el mes actual (ym); devuelve un error o null
export function admFixedSaveDemo(item, concept, amount, ym) {
  if (ym !== TODAY().slice(0, 7)) {
    return "Los gastos fijos se cambian desde el mes actual.";
  }
  if (aClosed(ym)) {
    return "El mes está cerrado: reabrilo para cambiarlo.";
  }
  admFixedSyncDemo();
  if (!item) {
    store.DEMO_AFIX.push({ id: store.AEID++, concept, amount, since: ym, from: ym, until: null, preset: false });
  } else {
    Object.assign(item, { concept, amount, from: item.since > ym ? item.since : ym, until: null });
    store.DEMO_AEXP = store.DEMO_AEXP.filter((exp) => !(exp.fixed_id === item.id && exp.day.slice(0, 7) >= ym && !amount && !aClosed(exp.day.slice(0, 7))));
    store.DEMO_AEXP.forEach((exp) => {
      if (exp.fixed_id === item.id && exp.day.slice(0, 7) >= ym && !aClosed(exp.day.slice(0, 7))) {
        Object.assign(exp, { concept, amount });
      }
    });
  }
  admFixedSyncDemo();
  return null;
}
// dejar de repetirlo desde el mes actual
export function admFixedStopDemo(item, ym) {
  if (aClosed(ym)) {
    return "El mes está cerrado: reabrilo para cambiarlo.";
  }
  admFixedSyncDemo();
  const prev = (() => {
    const date = /* @__PURE__ */ new Date((item.since > ym ? item.since : ym) + "-15T12:00:00");
    date.setMonth(date.getMonth() - 1);
    return dkey(date).slice(0, 7);
  })();
  item.until = prev;
  store.DEMO_AEXP = store.DEMO_AEXP.filter((exp) => !(exp.fixed_id === item.id && exp.day.slice(0, 7) >= ym && !aClosed(exp.day.slice(0, 7))));
  return null;
}
export function admFinDemo(year) {
  admDemo();
  admFixedSyncDemo();
  const current = TODAY().slice(0, 7);
  const nowYear = +current.slice(0, 4);
  const months = Array.from(
    {
      length: 12,
    },
    (slot, index) => {
      const ym = year + "-" + pad(index + 1);
      const closed = store.DEMO_ACL["month|" + ym];
      const totals = closed || (ym > current ? Z5() : admMonthDemo(ym));
      return Object.assign({}, totals, {
        month: ym,
        closed_at: closed ? closed.closed_at : null,
        state: closed ? "closed" : ym > current ? "future" : ym === current ? "open" : "ended",
      });
    },
  );
  const yearClosed = store.DEMO_ACL["year|" + year];
  return {
    year: year,
    months: months,
    year_closed_at: yearClosed ? yearClosed.closed_at : null,
    can_close_year: year < nowYear,
    current_month: current,
    fixed_items: store.DEMO_AFIX.filter((item) => !item.until || item.until >= item.since).map((item) => ({
      id: item.id,
      concept: item.concept,
      amount: item.amount,
      since: item.since,
      until: item.until,
      preset: item.preset,
    })),
    expenses: store.DEMO_AEXP.filter((exp) => exp.day.slice(0, 4) === String(year)).sort(
      (one, other) => other.day.localeCompare(one.day) || other.id - one.id,
    ),
    years: Object.keys(store.DEMO_ACL)
      .filter((key) => key.startsWith("year|"))
      .sort()
      .map((key) =>
        Object.assign(
          {
            year: +key.slice(5),
          },
          store.DEMO_ACL[key],
        ),
      ),
  };
}
// cerrar o reabrir un mes o un año; cerrar el año cierra los meses que falten y suma sus cuentas
export function admCloseDemo(close, kind, period) {
  const year = +period.slice(0, 4);
  const ym = period.slice(0, 7);
  const now = TODAY() + "T" + nowHM() + ":00";
  // D44: los gastos fijos que falten, antes de la foto (como admin_close)
  admFixedSyncDemo();
  if (kind === "month") {
    if (close) {
      store.DEMO_ACL["month|" + ym] = Object.assign(admMonthDemo(ym), {
        closed_at: now,
      });
    } else {
      delete store.DEMO_ACL["month|" + ym];
    }
    return;
  }
  if (!close) {
    delete store.DEMO_ACL["year|" + year];
    return;
  }
  const sum = Z5();
  for (let month = 1; month <= 12; month++) {
    const ym = year + "-" + pad(month);
    store.DEMO_ACL["month|" + ym] ||= Object.assign(admMonthDemo(ym), {
      closed_at: now,
    });
    const closed = store.DEMO_ACL["month|" + ym];
    for (const field in sum) {
      sum[field] += +closed[field] || 0;
    }
  }
  store.DEMO_ACL["year|" + year] = Object.assign(sum, {
    closed_at: now,
  });
}

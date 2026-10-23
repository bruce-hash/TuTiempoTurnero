import { TODAY, addDays, dkey, nowHM, pad } from "../lib/fechas.js";
import { store } from "../store.js";
import { Z5 } from "../views/admin/balance.js";
import { feeOf } from "../views/prestador/finanzas.js";

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
export function admHist() {
  const e = TODAY();
  if (admHist.d === e) {
    return admHist.c;
  }
  const a = {};
  const t = {};
  const s = Math.max(
    1,
    Math.round(
      /* @__PURE__ */ (new Date(e + "T12:00:00") - /* @__PURE__ */ new Date(ADM_LAUNCH + "T12:00:00")) /
        864e5,
    ),
  );
  for (let n = s; n >= 1; n--) {
    const o = dkey(addDays(-n));
    const i = /* @__PURE__ */ new Date(o + "T12:00:00").getDay();
    const l = n <= 75 ? 1 : Math.max(0.22, 1 - (n - 75) / 520);
    const c = Math.round(
      (i === 0 ? 3 : Math.round((20 + ((n * 37) % 13)) * (i === 6 ? 1.3 : i === 5 ? 1.15 : 1))) * l,
    );
    const d = 12e3 + ((n * 53) % 9) * 600;
    const p = (a[o] = {
      n: c,
      gross: c * d,
      fee: Math.round(c * d * 0.1),
      dep: Math.round(c * d * 0.5),
      ns: Math.round(c * 0.04),
      cx: Math.round(c * 0.06),
    });
    const w = o.slice(0, 7);
    const y = (t[w] ||= {
      n: 0,
      dep: 0,
      fee: 0,
    });
    y.n += p.n;
    y.dep += p.dep;
    y.fee += p.fee;
  }
  admHist.c = a;
  admHist.m = t;
  admHist.d = e;
  return a;
}
function admMonthDemo(e) {
  admHist();
  const a = admHist.m[e] || {
    n: 0,
    dep: 0,
    fee: 0,
  };
  const t = store.BOOK.filter(
    (o) =>
      o.src === "app" &&
      o.type !== "block" &&
      (o.paid || 0) > 0 &&
      o.date.slice(0, 7) === e &&
      (["confirmed", "done", "noshow"].includes(o.status) || (o.status === "cancelled" && !o.byProv)),
  );
  const s = a.dep + t.reduce((o, i) => o + (i.paid || 0) - feeOf(i), 0);
  const n = a.fee + t.reduce((o, i) => o + (i.fee || 0) + feeOf(i), 0);
  return {
    bookings: a.n + t.length,
    charged: s + n,
    deposits: s,
    commission: n,
    expenses: store.DEMO_AEXP.filter((o) => o.day.slice(0, 7) === e).reduce((o, i) => o + i.amount, 0),
  };
}
const nextM = (e) => {
  const a = /* @__PURE__ */ new Date(e + "-15T12:00:00");
  a.setMonth(a.getMonth() + 1);
  return dkey(a).slice(0, 7);
};
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
  const e = TODAY().slice(0, 7);
  for (let t = ADM_LAUNCH.slice(0, 7); t <= e; t = nextM(t)) {
    store.DEMO_AEXP.push({
      id: store.AEID++,
      day: t + "-05",
      concept: "Hosting, dominio y base de datos",
      amount: 45e3,
    });
    if (t < e || +TODAY().slice(8) >= 10) {
      store.DEMO_AEXP.push({
        id: store.AEID++,
        day: t + "-10",
        concept: "Publicidad en Instagram",
        amount: t < "2025-09" ? 8e4 : 15e4,
      });
    }
  }
  const a = (() => {
    const t = /* @__PURE__ */ new Date(e + "-15T12:00:00");
    t.setMonth(t.getMonth() - 1);
    return dkey(t).slice(0, 7);
  })();
  for (let t = ADM_LAUNCH.slice(0, 7); t < a; t = nextM(t)) {
    store.DEMO_ACL["month|" + t] = Object.assign(admMonthDemo(t), {
      closed_at: nextM(t) + "-03T10:00:00",
    });
  }
}
export function admFinDemo(e) {
  admDemo();
  const a = TODAY().slice(0, 7);
  const t = +a.slice(0, 4);
  const s = Array.from(
    {
      length: 12,
    },
    (o, i) => {
      const l = e + "-" + pad(i + 1);
      const c = store.DEMO_ACL["month|" + l];
      const d = c || (l > a ? Z5() : admMonthDemo(l));
      return Object.assign({}, d, {
        month: l,
        closed_at: c ? c.closed_at : null,
        state: c ? "closed" : l > a ? "future" : l === a ? "open" : "ended",
      });
    },
  );
  const n = store.DEMO_ACL["year|" + e];
  return {
    year: e,
    months: s,
    year_closed_at: n ? n.closed_at : null,
    can_close_year: e < t,
    expenses: store.DEMO_AEXP.filter((o) => o.day.slice(0, 4) === String(e)).sort(
      (o, i) => i.day.localeCompare(o.day) || i.id - o.id,
    ),
    years: Object.keys(store.DEMO_ACL)
      .filter((o) => o.startsWith("year|"))
      .sort()
      .map((o) =>
        Object.assign(
          {
            year: +o.slice(5),
          },
          store.DEMO_ACL[o],
        ),
      ),
  };
}
export function admCloseDemo(e, a, t) {
  const s = +t.slice(0, 4);
  const n = t.slice(0, 7);
  const o = TODAY() + "T" + nowHM() + ":00";
  if (a === "month") {
    if (e) {
      store.DEMO_ACL["month|" + n] = Object.assign(admMonthDemo(n), {
        closed_at: o,
      });
    } else {
      delete store.DEMO_ACL["month|" + n];
    }
    return;
  }
  if (!e) {
    delete store.DEMO_ACL["year|" + s];
    return;
  }
  const i = Z5();
  for (let l = 1; l <= 12; l++) {
    const c = s + "-" + pad(l);
    store.DEMO_ACL["month|" + c] ||= Object.assign(admMonthDemo(c), {
      closed_at: o,
    });
    const d = store.DEMO_ACL["month|" + c];
    for (const p in i) {
      i[p] += +d[p] || 0;
    }
  }
  store.DEMO_ACL["year|" + s] = Object.assign(i, {
    closed_at: o,
  });
}

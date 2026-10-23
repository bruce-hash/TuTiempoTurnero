import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { admDemo, admFinDemo, admHist } from "../../demo/admin.js";
import { TODAY, addDays, dkey, pad } from "../../lib/fechas.js";
import { activity } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { P, store } from "../../store.js";
import { render } from "../../ui/render.js";
import { rating } from "../../ui/resenas.js";
import { stampSvcs } from "../../ui/sellos.js";
import { comm } from "../prestador/comunidad.js";
import { feeOf } from "../prestador/finanzas.js";

export function admFin(e) {
  if (LIVE) {
    S.admFin = S.admFin || {};
    if (S.admFin[e]) {
      return S.admFin[e];
    } else {
      if (!S.admFinL) {
        S.admFinL = true;
        api
          .adminFinance(e)
          .then(() => {
            S.admFinL = false;
            render();
          })
          .catch(() => {
            S.admFinL = false;
            S.admFin[e] = {
              err: true,
              months: [],
              years: [],
              expenses: [],
            };
            render();
          });
      }
      return null;
    }
  } else {
    return admFinDemo(e);
  }
}
export function admData() {
  if (LIVE) {
    if (!S.adm && !S.admLoading) {
      S.admLoading = true;
      api
        .adminLoad()
        .then(() => {
          S.admLoading = false;
          render();
        })
        .catch(() => {
          S.admLoading = false;
          S.admErr = true;
          render();
        });
    }
    if (S.adm) {
      return {
        st: S.adm.stats,
        pv: S.adm.providers,
      };
    } else {
      return null;
    }
  }
  admDemo();
  const e = TODAY();
  const a = e.slice(0, 7);
  const t = +e.slice(8);
  const s = /* @__PURE__ */ new Date(e + "T12:00:00");
  s.setDate(1);
  s.setMonth(s.getMonth() - 1);
  const n = dkey(s).slice(0, 7);
  const o = new Date(s.getFullYear(), s.getMonth() + 1, 0).getDate();
  const i = new Date(+a.slice(0, 4), +a.slice(5, 7), 0).getDate();
  const l = (_) =>
    _.src === "app" && _.type !== "block" && ["confirmed", "done", "noshow"].includes(_.status);
  const c = admHist();
  const d = (_) => {
    const D = _ < e ? c[_] : null;
    const q = store.BOOK.filter((C) => l(C) && C.date === _);
    return {
      n: (D ? D.n : 0) + q.length,
      gross: (D ? D.gross : 0) + q.reduce((C, T) => C + (T.price || 0), 0),
      fee: (D ? D.fee : 0) + q.reduce((C, T) => C + (T.fee || 0) + feeOf(T), 0),
      dep: (D ? D.dep : 0) + q.reduce((C, T) => C + (T.paid || 0), 0),
      ns: (D ? D.ns : 0) + q.filter((C) => C.status === "noshow").length,
      cx:
        (D ? D.cx : 0) +
        store.BOOK.filter((C) => C.src === "app" && C.date === _ && C.status === "cancelled").length,
    };
  };
  const p = (_, D) => {
    const q = {
      n: 0,
      gross: 0,
      fee: 0,
      dep: 0,
      ns: 0,
      cx: 0,
    };
    for (let C = _; C <= D; C = dkey(addDays(1, C))) {
      const T = d(C);
      for (const A in q) {
        q[A] += T[A];
      }
    }
    return q;
  };
  const w = p(a + "-01", a + "-" + pad(i));
  const y = p(n + "-01", n + "-" + pad(Math.min(t, o)));
  const k = P.filter((_) => !_.deleted && (_.status || "active") === "active");
  const h = P.filter((_) => !_.deleted)
    .map((_) => ({
      id: _.id,
      name: _.name,
      status: _.status || "active",
      verified: _.verified !== false,
      cats: _.cats,
      month: store.BOOK.filter((D) => l(D) && D.pid == _.id && D.date.slice(0, 7) === a).length,
      activity: activity(_),
      mp: ![15, 26].includes(_.id),
      rating: rating(comm(_.id)),
      nrev: comm(_.id).reviews.length,
      photo: _.photo,
      hue: _.hue,
      notes: store.DEMO_NOTES[_.id] || [],
    }))
    .concat(
      store.DEMO_PENDING.map((_) =>
        Object.assign(
          {
            month: 0,
            activity: 0,
            mp: false,
            rating: 0,
            nrev: 0,
            notes: store.DEMO_NOTES[_.id] || [],
          },
          _,
        ),
      ),
    );
  const j = {};
  const b = {};
  const g = k.reduce((_, D) => _ + activity(D), 0) || 1;
  k.forEach((_) => _.cats.forEach((D) => (j[D] = (j[D] || 0) + 1)));
  k.forEach((_) => {
    const D = _.cats[0];
    b[D] = (b[D] || 0) + activity(_);
  });
  Object.keys(b).forEach((_) => (b[_] = Math.round((w.n * b[_]) / g)));
  return {
    st: {
      commission_pct: Math.round(store.COMISION * 1e4) / 100,
      providers_active: k.length,
      providers_pending: store.DEMO_PENDING.length,
      providers_suspended: h.filter((_) => _.status === "suspended").length,
      new_providers_month: store.DEMO_PENDING.length + P.filter((_) => !_.deleted && _.id >= 100).length,
      clients: 1180 + Object.keys(store.DEMO_USERS).length,
      new_clients_month: 64 + Math.max(0, Object.keys(store.DEMO_USERS).length - 1),
      bookings_month: w.n,
      bookings_prev: y.n,
      gross_month: w.gross,
      gross_prev: y.gross,
      deposits_month: w.dep,
      commission_month: w.fee,
      commission_prev: y.fee,
      no_show_month: w.ns,
      cancelled_month: w.cx,
      mp_missing: h.filter((_) => _.status === "active" && !_.mp).length,
      stamp_cards: k.filter((_) => stampSvcs(_).length).length,
      by_category: j,
      by_category_month: b,
      by_day: Array.from(
        {
          length: 30,
        },
        (_, D) => {
          const q = dkey(addDays(D - 29));
          const C = d(q);
          return {
            day: q,
            n: C.n,
            gross: C.gross,
            fee: C.fee,
          };
        },
      ),
      top: k
        .slice()
        .sort((_, D) => activity(D) - activity(_))
        .slice(0, 5)
        .map((_) => ({
          id: _.id,
          name: _.name,
          cats: _.cats,
          photo: _.photo,
          hue: _.hue,
          activity: activity(_),
        })),
      demo: true,
    },
    pv: h,
  };
}

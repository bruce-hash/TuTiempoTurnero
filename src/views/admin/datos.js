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

// finanzas de la plataforma de un año: en vivo se piden una vez y se guardan en S.admFin
export function admFin(year) {
  if (LIVE) {
    S.admFin = S.admFin || {};
    if (S.admFin[year]) {
      return S.admFin[year];
    } else {
      if (!S.admFinL) {
        S.admFinL = true;
        api
          .adminFinance(year)
          .then(() => {
            S.admFinL = false;
            render();
          })
          .catch(() => {
            S.admFinL = false;
            S.admFin[year] = {
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
    return admFinDemo(year);
  }
}
// datos del panel del admin: en vivo los trae admin_load; en la demo se arman con los turnos de la demo
// más un historial inventado (admHist) para que los totales del mes parezcan reales
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
        siteUrl: S.adm.siteUrl,
      };
    } else {
      return null;
    }
  }
  admDemo();
  const today = TODAY();
  const ym = today.slice(0, 7);
  const dayN = +today.slice(8);
  const prevDate = /* @__PURE__ */ new Date(today + "T12:00:00");
  prevDate.setDate(1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevYm = dkey(prevDate).slice(0, 7);
  const prevDays = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0).getDate();
  const monthDays = new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  // turnos que cuentan para la plataforma: reservados por la app y no cancelados
  const counts = (booking) =>
    booking.src === "app" && booking.type !== "block" && ["confirmed", "done", "noshow"].includes(booking.status);
  const hist = admHist();
  const dayStats = (day) => {
    const past = day < today ? hist[day] : null;
    const live = store.BOOK.filter((booking) => counts(booking) && booking.date === day);
    return {
      n: (past ? past.n : 0) + live.length,
      gross: (past ? past.gross : 0) + live.reduce((sum, booking) => sum + (booking.price || 0), 0),
      fee: (past ? past.fee : 0) + live.reduce((sum, booking) => sum + (booking.fee || 0) + feeOf(booking), 0),
      dep: (past ? past.dep : 0) + live.reduce((sum, booking) => sum + (booking.paid || 0), 0),
      ns: (past ? past.ns : 0) + live.filter((booking) => booking.status === "noshow").length,
      cx:
        (past ? past.cx : 0) +
        store.BOOK.filter((booking) => booking.src === "app" && booking.date === day && booking.status === "cancelled").length,
    };
  };
  // suma de dayStats entre dos fechas
  const rangeStats = (from, to) => {
    const acc = {
      n: 0,
      gross: 0,
      fee: 0,
      dep: 0,
      ns: 0,
      cx: 0,
    };
    for (let day = from; day <= to; day = dkey(addDays(1, day))) {
      const stats = dayStats(day);
      for (const key in acc) {
        acc[key] += stats[key];
      }
    }
    return acc;
  };
  const month = rangeStats(ym + "-01", ym + "-" + pad(monthDays));
  const prev = rangeStats(prevYm + "-01", prevYm + "-" + pad(Math.min(dayN, prevDays)));
  const active = P.filter((prov) => !prov.deleted && (prov.status || "active") === "active");
  const list = P.filter((prov) => !prov.deleted)
    .map((prov) => ({
      id: prov.id,
      name: prov.name,
      status: prov.status || "active",
      verified: prov.verified !== false,
      cats: prov.cats,
      month: store.BOOK.filter((booking) => counts(booking) && booking.pid == prov.id && booking.date.slice(0, 7) === ym).length,
      activity: activity(prov),
      mp: ![15, 26].includes(prov.id),
      rating: rating(comm(prov.id)),
      nrev: comm(prov.id).reviews.length,
      photo: prov.photo,
      hue: prov.hue,
      notes: store.DEMO_NOTES[prov.id] || [],
    }))
    .concat(
      store.DEMO_PENDING.map((prov) =>
        Object.assign(
          {
            month: 0,
            activity: 0,
            mp: false,
            rating: 0,
            nrev: 0,
            notes: store.DEMO_NOTES[prov.id] || [],
          },
          prov,
        ),
      ),
    );
  const byCat = {};
  const byCatMonth = {};
  const totalAct = active.reduce((sum, prov) => sum + activity(prov), 0) || 1;
  active.forEach((prov) => prov.cats.forEach((cat) => (byCat[cat] = (byCat[cat] || 0) + 1)));
  active.forEach((prov) => {
    const cat = prov.cats[0];
    byCatMonth[cat] = (byCatMonth[cat] || 0) + activity(prov);
  });
  Object.keys(byCatMonth).forEach((cat) => (byCatMonth[cat] = Math.round((month.n * byCatMonth[cat]) / totalAct)));
  return {
    st: {
      commission_pct: Math.round(store.COMISION * 1e4) / 100,
      providers_active: active.length,
      providers_pending: store.DEMO_PENDING.length,
      providers_suspended: list.filter((prov) => prov.status === "suspended").length,
      new_providers_month: store.DEMO_PENDING.length + P.filter((prov) => !prov.deleted && prov.id >= 100).length,
      clients: 1180 + Object.keys(store.DEMO_USERS).length,
      new_clients_month: 64 + Math.max(0, Object.keys(store.DEMO_USERS).length - 1),
      bookings_month: month.n,
      bookings_prev: prev.n,
      gross_month: month.gross,
      gross_prev: prev.gross,
      deposits_month: month.dep,
      commission_month: month.fee,
      commission_prev: prev.fee,
      no_show_month: month.ns,
      cancelled_month: month.cx,
      mp_missing: list.filter((prov) => prov.status === "active" && !prov.mp).length,
      stamp_cards: active.filter((prov) => stampSvcs(prov).length).length,
      by_category: byCat,
      by_category_month: byCatMonth,
      by_day: Array.from(
        {
          length: 30,
        },
        (slot, index) => {
          const day = dkey(addDays(index - 29));
          const stats = dayStats(day);
          return {
            day: day,
            n: stats.n,
            gross: stats.gross,
            fee: stats.fee,
          };
        },
      ),
      top: active
        .slice()
        .sort((one, other) => activity(other) - activity(one))
        .slice(0, 5)
        .map((prov) => ({
          id: prov.id,
          name: prov.name,
          cats: prov.cats,
          photo: prov.photo,
          hue: prov.hue,
          activity: activity(prov),
        })),
      demo: true,
    },
    pv: list,
  };
}

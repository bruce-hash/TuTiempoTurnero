import { liveApi } from "./index.js";
import { call } from "../saved.js";
import { sb } from "../../config.js";
import { TODAY, addDays, daysAgo, dkey, isoToLocal, localToIso, minsBetween } from "../../lib/fechas.js";
import { p0cat, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { feeOf } from "../../views/prestador/finanzas.js";
import { MSG_DEF } from "../../views/prestador/mensajes.js";

export const livePanel = {
  async loadMine() {
    const e = S.me;
    await liveApi.loadProvider(e, true);
    const a = dkey(addDays(-60));
    const t = dkey(addDays(120));
    const [s, n, o, i, l, c, d, p, w, y, k] = await Promise.all([
      call(
        sb
          .from("bookings")
          .select(
            "id,service_id,client_id,client_name,client_phone,service_name,source,status,starts_at,ends_at,price,discount_pct,paid_mp,paid_wallet,app_fee,client_fee,series_id,addons,buffer_min,pay_method",
          )
          .eq("provider_id", e)
          .gte("starts_at", localToIso(a, "00:00"))
          .lt("starts_at", localToIso(t, "23:59"))
          .in("status", ["confirmed", "done", "no_show", "hold"])
          .order("starts_at")
          .limit(5e3),
      ),
      call(sb.from("provider_clients").select("*").eq("provider_id", e).limit(5e3)),
      call(sb.from("products").select("*").eq("provider_id", e).order("name")),
      call(
        sb
          .from("expenses")
          .select("*")
          .eq("provider_id", e)
          .gte("spent_on", dkey(addDays(-400)))
          .order("spent_on"),
      ),
      call(
        sb
          .from("walkins")
          .select("*")
          .eq("provider_id", e)
          .gte("at", localToIso(TODAY(), "00:00"))
          .order("at"),
      ),
      call(sb.from("message_templates").select("*").eq("provider_id", e)),
      call(
        sb.rpc("provider_finance", {
          p_from: dkey(addDays(-29)),
          p_to: dkey(addDays(-1)),
        }),
      ),
      call(
        sb.from("provider_private").select("mp_connected,monthly_goal").eq("provider_id", e).maybeSingle(),
      ),
      call(
        sb.rpc("provider_occupancy", {
          p_from: dkey(addDays(-400)),
          p_to: TODAY(),
        }),
      ),
      call(sb.from("loyalty_cards").select("user_id,service_id,stamps").eq("provider_id", e).limit(5e3)),
      call(
        sb
          .from("cash_closings")
          .select("kind,period,income,expenses,cash,mp,counted,closed_at")
          .eq("provider_id", e)
          .gte("period", dkey(addDays(-800))),
      ),
    ]);
    const h = {
      confirmed: "confirmed",
      done: "done",
      no_show: "noshow",
      hold: "confirmed",
    };
    store.BOOK = store.BOOK.filter((b) => b.pid != e || b.mine).concat(
      (s || []).map((b) =>
        Object.assign(
          {
            id: b.id,
            pid: e,
            dur: minsBetween(b.starts_at, b.ends_at),
            svc: b.service_name || "",
            price: b.price,
            paid: b.paid_mp + b.paid_wallet,
            feeIn: Math.max(0, (b.app_fee || 0) - (b.client_fee || 0)),
            fee: b.client_fee || 0,
            wUsed: b.paid_wallet,
            disc: b.discount_pct,
            cliente: b.client_name || "",
            tel: b.client_phone || "",
            src: b.source === "app" ? "app" : "manual",
            type: b.source === "block" ? "block" : "local",
            status: h[b.status],
            pay: b.pay_method || "mp",
            series: b.series_id,
            hold: b.status === "hold",
            buf: b.buffer_min || 0,
            addons: (b.addons || []).map((g) => [g.name, g.price, g.min]),
            intake: b.intake || {},
            cat: ((pr(e).svcs || []).find((g) => g[4] === b.service_id) || [])[3],
          },
          isoToLocal(b.starts_at),
        ),
      ),
    );
    store.CLIENTS = {};
    (n || []).forEach((b) => {
      store.CLIENTS[b.name] = {
        id: b.id,
        v: b.visits,
        n: b.no_shows,
        last: daysAgo(b.last_visit),
        spend: b.visits ? Math.round(b.total_spent / b.visits) : 0,
        tel: b.phone || "",
        notes: b.notes || "",
        bday: b.birthday || "",
        contacted: !!b.contacted_at,
        user: b.user_id,
        profile: b.profile || {},
        stamps: Object.fromEntries(
          (y || []).filter((g) => b.user_id && g.user_id === b.user_id).map((g) => [g.service_id, g.stamps]),
        ),
      };
    });
    store.PRODS = (o || []).map((b) => ({
      id: b.id,
      n: b.name,
      p: b.price,
      stock: b.stock,
      min: b.min_stock,
    }));
    store.GASTOS = (i || []).map((b) => ({
      id: b.id,
      c: b.concept,
      m: b.amount,
      cat: b.category,
      d: b.spent_on,
    }));
    store.CLOSINGS = {};
    (k || []).forEach((b) => {
      store.CLOSINGS[b.kind + "|" + (b.kind === "month" ? String(b.period).slice(0, 7) : b.period)] = {
        income: b.income,
        expenses: b.expenses,
        cash: b.cash,
        mp: b.mp,
        counted: b.counted,
        at: isoToLocal(b.closed_at).time,
      };
    });
    S.walk = (l || []).map((b) => ({
      id: b.id,
      svc: b.description,
      precio: b.amount,
      propina: b.tip,
      hora: isoToLocal(b.at).time,
      medio: b.method === "mp" ? "Mercado Pago" : "Efectivo",
      cliente: b.client_name || "",
      kind: b.kind === "product" ? "prod" : "svc",
    }));
    store.MSGS = MSG_DEF(p0cat(e)).map((b) => {
      const g = (c || []).find((M) => M.key === b.k);
      if (g) {
        return Object.assign(b, {
          on: g.enabled,
          txt: g.body,
        });
      } else {
        return b;
      }
    });
    store.FIN = (d || []).map((b) => ({
      date: b.day,
      app: b.app,
      man: b.man,
      walk: b.walk,
      prod: b.prod,
    }));
    store.OCCD = {};
    (w || []).forEach((b) => {
      store.OCCD[b.day + "|" + b.hour] = b.busy_min;
    });
    store.MTOT = {};
    S.mp = p && p.mp_connected ? "ok" : "none";
    const j = pr(e);
    store.COMM = store.COMMBY[e];
    S.goal = (p && p.monthly_goal) || S.goal;
    S.jobsToday = store.BOOK.filter((b) => b.pid == e && b.date === TODAY() && b.status === "done").length;
    S.earnToday = store.BOOK.filter((b) => b.pid == e && b.date === TODAY() && b.status === "done").reduce(
      (b, g) => b + (g.price - (g.src === "app" ? feeOf(g) : 0)),
      0,
    );
  },
  async monthTotals(e) {
    const a = await call(
      sb.rpc("provider_month_totals", {
        p_year: e,
      }),
    );
    store.MTOT[e] = (a || []).map((t) => ({
      ing: t.income,
      gas: t.expenses,
    }));
    return store.MTOT[e];
  },
  m: {},
};

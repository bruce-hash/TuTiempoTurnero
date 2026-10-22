import { liveApi } from "./index.js";
import { call } from "../saved.js";
import { sb } from "../../config.js";
import { safeRedirect } from "../../lib/dom.js";
import { isoToLocal, localToIso, relDate } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { selAdds } from "../../lib/servicios.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { avatarUrl } from "../../ui/fotos.js";

export const liveAdmin = {
  async adminCheck() {
    const e = await call(sb.rpc("is_admin")).catch(() => false);
    S.isAdmin = !!e;
    return S.isAdmin;
  },
  async adminLoad() {
    const [e, a] = await Promise.all([
      call(sb.rpc("admin_stats")),
      call(
        sb.rpc("admin_providers", {
          p_status: null,
        }),
      ),
    ]);
    S.adm = {
      stats: e,
      providers: (a || []).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        verified: t.dni_verified,
        owner: t.owner_id,
        cats: t.categories || [],
        month: t.bookings_month,
        activity: +t.activity || 0,
        mp: !!t.mp_connected,
        rating: +t.rating_avg,
        nrev: t.rating_count,
        created: t.created_at,
        notes: (t.notes || []).map((s) => {
          const n = isoToLocal(s.at);
          return {
            id: s.id,
            body: s.body,
            d: n.date,
            t: n.time,
          };
        }),
      })),
    };
    store.COMISION = isFinite(parseFloat(e.commission_pct)) ? parseFloat(e.commission_pct) / 100 : 0.1;
    return S.adm;
  },
  async adminFinance(e) {
    const a = await call(
      sb.rpc("admin_finance", {
        p_year: e,
      }),
    );
    S.admFin = S.admFin || {};
    S.admFin[e] = a;
    return a;
  },
  async myMessages() {
    if (!S.user) {
      return;
    }
    const e = await call(sb.rpc("my_messages")).catch(() => []);
    S.inbox = (e || []).map((a) => ({
      id: a.id,
      pid: a.provider_id,
      name: a.provider_name,
      photo: avatarUrl(a.photo_path),
      hue: a.hue,
      body: a.body,
      d: relDate(a.created_at),
      read: !!a.read,
      auto: a.kind && a.kind !== "msg",
    }));
  },
  async book({ pid: e, svcIdx: a, date: t, time: s, rep: n }) {
    const o = pr(e);
    const i = o.svcs[a];
    const l = selAdds(o)
      .map((p) => p[3])
      .filter(Boolean);
    const c = await call(
      sb.rpc("book_slot", {
        p_service: i[4],
        p_start: localToIso(t, s),
        p_repeat_weeks: n || 0,
        p_extra: n ? 3 : 0,
        p_pay: S.payM === "cash" ? "cash" : S.payM === "reward" ? "reward" : "mp",
        p_addons: l,
        p_intake: {},
      }),
    );
    if (c.status === "confirmed") {
      await Promise.all([liveApi.myBookings(), liveApi.loadProvider(e, true), liveApi.myStamps()]);
      return {
        id: c.booking_ids[0],
        skipped: c.skipped,
        count: c.booking_ids.length,
        cash: c.pay === "cash",
      };
    }
    const d = await sb.functions.invoke("mp-create-preference", {
      body: {
        booking_ids: c.booking_ids,
      },
    });
    if (d.error || !d.data || !d.data.init_point) {
      await sb.rpc("cancel_by_client", {
        p_booking: c.booking_ids[0],
      });
      throw new Error("No pudimos abrir Mercado Pago. Probá de nuevo.");
    }
    safeRedirect(d.data.init_point);
    return {
      redirect: true,
    };
  },
};

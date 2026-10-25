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
    const isAdmin = await call(sb.rpc("is_admin")).catch(() => false);
    S.isAdmin = !!isAdmin;
    return S.isAdmin;
  },
  async adminLoad() {
    const [stats, providers, settings] = await Promise.all([
      call(sb.rpc("admin_stats")),
      call(
        sb.rpc("admin_providers", {
          p_status: null,
        }),
      ),
      call(sb.from("app_settings").select("site_url").maybeSingle()).catch(() => null),
    ]);
    S.adm = {
      stats: stats,
      // H24: la dirección del sitio con la que la base arma los links de los avisos
      siteUrl: (settings && settings.site_url) || "",
      providers: (providers || []).map((prov) => ({
        id: prov.id,
        name: prov.name,
        status: prov.status,
        verified: prov.dni_verified,
        dni: prov.dni_number || "",
        dniPhotos: prov.dni_photos || {},
        verifiedAt: prov.dni_verified_at,
        verifiedBy: prov.dni_verified_by || "",
        owner: prov.owner_id,
        cats: prov.categories || [],
        month: prov.bookings_month,
        activity: +prov.activity || 0,
        mp: !!prov.mp_connected,
        rating: +prov.rating_avg,
        nrev: prov.rating_count,
        created: prov.created_at,
        notes: (prov.notes || []).map((note) => {
          const at = isoToLocal(note.at);
          return {
            id: note.id,
            body: note.body,
            d: at.date,
            t: at.time,
          };
        }),
      })),
    };
    store.COMISION = isFinite(parseFloat(stats.commission_pct)) ? parseFloat(stats.commission_pct) / 100 : 0.1;
    return S.adm;
  },
  // "Para revisar · cobros" (Bloque 1): devoluciones que fallan o se reintentan y pagos en revisión
  async adminReview() {
    S.admRev = (await call(sb.rpc("admin_review"))) || { refunds: [], payments: [] };
    return S.admRev;
  },
  async adminFinance(year) {
    const data = await call(
      sb.rpc("admin_finance", {
        p_year: year,
      }),
    );
    S.admFin = S.admFin || {};
    S.admFin[year] = data;
    return data;
  },
  async myMessages() {
    if (!S.user) {
      return;
    }
    const rows = await call(sb.rpc("my_messages")).catch(() => []);
    S.inbox = (rows || []).map((msg) => ({
      id: msg.id,
      pid: msg.provider_id,
      name: msg.provider_name,
      photo: avatarUrl(msg.photo_path),
      hue: msg.hue,
      body: msg.body,
      d: relDate(msg.created_at),
      read: !!msg.read,
      auto: msg.kind && msg.kind !== "msg",
    }));
  },
  // Reserva: book_slot crea el turno (y los repetidos) en espera de pago con los montos que calcula la base. Si no hay
  // nada que pagar queda confirmado; si no, se crea el cobro en Mercado Pago y se va a pagar. Si Mercado Pago falla,
  // se libera la reserva.
  async book({ pid: pid, svcIdx: svcIdx, date: date, time: time, rep: rep }) {
    const prov = pr(pid);
    const svc = prov.svcs[svcIdx];
    const addonIds = selAdds(prov)
      .map((addon) => addon[3])
      .filter(Boolean);
    const res = await call(
      sb.rpc("book_slot", {
        p_service: svc[4],
        p_start: localToIso(date, time),
        p_repeat_weeks: rep || 0,
        // rep = cada cuántas semanas: siempre 3 turnos más además del primero
        p_extra: rep ? 3 : 0,
        p_pay: S.payM === "cash" ? "cash" : S.payM === "reward" ? "reward" : "mp",
        p_addons: addonIds,
        p_intake: {},
      }),
    );
    if (res.status === "confirmed") {
      await Promise.all([liveApi.myBookings(), liveApi.loadProvider(pid, true), liveApi.myStamps()]);
      return {
        id: res.booking_ids[0],
        skipped: res.skipped,
        count: res.booking_ids.length,
        cash: res.pay === "cash",
      };
    }
    const pref = await sb.functions.invoke("mp-create-preference", {
      body: {
        booking_ids: res.booking_ids,
      },
    });
    if (pref.error || !pref.data || !pref.data.init_point) {
      await sb.rpc("cancel_by_client", {
        p_booking: res.booking_ids[0],
      });
      throw new Error("No pudimos abrir Mercado Pago. Probá de nuevo.");
    }
    safeRedirect(pref.data.init_point);
    return {
      redirect: true,
    };
  },
};

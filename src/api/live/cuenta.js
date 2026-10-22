import { liveApi } from "./index.js";
import { upsertP } from "../mapeo.js";
import { call } from "../saved.js";
import { CITY, sb } from "../../config.js";
import { errMsg } from "../../lib/errores.js";
import { isoToLocal, minsBetween } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { uname } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { avatarUrl } from "../../ui/fotos.js";
import { toast } from "../../ui/toast.js";

export const liveCuenta = {
  async session() {
    const { data: e } = await sb.auth.getSession();
    const a = e && e.session;
    if (!a) {
      return null;
    }
    const t = a.user;
    const s = await call(
      sb.from("profiles").select("full_name,phone,avatar_path").eq("id", t.id).maybeSingle(),
    ).catch(() => null);
    S.user = {
      id: t.id,
      email: t.email,
      name: (s && s.full_name) || (t.user_metadata && t.user_metadata.full_name) || t.email.split("@")[0],
      photo: avatarUrl(s && s.avatar_path) || (t.user_metadata && t.user_metadata.avatar_url) || null,
    };
    S.form.tel = (s && s.phone) || "";
    let n = await call(sb.rpc("my_provider"));
    const o = t.user_metadata && t.user_metadata.provider_reg;
    if (!n && o) {
      try {
        n = await call(
          sb.rpc("register_provider", {
            p_name: o.name,
            p_address: o.address || "",
            p_categories: o.categories,
            p_phone: o.phone || "",
            p_dni: o.dni,
            p_instagram: o.instagram || null,
            p_city: CITY,
          }),
        );
        await sb.auth.updateUser({
          data: {
            provider_reg: null,
          },
        });
      } catch (i) {
        toast(errMsg(i));
      }
    }
    if (n) {
      S.me = n;
      S.barberAuth = true;
      await liveApi.loadMine();
    }
    await Promise.all([liveApi.myBookings(), liveApi.myMessages(), liveApi.myStamps(), liveApi.adminCheck()]);
    return S.user;
  },
  async myBookings() {
    if (!S.user) {
      return;
    }
    const e = await call(sb.rpc("my_bookings"));
    const a = {
      confirmed: "confirmed",
      done: "done",
      no_show: "noshow",
      cancelled_client: "cancelled",
      cancelled_provider: "cancelled",
      hold: "hold",
      expired: "expired",
    };
    store.BOOK = store.BOOK.filter((t) => !t.mine).concat(
      (e || []).map((t) => {
        const s =
          pr(t.provider_id) ||
          upsertP({
            id: t.provider_id,
            name: t.provider_name,
            addr: t.address || "",
            hue: t.hue,
            cats: [t.category || "n"],
            svcs: [],
          });
        if (t.photo_path && !s.photo) {
          s.photo = avatarUrl(t.photo_path);
        }
        return Object.assign(
          {
            id: t.id,
            pid: t.provider_id,
            dur: minsBetween(t.starts_at, t.ends_at),
            svc: t.service_name,
            price: t.price,
            paid: t.paid_mp + t.paid_wallet,
            fee: +t.client_fee || 0,
            disc: t.discount_pct,
            status: a[t.status] || t.status,
            byProv: t.status === "cancelled_provider",
            self: !!t.settle_by_provider,
            mine: true,
            pay: t.pay_method || "mp",
            series: t.series_id,
            cat: t.category,
            type: "local",
            src: "app",
            cliente: uname(),
            addons: (t.addons || []).map((n) => [n.name, n.price, n.min]),
            intake: t.intake || {},
            every: t.repeat_days || 0,
            note: t.prep_note || "",
            reviewed: !!t.reviewed,
            stamped: !!t.stamped,
          },
          isoToLocal(t.starts_at),
        );
      }),
    );
  },
  async wallet() {
    S.wallet = 0;
    S.wmov = [];
  },
  async myStamps() {
    if (!S.user) {
      return;
    }
    const e = await call(sb.rpc("my_stamps")).catch(() => []);
    S.myStampsBy = S.myStampsBy || {};
    S.cards = (e || []).map((a) => {
      (S.myStampsBy[a.provider_id] ||= {})[a.service_id] = a.stamps;
      return {
        pid: a.provider_id,
        sid: a.service_id,
        svc: a.service_name,
        name: a.provider_name,
        photo: avatarUrl(a.photo_path),
        hue: a.hue,
        cat: a.category || "n",
        n: a.stamps,
        goal: a.stamp_goal || 0,
        on: a.stamps_on,
        done: a.done,
      };
    });
  },
  async commission() {
    const e = await call(sb.rpc("commission")).catch(() => null);
    if (e != null && isFinite(+e)) {
      store.COMISION = +e;
    }
  },
};

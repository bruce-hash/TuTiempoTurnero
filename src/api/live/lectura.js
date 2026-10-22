import { cfgFromDb, svcsFromDb, upsertP } from "../mapeo.js";
import { call } from "../saved.js";
import { CITY, PAGE, sb } from "../../config.js";
import { TODAY, addDays, dkey, isoToLocal, minsBetween, relDate } from "../../lib/fechas.js";
import { FOLLOW, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { avatarUrl, mediaUrl } from "../../ui/fotos.js";

export const liveLectura = {
  live: true,
  async counts() {
    const e = await call(
      sb.rpc("category_counts", {
        p_city: CITY,
      }),
    );
    const a = {
      todos: 0,
    };
    (e || []).forEach((t) => {
      a[t.category_id] = Number(t.providers);
    });
    return a;
  },
  async listProviders({ cat: e, q: a, after: t }) {
    const s = await call(
      sb.rpc("list_providers", {
        p_city: CITY,
        p_category: e === "todos" ? null : e,
        p_q: a || null,
        p_after_key: t ? t[0] : null,
        p_after_id: t ? t[1] : null,
        p_limit: PAGE,
      }),
    );
    const n = (s || []).map((i) => {
      const l = upsertP({
        id: i.id,
        slug: i.slug,
        name: i.name,
        addr: i.address || "",
        hue: i.hue,
        photo: avatarUrl(i.photo_path),
        cats: i.categories || ["n"],
        rating: Number(i.rating_avg),
        nrev: i.rating_count,
        activity: +i.activity || 0,
      });
      l.svcs ||= [];
      l.card = Object.assign(l.card || {}, {
        [e]: {
          min: i.min_price,
          minName: i.min_service,
          happy: i.happy_pct,
          next: i.next_free ? isoToLocal(i.next_free) : null,
        },
      });
      return l;
    });
    const o = s && s[s.length - 1];
    return {
      items: n,
      next: s && s.length === PAGE && o ? [o.sort_key, o.id] : null,
    };
  },
  async loadProvider(e, a) {
    const t = pr(e);
    if (t && t.full && !a && Date.now() - t.full < 6e4) {
      return t;
    }
    const s = await call(
      sb.rpc("get_provider", {
        pid: +e,
      }),
    );
    if (!s) {
      upsertP({
        id: +e,
        deleted: true,
        cats: ["n"],
        svcs: [],
        name: "",
        addr: "",
      });
      return null;
    }
    const n = upsertP({
      id: s.id,
      slug: s.slug,
      name: s.name,
      bio: s.bio || "",
      addr: s.address || "",
      ig: s.instagram || "",
      hue: s.hue,
      photo: avatarUrl(s.photo_path),
      cats: s.categories.length ? s.categories : ["n"],
      svcs: svcsFromDb(s.services),
      rating: Number(s.rating_avg),
      nrev: s.rating_count,
      verified: !!s.dni_verified,
      full: Date.now(),
      deleted: false,
    });
    store.CFGS[n.id] = cfgFromDb(s.settings, s.hours);
    (s.services || []).forEach((l) => {
      if (l.stamp_goal) {
        store.CFGS[n.id].stamps.goals[l.id] = l.stamp_goal;
      }
    });
    store.COMMBY[n.id] = {
      followers: s.followers,
      reviews: (s.reviews || []).map((l) => ({
        id: l.id,
        n: l.author,
        s: l.stars,
        t: l.body || "",
        d: relDate(l.created_at),
        reply: l.reply || "",
      })),
      media: (s.media || []).map((l) => ({
        id: l.id,
        label: l.label || "",
        url: mediaUrl(l.storage_path),
        video: l.kind === "video",
        hue: n.hue,
      })),
    };
    FOLLOW[n.id] = !!s.following;
    S.myStampsBy = S.myStampsBy || {};
    S.myStampsBy[n.id] = s.my_stamps && typeof s.my_stamps == "object" ? s.my_stamps : {};
    const o = store.CFGS[n.id];
    const i = await call(
      sb.rpc("provider_busy", {
        pid: n.id,
        p_from: TODAY(),
        p_to: dkey(addDays(Math.min(91, o.ahead + 84))),
      }),
    );
    store.BOOK = store.BOOK.filter((l) => l.pid != n.id || !l.busy).concat(
      (i || []).map((l, c) =>
        Object.assign(
          {
            id: "busy" + n.id + "_" + c,
            pid: n.id,
            dur: minsBetween(l.starts_at, l.ends_at),
            status: "confirmed",
            type: "busy",
            busy: true,
            cliente: "",
            dayBlock: !!l.day_block,
          },
          isoToLocal(l.starts_at),
        ),
      ),
    );
    return n;
  },
};

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
    const rows = await call(
      sb.rpc("category_counts", {
        p_city: CITY,
      }),
    );
    const counts = {
      todos: 0,
    };
    (rows || []).forEach((row) => {
      counts[row.category_id] = Number(row.providers);
    });
    return counts;
  },
  // Una página del listado (por cursor: after = [sort_key, id] del último). Guarda cada prestador en P y, por rubro, el
  // precio mínimo, el happy hour y el próximo horario libre para su tarjeta.
  async listProviders({ cat: cat, q: query, after: after }) {
    const rows = await call(
      sb.rpc("list_providers", {
        p_city: CITY,
        p_category: cat === "todos" ? null : cat,
        p_q: query || null,
        p_after_key: after ? after[0] : null,
        p_after_id: after ? after[1] : null,
        p_limit: PAGE,
      }),
    );
    const items = (rows || []).map((row) => {
      const prov = upsertP({
        id: row.id,
        slug: row.slug,
        name: row.name,
        addr: row.address || "",
        hue: row.hue,
        photo: avatarUrl(row.photo_path),
        cats: row.categories || ["n"],
        rating: Number(row.rating_avg),
        nrev: row.rating_count,
        activity: +row.activity || 0,
      });
      prov.svcs ||= [];
      prov.card = Object.assign(prov.card || {}, {
        [cat]: {
          min: row.min_price,
          minName: row.min_service,
          happy: row.happy_pct,
          next: row.next_free ? isoToLocal(row.next_free) : null,
        },
      });
      return prov;
    });
    const last = rows && rows[rows.length - 1];
    return {
      items: items,
      next: rows && rows.length === PAGE && last ? [last.sort_key, last.id] : null,
    };
  },
  // Ficha completa del prestador (se reusa si se cargó hace menos de un minuto, salvo force): servicios, agenda,
  // reseñas, trabajos y los horarios ocupados de los próximos días (sin datos de clientes) para pintar el turnero.
  async loadProvider(pid, force) {
    const cached = pr(pid);
    if (cached && cached.full && !force && Date.now() - cached.full < 6e4) {
      return cached;
    }
    const data = await call(
      sb.rpc("get_provider", {
        pid: +pid,
      }),
    );
    if (!data) {
      upsertP({
        id: +pid,
        deleted: true,
        cats: ["n"],
        svcs: [],
        name: "",
        addr: "",
      });
      return null;
    }
    const prov = upsertP({
      id: data.id,
      slug: data.slug,
      name: data.name,
      bio: data.bio || "",
      addr: data.address || "",
      ig: data.instagram || "",
      hue: data.hue,
      photo: avatarUrl(data.photo_path),
      cats: data.categories.length ? data.categories : ["n"],
      svcs: svcsFromDb(data.services),
      rating: Number(data.rating_avg),
      nrev: data.rating_count,
      verified: !!data.dni_verified,
      full: Date.now(),
      deleted: false,
    });
    store.CFGS[prov.id] = cfgFromDb(data.settings, data.hours);
    (data.services || []).forEach((svc) => {
      if (svc.stamp_goal) {
        store.CFGS[prov.id].stamps.goals[svc.id] = svc.stamp_goal;
      }
    });
    store.COMMBY[prov.id] = {
      followers: data.followers,
      reviews: (data.reviews || []).map((review) => ({
        id: review.id,
        n: review.author,
        s: review.stars,
        t: review.body || "",
        d: relDate(review.created_at),
        reply: review.reply || "",
      })),
      media: (data.media || []).map((item) => ({
        id: item.id,
        label: item.label || "",
        url: mediaUrl(item.storage_path),
        video: item.kind === "video",
        hue: prov.hue,
      })),
    };
    FOLLOW[prov.id] = !!data.following;
    S.myStampsBy = S.myStampsBy || {};
    S.myStampsBy[prov.id] = data.my_stamps && typeof data.my_stamps == "object" ? data.my_stamps : {};
    const conf = store.CFGS[prov.id];
    const busy = await call(
      sb.rpc("provider_busy", {
        pid: prov.id,
        p_from: TODAY(),
        p_to: dkey(addDays(Math.min(91, conf.ahead + 84))),
      }),
    );
    store.BOOK = store.BOOK.filter((booking) => booking.pid != prov.id || !booking.busy).concat(
      (busy || []).map((row, idx) =>
        Object.assign(
          {
            id: "busy" + prov.id + "_" + idx,
            pid: prov.id,
            dur: minsBetween(row.starts_at, row.ends_at),
            status: "confirmed",
            type: "busy",
            busy: true,
            cliente: "",
            dayBlock: !!row.day_block,
          },
          isoToLocal(row.starts_at),
        ),
      ),
    );
    return prov;
  },
};

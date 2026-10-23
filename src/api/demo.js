import { PAGE } from "../config.js";
import { activity, norm, rot } from "../lib/prestadores.js";
import { CATS, catInfo } from "../lib/rubros.js";
import { P } from "../store.js";

// Modo demo: el listado y los conteos salen de los datos de ejemplo en memoria; el resto no hace nada (api.m.* son
// funciones vacías y las pantallas cambian los datos directamente cuando no es LIVE).
export const demoApi = {
  live: false,
  async counts() {
    const isActive = (prov) => !prov.deleted && (prov.status || "active") === "active";
    const counts = {};
    CATS.forEach(([cat]) => (counts[cat] = P.filter((prov) => isActive(prov) && prov.cats.includes(cat)).length));
    counts.todos = P.filter(isActive).length;
    return counts;
  },
  async listProviders({ cat: cat, q: query, after: offset }) {
    const needle = norm(query || "");
    let list = P.filter(
      (prov) => !prov.deleted && (prov.status || "active") === "active" && (cat === "todos" || prov.cats.includes(cat)),
    );
    if (needle) {
      list = list.filter((prov) =>
        norm(
          prov.name +
            " " +
            prov.addr +
            " " +
            prov.svcs.map((svc) => svc[0]).join(" ") +
            " " +
            prov.cats.map((id) => catInfo(id).name).join(" "),
        ).includes(needle),
      );
    }
    list = list.sort((left, right) => activity(right) - activity(left) || rot(left.id) - rot(right.id));
    const from = offset || 0;
    return {
      items: list.slice(from, from + PAGE),
      next: from + PAGE < list.length ? from + PAGE : null,
      total: list.length,
    };
  },
  async loadProvider() {},
  async myBookings() {},
  async wallet() {},
  async book() {
    return null;
  },
  async session() {
    return null;
  },
  async providerIdBySlug(slug) {
    const prov = P.find((item) => item.slug === slug);
    return prov ? prov.id : null;
  },
  m: new Proxy(
    {},
    {
      get: () => async () => {},
    },
  ),
};

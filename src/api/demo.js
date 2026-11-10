import { PAGE } from "../config.js";
import { activity, norm, rot } from "../lib/prestadores.js";
import { CATS, catInfo } from "../lib/rubros.js";
import { P, store } from "../store.js";
import { S } from "../state.js";
import { demoFollowers } from "../demo/seguidores.js";

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
  // D33: en la demo, el historial de cliente sale de sus turnos y de a quién sigue
  async clientHistory() {
    const bookings = store.BOOK.filter((booking) => booking.mine).length;
    const follows = Object.values(S.followingBy || {}).filter(Boolean).length;
    return { bookings, follows, reviews: 0, any: bookings + follows > 0 };
  },
  async myBookings() {},
  async book() {
    return null;
  },
  async session() {
    return null;
  },
  // Paso 1: en la demo no hay Mercado Pago (la reserva se confirma sin salir de la app)
  async checkoutStatus() {
    return null;
  },
  async checkoutPoke() {},
  async payHold() {},
  // Bloque C: en la demo no hay notificaciones push
  async pushRegistered() {
    return false;
  },
  // 4/11 · Bloque 3: seguidores de ejemplo (el número sigue siendo el de la demo)
  async followers() {
    store.FOLLOWERS = demoFollowers();
    return store.FOLLOWERS;
  },
  async myOffers() {},
  // 4/11 · Bloque 4: en la demo no hay ventas guardadas de otros días
  async walkinsOn(day) {
    store.WALKDAY[day] = store.WALKDAY[day] || [];
    return store.WALKDAY[day];
  },
  async refreshCommunity() {
    return false;
  },
  async providerIdBySlug(slug) {
    const prov = P.find((item) => item.slug === slug);
    return prov ? prov.id : null;
  },
  // 10/11 · punto 8: en la demo no hay registro de cambios de la caja
  async cashDay() {
    return null;
  },
  // en la demo Finanzas sale de lo que está en memoria
  async finance() {
    return store.FIN;
  },
  m: new Proxy(
    {},
    {
      get: () => async () => {},
    },
  ),
};

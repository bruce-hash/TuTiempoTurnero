import { PAGE } from "../config.js";
import { activity, norm, rot } from "../lib/prestadores.js";
import { CATS, catInfo } from "../lib/rubros.js";
import { P } from "../store.js";

export const demoApi = {
  live: false,
  async counts() {
    const e = (t) => !t.deleted && (t.status || "active") === "active";
    const a = {};
    CATS.forEach(([t]) => (a[t] = P.filter((s) => e(s) && s.cats.includes(t)).length));
    a.todos = P.filter(e).length;
    return a;
  },
  async listProviders({ cat: e, q: a, after: t }) {
    const s = norm(a || "");
    let n = P.filter(
      (i) => !i.deleted && (i.status || "active") === "active" && (e === "todos" || i.cats.includes(e)),
    );
    if (s) {
      n = n.filter((i) =>
        norm(
          i.name +
            " " +
            i.addr +
            " " +
            i.svcs.map((l) => l[0]).join(" ") +
            " " +
            i.cats.map((l) => catInfo(l).name).join(" "),
        ).includes(s),
      );
    }
    n = n.sort((i, l) => activity(l) - activity(i) || rot(i.id) - rot(l.id));
    const o = t || 0;
    return {
      items: n.slice(o, o + PAGE),
      next: o + PAGE < n.length ? o + PAGE : null,
      total: n.length,
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
  m: new Proxy(
    {},
    {
      get: () => async () => {},
    },
  ),
};

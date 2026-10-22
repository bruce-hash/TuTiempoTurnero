import { cfg, nextFree } from "../lib/turnero.js";
import { S } from "../state.js";

export function cardInfo(e, cat) {
  if (e.card && e.card[S.cat || "todos"]) {
    const l = e.card[S.cat || "todos"];
    return {
      min: l.min,
      minName: l.minName,
      happy: l.happy,
      next: l.next,
      multi: e.svcs.length > 1 || !!l.minName,
    };
  }
  const t = e.svcs.filter((l) => l[3] === cat);
  const s = t.length ? t : e.svcs;
  if (!s.length) {
    return {
      min: 0,
      minName: "",
      happy: 0,
      next: null,
    };
  }
  const n = s.reduce((l, c) => (c[2] < l[2] ? c : l), s[0]);
  const o = nextFree(e.id, n[1]);
  const i = cfg(e.id);
  return {
    min: n[2],
    minName: n[0],
    happy: i.on && i.happy.on ? i.happy.pct : 0,
    next: o,
    multi: s.length > 1,
  };
}

import { LIVE } from "../config.js";
import { esc } from "../lib/dom.js";
import { ME, avatar, pr } from "../lib/prestadores.js";
import { cfg, skey, uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { P, store } from "../store.js";

export const stampCfg = (e) => {
  const a = cfg(e);
  return (a.stamps ||= {
    on: false,
    goals: {},
  });
};
export function stampGoal(e, a) {
  const t = stampCfg(e);
  if (!t.on || !a) {
    return 0;
  }
  const s = +((t.goals || {})[skey(a)] || 0);
  if (s >= 15 && s <= 20) {
    return s;
  } else {
    return 0;
  }
}
export function stampEarns(e, a) {
  return stampGoal(e, a) > 0;
}
export const stampSvcs = (e) => (e && e.svcs ? e.svcs.filter((a) => stampEarns(e.id, a)) : []);
export const svcByKey = (e, a) => (e && e.svcs ? e.svcs.find((t) => String(skey(t)) === String(a)) : null);
export function myStamps(e, a) {
  if (!S.user || !a) {
    return 0;
  }
  const t = String(skey(a));
  if (LIVE) {
    return +(((S.myStampsBy || {})[e] || {})[t] || 0);
  } else {
    return +(((store.DEMO_STAMPS[e] || {})[uname()] || {})[t] || 0);
  }
}
export function setMyStamps(e, a, t) {
  const s = String(skey(a));
  if (LIVE) {
    const o = (S.myStampsBy ||= {});
    (o[e] ||= {})[s] = t;
    return;
  }
  const n = (store.DEMO_STAMPS[e] ||= {});
  (n[uname()] ||= {})[s] = t;
}
export function cliStamps(e, a, t = ME()) {
  if (!a) {
    return 0;
  }
  const s = String(skey(a));
  if (LIVE) {
    return +(((store.CLIENTS[e] && store.CLIENTS[e].stamps) || {})[s] || 0);
  }
  const n = (store.DEMO_STAMPS[t] ||= {});
  const o = (n[e] ||= {});
  if (o[s] === void 0) {
    const i = stampGoal(t, a) || 15;
    o[s] = a === stampSvcs(pr(t))[0] && store.CLIENTS[e] ? Math.min(i - 1, store.CLIENTS[e].v || 0) : 0;
  }
  return o[s];
}
export function setCliStamps(e, a, t, s = ME()) {
  const n = String(skey(a));
  if (LIVE) {
    if (store.CLIENTS[e]) {
      store.CLIENTS[e].stamps = store.CLIENTS[e].stamps || {};
      store.CLIENTS[e].stamps[n] = t;
    }
    return;
  }
  const o = (store.DEMO_STAMPS[s] ||= {});
  (o[e] ||= {})[n] = t;
}
export function cliBest(e, a = ME()) {
  let t = null;
  stampSvcs(pr(a)).forEach((s) => {
    const n = stampGoal(a, s);
    const o = Math.min(cliStamps(e, s, a), n);
    if (!t || o / n > t.n / t.g) {
      t = {
        sv: s,
        n: o,
        g: n,
      };
    }
  });
  return t;
}
export const stampGrid = (e, a, t = "") =>
  `<div class="stamps ${t}" role="img" aria-label="${e} de ${a} sellos">${Array.from(
    {
      length: a,
    },
    (s, n) => `<i class="${n < e ? "on" : ""}">${n < e ? "✓" : n === a - 1 ? "🎁" : ""}</i>`,
  ).join("")}</div>`;
export function stampBox(e) {
  const a = stampCfg(e.id);
  const t = stampSvcs(e);
  if (!a.on || !t.length) {
    return "";
  }
  const s = e.svcs[S.svc];
  if (!s) {
    return "";
  }
  const n = stampGoal(e.id, s);
  if (!n) {
    return `<div class="panel stampban off" id="stampBox"><div class="sb-h"><span class="sb-ic">🎟️</span><div><b>${esc(s[0])} no suma sellos</b><span class="hint">Tienen tarjeta de sellos: ${t.map((i) => esc(i[0])).join(", ")}.</span></div></div></div>`;
  }
  const o = myStamps(e.id, s);
  return `<div class="panel stampban" id="stampBox"><div class="sb-h"><span class="sb-ic">🎟️</span><div><b>Tu tarjeta de ${esc(s[0])}</b><span class="hint">Cada vez que te lo hacés suma 1 sello. Con ${n} sellos, el próximo es gratis.</span></div>${S.user ? `<b class="sb-n">${Math.min(o, n)}/${n}</b>` : ""}</div>
   ${S.user ? `${stampGrid(Math.min(o, n), n, "sm")}<p class="note" style="text-align:left;margin:6px 0 0">${o >= n ? "🎁 ¡Tarjeta llena! Elegí horario y en el pago tocá “Usar mi premio”." : `Te faltan ${n - o} para un ${esc(s[0])} gratis.`}</p>` : '<p class="note" style="text-align:left;margin:6px 0 0">Ingresá para ver tus sellos.</p>'}</div>`;
}
export function myCards() {
  if (!S.user) {
    return [];
  }
  if (LIVE) {
    return (S.cards || []).filter((a) => a.on && a.goal);
  }
  const e = [];
  P.filter((a) => !a.deleted).forEach((a) =>
    stampSvcs(a).forEach((t) => {
      const s = myStamps(a.id, t);
      const n = store.BOOK.filter((o) => o.mine && o.pid == a.id && o.svc === t[0] && o.status === "done").length;
      if (s > 0 || n > 0) {
        e.push({
          pid: a.id,
          sid: skey(t),
          svc: t[0],
          name: a.name,
          photo: a.photo,
          hue: a.hue,
          cat: t[3] || a.cats[0],
          n: s,
          goal: stampGoal(a.id, t),
          on: true,
          done: n,
        });
      }
    }),
  );
  return e;
}
export function stampCard(e) {
  const a = e.n >= e.goal;
  return `<div class="panel stampcard seg-${e.cat || "n"}"><div class="sc-h">${avatar(e)}<div><b>${esc(e.svc)}</b><span class="hint">${esc(e.name)} · ${Math.min(e.n, e.goal)} de ${e.goal} sellos · ${e.done} hecho${e.done === 1 ? "" : "s"}</span></div></div>
   ${stampGrid(Math.min(e.n, e.goal), e.goal)}
   <p class="sc-r">${a ? `🎁 <b>¡Premio listo!</b> Tu próximo ${esc(e.svc)} es gratis.` : `Te faltan <b>${e.goal - e.n}</b> para un ${esc(e.svc)} gratis.`}</p>
   ${a ? `<button class="btn btn-pri btn-block" data-act="useReward" data-id="${e.pid}" data-sk="${esc(String(e.sid))}">Reservar mi premio</button>` : `<button class="btn btn-ghost btn-block btn-sm" data-go="perfil" data-id="${e.pid}">Ver perfil</button>`}</div>`;
}

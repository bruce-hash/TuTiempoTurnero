import { LIVE } from "../config.js";
import { esc } from "../lib/dom.js";
import { ME, avatar, pr } from "../lib/prestadores.js";
import { cfg, skey, uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { P, store } from "../store.js";

// Tarjeta de sellos: cada servicio puede dar un sello por visita; con la meta (15 a 20) el siguiente es gratis.
// En vivo los sellos vienen de la base; en la demo se guardan en store.DEMO_STAMPS[prestador][cliente][servicio].
export const stampCfg = (pid) => {
  const conf = cfg(pid);
  return (conf.stamps ||= {
    on: false,
    goals: {},
  });
};
export function stampGoal(pid, svc) {
  const conf = stampCfg(pid);
  if (!conf.on || !svc) {
    return 0;
  }
  const goal = +((conf.goals || {})[skey(svc)] || 0);
  if (goal >= 15 && goal <= 20) {
    return goal;
  } else {
    return 0;
  }
}
export function stampEarns(pid, svc) {
  return stampGoal(pid, svc) > 0;
}
export const stampSvcs = (prov) => (prov && prov.svcs ? prov.svcs.filter((svc) => stampEarns(prov.id, svc)) : []);
export const svcByKey = (prov, key) => (prov && prov.svcs ? prov.svcs.find((svc) => String(skey(svc)) === String(key)) : null);
export function myStamps(pid, svc) {
  if (!S.user || !svc) {
    return 0;
  }
  const key = String(skey(svc));
  if (LIVE) {
    return +(((S.myStampsBy || {})[pid] || {})[key] || 0);
  } else {
    return +(((store.DEMO_STAMPS[pid] || {})[uname()] || {})[key] || 0);
  }
}
export function setMyStamps(pid, svc, count) {
  const key = String(skey(svc));
  if (LIVE) {
    const byProv = (S.myStampsBy ||= {});
    (byProv[pid] ||= {})[key] = count;
    return;
  }
  const provStamps = (store.DEMO_STAMPS[pid] ||= {});
  (provStamps[uname()] ||= {})[key] = count;
}
// en la demo, la primera vez se siembran desde las visitas del cliente (sin llegar a la meta)
export function cliStamps(client, svc, pid = ME()) {
  if (!svc) {
    return 0;
  }
  const key = String(skey(svc));
  if (LIVE) {
    return +(((store.CLIENTS[client] && store.CLIENTS[client].stamps) || {})[key] || 0);
  }
  const provStamps = (store.DEMO_STAMPS[pid] ||= {});
  const clientStamps = (provStamps[client] ||= {});
  if (clientStamps[key] === void 0) {
    const goal = stampGoal(pid, svc) || 15;
    clientStamps[key] = svc === stampSvcs(pr(pid))[0] && store.CLIENTS[client] ? Math.min(goal - 1, store.CLIENTS[client].v || 0) : 0;
  }
  return clientStamps[key];
}
export function setCliStamps(client, svc, count, pid = ME()) {
  const key = String(skey(svc));
  if (LIVE) {
    if (store.CLIENTS[client]) {
      store.CLIENTS[client].stamps = store.CLIENTS[client].stamps || {};
      store.CLIENTS[client].stamps[key] = count;
    }
    return;
  }
  const provStamps = (store.DEMO_STAMPS[pid] ||= {});
  (provStamps[client] ||= {})[key] = count;
}
// la tarjeta del cliente más cerca del premio
export function cliBest(client, pid = ME()) {
  let best = null;
  stampSvcs(pr(pid)).forEach((svc) => {
    const goal = stampGoal(pid, svc);
    const have = Math.min(cliStamps(client, svc, pid), goal);
    if (!best || have / goal > best.n / best.g) {
      best = {
        sv: svc,
        n: have,
        g: goal,
      };
    }
  });
  return best;
}
export const stampGrid = (have, goal, cls = "") =>
  `<div class="stamps ${cls}" role="img" aria-label="${have} de ${goal} sellos">${Array.from(
    {
      length: goal,
    },
    (cell, index) => `<i class="${index < have ? "on" : ""}">${index < have ? "✓" : index === goal - 1 ? "🎁" : ""}</i>`,
  ).join("")}</div>`;
export function stampBox(prov) {
  const conf = stampCfg(prov.id);
  const svcs = stampSvcs(prov);
  if (!conf.on || !svcs.length) {
    return "";
  }
  const svc = prov.svcs[S.svc];
  if (!svc) {
    return "";
  }
  const goal = stampGoal(prov.id, svc);
  if (!goal) {
    return `<div class="panel stampban off" id="stampBox"><div class="sb-h"><span class="sb-ic">🎟️</span><div><b>${esc(svc[0])} no suma sellos</b><span class="hint">Tienen tarjeta de sellos: ${svcs.map((other) => esc(other[0])).join(", ")}.</span></div></div></div>`;
  }
  const have = myStamps(prov.id, svc);
  return `<div class="panel stampban" id="stampBox"><div class="sb-h"><span class="sb-ic">🎟️</span><div><b>Tu tarjeta de ${esc(svc[0])}</b><span class="hint">Cada vez que te lo hacés suma 1 sello. Con ${goal} sellos, el próximo es gratis.</span></div>${S.user ? `<b class="sb-n">${Math.min(have, goal)}/${goal}</b>` : ""}</div>
   ${S.user ? `${stampGrid(Math.min(have, goal), goal, "sm")}<p class="note" style="text-align:left;margin:6px 0 0">${have >= goal ? "🎁 ¡Tarjeta llena! Elegí horario y en el pago tocá “Usar mi premio”." : `Te faltan ${goal - have} para un ${esc(svc[0])} gratis.`}</p>` : '<p class="note" style="text-align:left;margin:6px 0 0">Ingresá para ver tus sellos.</p>'}</div>`;
}
export function myCards() {
  if (!S.user) {
    return [];
  }
  if (LIVE) {
    return (S.cards || []).filter((card) => card.on && card.goal);
  }
  const cards = [];
  P.filter((prov) => !prov.deleted).forEach((prov) =>
    stampSvcs(prov).forEach((svc) => {
      const have = myStamps(prov.id, svc);
      const done = store.BOOK.filter((booking) => booking.mine && booking.pid == prov.id && booking.svc === svc[0] && booking.status === "done").length;
      if (have > 0 || done > 0) {
        cards.push({
          pid: prov.id,
          sid: skey(svc),
          svc: svc[0],
          name: prov.name,
          photo: prov.photo,
          hue: prov.hue,
          cat: svc[3] || prov.cats[0],
          n: have,
          goal: stampGoal(prov.id, svc),
          on: true,
          done: done,
        });
      }
    }),
  );
  return cards;
}
export function stampCard(card) {
  const full = card.n >= card.goal;
  return `<div class="panel stampcard seg-${card.cat || "n"}"><div class="sc-h">${avatar(card)}<div><b>${esc(card.svc)}</b><span class="hint">${esc(card.name)} · ${Math.min(card.n, card.goal)} de ${card.goal} sellos · ${card.done} hecho${card.done === 1 ? "" : "s"}</span></div></div>
   ${stampGrid(Math.min(card.n, card.goal), card.goal)}
   <p class="sc-r">${full ? `🎁 <b>¡Premio listo!</b> Tu próximo ${esc(card.svc)} es gratis.` : `Te faltan <b>${card.goal - card.n}</b> para un ${esc(card.svc)} gratis.`}</p>
   ${full ? `<button class="btn btn-pri btn-block" data-act="useReward" data-id="${card.pid}" data-sk="${esc(String(card.sid))}">Reservar mi premio</button>` : `<button class="btn btn-ghost btn-block btn-sm" data-go="perfil" data-id="${card.pid}">Ver perfil</button>`}</div>`;
}

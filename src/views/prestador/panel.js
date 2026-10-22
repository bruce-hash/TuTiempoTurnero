import { esc } from "../../lib/dom.js";
import { TODAY, addDays, dkey } from "../../lib/fechas.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { CAT, RUBRO, catInfo, catName, pcat } from "../../lib/rubros.js";
import { cfg } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { vBAgendaT } from "./agenda.js";
import { vCaja } from "./caja.js";
import { vBClientes } from "./clientes.js";
import { comm, vBComunidad } from "./comunidad.js";
import { vBStats } from "./estadisticas.js";
import { vBFinanzas } from "./finanzas.js";
import { vBHorarios } from "./horarios.js";
import { MSG_DEF } from "./mensajes.js";
import { vBPerfil } from "./perfil.js";
import { vBProductos } from "./productos.js";

export function demoClosings(e) {
  const a = {};
  const t = TODAY();
  const s = e.filter(
    (n) => n.date.slice(0, 7) === t.slice(0, 7) && n.date < t && n.app + n.man + n.walk + n.prod > 0,
  );
  s.slice(0, Math.max(0, s.length - 2)).forEach((n) => {
    const o = n.app + n.man + n.walk + n.prod;
    a["day|" + n.date] = {
      income: o,
      cash: Math.round(o * 0.55),
      mp: o - Math.round(o * 0.55),
      counted: null,
      at: "21:0" + (n.date.slice(-1) % 10),
    };
  });
  return a;
}
export const STORE = {};
function seedStore(pid) {
  const a = {};
  store.BOOK.filter((i) => i.pid == pid && i.cliente && i.type !== "block").forEach((i, l) => {
    a[i.cliente] = {
      v: 2 + (l % 5),
      n: 0,
      last: 7 + l * 3,
      spend: i.price,
      tel: "2284 4" + String(1e4 + l * 731).slice(-5),
      notes: "",
      bday: "",
    };
  });
  const t = [];
  for (let i = 29; i >= 1; i--) {
    const l = dkey(addDays(-i));
    const c = /* @__PURE__ */ new Date(l + "T12:00:00").getDay();
    const d = ((i * pid) % 11) / 10;
    t.push(
      c === 0
        ? {
            date: l,
            app: 0,
            man: 0,
            walk: 0,
            prod: 0,
          }
        : {
            date: l,
            app: Math.round((18e3 + d * 15e3) / 100) * 100,
            man: Math.round((9e3 + d * 7e3) / 100) * 100,
            walk: Math.round((6e3 + (1 - d) * 9e3) / 100) * 100,
            prod: i % 4 === 0 ? 6e3 : 0,
          },
    );
  }
  const s = (
    pr(pid) || {
      cats: ["b"],
    }
  ).cats[0];
  const n = RUBRO[s] || RUBRO.b;
  const o = {
    b: {
      corte: "Fade 1 a los costados, tijera arriba",
      barba: "Perfilada, sin degradé",
    },
    p: {
      formula: "Koleston 7.1 + oxidante 20 vol",
      tecnica: "Balayage, corte en capas",
    },
    m: {
      presion: "Fuerte",
      zonas: "Trabajar cervicales; evitar lumbar",
      salud: "Contractura crónica en hombros",
    },
    l: {
      mapa: "Ojo de gato · C · 9-12 mm",
      adhesivo: "Sensitive, sin molestias",
    },
    u: {
      forma: "Almendra media",
      colores: "Nudes y rojo",
      unas: "Cutículas secas",
    },
    d: {
      fototipo: "III",
      zonas: "Piernas completas · sesión 3 de 8",
      reacciones: "Leve enrojecimiento",
    },
  };
  Object.keys(a)
    .slice(0, 2)
    .forEach((i) => {
      a[i].profile = Object.assign({}, o[s] || {});
      a[i].notes = "";
    });
  return {
    CLOSINGS: demoClosings(t),
    CLIENTS: a,
    PRODS: n.prods.map((i) => ({
      n: i[0],
      p: i[1],
      stock: i[2],
      min: i[3],
    })),
    GASTOS: [
      {
        id: store.GID++,
        c: "Alquiler",
        m: 12e4,
        cat: "Alquiler",
        d: dkey(addDays(-10)),
      },
      {
        id: store.GID++,
        c: "Insumos de " + catName(s).toLowerCase(),
        m: 35e3,
        cat: "Insumos",
        d: dkey(addDays(-4)),
      },
    ],
    FIN: t,
    MSGS: MSG_DEF(s),
    walk: [],
    earn: 0,
    jobs: 0,
    mp: "none",
  };
}
export function useProvider(pid) {
  pid = +pid;
  if (S.me === pid && store.COMMBY[pid] === store.COMM) {
    return;
  }
  if (S.me != null) {
    STORE[S.me] = {
      CLIENTS: store.CLIENTS,
      PRODS: store.PRODS,
      GASTOS: store.GASTOS,
      FIN: store.FIN,
      MSGS: store.MSGS,
      CLOSINGS: store.CLOSINGS,
      walk: S.walk,
      earn: S.earnToday,
      jobs: S.jobsToday,
      mp: S.mp,
    };
  }
  S.me = pid;
  const a = STORE[pid] || seedStore(pid);
  store.CLIENTS = a.CLIENTS;
  store.PRODS = a.PRODS;
  store.GASTOS = a.GASTOS;
  store.FIN = a.FIN;
  store.MSGS = a.MSGS;
  store.CLOSINGS = a.CLOSINGS || {};
  S.walk = a.walk;
  S.earnToday = a.earn;
  S.jobsToday = a.jobs;
  S.mp = a.mp;
  store.COMM = comm(pid);
}
export const BTABS = [
  ["agenda", "Agenda"],
  ["caja", "Caja"],
  ["finanzas", "Finanzas"],
  ["clientes", "Clientes"],
  ["productos", "Productos"],
  ["horarios", "Horarios"],
  ["stats", "Estadísticas"],
  ["comunidad", "Trabajos"],
  ["perfil", "Perfil"],
];
export function selectBtab(e) {
  S.btab = e;
  S.delAsk = null;
  S.cli = null;
  S.buyI = null;
  S.prodOpen = false;
  S.gOpen = false;
  S.mEdit = null;
  if (e === "agenda") {
    S.newT = 0;
  }
  S.hErr = null;
  S.manOpen = false;
  S.blockOpen = false;
  render();
}
export function vBarbero() {
  const e = pr(ME());
  const a = BTABS;
  const t = Math.max(
    0,
    a.findIndex((l) => l[0] === S.btab),
  );
  const s = cfg(ME());
  const n = `<div class="panel bhead"><div class="contact">${avatar(e)}<div><b>${esc(e.name)}</b><div class="cchips" style="justify-content:flex-start;margin-top:4px">${e.cats.map((l) => `<button class="cchip seg-${l}" data-pctx="${l}" aria-pressed="${l === pcat(e, S.pctx)}">${CAT[l] ? catInfo(l).ic : ""} ${esc(catName(l))}</button>`).join("")}</div></div></div>
   <div class="swrow"><div><b>📅 Turnos online</b><div class="hint">${s.on ? "🟢 Tus clientes pueden reservar y pagar" : "⚪ Nadie puede reservar online"}</div></div><button class="tg" data-act="turnosOn" aria-pressed="${s.on}" aria-label="Turnos online"></button></div></div><button class="btn btn-ghost btn-block" data-act="preview">👁 Ver mi perfil como lo ve un cliente</button>`;
  const o = `<div class="btabw"><button class="tabarr" data-act="tabPrev" aria-label="Sección anterior" ${t === 0 ? "disabled" : ""}>‹</button><div class="btabs" role="tablist">${a.map(([l, c]) => `<button role="tab" data-btab="${l}" aria-selected="${S.btab === l}">${c}${l === "agenda" && S.newT ? ' <i class="dotn"></i>' : ""}</button>`).join("")}</div><button class="tabarr" data-act="tabNext" aria-label="Sección siguiente" ${t >= a.length - 1 ? "disabled" : ""}>›</button></div>`;
  const i = (
    {
      caja: () => vCaja(e),
      agenda: () => vBAgendaT(),
      clientes: () => vBClientes(),
      finanzas: () => vBFinanzas(),
      horarios: () => vBHorarios(),
      productos: () => vBProductos(),
      stats: () => vBStats(),
      comunidad: () => vBComunidad(e),
      perfil: () => vBPerfil(e),
    }[S.btab] || (() => vBAgendaT())
  )();
  return `<div class="narrow stack" style="margin-top:20px">${n}${o}${i}</div>`;
}

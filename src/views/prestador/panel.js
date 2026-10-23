import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { TODAY, addDays, dkey, relDate } from "../../lib/fechas.js";
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

// cierres de caja de ejemplo: todos los días del mes con movimientos, menos los dos últimos
export function demoClosings(fin) {
  const closings = {};
  const today = TODAY();
  const days = fin.filter(
    (day) => day.date.slice(0, 7) === today.slice(0, 7) && day.date < today && day.app + day.man + day.walk + day.prod > 0,
  );
  days.slice(0, Math.max(0, days.length - 2)).forEach((day) => {
    const income = day.app + day.man + day.walk + day.prod;
    closings["day|" + day.date] = {
      income: income,
      cash: Math.round(income * 0.55),
      mp: income - Math.round(income * 0.55),
      counted: null,
      at: "21:0" + (day.date.slice(-1) % 10),
    };
  });
  return closings;
}
export const STORE = {};
// datos de ejemplo del panel de un prestador (clientes, últimos 29 días de finanzas, productos, gastos, avisos).
// No está en src/demo y llega al build de producción: ver el informe de A2.
function seedStore(pid) {
  const clients = {};
  store.BOOK.filter((booking) => booking.pid == pid && booking.cliente && booking.type !== "block").forEach((booking, index) => {
    clients[booking.cliente] = {
      v: 2 + (index % 5),
      n: 0,
      last: 7 + index * 3,
      spend: booking.price,
      tel: "2284 4" + String(1e4 + index * 731).slice(-5),
      notes: "",
      bday: "",
    };
  });
  const fin = [];
  for (let daysAgo = 29; daysAgo >= 1; daysAgo--) {
    const date = dkey(addDays(-daysAgo));
    const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
    const factor = ((daysAgo * pid) % 11) / 10;
    fin.push(
      dow === 0
        ? {
            date: date,
            app: 0,
            man: 0,
            walk: 0,
            prod: 0,
          }
        : {
            date: date,
            app: Math.round((18e3 + factor * 15e3) / 100) * 100,
            man: Math.round((9e3 + factor * 7e3) / 100) * 100,
            walk: Math.round((6e3 + (1 - factor) * 9e3) / 100) * 100,
            prod: daysAgo % 4 === 0 ? 6e3 : 0,
          },
    );
  }
  const cat = (
    pr(pid) || {
      cats: ["b"],
    }
  ).cats[0];
  const rubro = RUBRO[cat] || RUBRO.b;
  const profileByCat = {
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
  Object.keys(clients)
    .slice(0, 2)
    .forEach((name) => {
      clients[name].profile = Object.assign({}, profileByCat[cat] || {});
      clients[name].notes = "";
    });
  return {
    CLOSINGS: demoClosings(fin),
    CLIENTS: clients,
    PRODS: rubro.prods.map((row) => ({
      n: row[0],
      p: row[1],
      stock: row[2],
      min: row[3],
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
        c: "Insumos de " + catName(cat).toLowerCase(),
        m: 35e3,
        cat: "Insumos",
        d: dkey(addDays(-4)),
      },
    ],
    FIN: fin,
    MSGS: MSG_DEF(cat),
    walk: [],
    earn: 0,
    jobs: 0,
    mp: "none",
  };
}
// cambia el prestador activo del panel: guarda los datos del anterior en STORE y carga (o siembra) los del nuevo
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
  const kept = STORE[pid] || seedStore(pid);
  store.CLIENTS = kept.CLIENTS;
  store.PRODS = kept.PRODS;
  store.GASTOS = kept.GASTOS;
  store.FIN = kept.FIN;
  store.MSGS = kept.MSGS;
  store.CLOSINGS = kept.CLOSINGS || {};
  S.walk = kept.walk;
  S.earnToday = kept.earn;
  S.jobsToday = kept.jobs;
  S.mp = kept.mp;
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
// cambia de pestaña del panel y cierra lo que hubiera abierto (setBtab no dibuja: lo usa también el enrutador)
export function selectBtab(tab) {
  setBtab(tab);
  render();
}
export function setBtab(tab) {
  S.btab = tab;
  S.delAsk = null;
  S.cli = null;
  S.buyI = null;
  S.prodOpen = false;
  S.gOpen = false;
  S.mEdit = null;
  if (tab === "agenda") {
    S.newT = 0;
  }
  S.hErr = null;
  S.manOpen = false;
  S.blockOpen = false;
}
// avisos de cobros sin leer (Bloque 1): pagos devueltos desde Mercado Pago, contracargos y reclamos
function noticesPanel() {
  const unread = (S.notices || []).filter((notice) => !notice.read);
  if (!unread.length) {
    return "";
  }
  return `<div class="panel inbox"><p class="lbl">🔔 Avisos de cobros <span class="cnt">${unread.length}</span></p><ul class="ag">${unread
    .slice(0, 5)
    .map((notice) => `<li class="unread"><div><span class="msgb">${esc(notice.body)}</span><span class="hint">${esc(relDate(notice.at))}</span></div></li>`)
    .join("")}</ul><button class="btn btn-ghost btn-sm" data-act="noticesRead">Entendido</button></div>`;
}
// panel del prestador: cabecera (rubros, turnos online), pestañas y la sección elegida
export function vBarbero() {
  const prov = pr(ME());
  const tabs = BTABS;
  const tabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab[0] === S.btab),
  );
  const conf = cfg(ME());
  const head = `<div class="panel bhead"><div class="contact">${avatar(prov)}<div><b>${esc(prov.name)}</b><div class="cchips" style="justify-content:flex-start;margin-top:4px">${prov.cats.map((cat) => `<button class="cchip seg-${cat}" data-pctx="${cat}" aria-pressed="${cat === pcat(prov, S.pctx)}">${CAT[cat] ? catInfo(cat).ic : ""} ${esc(catName(cat))}</button>`).join("")}</div></div></div>
   <div class="swrow"><div><b>📅 Turnos online</b><div class="hint">${!conf.on ? "⚪ Nadie puede reservar online" : LIVE && S.mp !== "ok" ? "⚠ Sin Mercado Pago conectado: hoy nadie puede reservarte online" : "🟢 Tus clientes pueden reservar y pagar"}</div>${conf.on && LIVE && S.mp !== "ok" ? '<button class="lnk" data-btab="perfil">Conectar Mercado Pago</button>' : ""}</div><button class="tg" data-act="turnosOn" aria-pressed="${conf.on}" aria-label="Turnos online"></button></div></div><button class="btn btn-ghost btn-block" data-act="preview">👁 Ver mi perfil como lo ve un cliente</button>`;
  const tabBar = `<div class="btabw"><button class="tabarr" data-act="tabPrev" aria-label="Sección anterior" ${tabIndex === 0 ? "disabled" : ""}>‹</button><div class="btabs" role="tablist">${tabs.map(([id, label]) => `<button role="tab" data-btab="${id}" aria-selected="${S.btab === id}">${label}${id === "agenda" && S.newT ? ' <i class="dotn"></i>' : ""}</button>`).join("")}</div><button class="tabarr" data-act="tabNext" aria-label="Sección siguiente" ${tabIndex >= tabs.length - 1 ? "disabled" : ""}>›</button></div>`;
  const body = (
    {
      caja: () => vCaja(prov),
      agenda: () => vBAgendaT(),
      clientes: () => vBClientes(),
      finanzas: () => vBFinanzas(),
      horarios: () => vBHorarios(),
      productos: () => vBProductos(),
      stats: () => vBStats(),
      comunidad: () => vBComunidad(prov),
      perfil: () => vBPerfil(prov),
    }[S.btab] || (() => vBAgendaT())
  )();
  return `<div class="narrow stack" style="margin-top:20px">${head}${noticesPanel()}${tabBar}${body}</div>`;
}

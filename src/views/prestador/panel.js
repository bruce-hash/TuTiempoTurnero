import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { relDate } from "../../lib/fechas.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { CAT, catInfo, catName, pcat } from "../../lib/rubros.js";
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
import { seedStore } from "../../demo/panel.js";
import { MSG_DEF } from "./mensajes.js";
import { vBPerfil } from "./perfil.js";
import { vBProductos } from "./productos.js";

export const STORE = {};
// datos vacíos del panel de un prestador: en vivo los completa la base (loadMine); en la demo, src/demo/panel.js
const emptyStore = () => ({ CLOSINGS: {}, CLIENTS: {}, PRODS: [], GASTOS: [], FIN: [], MSGS: MSG_DEF(), walk: [], earn: 0, jobs: 0, mp: "none" });
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
  const kept = STORE[pid] || (LIVE ? emptyStore() : seedStore(pid));
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
  return `<div class="panel inbox pb-notices"><p class="lbl">🔔 Avisos de cobros <span class="cnt">${unread.length}</span></p><ul class="ag">${unread
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
  // en la compu: menú lateral (cabecera y pestañas) y la sección a la derecha; en el celular, todo en una columna, en el
  // orden de siempre (cabecera, avisos, pestañas, sección: ver .pb en compu.css)
  return `<div class="narrow stack cols2 pb" style="margin-top:20px"><div class="pb-side">${head}${tabBar}</div><div class="pb-main">${noticesPanel()}${body}</div></div>`;
}

import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { CAT, catInfo, catName, pcat } from "../../lib/rubros.js";
import { cfg } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { pushCard } from "../../ui/avisos.js";
import { render } from "../../ui/render.js";
import { vBAgendaT } from "./agenda.js";
import { vBClientes } from "./clientes.js";
import { comm, vBComunidad } from "./comunidad.js";
import { vBStats } from "./estadisticas.js";
import { vBFinanzas } from "./finanzas.js";
import { vBHorarios } from "./horarios.js";
import { seedStore } from "../../demo/panel.js";
import { MSG_DEF } from "./mensajes.js";
import { vBPerfil } from "./perfil.js";
import { vBProductos } from "./productos.js";
import { setupCard } from "./verificacion.js";
import { suspendedBanner } from "./suspendida.js";
import { suspension } from "../../lib/alta.js";
import { ic } from "../../ui/iconos.js";

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
// v2: el orden que pidió el cliente; todas a la vista (en el celular, 4 × 2 con ícono y etiqueta chica; en la compu, la
// columna de la izquierda)
export const BTABS = [
  ["agenda", "Agenda", ic("agenda")],
  ["horarios", "Horarios", ic("horarios")],
  ["finanzas", "Finanzas", ic("finanzas")],
  ["productos", "Productos", ic("productos")],
  ["stats", "Estadísticas", ic("estadisticas")],
  ["clientes", "Clientes", ic("clientes")],
  ["comunidad", "Trabajos", ic("trabajos")],
  ["perfil", "Perfil", ic("ajustes")],
];
// cambia de pestaña del panel y cierra lo que hubiera abierto (setBtab no dibuja: lo usa también el enrutador)
export function selectBtab(tab) {
  setBtab(tab);
  render();
}
export function setBtab(tab) {
  // C34 (V4): la Caja ahora es "Caja del día" en Finanzas (las direcciones y botones viejos llevan ahí)
  if (tab === "caja") {
    tab = "finanzas";
    S.fp = "dia";
  }
  S.btab = tab;
  S.delAsk = null;
  S.movEd = null;
  S.movDel = null;
  S.prodDel = null;
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
// 4/11: los avisos del panel (cobros, Mercado Pago, seguidores nuevos) pasaron a la campanita de la cabecera
// (src/ui/campanita.js)
// panel del prestador: cabecera (rubros, turnos online), pestañas y la sección elegida
export function vBarbero() {
  const prov = pr(ME());
  const tabs = BTABS;
  const conf = cfg(ME());
  const head = `<div class="panel bhead"><div class="contact">${avatar(prov)}<div><b>${esc(prov.name)}</b><div class="cchips" style="justify-content:flex-start;margin-top:4px">${prov.cats.map((cat) => `<button class="cchip seg-${cat}" data-pctx="${cat}" aria-pressed="${cat === pcat(prov, S.pctx)}">${CAT[cat] ? catInfo(cat).ic : ""} ${esc(catName(cat))}</button>`).join("")}</div></div></div>
   <div class="swrow"><div><b>${ic("agenda")} Turnos online</b><div class="hint">${suspension() ? `${ic("estado-off")} Cuenta suspendida: nadie puede reservarte online` : !conf.on ? `${ic("estado-off")} Nadie puede reservar online` : LIVE && S.mp !== "ok" ? `${ic("aviso")} Sin Mercado Pago conectado: hoy nadie puede reservarte online` : `${ic("estado-on")} Tus clientes pueden reservar y pagar`}</div>${conf.on && LIVE && S.mp !== "ok" && !suspension() ? '<button class="lnk" data-btab="perfil">Conectar Mercado Pago</button>' : ""}</div><button class="tg" data-act="turnosOn" aria-pressed="${conf.on}" aria-label="Turnos online"></button></div></div>`;
  const tabBar = `<div class="btabw"><div class="btabs" role="tablist" aria-label="Secciones del panel">${tabs.map(([id, label, icon]) => `<button role="tab" data-btab="${id}" aria-selected="${S.btab === id}"><span class="bt-i" aria-hidden="true">${icon}</span><span class="bt-l">${label}</span>${id === "agenda" && S.newT ? '<i class="dotn"></i>' : ""}</button>`).join("")}</div></div>`;
  const body = (
    {
      // v2: "Ver mi perfil como cliente" salió de la cabecera y del menú de cuenta: queda acá, al final de la Agenda
      agenda: () => setupCard() + pushCard("prestador") + vBAgendaT() + `<button class="btn btn-ghost btn-block ag-prev" data-act="preview">${ic("ver")} Ver mi perfil como cliente</button>`,
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
  // orden de siempre (cabecera, avisos, pestañas, sección: ver .pb en compu.css). 10/11 (D43): con la cuenta suspendida,
  // el aviso fijo va arriba de todo, en todas las secciones (en la compu, a lo ancho de las dos columnas)
  return `<div class="narrow stack cols2 pb" style="margin-top:20px">${suspendedBanner()}<div class="pb-side">${head}${tabBar}</div><div class="pb-main">${body}</div></div>`;
}

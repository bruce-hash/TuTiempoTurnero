// 11/11 (división del código): el prestador activo del panel y las pestañas, aparte de la vista del panel
// (src/views/prestador/panel.js, que se carga recién al abrirlo: src/partes.js)
import { LIVE } from "../config.js";
import { seedStore } from "../demo/panel.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { ic } from "../ui/iconos.js";
import { render } from "../ui/render.js";
import { comm } from "./comunidad.js";
import { MSG_DEF } from "./mensajes-def.js";

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
      BLOCKED: store.BLOCKED,
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
  store.BLOCKED = kept.BLOCKED || [];
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

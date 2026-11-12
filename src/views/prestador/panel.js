import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { CAT, catInfo, catName, pcat } from "../../lib/rubros.js";
import { cfg } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { pushCard } from "../../ui/avisos.js";
import { vBAgendaT } from "./agenda.js";
import { vBClientes } from "./clientes.js";
import { vBComunidad } from "./comunidad.js";
import { vBStats } from "./estadisticas.js";
import { vBFinanzas } from "./finanzas.js";
import { vBHorarios } from "./horarios.js";
import { vBPerfil } from "./perfil.js";
import { vBProductos } from "./productos.js";
import { setupCard } from "./verificacion.js";
import { suspendedBanner } from "./suspendida.js";
import { suspension } from "../../lib/alta.js";
import { ic } from "../../ui/iconos.js";

// 11/11 (división del código): el prestador activo y las pestañas viven en src/lib/panel-nav.js (los usa también el
// arranque, el enrutador y la campanita sin cargar todo el panel)
export { BTABS, STORE, selectBtab, setBtab, useProvider } from "../../lib/panel-nav.js";
import { BTABS } from "../../lib/panel-nav.js";
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

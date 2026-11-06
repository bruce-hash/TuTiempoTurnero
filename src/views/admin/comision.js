import { LIVE } from "../../config.js";
import { MP_TERMS, chargeFor } from "../../lib/cobro.js";
import { money, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { HOLIDAY_KINDS, holidayLabel, kindName } from "../../lib/feriados.js";
import { isoToLocal } from "../../lib/fechas.js";
import { dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { stampsOn } from "../../ui/sellos.js";
import { ic } from "../../ui/iconos.js";

// D30: comisión de TuTiempo (% de la SEÑA) y % de Mercado Pago por plazo de acreditación. El ejemplo, con un corte de
// $20.000 y seña del 50%, es solo para mostrar: la base hace la misma cuenta al reservar (charge_parts).
const MP_REF = { instant: 7.61, d10: 5.31, d18: 4.1, d35: 1.8 };
export function admCom(data) {
  const fees = store.FEES;
  const pct = fees.commission;
  const ex = chargeFor(1e4, pct, fees.mp.instant, 2e4);
  const rows = MP_TERMS.map(([term, name]) => `<tr><td>${name}</td><td><div class="comrow"><input id="admMp-${term}" type="text" inputmode="decimal" maxlength="5" value="${pctTxt(fees.mp[term])}" aria-label="Mercado Pago, ${name}, en porcentaje" autocomplete="off"><span class="pctl">%</span></div></td><td class="hint">${pctTxt(MP_REF[term])}%</td></tr>`).join("");
  return `<form class="panel" id="fCom" novalidate><p class="lbl">Comisión de TuTiempo</p>
    <div class="comrow"><input id="admCom" type="text" inputmode="decimal" maxlength="5" value="${pctTxt(pct)}" aria-label="Comisión en porcentaje del precio del turno" autocomplete="off"><span class="pctl">% del servicio</span></div>
    <p class="note" style="text-align:left;margin:8px 0 10px">Entre 0 y 30, con decimales si querés (por ejemplo 7 u 8,5). Es un % del <b>precio del turno</b> (con descuentos y adicionales), se cobra al reservar junto con la seña y la paga el cliente aparte: el profesional recibe su seña completa.</p>
    <p class="lbl" style="margin-top:14px">Comisión de Mercado Pago por plazo de acreditación</p>
    <table class="mptab"><thead><tr><th>Plazo</th><th>% que se suma</th><th>Referencia (con IVA)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note" style="text-align:left;margin:8px 0 10px">De 0 a 15. Cada profesional elige su plazo en Horarios (el mismo que en su cuenta de Mercado Pago). Con 0, al cliente no se le suma nada y el costo de Mercado Pago lo absorbe el profesional, como hasta ahora. Las referencias cambian según la provincia y Mercado Pago las actualiza.</p>
    <div class="panel comex"><p class="lbl" style="margin:0 0 6px">Ejemplo: corte de ${money(2e4)}, seña del 50%, acreditación al instante</p><div class="sum">
      <div><span>Seña para el profesional</span><span>${money(ex.deposit)}</span></div>
      <div><span>Comisión TuTiempo (${pctTxt(pct)}% del servicio)</span><span>${money(ex.fee)}</span></div>
      <div><span>Costo de Mercado Pago (${pctTxt(fees.mp.instant)}% del total)</span><span>${money(ex.mp)}</span></div>
      <div class="tot"><span>El cliente paga al reservar</span><span>${money(ex.total)}</span></div></div>
      <p class="note" style="text-align:left;margin:6px 0 0">Total = (seña + comisión) / (1 − % de Mercado Pago), redondeado para arriba. El profesional recibe ${money(ex.deposit)} ahora y ${money(ex.deposit)} en el local; TuTiempo, ${money(ex.fee)}.</p></div>
    <p class="note" style="text-align:left;margin:0 0 10px">Los cambios valen para las reservas nuevas; las ya hechas no cambian.</p>
    <div class="err" id="comerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar comisiones</button></form>${dniPanel()}${stampsPanel()}${holidaysPanel()}${LIVE ? siteForm(data.siteUrl) : ""}`;
}
// H24: dirección del sitio con la que la base arma los links de los avisos a los clientes (recordatorios, cancelaciones)
function siteForm(url) {
  return `<form class="panel" id="fSite" novalidate><p class="lbl">Dirección del sitio</p>
    <input id="admSite" type="url" inputmode="url" maxlength="100" value="${esc(url || "")}" placeholder="https://prueba.tutiempo.com.ar" aria-label="Dirección del sitio" autocomplete="off">
    <p class="note" style="text-align:left;margin:8px 0 10px">La que abren los clientes: <b>https://</b> y el dominio, sin barra al final ni nada después. Con ella se arman los links de los avisos (por ejemplo <i>${esc(url || "https://tutiempo.com.ar")}/nombre-del-negocio</i>). En el entorno de prueba, la del subdominio de prueba.</p>
    <div class="err" id="siteerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar dirección</button></form>`;
}
// Bloque D (D26): "Exigir DNI para aprobar prestadores" (hoy activada). Apagada, se aprueba sin DNI y nadie gana el sello
// "Identidad verificada" sin haberse verificado.
// C29 (V5 resto): "Tarjetas de sellos" para toda la plataforma. Apagadas, no se ven en ningún lado y no se suman sellos;
// los datos quedan y al encenderlas vuelven como estaban (los premios ganados se canjean al reactivar).
function stampsPanel() {
  const on = stampsOn();
  return `<div class="panel"><p class="lbl">Sellos</p><div class="swrow"><div><b>${ic("sellos")} Tarjetas de sellos</b><div class="hint">${on ? "Los profesionales pueden dar sellos y los clientes canjean su premio" : "Apagadas: no se ven en ningún lado y no se suman sellos"}</div></div><button class="tg" data-act="admStamps" aria-pressed="${on}" aria-label="Tarjetas de sellos"></button></div>
    <p class="note" style="text-align:left;margin:8px 0 0">${on ? "Si las apagás, desaparecen de los perfiles, de Mis turnos y del panel de los profesionales, y no se suman sellos. Las tarjetas, los sellos y los premios ganados quedan guardados." : "Si las volvés a encender, cada cliente vuelve a ver su tarjeta como estaba y los premios ganados se pueden canjear."}</p></div>`;
}
function dniPanel() {
  const on = dniRequired();
  return `<div class="panel"><p class="lbl">Verificación</p><div class="swrow"><div><b>${ic("dni")} Exigir DNI para aprobar profesionales</b><div class="hint">${on ? "Para aprobar a un profesional hacen falta su número de DNI y las fotos del frente y del dorso" : "Los profesionales nuevos se aprueban sin DNI"}</div></div><button class="tg" data-act="admReqDni" aria-pressed="${on}" aria-label="Exigir DNI para aprobar profesionales"></button></div>
    <p class="note" style="text-align:left;margin:8px 0 0">${on ? "Si la apagás, el alta y el panel dejan de pedir el DNI y aprobás a los profesionales nuevos solo con sus datos." : "Si la volvés a activar, los profesionales pendientes tienen que cargar su DNI antes de que los apruebes."} Los que ya tienen el DNI verificado siguen mostrando “Identidad verificada”.</p></div>`;
}
// 7/11 · Feriados (D39): la lista oficial del año en curso y del siguiente, que trae el servidor de la fuente pública
// (holidays-sync, los lunes). El admin la revisa, la corrige si hace falta y la confirma una vez por año: desde ahí los
// profesionales la ven en Horarios y les llega el aviso 7 días antes.
function holidaysPanel() {
  const years = S.admHol || [];
  const when = (iso) => (iso ? isoToLocal(iso).date.split("-").reverse().slice(0, 2).join("/") : "");
  const yearBox = (y) => {
    const status = y.confirmed_at
      ? `<span class="chip ok">✓ Confirmado el ${esc(when(y.confirmed_at))}</span>`
      : '<span class="chip gray">Sin confirmar: los profesionales todavía no lo ven</span>';
    const source = y.fetch_error
      ? `<p class="hint holerr">${ic("aviso")} La fuente falló${y.fetched_at ? ` (${esc(when(y.fetched_at))})` : ""}: ${esc(y.fetch_error)}. Si no se arregla, cargá o corregí los feriados a mano.</p>`
      : y.fetched_at
        ? `<p class="hint">Traídos de la fuente el ${esc(when(y.fetched_at))}: ${+y.fetched_count || 0}.</p>`
        : '<p class="hint">Todavía no se trajeron de la fuente.</p>';
    const changed = y.source_changed ? `<p class="hint holerr">${ic("aviso")} La fuente cambió después de confirmar (por ejemplo, un traslado por decreto). Revisá la lista, corregí lo que haga falta y volvé a confirmar.</p>` : "";
    const days = (y.days || [])
      .map((h) => `<li data-hday="${esc(h.day)}"><span class="ag-t">${esc(h.day.slice(8, 10))}/${esc(h.day.slice(5, 7))}</span><div><b>${esc(h.name)}</b><span>${esc(holidayLabel(h.day))} · ${esc(kindName(h.kind))}${h.source === "admin" ? " · cargado a mano" : ""}</span></div><button type="button" class="xbtn" data-act="admHolDel" data-d="${esc(h.day)}" aria-label="Borrar ${esc(h.name)}">${ic("borrar")}</button></li>`)
      .join("");
    return `<div class="holyear"><div class="holyear-h"><b>${y.year}</b>${status}</div>${source}${changed}
     ${days ? `<ul class="ag holadm">${days}</ul>` : '<p class="note" style="text-align:left">No hay feriados cargados.</p>'}
     ${(!y.confirmed_at || y.source_changed) && (y.days || []).length ? `<button type="button" class="btn btn-pri btn-block" data-act="admHolConfirm" data-y="${y.year}">Confirmar los feriados de ${y.year}</button>` : ""}</div>`;
  };
  return `<div class="panel holpanel-adm"><p class="lbl">${ic("agenda")} Feriados</p>
   <p class="note" style="text-align:left;margin:0 0 10px">Los nacionales (inamovibles y trasladables) y los días no laborables con fines turísticos; no los provinciales ni los municipales. La lista oficial la trae el servidor de una fuente pública todos los lunes. Revisala y confirmala una vez por año: desde ahí cada profesional la ve en Horarios (Abro / Cierro) y le llega el aviso 7 días antes. Si no elige, el feriado queda abierto.</p>
   ${years.map(yearBox).join("")}
   <form id="fHol" class="stack" style="gap:8px;margin-top:12px" novalidate><p class="lbl" style="margin:0">Agregar o corregir un feriado</p>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="holD">Fecha</label><input id="holD" type="date"></div>
    <div class="f"><label for="holK">Tipo</label><select id="holK">${HOLIDAY_KINDS.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></div></div>
    <div class="f"><label for="holN">Nombre</label><input id="holN" maxlength="80" autocomplete="off" placeholder="Día de la Soberanía Nacional"></div>
    <p class="hint" id="holerr" role="alert"></p>
    <button class="btn btn-ghost btn-block" type="submit">Guardar feriado</button></form>
   ${LIVE ? '<button type="button" class="btn btn-ghost btn-block" style="margin-top:8px" data-act="admHolFetch">Traer de nuevo de la fuente</button>' : ""}</div>`;
}

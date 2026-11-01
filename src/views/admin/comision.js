import { LIVE } from "../../config.js";
import { MP_TERMS, chargeFor } from "../../lib/cobro.js";
import { money, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dniRequired } from "../../lib/verificacion.js";
import { store } from "../../store.js";

// D30: comisión de TuTiempo (% de la SEÑA) y % de Mercado Pago por plazo de acreditación. El ejemplo, con un corte de
// $20.000 y seña del 50%, es solo para mostrar: la base hace la misma cuenta al reservar (charge_parts).
const MP_REF = { instant: 7.61, d10: 5.31, d18: 4.1, d35: 1.8 };
export function admCom(data) {
  const fees = store.FEES;
  const pct = fees.commission;
  const ex = chargeFor(1e4, pct, fees.mp.instant);
  const rows = MP_TERMS.map(([term, name]) => `<tr><td>${name}</td><td><div class="comrow"><input id="admMp-${term}" type="text" inputmode="decimal" maxlength="5" value="${pctTxt(fees.mp[term])}" aria-label="Mercado Pago, ${name}, en porcentaje" autocomplete="off"><span class="pctl">%</span></div></td><td class="hint">${pctTxt(MP_REF[term])}%</td></tr>`).join("");
  return `<form class="panel" id="fCom" novalidate><p class="lbl">Comisión de TuTiempo</p>
    <div class="comrow"><input id="admCom" type="text" inputmode="decimal" maxlength="5" value="${pctTxt(pct)}" aria-label="Comisión en porcentaje de la seña" autocomplete="off"><span class="pctl">% de la seña</span></div>
    <p class="note" style="text-align:left;margin:8px 0 10px">Entre 0 y 30, con decimales si querés (por ejemplo 7 u 8,5). Es un % de la <b>seña</b> y la paga el cliente aparte: el prestador recibe su seña completa.</p>
    <p class="lbl" style="margin-top:14px">Comisión de Mercado Pago por plazo de acreditación</p>
    <table class="mptab"><thead><tr><th>Plazo</th><th>% que se suma</th><th>Referencia (con IVA)</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note" style="text-align:left;margin:8px 0 10px">De 0 a 15. Cada prestador elige su plazo en Horarios (el mismo que en su cuenta de Mercado Pago). Con 0, al cliente no se le suma nada y el costo de Mercado Pago lo absorbe el prestador, como hasta ahora. Las referencias cambian según la provincia y Mercado Pago las actualiza.</p>
    <div class="panel comex"><p class="lbl" style="margin:0 0 6px">Ejemplo: corte de ${money(2e4)}, seña del 50%, acreditación al instante</p><div class="sum">
      <div><span>Seña para el prestador</span><span>${money(ex.deposit)}</span></div>
      <div><span>Comisión TuTiempo (${pctTxt(pct)}% de la seña)</span><span>${money(ex.fee)}</span></div>
      <div><span>Costo de Mercado Pago (${pctTxt(fees.mp.instant)}% del total)</span><span>${money(ex.mp)}</span></div>
      <div class="tot"><span>El cliente paga al reservar</span><span>${money(ex.total)}</span></div></div>
      <p class="note" style="text-align:left;margin:6px 0 0">Total = (seña + comisión) / (1 − % de Mercado Pago), redondeado para arriba. El prestador recibe ${money(ex.deposit)} ahora y ${money(ex.deposit)} en el local; TuTiempo, ${money(ex.fee)}.</p></div>
    <p class="note" style="text-align:left;margin:0 0 10px">Los cambios valen para las reservas nuevas; las ya hechas no cambian.</p>
    <div class="err" id="comerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar comisiones</button></form>${dniPanel()}${LIVE ? siteForm(data.siteUrl) : ""}`;
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
function dniPanel() {
  const on = dniRequired();
  return `<div class="panel"><p class="lbl">Verificación</p><div class="swrow"><div><b>🪪 Exigir DNI para aprobar prestadores</b><div class="hint">${on ? "Para aprobar a un prestador hacen falta su número de DNI y las fotos del frente y del dorso" : "Los prestadores nuevos se aprueban sin DNI"}</div></div><button class="tg" data-act="admReqDni" aria-pressed="${on}" aria-label="Exigir DNI para aprobar prestadores"></button></div>
    <p class="note" style="text-align:left;margin:8px 0 0">${on ? "Si la apagás, el alta y el panel dejan de pedir el DNI y aprobás a los prestadores nuevos solo con sus datos." : "Si la volvés a activar, los prestadores pendientes tienen que cargar su DNI antes de que los apruebes."} Los que ya tienen el DNI verificado siguen mostrando “Identidad verificada”.</p></div>`;
}

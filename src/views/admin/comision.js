import { money, pctTxt } from "../../lib/dinero.js";

// comisión de la plataforma; el ejemplo con un corte de $20.000 es solo para mostrar (la base calcula la real)
export function admCom(data) {
  const pct = +data.st.commission_pct;
  const fee = Math.round((pct * 2e4) / 100);
  return `<form class="panel" id="fCom" novalidate><p class="lbl">Comisión de TuTiempo</p>
    <div class="comrow"><input id="admCom" type="text" inputmode="decimal" maxlength="5" value="${pctTxt(pct)}" aria-label="Comisión en porcentaje" autocomplete="off"><span class="pctl">%</span></div>
    <p class="note" style="text-align:left;margin:8px 0 10px">Escribí el porcentaje que quieras, entre 0 y 30 (podés usar decimales, por ejemplo 8,5). Es un % del precio del turno y <b>la paga el cliente aparte</b>, junto con la seña: el prestador recibe su seña completa. Vale para las reservas nuevas.</p>
    <div class="panel comex"><p class="lbl" style="margin:0 0 6px">Ejemplo con ${pctTxt(pct)}%</p><div class="sum">
      <div><span>Corte de cabello</span><span>${money(2e4)}</span></div><div><span>Seña que pidió el prestador (50%)</span><span>${money(1e4)}</span></div>
      <div><span>Comisión TuTiempo (${pctTxt(pct)}%)</span><span>${money(fee)}</span></div><div class="tot"><span>El cliente paga al reservar</span><span>${money(1e4 + fee)}</span></div></div>
      <p class="note" style="text-align:left;margin:6px 0 0">El prestador recibe ${money(1e4)} ahora y ${money(1e4)} en el local. TuTiempo cobra ${money(fee)}.</p></div>
    <div class="err" id="comerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar comisión</button></form>`;
}

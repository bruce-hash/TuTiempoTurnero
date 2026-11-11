import { MP_TERMS } from "../../lib/cobro.js";
import { pctTxt } from "../../lib/dinero.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";

// 11/11: el número vive en src/lib/sena.js (lo usan también los Términos y el admin sin cargar el panel)
export { DEPOSIT_PCT } from "../../lib/sena.js";
import { DEPOSIT_PCT } from "../../lib/sena.js";
export const depositNote = (style = "") =>
  `<p class="note depnote" style="text-align:left;${style}">${ic("sena")} <b>Seña: ${DEPOSIT_PCT}% del servicio</b>, igual para todos los profesionales de TuTiempo. El resto lo cobrás en el local. Si el cliente no viene, la seña te queda a vos.</p>`;

// 4/11 · Bloque 4 (cambia D30): el profesional elige su plazo de acreditación de Mercado Pago, con la tabla del admin al
// lado (lo que se suma al pago del cliente en cada plazo, con IVA). Si un cobro no coincide, la base avisa y lo manda a
// "Para revisar"; ya no lo cambia sola. Radios con name="hterm" en el alta del negocio (se guardan al seguir) y
// name="pterm" en Perfil → Cobros con Mercado Pago (9/11: antes estaba al final de Horarios; se guarda al tocar).
export function termPicker(current, name = "hterm") {
  const term = MP_TERMS.some(([value]) => value === current) ? current : "instant";
  const rows = MP_TERMS.map(([value, label]) => {
    const pct = +(store.FEES.mp[value] || 0);
    return `<label class="termopt"><input type="radio" name="${name}" id="${name}-${value}" value="${value}" ${value === term ? "checked" : ""}><span class="term-n">${label}</span><span class="term-p">${pctTxt(pct)}%</span></label>`;
  }).join("");
  return `<fieldset class="f termpick"><legend>Plazo de acreditación de Mercado Pago</legend>
   <div class="termopts" role="radiogroup">${rows}</div>
   <span class="hint">El % es lo que Mercado Pago cobra en cada plazo (con IVA) y se suma al pago del cliente, así vos recibís la seña completa. Elegí el mismo plazo que tenés en tu cuenta de Mercado Pago (Tu negocio → Costos y plazos). Si un cobro no coincide, te avisamos.</span></fieldset>`;
}

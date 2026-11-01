import { chargeFor } from "./cobro.js";
import { cfg } from "./turnero.js";
import { store } from "../store.js";

// D30: comisión de TuTiempo (% de la seña) y % de Mercado Pago por plazo de acreditación. En vivo se reemplazan por los
// de app_settings al arrancar (api.fees()); en la demo, los de ejemplo.
store.FEES = { commission: 7, mp: { instant: 0, d10: 0, d18: 0, d35: 0 } };
// Porcentaje para mostrar con coma decimal ("8,5"); sin argumento, el de la comisión de TuTiempo vigente.
export const pctTxt = (pct) => String(Math.round((pct == null ? store.FEES.commission : +pct) * 100) / 100).replace(".", ",");
export { PESOS_ERR, parsePesos, parseWhole } from "./montos.js";
export const money = (amount) => "$" + Math.round(amount).toLocaleString("es-AR");
export const mustPayTotal = () => false;
// Lo que se paga al reservar: la seña (porcentaje del prestador) o el total si el prestador lo pide.
// clientName ya no se usa: hasta la versión 29, al que tenía faltas se le cobraba el total.
export const payNow = (pid, price, clientName) => {
  const conf = cfg(pid);
  if (conf.pay === "total") {
    return price;
  } else {
    return Math.min(price, Math.round((price * conf.pct) / 100));
  }
};
// D30: lo que se paga al reservar por una seña de este prestador: { deposit, fee (TuTiempo), mp (Mercado Pago), total }
export const chargeAt = (pid, deposit) => chargeFor(deposit, store.FEES.commission, mpPctOf(pid));
// % de Mercado Pago del plazo que eligió el prestador
export const mpPctOf = (pid) => +(store.FEES.mp[cfg(pid).term || "instant"] || 0);

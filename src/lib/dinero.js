import { cfg } from "./turnero.js";
import { store } from "../store.js";

// Comisión de TuTiempo como fracción (0.1 = 10%). En vivo se reemplaza por la de app_settings al arrancar.
store.COMISION = 0.1;
// Porcentaje para mostrar con coma decimal ("8,5"); sin argumento, el de la comisión vigente.
export const pctTxt = (pct) => String(Math.round((pct == null ? store.COMISION * 100 : +pct) * 100) / 100).replace(".", ",");
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
export const feeFor = (price) => Math.round((price || 0) * store.COMISION);

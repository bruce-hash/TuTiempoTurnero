import { cfg } from "./turnero.js";
import { store } from "../store.js";

// Comisión de TuTiempo como fracción (0.1 = 10%). En vivo se reemplaza por la de app_settings al arrancar.
store.COMISION = 0.1;
// Porcentaje para mostrar con coma decimal ("8,5"); sin argumento, el de la comisión vigente.
export const pctTxt = (pct) => String(Math.round((pct == null ? store.COMISION * 100 : +pct) * 100) / 100).replace(".", ",");
// H08: montos enteros en pesos. Acepta "12500", "12.500" o "$ 12.500"; con centavos ("12500,50") u otros signos no
// es un monto (NaN). Antes se borraba todo lo que no fuera número y "12500,50" quedaba en 1.250.050. Vacío = 0.
export function parsePesos(raw) {
  const text = String(raw == null ? "" : raw).replace(/[$\s]/g, "");
  if (text === "") {
    return 0;
  }
  return /^\d+$/.test(text) || /^\d{1,3}(\.\d{3})+$/.test(text) ? +text.replace(/\./g, "") : NaN;
}
export const PESOS_ERR = "Escribí el monto en pesos enteros, sin centavos (por ejemplo 12500 o 12.500).";
// cantidades (unidades, minutos, porcentajes): solo números enteros; vacío = 0
export function parseWhole(raw) {
  const text = String(raw == null ? "" : raw).trim();
  return text === "" ? 0 : /^\d+$/.test(text) ? +text : NaN;
}
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

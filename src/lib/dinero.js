import { cfg } from "./turnero.js";
import { store } from "../store.js";

store.COMISION = 0.1;
export const pctTxt = (e) => String(Math.round((e == null ? store.COMISION * 100 : +e) * 100) / 100).replace(".", ",");
export const money = (e) => "$" + Math.round(e).toLocaleString("es-AR");
export const mustPayTotal = () => false;
export const payNow = (e, a, t) => {
  const s = cfg(e);
  if (s.pay === "total") {
    return a;
  } else {
    return Math.min(a, Math.round((a * s.pct) / 100));
  }
};
export const feeFor = (e) => Math.round((e || 0) * store.COMISION);

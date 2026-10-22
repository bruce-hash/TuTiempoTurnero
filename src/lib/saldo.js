import { TODAY, dayLabel } from "./fechas.js";
import { S } from "../state.js";

const CASHBACK = 0;
const cbOf = (e) => Math.floor(e * CASHBACK);
function wMove(e, amt) {
  S.wmov.unshift({
    d: dayLabel(TODAY()),
    t: e,
    amt: amt,
  });
}
function walletPay(total) {
  const a = S.useWallet ? Math.min(S.wallet, total) : 0;
  const t = total - a;
  const s = cbOf(t);
  return {
    used: a,
    mp: t,
    cb: s,
  };
}
function applyPay(pay, what) {
  if (pay.used) {
    S.wallet -= pay.used;
    wMove("Pagaste con saldo · " + what, -pay.used);
  }
  if (pay.cb) {
    S.wallet += pay.cb;
    wMove("Cashback 5% · " + what, pay.cb);
  }
}
export function refundPay(e, what) {
  if (e) {
    if (e.wUsed) {
      S.wallet += e.wUsed;
      wMove("Devolución a tu saldo · " + what, e.wUsed);
    }
    if (e.cb) {
      const t = Math.min(S.wallet, e.cb);
      S.wallet -= t;
      if (t) {
        wMove("Se descuenta el cashback · " + what, -t);
      }
    }
    e.wUsed = 0;
    e.cb = 0;
  }
}
function walletBox(total) {
  return "";
}
export function walletPanel() {
  return "";
}

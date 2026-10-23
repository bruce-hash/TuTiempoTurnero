import { TODAY, dayLabel } from "./fechas.js";
import { S } from "../state.js";

// Saldo TuTiempo y cashback: ya no existen (v25, CASHBACK = 0) y este código no hace nada útil. Se borra en el
// Bloque 2 (H17).
const CASHBACK = 0;
const cbOf = (amount) => Math.floor(amount * CASHBACK);
function wMove(text, amt) {
  S.wmov.unshift({
    d: dayLabel(TODAY()),
    t: text,
    amt: amt,
  });
}
function walletPay(total) {
  const used = S.useWallet ? Math.min(S.wallet, total) : 0;
  const mp = total - used;
  const cashback = cbOf(mp);
  return {
    used: used,
    mp: mp,
    cb: cashback,
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
export function refundPay(booking, what) {
  if (booking) {
    if (booking.wUsed) {
      S.wallet += booking.wUsed;
      wMove("Devolución a tu saldo · " + what, booking.wUsed);
    }
    if (booking.cb) {
      const back = Math.min(S.wallet, booking.cb);
      S.wallet -= back;
      if (back) {
        wMove("Se descuenta el cashback · " + what, -back);
      }
    }
    booking.wUsed = 0;
    booking.cb = 0;
  }
}
function walletBox(total) {
  return "";
}
export function walletPanel() {
  return "";
}

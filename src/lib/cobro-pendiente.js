// 4/11 · Bloque 1: el cobro que quedó abierto al ir a Mercado Pago (id del turno y token de regreso, nada personal).
// Desde la app instalada en iPhone, Mercado Pago abre la vuelta en Safari, que no comparte sesión ni almacenamiento con
// la app: la confirmación no puede depender de esa vuelta. Antes de salir a pagar la app guarda el cobro, y cada vez que
// vuelve a primer plano (o se abre), si sigue pendiente, lleva a la pantalla del turno: "Estamos confirmando tu pago",
// le pide a mp-reconcile que consulte a Mercado Pago y pasa sola a "Tenés turno" o, si no se pagó, a "El pago no se
// completó · Volver a intentar". En el navegador hace lo mismo si se vuelve a la pestaña sin pasar por la vuelta.
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { store } from "../store.js";

const KEY = "tt_cobro";
const MAX_AGE = 40 * 60 * 1000; // un cobro abierto vence a los 10 minutos del hold; 40 por si el pago llega tarde

const read = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && /^[0-9a-f]{64}$/.test(raw.t) && Number.isInteger(raw.b) && Date.now() - raw.at < MAX_AGE) {
      return raw;
    }
  } catch {
    // sin almacenamiento (modo privado): no hay cobro guardado
  }
  return null;
};

export function savePendingPay(token, booking) {
  if (!/^[0-9a-f]{64}$/.test(token || "") || !Number.isInteger(+booking)) {
    return;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ t: token, b: +booking, at: Date.now() }));
  } catch {
    // sin almacenamiento: queda solo la vuelta de Mercado Pago
  }
}

export function clearPendingPay(booking) {
  const pending = read();
  if (!pending || booking == null || pending.b === +booking) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nada que borrar
    }
  }
}

export const pendingPay = read;

// el turno del cobro guardado ya no está esperando el pago (confirmado, vencido, cancelado): se olvida
export function settlePendingPay() {
  const pending = read();
  if (!pending) {
    return;
  }
  const booking = store.BOOK.find((item) => item.id === pending.b);
  if (booking && booking.status !== "hold") {
    clearPendingPay(pending.b);
  }
}

let busy = false;
// al volver a primer plano: si hay un cobro pendiente, a la pantalla del turno, confirmando. go: (view) => void
export async function resumePendingPay(go) {
  const pending = read();
  if (!LIVE || !pending || !S.user || busy || document.visibilityState !== "visible") {
    return false;
  }
  // ya está en la pantalla de ese turno (la vuelta de Mercado Pago en este mismo navegador): ella sigue esperando
  if (S.view === "turnoOk" && S.turnoId === pending.b) {
    return true;
  }
  busy = true;
  try {
    await api.myBookings().catch(() => {});
    const booking = store.BOOK.find((item) => item.id === pending.b);
    if (!booking) {
      clearPendingPay(pending.b);
      return false;
    }
    if (booking.status !== "hold") {
      // ya se resolvió (por ejemplo, confirmado mientras la app estaba en segundo plano): solo si no se vio todavía
      clearPendingPay(pending.b);
      if (booking.status === "confirmed" && !(S.view === "turnoOk" && S.turnoId === pending.b)) {
        S.turnoId = pending.b;
        S.justBooked = true;
        S.payToken = pending.t;
        S.payBack = null;
        go("turnoOk");
      }
      return true;
    }
    // sigue en "hold": confirmando, consulta a Mercado Pago y, si a los ~20 s no hay pago, "El pago no se completó"
    S.turnoId = pending.b;
    S.payToken = pending.t;
    S.payBack = null;
    S.payResume = Date.now();
    S.justBooked = true;
    api.checkoutPoke(pending.t);
    go("turnoOk");
    return true;
  } finally {
    busy = false;
  }
}

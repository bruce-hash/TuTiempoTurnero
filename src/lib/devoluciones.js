import { money } from "./dinero.js";
import { dm } from "./fechas.js";

// Devolución de un turno (Bloque 1): la arma la base (tabla refunds, en my_bookings) y el navegador solo la muestra.
// booking.refund = { amount, status: "pending" | "done", done: "AAAA-MM-DD", reason }
const WHY = {
  slot_taken: "el horario ya no estaba libre cuando se acreditó tu pago",
  booking_unavailable: "el turno ya no estaba disponible cuando se acreditó tu pago",
  amount_short: "el pago no alcanzó para el turno",
};
export function refundText(booking) {
  const refund = booking.refund;
  if (!refund || !refund.amount) {
    return "";
  }
  const why = WHY[refund.reason] ? ` (${WHY[refund.reason]})` : "";
  return refund.status === "done"
    ? `te devolvimos ${money(refund.amount)}${refund.done ? " el " + dm(refund.done) : ""}${why}`
    : `te devolvemos ${money(refund.amount)}${why}`;
}
// el turno no lo canceló el profesional: el horario se ocupó, el pago no alcanzó, etc.
export const notByProvider = (booking) => !!(booking.refund && WHY[booking.refund.reason]);
export const cap = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");

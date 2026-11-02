// V4b · C25 "Cargar diferencia": el resto de un turno (precio menos la seña pagada) cobrado en el local en uno o dos
// medios. La base guarda las partes (bookings.rest_parts, set_rest_parts) y controla que no pasen del resto; acá solo se
// muestran y se revisa el formulario antes de mandarlo. booking.restParts: [[medio, monto], …] o null.
import { medioFromDb } from "./medios.js";
import { PESOS_ERR } from "./montos.js";

// lo que queda por cobrar en el local (la misma cuenta que booking_rest en la base)
export const restOf = (booking) => Math.max(0, (booking.price || 0) - (booking.paid || 0));

// el medio del resto entero cuando no se cargaron partes: el que anotó el prestador o, si no, lo que eligió el cliente
export const defaultRestMedio = (booking) =>
  medioFromDb(booking.restMethod) || (booking.src === "app" && booking.pay !== "cash" ? "Mercado Pago" : "Efectivo");

// las partes del resto y lo que quedó sin cobrar (solo si se cargaron partes que suman menos que el resto)
export function restSplit(booking) {
  const rest = restOf(booking);
  if (booking.restParts && booking.restParts.length) {
    const parts = booking.restParts.map(([medio, amount]) => ({ medio, m: amount }));
    const got = parts.reduce((sum, part) => sum + part.m, 0);
    return { parts, missing: Math.max(0, rest - got) };
  }
  return { parts: rest > 0 ? [{ medio: defaultRestMedio(booking), m: rest }] : [], missing: 0 };
}
export const restMissing = (booking) => restSplit(booking).missing;

// revisa dos partes ya leídas (montos enteros o NaN): devuelve el error o null. La base vuelve a controlar todo.
export function checkSplit(rest, parts) {
  if (parts.some((part) => isNaN(part.m))) {
    return PESOS_ERR;
  }
  if (parts.some((part) => !(part.m > 0))) {
    return "Ingresá cuánto te pagó en cada medio.";
  }
  if (parts.length === 2 && parts[0].medio === parts[1].medio) {
    return "Elegí dos medios distintos.";
  }
  const total = parts.reduce((sum, part) => sum + part.m, 0);
  if (total > rest) {
    return `Entre los dos no puede pasar del resto (${fmt(rest)}).`;
  }
  return null;
}
const fmt = (value) => "$" + Math.round(value).toLocaleString("es-AR");

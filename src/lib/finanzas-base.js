// 11/11 (división del código): cuentas chicas de Finanzas que usa también el arranque (api) y el listener de toques
import { NOW } from "./fechas.js";

// "2026-11" de "2026-11-11"
export const ymk = (date) => date.slice(0, 7);
// comisión que el cliente pagó en un turno de la app (no es del prestador)
export const feeOf = (booking) => booking.feeIn || 0;
// los años que se pueden elegir en Finanzas y en el balance del admin
export const YEARS = () => {
  const year = NOW().getFullYear();
  const years = [];
  for (let value = year - 1; value <= Math.max(2028, year); value++) {
    years.push(value);
  }
  return years;
};

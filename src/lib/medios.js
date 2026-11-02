// C25 (V4): medios de pago de lo que se cobra en el local (lo cargado sin turno y el resto de un turno). En la base:
// cash, transfer y mp (walkins.method, bookings.rest_method); en la app, su nombre.
export const MEDIOS = ["Efectivo", "Transferencia", "Mercado Pago"];
const TO_DB = { Efectivo: "cash", Transferencia: "transfer", "Mercado Pago": "mp" };
export const medioToDb = (medio) => TO_DB[medio] || "cash";
export const medioFromDb = (method) => Object.keys(TO_DB).find((key) => TO_DB[key] === method) || null;
export const medioIcon = (medio) => (medio === "Efectivo" ? "💵" : medio === "Transferencia" ? "🏦" : "📱");

// Montos y cantidades que escribe la gente en los formularios. Sin dependencias: lo prueba pruebas/unidad.mjs.
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

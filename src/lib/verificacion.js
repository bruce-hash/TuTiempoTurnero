import { LIVE } from "../config.js";
import { S } from "../state.js";

// Bloque D (D26): la verificación por DNI queda detrás de "Exigir DNI para aprobar prestadores" (app_settings.require_dni,
// hoy activada; S.requireDni la trae la base). Todo lo de la app que cambia con esa opción pregunta acá: si se deja de
// pedir el DNI, se apaga desde el panel admin y no hay que tocar código.
export const dniRequired = () => S.requireDni !== false;

// paso 2 del alta: con el DNI exigido, la identidad verificada; sin DNI, que TuTiempo haya aprobado el perfil
// (en vivo, el estado de su perfil lo trae my_provider_status; en la demo, el del prestador)
export function approved(prov) {
  if (prov.verified !== false) {
    return true;
  }
  return !dniRequired() && (LIVE ? S.provStatus : prov.status) === "active";
}

// lo que falta del DNI (número, frente, dorso), según my_dni_status
export function dniMissing(st) {
  st = st || {};
  return [
    ["number", "el número"],
    ["front", "la foto del frente"],
    ["back", "la del dorso"],
  ]
    .filter(([key]) => !st[key])
    .map(([, label]) => label);
}

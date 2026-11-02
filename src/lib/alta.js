import { S } from "../state.js";
import { ME, pr } from "./prestadores.js";
import { approved, dniMissing, dniRequired } from "./verificacion.js";

// Registrá tu negocio (ingreso y registro, aprobado el 1/11): los 5 pasos del alta y lo que le falta a un prestador para
// recibir reservas. Los pasos guardados los trae la base (my_setup → S.setupBy[pid]); un prestador sin datos de alta
// (los de antes de este bloque y los de ejemplo de la demo) ya está dado de alta: los 5 pasos hechos.
export const STEPS = ["Tu negocio", "Servicios", "Horarios", "Seña y cobro", "Verificación"];
export const setupOf = (pid = ME()) => (S.setupBy || {})[pid] || null;
export const stepsDone = (pid = ME()) => (setupOf(pid) ? setupOf(pid).steps || [] : [1, 2, 3, 4, 5]);
export const stepDone = (n, pid = ME()) => stepsDone(pid).includes(n);
// el primer paso sin guardar (null: los 5 hechos)
export const nextStep = (pid = ME()) => [1, 2, 3, 4, 5].find((n) => !stepDone(n, pid)) || null;
// adónde lleva "Registrá tu negocio" / "Seguir con el alta" a alguien con sesión
export function bizStartPath() {
  // D33: una cuenta de cliente elige antes si la usa para el negocio (si recién se creó para eso, va directo al paso 1)
  if (!S.barberAuth) {
    return S.bizNew ? "/registrar-negocio/1" : "/registrar-negocio";
  }
  const n = nextStep();
  return n ? "/registrar-negocio/" + n : "/panel/agenda";
}
export const mpConnected = () => S.mp === "ok";
// el DNI ya está (verificado, o con número y las dos fotos): en esta sesión (my_dni_status) o según la base (my_setup)
export function dniDone(pid = ME()) {
  const prov = pr(pid);
  const setup = setupOf(pid);
  return (!!prov && prov.verified !== false) || (!!setup && !!setup.dni_ok) || dniMissing(S.dniSt).length === 0;
}
// lo que falta para recibir reservas, en orden: [texto, hecho, acción]
export function setupTodo(pid = ME()) {
  const prov = pr(pid);
  if (!prov) {
    return [];
  }
  const items = [
    ["Tu negocio, servicios y horarios", [1, 2, 3].every((n) => stepDone(n, pid)), "biz"],
    ["Seña y plazo de acreditación", stepDone(4, pid), "biz"],
    ["Conectar Mercado Pago", mpConnected(), "mp"],
  ];
  const setup = setupOf(pid);
  // aprobado: con datos del alta, el estado del perfil (my_setup); si no, como hasta ahora (verificacion.js)
  const ok = setup && setup.status ? setup.status === "active" : approved(prov);
  if (dniRequired()) {
    items.push(["Verificación de DNI", ok || dniDone(pid), "dni"]);
  }
  items.push([ok ? "Aprobación de TuTiempo" : "Aprobación de TuTiempo (en revisión)", ok, "ok"]);
  return items;
}
// ¿ya puede recibir reservas? (alta completa, aprobado y con Mercado Pago)
export const setupComplete = (pid = ME()) => setupTodo(pid).every((item) => item[1]);

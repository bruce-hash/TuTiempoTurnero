// Ingreso y registro (rediseño aprobado el 1/11): la acción que pidió ingresar ("acción pendiente"). Ingresar no saca a
// nadie de lo que estaba haciendo: la ventana la muestra como un ticket y, al ingresar, sigue sola.
//   S.pending = { a, pid, svc, day, time, at }
//     a: "reservar" (un horario elegido), "seguir" (a un prestador), "lista" (avisarme si se libera un turno ese día)
//        o "negocio" (registrar un negocio)
//     pid, svc (clave del servicio, skey), day (AAAA-MM-DD), time (HH:MM): solo ids, nada personal
//     at: cuándo se pidió (vence a las 2 horas)
// Sobrevive a la vuelta de Google (sessionStorage, misma pestaña) y al link de confirmación del email, aunque se abra
// en otro navegador o en otro celular: viaja en los metadatos de la cuenta nueva (tt_pending) y se borra al usarla.
import { S } from "../state.js";

const KEY = "tt_pending";
const TTL_MS = 2 * 60 * 60 * 1000;
const KINDS = ["reservar", "seguir", "lista", "negocio"];

// solo lo que se espera, con el formato que se espera (viene de sessionStorage o de los metadatos de la cuenta)
export function cleanPending(raw) {
  if (!raw || typeof raw !== "object" || !KINDS.includes(raw.a)) {
    return null;
  }
  const at = +raw.at || 0;
  if (!at || Date.now() - at > TTL_MS || at > Date.now() + 60000) {
    return null;
  }
  const out = { a: raw.a, at };
  if (raw.a !== "negocio") {
    if (!/^\d{1,12}$/.test(String(raw.pid || ""))) {
      return null;
    }
    out.pid = +raw.pid;
  }
  if (raw.a === "reservar") {
    if (typeof raw.svc !== "string" || raw.svc.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(raw.day || "") || !/^\d{2}:\d{2}$/.test(raw.time || "")) {
      return null;
    }
    Object.assign(out, { svc: raw.svc, day: raw.day, time: raw.time });
  }
  if (raw.a === "lista") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.day || "")) {
      return null;
    }
    out.day = raw.day;
  }
  return out;
}
export function setPending(pending) {
  S.pending = cleanPending(Object.assign({ at: Date.now() }, pending));
  return S.pending;
}
export function clearPending() {
  S.pending = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch (err) {}
}
// antes de ir a Google (la página se recarga al volver)
export function stashPending() {
  try {
    if (S.pending) {
      sessionStorage.setItem(KEY, JSON.stringify(S.pending));
    } else {
      sessionStorage.removeItem(KEY);
    }
  } catch (err) {}
}
// al arrancar: la que quedó guardada antes de ir a Google
export function unstashPending() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) || "null");
    sessionStorage.removeItem(KEY);
    return cleanPending(raw);
  } catch (err) {
    return null;
  }
}

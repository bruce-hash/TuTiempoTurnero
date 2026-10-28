import { SUBMIT } from "./registro.js";
import { clearFieldError } from "../lib/sesion.js";

// último envío de cada formulario: un segundo envío en menos de 450 ms se ignora (doble toque)
const SUBMIT_AT = /* @__PURE__ */ new WeakMap();
document.addEventListener("submit", (ev) => {
  ev.preventDefault();
  {
    const now = Date.now();
    const last = SUBMIT_AT.get(ev.target);
    if (last && now - last < 450) {
      return;
    }
    SUBMIT_AT.set(ev.target, now);
  }
  const accion = SUBMIT.get(ev.target.id);
  if (accion) {
    accion(ev);
  }
});
// Bloque D: al corregir un campo con error, el error se va
document.addEventListener("input", (ev) => {
  if (ev.target.getAttribute && ev.target.getAttribute("aria-invalid") === "true") {
    clearFieldError(ev.target);
  }
});
document.addEventListener("change", (ev) => {
  if (ev.target.type === "checkbox" && ev.target.getAttribute("aria-invalid") === "true") {
    clearFieldError(ev.target);
  }
});

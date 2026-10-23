import { SUBMIT } from "./registro.js";

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

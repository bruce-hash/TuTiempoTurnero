import { SUBMIT } from "./registro.js";

const SUBMIT_AT = /* @__PURE__ */ new WeakMap();
document.addEventListener("submit", (e) => {
  e.preventDefault();
  {
    const a = Date.now();
    const t = SUBMIT_AT.get(e.target);
    if (t && a - t < 450) {
      return;
    }
    SUBMIT_AT.set(e.target, a);
  }
  const accion = SUBMIT.get(e.target.id);
  if (accion) {
    accion(e);
  }
});

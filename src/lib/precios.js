import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { pr } from "./prestadores.js";
import { cfg } from "./turnero.js";

// C52 (V8): los precios que ve el cliente no se quedan viejos si el prestador los cambia mientras mira su perfil o la
// confirmación del turno. El cobro siempre lo calcula la base (book_slot); esto es para que lo que se ve sea lo que se paga.
const VIEWS = ["perfil", "checkoutT"];

// lo que define el precio: servicios (precio, duración, adicionales), seña, happy hour y la comisión de TuTiempo
const priceSig = (pid) => {
  const prov = pr(pid);
  return JSON.stringify([prov ? prov.svcs : null, prov ? cfg(pid) : null, store.COMISION]);
};
// alguien escribiendo en un campo: no se vuelve a dibujar la pantalla (se perdería lo escrito); el control antes de
// pagar lo agarra igual
const typing = () => {
  const el = document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !!document.getElementById("app")?.contains(el);
};

// vuelve a pedir los datos del prestador que se está mirando; true si cambió algo que afecta el precio
export async function refreshPrices() {
  if (!LIVE || !S.pid || !VIEWS.includes(S.view)) {
    return false;
  }
  const pid = S.pid;
  const before = priceSig(pid);
  await Promise.all([api.loadProvider(pid, true), api.commission()]);
  return priceSig(pid) !== before;
}

// al volver a la pestaña y cada minuto mientras está a la vista
export function startPriceRefresh() {
  if (!LIVE) {
    return;
  }
  const tick = () => {
    if (document.visibilityState !== "visible") {
      return;
    }
    refreshPrices()
      .then((changed) => {
        if (changed && VIEWS.includes(S.view) && !typing()) {
          render();
        }
      })
      .catch(() => {});
  };
  document.addEventListener("visibilitychange", tick);
  setInterval(tick, 60000);
}

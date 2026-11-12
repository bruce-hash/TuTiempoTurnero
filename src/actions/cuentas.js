import { openAuth } from "./auth.js";
import { registerClick } from "./registro.js";
import { LIVE, sb } from "../config.js";
import { demoStash } from "../demo/usuarios.js";
import { setPending } from "../lib/pendiente.js";
import { pr } from "../lib/prestadores.js";
import { forgetPushHere } from "../lib/push.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { rememberOpener, returnFocus } from "../ui/ingreso.js";

// D33: lo que pasa cuando una cuenta de negocio intenta algo de cliente (reservar, seguir, avisarme): un aviso con la
// salida "Cerrar sesión e ingresar con otra cuenta". pending: la acción que intentaba (sigue después, con la otra cuenta).
export function blockBusiness(el, pending) {
  rememberOpener(el);
  S.bizBlock = { pending: pending || null };
  S.authModal = null;
  render();
  const btn = document.querySelector(".authmodal [data-act=bizSwitch]");
  if (btn) {
    btn.focus();
  }
}
// cerrar la sesión de este dispositivo (cliente, negocio o admin) sin cambiar de pantalla
export async function signOutHere() {
  if (LIVE) {
    await forgetPushHere().catch(() => {});
    await sb.auth.signOut().catch(() => {});
    store.BOOK = store.BOOK.filter((booking) => !booking.mine && booking.pid != S.me);
    const prov = pr(S.me);
    if (prov) {
      prov.full = 0;
    }
  } else {
    demoStash();
  }
  S.user = null;
  S.barberAuth = false;
  S.followingBy = {};
  S.bizNew = false;
  S.role = "cliente";
}
registerClick("bizBlockClose", (ev, el, act) => {
  S.bizBlock = null;
  render();
  returnFocus();
});
registerClick("bizSwitch", async (ev, el, act) => {
  const pending = S.bizBlock && S.bizBlock.pending;
  S.bizBlock = null;
  await signOutHere();
  if (pending) {
    setPending(pending);
  }
  openAuth(el, { keepPending: true });
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && S.bizBlock) {
    S.bizBlock = null;
    render();
    returnFocus();
  }
});

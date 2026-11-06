import { openAuth } from "./auth.js";
import { blockBusiness } from "./cuentas.js";
import { isBusiness } from "../lib/cuentas.js";
import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { FOLLOW, ME, isFol, pr } from "../lib/prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { profileUrl } from "../router.js";
import { toggleAccountMenu } from "../ui/menu-cuenta.js";
import { toast } from "../ui/toast.js";
import { comm, qrSheet } from "../views/prestador/comunidad.js";
import { IMAGO } from "../ui/iconos.js";

// “Volver al inicio” desde la pantalla de error
registerClick("recover", (ev, el, act) => {
  S.view = "home";
  S.role = S.barberAuth && S.role === "barbero" ? "barbero" : "cliente";
  S.preview = false;
  S.slot = null;
  S.list = null;
  S.btab = "agenda";
  render();
  window.scrollTo(0, 0);
  return;
});
// menú de cuenta de la cabecera (Bloque D)
registerClick("acctMenu", (ev, el, act) => {
  toggleAccountMenu(ev);
});
// desde el panel del prestador o el de TuTiempo: Mi perfil o Mis turnos, como cliente
registerClick("asClient", (ev, el, act) => {
  S.role = "cliente";
  S.preview = false;
  go(["misturnos", "home", "ajustes"].includes(el.dataset.to) ? el.dataset.to : "cuenta");
  window.scrollTo(0, 0);
});
registerClick("salirAdmin", (ev, el, act) => {
  S.role = "cliente";
  S.view = "home";
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("preview", (ev, el, act) => {
  S.preview = true;
  S.pid = ME();
  S.pctx = null;
  S.day = null;
  S.slot = null;
  S.svc = 0;
  render();
  window.scrollTo(0, 0);
});
registerClick("exitPreview", (ev, el, act) => {
  S.preview = false;
  render();
  window.scrollTo(0, 0);
});
registerClick("verPublicoLocal", (ev, el, act) => {
  S.preview = true;
  S.pid = ME();
  S.day = null;
  S.slot = null;
  render();
  window.scrollTo(0, 0);
});
registerClick("volver", (ev, el, act) => {
  go(S.prev || "home");
});
registerClick("toast", (ev, el, act) => {
  toast(el.dataset.msg);
});
registerClick("salirBarbero", (ev, el, act) => {
  if (LIVE) {
    sb.auth.signOut();
    S.user = null;
    store.BOOK = store.BOOK.filter((booking) => booking.pid != S.me);
    const prov = pr(S.me);
    if (prov) {
      prov.full = 0;
    }
  }
  S.barberAuth = false;
  S.role = "cliente";
  S.view = "home";
  toast("Cerraste sesión del panel");
  render();
  window.scrollTo(0, 0);
});
// seguir / dejar de seguir a un prestador (también lo usa la acción pendiente al ingresar)
export function setFollow(pid, on) {
  if (on === isFol(pid)) {
    return;
  }
  if (LIVE) {
    FOLLOW[pid] = on;
  } else {
    S.followingBy[pid] = on;
  }
  comm(pid).followers += on ? 1 : -1;
  api.m.follow(pid, on);
  toast(on ? "Ahora seguís a " + pr(pid).name + ". Te avisamos cuando tenga lugar." : "Dejaste de seguirlo");
}
registerClick("seguir", (ev, el, act) => {
  const pid = S.pid || ME();
  // sin sesión: la ventana de ingreso con el ticket "Seguir a…" (al ingresar queda hecho)
  if (!S.user && S.role !== "barbero") {
    openAuth(el, { pending: { a: "seguir", pid } });
    return;
  }
  // D33: una cuenta de negocio no sigue a otros negocios
  if (isBusiness()) {
    blockBusiness(el, { a: "seguir", pid });
    return;
  }
  setFollow(pid, !isFol(pid));
  render();
});
registerClick("copiarLink", (ev, el, act) => {
  const url = profileUrl(pr(ME()));
  try {
    navigator.clipboard.writeText(url).then(
      () => toast("Link copiado"),
      () => toast(url),
    );
  } catch (err) {
    toast(url);
  }
});
// C40 (V3b): la hoja del QR se agrega al final de la página, se imprime (ahí está "Guardar como PDF") y se saca
registerClick("qrPrint", (ev, el, act) => {
  document.querySelectorAll(".qrsheet").forEach((sheet) => sheet.remove());
  document.body.insertAdjacentHTML("beforeend", qrSheet(pr(ME()), IMAGO));
  document.body.classList.add("printing-qr");
  const done = () => {
    document.body.classList.remove("printing-qr");
    document.querySelectorAll(".qrsheet").forEach((sheet) => sheet.remove());
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
});
registerClick("verPublico", (ev, el, act) => {
  S.preview = true;
  S.pid = ME();
  render();
  window.scrollTo(0, 0);
});

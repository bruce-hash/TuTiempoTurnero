import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { FOLLOW, ME, isFol, pr } from "../lib/prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { profileUrl } from "../router.js";
import { toast } from "../ui/toast.js";
import { comm } from "../views/prestador/comunidad.js";

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
  S.blogin.fails = 0;
  S.blogin.locked = false;
  S.role = "cliente";
  S.view = "home";
  toast("Cerraste sesión del panel");
  render();
  window.scrollTo(0, 0);
});
registerClick("seguir", (ev, el, act) => {
  const pid = S.pid || ME();
  if (!S.user && S.role !== "barbero") {
    S.after = "perfil";
    go("login");
    return;
  }
  const on = !isFol(pid);
  if (LIVE) {
    FOLLOW[pid] = on;
  } else {
    S.followingBy[pid] = on;
  }
  comm(pid).followers += on ? 1 : -1;
  api.m.follow(pid, on);
  toast(on ? "Ahora seguís a " + pr(pid).name + ". Te avisamos cuando tenga lugar." : "Dejaste de seguirlo");
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
registerClick("verPublico", (ev, el, act) => {
  S.preview = true;
  S.pid = ME();
  render();
  window.scrollTo(0, 0);
});

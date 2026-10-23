import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { FOLLOW, ME, isFol, pr } from "../lib/prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { comm } from "../views/prestador/comunidad.js";

registerClick("recover", (e, x, v) => {
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
registerClick("salirAdmin", (e, x, v) => {
  S.role = "cliente";
  S.view = "home";
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("preview", (e, x, v) => {
  S.preview = true;
  S.pid = ME();
  S.pctx = null;
  S.day = null;
  S.slot = null;
  S.svc = 0;
  render();
  window.scrollTo(0, 0);
});
registerClick("exitPreview", (e, x, v) => {
  S.preview = false;
  render();
  window.scrollTo(0, 0);
});
registerClick("verPublicoLocal", (e, x, v) => {
  S.preview = true;
  S.pid = ME();
  S.day = null;
  S.slot = null;
  render();
  window.scrollTo(0, 0);
});
registerClick("volver", (e, x, v) => {
  go(S.prev || "home");
});
registerClick("toast", (e, x, v) => {
  toast(x.dataset.msg);
});
registerClick("salirBarbero", (e, x, v) => {
  if (LIVE) {
    sb.auth.signOut();
    S.user = null;
    store.BOOK = store.BOOK.filter((m) => m.pid != S.me);
    const r = pr(S.me);
    if (r) {
      r.full = 0;
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
registerClick("seguir", (e, x, v) => {
  const r = S.pid || ME();
  if (!S.user && S.role !== "barbero") {
    S.after = "perfil";
    go("login");
    return;
  }
  const m = !isFol(r);
  if (LIVE) {
    FOLLOW[r] = m;
  } else {
    S.followingBy[r] = m;
  }
  comm(r).followers += m ? 1 : -1;
  api.m.follow(r, m);
  toast(m ? "Ahora seguís a " + pr(r).name + ". Te avisamos cuando tenga lugar." : "Dejaste de seguirlo");
  render();
});
registerClick("copiarLink", (e, x, v) => {
  const r = "https://tutiempo.com.ar/" + (pr(ME()).slug || "p/" + ME());
  try {
    navigator.clipboard.writeText(r).then(
      () => toast("Link copiado"),
      () => toast(r),
    );
  } catch (m) {
    toast(r);
  }
});
registerClick("verPublico", (e, x, v) => {
  S.preview = true;
  S.pid = ME();
  render();
  window.scrollTo(0, 0);
});

import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { pr } from "../lib/prestadores.js";
import { saveAfter } from "../lib/sesion.js";
import { EMAIL } from "../lib/validar.js";
import { S } from "../state.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { useProvider } from "../views/prestador/panel.js";

registerClick("demoLogin", (e, x, v) => {
  const r = +x.dataset.id;
  useProvider(r);
  S.barberAuth = true;
  S.role = "barbero";
  S.btab = "agenda";
  S.pctx = null;
  S.edSvcs = null;
  toast("Entraste como " + pr(r).name);
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("googleProv", (e, x, v) => {
  if (LIVE) {
    saveAfter("panel");
    sb.auth
      .signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: location.origin + location.pathname,
        },
      })
      .then((r) => {
        if (r.error) {
          toast(errMsg(r.error));
        }
      });
    return;
  }
  useProvider(7);
  S.barberAuth = true;
  S.role = "barbero";
  S.btab = "agenda";
  S.pctx = null;
  toast("Entraste con Google como " + pr(7).name);
  render();
  window.scrollTo(0, 0);
});
registerClick("bShow", (e, x, v) => {
  S.blogin.email = $("#be").value;
  S.blogin.pass = $("#bp").value;
  S.blogin.show = !S.blogin.show;
  render();
});
registerClick("bRecover", (e, x, v) => {
  S.login = {
    mode: "forgot",
    email: (($("#be") || {}).value || S.blogin.email || "").trim(),
    err: "",
  };
  S.keepLogin = true;
  go("login");
});
registerClick("bBack", (e, x, v) => {
  S.blogin.step = "form";
  S.blogin.err = "";
  render();
});
registerSubmit("fRecover", (e) => {
  const a = $("#re").value.trim();
  S.blogin.email = a;
  if (!EMAIL.test(a)) {
    S.blogin.err = "Ingresá un email válido.";
    render();
    return;
  }
  if (LIVE) {
    sb.auth.resetPasswordForEmail(a, {
      redirectTo: location.origin + location.pathname,
    });
  }
  S.blogin.step = "sent";
  S.blogin.err = "";
  render();
  return;
});
registerSubmit("fBarb", (e) => {
  const a = S.blogin;
  a.email = $("#be").value.trim();
  a.pass = $("#bp").value;
  if (!a.email || !a.pass) {
    a.err = "Completá tu email y tu contraseña.";
    render();
    return;
  }
  if (!EMAIL.test(a.email)) {
    a.err = "Ese email no es válido.";
    render();
    return;
  }
  if (LIVE) {
    a.locked = true;
    render();
    sb.auth
      .signInWithPassword({
        email: a.email,
        password: a.pass,
      })
      .then(async (t) => {
        a.locked = false;
        if (t.error) {
          a.fails++;
          a.err = errMsg(t.error);
          a.pass = "";
          render();
          return;
        }
        await api.session();
        if (!S.barberAuth) {
          a.err = "Esta cuenta no tiene perfil de prestador. Registrate en “Sumate”.";
          render();
          return;
        }
        a.err = "";
        a.fails = 0;
        S.role = "barbero";
        S.btab = "agenda";
        toast("Bienvenido, " + pr(S.me).name);
        render();
        window.scrollTo(0, 0);
      })
      .catch((t) => {
        a.locked = false;
        a.err = errMsg(t);
        render();
      });
    return;
  }
  if (a.email.toLowerCase() === "sofia@tutiempo.demo" && a.pass === "prestador123") {
    a.err = "";
    a.fails = 0;
    useProvider(21);
    S.barberAuth = true;
    S.role = "barbero";
    S.btab = "agenda";
    S.pctx = null;
    toast("Bienvenida, Sofía");
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (a.email.toLowerCase() === "hidro.style@tutiempo.demo" && pr(7).deleted) {
    a.err = "Esta cuenta fue eliminada. Si querés volver, creá un perfil nuevo.";
    render();
    return;
  }
  if (a.email.toLowerCase() === "hidro.style@tutiempo.demo" && a.pass === "barbero123") {
    a.err = "";
    a.fails = 0;
    useProvider(7);
    S.pctx = null;
    S.barberAuth = true;
    S.role = "barbero";
    S.btab = "agenda";
    toast("Bienvenido, Hidro.Style");
    render();
    window.scrollTo(0, 0);
    return;
  }
  a.fails++;
  if (a.fails >= 5) {
    a.locked = true;
    a.err = "Demasiados intentos. Esperá 30 segundos o recuperá tu contraseña.";
    a.pass = "";
    render();
    setTimeout(() => {
      a.locked = false;
      a.fails = 0;
      a.err = "";
      if (S.view === "loginBarbero" && S.role === "cliente") {
        render();
      }
    }, 3e4);
    return;
  }
  a.err =
    a.email.toLowerCase() === "hidro.style@tutiempo.demo"
      ? `Contraseña incorrecta. Te quedan ${5 - a.fails} intentos.`
      : "No encontramos una cuenta con ese email.";
  a.pass = "";
  render();
  return;
});

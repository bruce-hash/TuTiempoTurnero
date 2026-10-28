import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { pr } from "../lib/prestadores.js";
import { rememberEmail, saveAfter, showFieldErrors } from "../lib/sesion.js";
import { EMAIL } from "../lib/validar.js";
import { S } from "../state.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { afterPanelLogin } from "../router.js";
import { useProvider } from "../views/prestador/panel.js";

registerClick("demoLogin", (ev, el, act) => {
  const pid = +el.dataset.id;
  useProvider(pid);
  S.barberAuth = true;
  S.role = "barbero";
  S.btab = "agenda";
  S.pctx = null;
  S.edSvcs = null;
  toast("Entraste como " + pr(pid).name);
  if (afterPanelLogin()) {
    return;
  }
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("googleProv", (ev, el, act) => {
  if (LIVE) {
    saveAfter("panel");
    sb.auth
      .signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: location.origin + "/",
        },
      })
      .then((res) => {
        if (res.error) {
          toast(errMsg(res.error));
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
  if (afterPanelLogin()) {
    return;
  }
  render();
  window.scrollTo(0, 0);
});
registerClick("bShow", (ev, el, act) => {
  S.blogin.email = $("#be").value;
  S.blogin.pass = $("#bp").value;
  S.blogin.show = !S.blogin.show;
  render();
});
registerClick("bRecover", (ev, el, act) => {
  S.login = {
    mode: "forgot",
    email: (($("#be") || {}).value || S.blogin.email || "").trim(),
    err: "",
  };
  S.keepLogin = true;
  go("login");
});
registerClick("bBack", (ev, el, act) => {
  S.blogin.step = "form";
  S.blogin.err = "";
  render();
});
registerSubmit("fRecover", (ev) => {
  const email = $("#re").value.trim();
  S.blogin.email = email;
  if (!EMAIL.test(email)) {
    S.blogin.err = "Ingresá un email válido.";
    render();
    return;
  }
  if (LIVE) {
    sb.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + "/",
    });
  }
  S.blogin.step = "sent";
  S.blogin.err = "";
  render();
  return;
});
// ingreso de prestadores. En vivo, Supabase Auth; en la demo, cuentas fijas (H18) y bloqueo de 30 s a los 5 intentos
registerSubmit("fBarb", (ev) => {
  const login = S.blogin;
  login.email = $("#be").value.trim();
  login.pass = $("#bp").value;
  // Bloque D: "Recordar mi email en este dispositivo" y los errores al lado de cada campo
  login.remember = !$("#be_rem") || $("#be_rem").checked;
  const keep = login.remember;
  if (!login.email || !login.pass) {
    return showFieldErrors({ be: login.email ? "" : "Escribí tu email.", bp: login.pass ? "" : "Escribí tu contraseña." }, "berr");
  }
  if (!EMAIL.test(login.email)) {
    return showFieldErrors({ be: "Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com" }, "berr");
  }
  rememberEmail(login.email, keep);
  if (LIVE) {
    login.locked = true;
    render();
    sb.auth
      .signInWithPassword({
        email: login.email,
        password: login.pass,
      })
      .then(async (res) => {
        login.locked = false;
        if (res.error) {
          login.fails++;
          login.err = errMsg(res.error);
          login.pass = "";
          render();
          return;
        }
        await api.session();
        if (!S.barberAuth) {
          login.err = "Esta cuenta no tiene perfil de prestador. Registrate en “Sumate”.";
          render();
          return;
        }
        login.err = "";
        login.fails = 0;
        S.role = "barbero";
        // primer ingreso (Bloque D): a Perfil, con los pasos para activar el perfil
        S.btab = S.firstPanel ? "perfil" : "agenda";
        S.firstPanel = false;
        toast("Bienvenido, " + pr(S.me).name);
        if (afterPanelLogin()) {
          return;
        }
        render();
        window.scrollTo(0, 0);
      })
      .catch((err) => {
        login.locked = false;
        login.err = errMsg(err);
        render();
      });
    return;
  }
  if (login.email.toLowerCase() === "sofia@tutiempo.demo" && login.pass === "prestador123") {
    login.err = "";
    login.fails = 0;
    useProvider(21);
    S.barberAuth = true;
    S.role = "barbero";
    S.btab = "agenda";
    S.pctx = null;
    toast("Bienvenida, Sofía");
    if (afterPanelLogin()) {
      return;
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (login.email.toLowerCase() === "filo@tutiempo.demo" && pr(7).deleted) {
    login.err = "Esta cuenta fue eliminada. Si querés volver, creá un perfil nuevo.";
    render();
    return;
  }
  if (login.email.toLowerCase() === "filo@tutiempo.demo" && login.pass === "barbero123") {
    login.err = "";
    login.fails = 0;
    useProvider(7);
    S.pctx = null;
    S.barberAuth = true;
    S.role = "barbero";
    S.btab = "agenda";
    toast("Bienvenido, " + pr(7).name);
    if (afterPanelLogin()) {
      return;
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  login.fails++;
  if (login.fails >= 5) {
    login.locked = true;
    login.err = "Demasiados intentos. Esperá 30 segundos o recuperá tu contraseña.";
    login.pass = "";
    render();
    setTimeout(() => {
      login.locked = false;
      login.fails = 0;
      login.err = "";
      if (S.view === "loginBarbero" && S.role === "cliente") {
        render();
      }
    }, 3e4);
    return;
  }
  login.err =
    login.email.toLowerCase() === "filo@tutiempo.demo"
      ? `Contraseña incorrecta. Te quedan ${5 - login.fails} intentos.`
      : "No encontramos una cuenta con ese email.";
  login.pass = "";
  render();
  return;
});

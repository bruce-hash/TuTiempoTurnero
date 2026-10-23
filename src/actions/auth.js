import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { afterLogin, authErr, goAfter, saveAfter } from "../lib/sesion.js";
import { EMAIL, PWRULE, pwOk, pwScore } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("google", (ev, el, act) => {
  if (LIVE) {
    saveAfter(S.after || "home");
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
  demoSignIn("juan.perez@gmail.com", "Juan Pérez");
  afterLogin();
});
registerClick("authMode", (ev, el, act) => {
  const email = (
    ($("#ai_e") || $("#au_e") || $("#af_e") || $("#le") || {}).value ||
    S.login.email ||
    ""
  ).trim();
  S.login = {
    mode: el.dataset.m,
    email: email,
    err: "",
    fails: S.login.fails || 0,
  };
  if (S.view !== "login" && S.view !== "register") {
    S.keepLogin = true;
    go("login");
    return;
  }
  render();
  const field = $("#ai_e,#au_n,#af_e,#le");
  if (field && !field.value) {
    field.focus();
  }
});
registerClick("pwShow", (ev, el, act) => {
  const input = document.getElementById(el.dataset.for);
  if (input) {
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    el.textContent = hidden ? "Ocultar" : "Mostrar";
  }
});
registerClick("demoRecoveryLink", (ev, el, act) => {
  S.recoverEmail = S.login.email.toLowerCase();
  S.npMode = "recover";
  go("newpass");
});
registerClick("resendConfirm", (ev, el, act) => {
  if (LIVE) {
    sb.auth
      .resend({
        type: "signup",
        email: S.login.email,
        options: {
          emailRedirectTo: location.origin + "/",
        },
      })
      .then((res) => toast(res.error ? errMsg(res.error) : "Te lo reenviamos a " + S.login.email));
  } else {
    toast("Te lo reenviamos a " + S.login.email);
  }
});
registerClick("loginBack", (ev, el, act) => {
  S.login = {
    mode: "code",
    email: S.login.email,
    err: "",
  };
  render();
});
registerClick("reenviar", (ev, el, act) => {
  S.login.err = "";
  if (LIVE) {
    sb.auth
      .signInWithOtp({
        email: S.login.email,
      })
      .then((res) => {
        if (res.error) {
          toast(errMsg(res.error));
        }
      });
  }
  toast("Te reenviamos el código a " + S.login.email);
  render();
});
// barra de fuerza de la contraseña mientras se escribe
registerInput(["au_p", "np1"], (ev) => {
  const score = pwScore(ev.target.value);
  const meter = $("#" + ev.target.id + "_m");
  if (meter) {
    meter.style.width = score * 25 + "%";
    meter.style.background = score < 2 ? "var(--bad)" : score < 3 ? "var(--warn)" : "var(--ok)";
  }
  const hint = $("#" + ev.target.id + "_h");
  if (hint) {
    hint.textContent =
      ev.target.value && pwOk(ev.target.value) ? (score >= 4 ? "Muy segura ✓" : "Segura ✓") : PWRULE;
  }
  return;
});
// ingreso con email y contraseña; 5 intentos fallidos bloquean 30 segundos
registerSubmit("fLogin", (ev) => {
  const login = S.login;
  const email = $("#ai_e").value.trim().toLowerCase();
  const pass = $("#ai_p").value;
  login.email = email;
  if (login.locked) {
    return;
  }
  if (!email || !pass) {
    return authErr("Completá tu email y tu contraseña.", email ? "ai_p" : "ai_e");
  }
  if (!EMAIL.test(email)) {
    return authErr("Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com", "ai_e");
  }
  const fail = (msg) => {
    login.fails = (login.fails || 0) + 1;
    if (login.fails >= 5) {
      login.locked = true;
      login.err = "Demasiados intentos. Esperá 30 segundos o recuperá tu contraseña.";
      render();
      setTimeout(() => {
        login.locked = false;
        login.fails = 0;
        login.err = "";
        if (S.view === "login") {
          render();
        }
      }, 3e4);
      return;
    }
    login.err = msg;
    render();
    const field = $("#ai_p");
    if (field) {
      field.focus();
    }
  };
  if (LIVE) {
    const btn = ev.target.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = true;
    }
    sb.auth
      .signInWithPassword({
        email: email,
        password: pass,
      })
      .then(async (res) => {
        if (res.error) {
          if (/Email not confirmed/.test(res.error.message || "")) {
            S.login = {
              mode: "confirm",
              email: email,
              err: "",
            };
            render();
            return;
          }
          return fail(errMsg(res.error));
        }
        await api.session();
        afterLogin();
      })
      .catch((err) => fail(errMsg(err)));
    return;
  }
  const user = store.DEMO_USERS[email];
  if (!user || user.pass !== pass) {
    return fail("Email o contraseña incorrectos.");
  }
  demoSignIn(email, user.name);
  afterLogin();
  return;
});
// recuperar contraseña: siempre dice “te mandamos el link” (salvo error de red o de límite), para no revelar
// qué emails tienen cuenta
registerSubmit("fForgot", (ev) => {
  const email = $("#af_e").value.trim().toLowerCase();
  S.login.email = email;
  if (!EMAIL.test(email)) {
    return authErr("Ingresá un email válido.", "af_e");
  }
  const showSent = () => {
    S.login = {
      mode: "sent",
      email: email,
      err: "",
    };
    render();
  };
  if (LIVE) {
    sb.auth
      .resetPasswordForEmail(email, {
        redirectTo: location.origin + "/",
      })
      .then((res) => {
        if (res.error && /rate|security purposes|Failed to fetch/i.test(res.error.message || "")) {
          return authErr(errMsg(res.error));
        }
        showSent();
      });
    return;
  }
  showSent();
  return;
});
registerSubmit("fMail", (ev) => {
  const email = $("#le").value.trim();
  S.login.email = email;
  if (!email) {
    S.login.err = "Ingresá tu email.";
    render();
    return;
  }
  if (!EMAIL.test(email)) {
    S.login.err = "Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com";
    render();
    return;
  }
  if (LIVE) {
    sb.auth
      .signInWithOtp({
        email: email,
        options: {
          shouldCreateUser: true,
        },
      })
      .then((res) => {
        if (res.error) {
          S.login.err = errMsg(res.error);
          render();
          return;
        }
        S.login = {
          mode: "codeSent",
          email: email,
          err: "",
        };
        toast("Código enviado a " + email);
        render();
      });
    return;
  }
  S.login = {
    mode: "codeSent",
    email: email,
    err: "",
  };
  toast("Código enviado a " + email);
  render();
  return;
});
// ingreso con código por email (en la demo el código es 123456)
registerSubmit("fCode", (ev) => {
  const code = $("#lc").value.replace(/\D/g, "");
  if (code.length !== 6) {
    S.login.err = "El código tiene 6 dígitos.";
    render();
    return;
  }
  if (LIVE) {
    sb.auth
      .verifyOtp({
        email: S.login.email,
        token: code,
        type: "email",
      })
      .then(async (res) => {
        if (res.error) {
          S.login.err = errMsg(res.error);
          render();
          return;
        }
        await api.session();
        S.login = {
          mode: "in",
          email: "",
          err: "",
        };
        toast("Ingresaste como " + S.user.name);
        goAfter();
      })
      .catch((err) => {
        S.login.err = errMsg(err);
        render();
      });
    return;
  }
  if (code !== "123456") {
    S.login.err = "Código incorrecto. Revisá el email o pedí uno nuevo.";
    render();
    return;
  }
  const name = S.login.email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  S.user = {
    name: name,
    email: S.login.email,
  };
  S.login = {
    mode: "in",
    email: "",
    err: "",
  };
  toast("Ingresaste como " + name);
  goAfter();
  return;
});

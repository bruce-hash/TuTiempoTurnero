import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { afterLogin, authErr, saveAfter } from "../lib/sesion.js";
import { EMAIL, PWRULE, pwOk, pwScore } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("google", (e, x, v) => {
  if (LIVE) {
    saveAfter(S.after || "home");
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
  demoSignIn("juan.perez@gmail.com", "Juan Pérez");
  afterLogin();
});
registerClick("authMode", (e, x, v) => {
  const r = (
    ($("#ai_e") || $("#au_e") || $("#af_e") || $("#le") || {}).value ||
    S.login.email ||
    ""
  ).trim();
  S.login = {
    mode: x.dataset.m,
    email: r,
    err: "",
    fails: S.login.fails || 0,
  };
  if (S.view !== "login" && S.view !== "register") {
    S.keepLogin = true;
    go("login");
    return;
  }
  render();
  const m = $("#ai_e,#au_n,#af_e,#le");
  if (m && !m.value) {
    m.focus();
  }
});
registerClick("pwShow", (e, x, v) => {
  const r = document.getElementById(x.dataset.for);
  if (r) {
    const m = r.type === "password";
    r.type = m ? "text" : "password";
    x.textContent = m ? "Ocultar" : "Mostrar";
  }
});
registerClick("demoRecoveryLink", (e, x, v) => {
  S.recoverEmail = S.login.email.toLowerCase();
  S.npMode = "recover";
  go("newpass");
});
registerClick("resendConfirm", (e, x, v) => {
  if (LIVE) {
    sb.auth
      .resend({
        type: "signup",
        email: S.login.email,
        options: {
          emailRedirectTo: location.origin + location.pathname,
        },
      })
      .then((r) => toast(r.error ? errMsg(r.error) : "Te lo reenviamos a " + S.login.email));
  } else {
    toast("Te lo reenviamos a " + S.login.email);
  }
});
registerClick("loginBack", (e, x, v) => {
  S.login = {
    mode: "code",
    email: S.login.email,
    err: "",
  };
  render();
});
registerClick("reenviar", (e, x, v) => {
  S.login.err = "";
  if (LIVE) {
    sb.auth
      .signInWithOtp({
        email: S.login.email,
      })
      .then((r) => {
        if (r.error) {
          toast(errMsg(r.error));
        }
      });
  }
  toast("Te reenviamos el código a " + S.login.email);
  render();
});
registerInput(["au_p", "np1"], (e) => {
  const a = pwScore(e.target.value);
  const t = $("#" + e.target.id + "_m");
  if (t) {
    t.style.width = a * 25 + "%";
    t.style.background = a < 2 ? "var(--bad)" : a < 3 ? "var(--warn)" : "var(--ok)";
  }
  const s = $("#" + e.target.id + "_h");
  if (s) {
    s.textContent =
      e.target.value && pwOk(e.target.value) ? (a >= 4 ? "Muy segura ✓" : "Segura ✓") : PWRULE;
  }
  return;
});
registerSubmit("fLogin", (e) => {
  const a = S.login;
  const t = $("#ai_e").value.trim().toLowerCase();
  const s = $("#ai_p").value;
  a.email = t;
  if (a.locked) {
    return;
  }
  if (!t || !s) {
    return authErr("Completá tu email y tu contraseña.", t ? "ai_p" : "ai_e");
  }
  if (!EMAIL.test(t)) {
    return authErr("Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com", "ai_e");
  }
  const n = (i) => {
    a.fails = (a.fails || 0) + 1;
    if (a.fails >= 5) {
      a.locked = true;
      a.err = "Demasiados intentos. Esperá 30 segundos o recuperá tu contraseña.";
      render();
      setTimeout(() => {
        a.locked = false;
        a.fails = 0;
        a.err = "";
        if (S.view === "login") {
          render();
        }
      }, 3e4);
      return;
    }
    a.err = i;
    render();
    const l = $("#ai_p");
    if (l) {
      l.focus();
    }
  };
  if (LIVE) {
    const i = e.target.querySelector("button[type=submit]");
    if (i) {
      i.disabled = true;
    }
    sb.auth
      .signInWithPassword({
        email: t,
        password: s,
      })
      .then(async (l) => {
        if (l.error) {
          if (/Email not confirmed/.test(l.error.message || "")) {
            S.login = {
              mode: "confirm",
              email: t,
              err: "",
            };
            render();
            return;
          }
          return n(errMsg(l.error));
        }
        await api.session();
        afterLogin();
      })
      .catch((l) => n(errMsg(l)));
    return;
  }
  const o = store.DEMO_USERS[t];
  if (!o || o.pass !== s) {
    return n("Email o contraseña incorrectos.");
  }
  demoSignIn(t, o.name);
  afterLogin();
  return;
});
registerSubmit("fForgot", (e) => {
  const a = $("#af_e").value.trim().toLowerCase();
  S.login.email = a;
  if (!EMAIL.test(a)) {
    return authErr("Ingresá un email válido.", "af_e");
  }
  const t = () => {
    S.login = {
      mode: "sent",
      email: a,
      err: "",
    };
    render();
  };
  if (LIVE) {
    sb.auth
      .resetPasswordForEmail(a, {
        redirectTo: location.origin + location.pathname,
      })
      .then((s) => {
        if (s.error && /rate|security purposes|Failed to fetch/i.test(s.error.message || "")) {
          return authErr(errMsg(s.error));
        }
        t();
      });
    return;
  }
  t();
  return;
});
registerSubmit("fMail", (e) => {
  const a = $("#le").value.trim();
  S.login.email = a;
  if (!a) {
    S.login.err = "Ingresá tu email.";
    render();
    return;
  }
  if (!EMAIL.test(a)) {
    S.login.err = "Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com";
    render();
    return;
  }
  if (LIVE) {
    sb.auth
      .signInWithOtp({
        email: a,
        options: {
          shouldCreateUser: true,
        },
      })
      .then((t) => {
        if (t.error) {
          S.login.err = errMsg(t.error);
          render();
          return;
        }
        S.login = {
          mode: "codeSent",
          email: a,
          err: "",
        };
        toast("Código enviado a " + a);
        render();
      });
    return;
  }
  S.login = {
    mode: "codeSent",
    email: a,
    err: "",
  };
  toast("Código enviado a " + a);
  render();
  return;
});
registerSubmit("fCode", (e) => {
  const a = $("#lc").value.replace(/\D/g, "");
  if (a.length !== 6) {
    S.login.err = "El código tiene 6 dígitos.";
    render();
    return;
  }
  if (LIVE) {
    sb.auth
      .verifyOtp({
        email: S.login.email,
        token: a,
        type: "email",
      })
      .then(async (n) => {
        if (n.error) {
          S.login.err = errMsg(n.error);
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
        const o = S.after || "home";
        S.after = null;
        go(o);
      })
      .catch((n) => {
        S.login.err = errMsg(n);
        render();
      });
    return;
  }
  if (a !== "123456") {
    S.login.err = "Código incorrecto. Revisá el email o pedí uno nuevo.";
    render();
    return;
  }
  const t = S.login.email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (n) => n.toUpperCase());
  S.user = {
    name: t,
    email: S.login.email,
  };
  S.login = {
    mode: "in",
    email: "",
    err: "",
  };
  toast("Ingresaste como " + t);
  const s = S.after || "home";
  S.after = null;
  go(s);
  return;
});

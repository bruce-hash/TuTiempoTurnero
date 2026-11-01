import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { captchaToken } from "../lib/captcha.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { RESEND_WAIT_MS, afterLogin, authErr, goAfter, rememberEmail, resendLeft, saveAfter, showFieldErrors, tickResend } from "../lib/sesion.js";
import { EMAIL, PWRULE, pwOk, pwScore } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { AUTH_PAGES, focusFirstField, rememberOpener, returnFocus } from "../ui/ingreso.js";
import { clearPending, setPending, stashPending } from "../lib/pendiente.js";
import { pr } from "../lib/prestadores.js";
import { useProvider } from "../views/prestador/panel.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// abre la ventana de ingreso. opts.mode: "in" (por defecto) o "up"; opts.pending: la acción que lo pidió (ticket).
// Sin acción pendiente, al ingresar queda la misma página (S.after "blando": el prestador va a su Agenda).
export function openAuth(el, opts = {}) {
  if (S.user) {
    go("cuenta");
    return;
  }
  if (opts.pending) {
    setPending(opts.pending);
  } else if (!opts.keepPending) {
    clearPending();
  }
  rememberOpener(el);
  S.login = { mode: opts.mode || "in", email: S.login.email || "", err: "", fails: S.login.fails || 0, locked: S.login.locked };
  if (AUTH_PAGES.includes(S.view)) {
    render();
    focusFirstField();
    return;
  }
  S.authModal = true;
  S.after = location.pathname + location.search;
  S.afterSoft = !opts.pending;
  render();
  focusFirstField();
}
const closeAuth = () => {
  S.authModal = null;
  S.after = null;
  S.afterSoft = false;
  clearPending();
  render();
  returnFocus();
};
registerClick("authOpen", (ev, el, act) => openAuth(el));
registerClick("authClose", (ev, el, act) => closeAuth());
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && S.authModal && document.querySelector(".authmodal")) {
    closeAuth();
  }
});
registerClick("google", (ev, el, act) => {
  if (LIVE) {
    // la vuelta de Google recarga la página: adónde volver y la acción pendiente quedan en esta pestaña
    saveAfter(S.after || "home", S.afterSoft || !S.after);
    stashPending();
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
  demoSignIn("juan.perez@tutiempo.demo", "Juan Pérez");
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
    locked: S.login.locked,
  };
  if (!AUTH_PAGES.includes(S.view) && !S.authModal) {
    S.keepLogin = true;
    go(el.dataset.m === "up" ? "register" : "login");
    return;
  }
  render();
  focusFirstField();
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
registerClick("resendConfirm", async (ev, el, act) => {
  // una vez por minuto (Supabase rechaza los repetidos): el botón muestra cuánto falta
  if (resendLeft(S.login.resendAt) > 0) {
    return;
  }
  let token;
  try {
    token = await captchaToken("resendConfirm");
  } catch (err) {
    return toast(errMsg(err));
  }
  S.login.resendAt = Date.now() + RESEND_WAIT_MS;
  render();
  tickResend();
  if (LIVE) {
    sb.auth
      .resend({
        type: "signup",
        email: S.login.email,
        options: {
          emailRedirectTo: location.origin + "/",
          captchaToken: token,
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
registerClick("reenviar", async (ev, el, act) => {
  if (resendLeft(S.login.resendAt) > 0) {
    return;
  }
  let token;
  try {
    token = await captchaToken("reenviar");
  } catch (err) {
    return toast(errMsg(err));
  }
  S.login.err = "";
  S.login.resendAt = Date.now() + RESEND_WAIT_MS;
  if (LIVE) {
    sb.auth
      .signInWithOtp({
        email: S.login.email,
        options: {
          shouldCreateUser: false,
          captchaToken: token,
        },
      })
      .then((res) => {
        if (res.error && !NO_ACCOUNT.test(res.error.message || res.error.code || "")) {
          toast(errMsg(res.error));
        }
      });
  }
  toast("Te reenviamos el código a " + S.login.email);
  render();
  tickResend();
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
// el mismo mensaje si el email no existe o la contraseña está mal (nadie puede averiguar qué emails tienen cuenta)
const BAD_LOGIN = "Email o contraseña incorrectos. Revisalos o entrá con un código.";
// demo: cuentas de ejemplo de prestadores (H18: nada de esto vale en vivo)
const DEMO_PROVIDERS = LIVE
  ? {}
  : { "filo@tutiempo.demo": { pass: "barbero123", pid: 7 }, "sofia@tutiempo.demo": { pass: "prestador123", pid: 21 } };
function demoProviderSignIn(email, pid) {
  demoSignIn(email, pr(pid).name);
  useProvider(pid);
  S.barberAuth = true;
  S.btab = "agenda";
  S.pctx = null;
}
if (!LIVE) {
  // demo: entrar como cualquier prestador de ejemplo (botones de la ventana de ingreso)
  registerClick("demoLogin", (ev, el, act) => {
    const pid = +el.dataset.id;
    useProvider(pid);
    S.barberAuth = true;
    S.btab = "agenda";
    S.pctx = null;
    S.authModal = null;
    S.after = null;
    S.afterSoft = false;
    toast("Entraste como " + pr(pid).name);
    goAfter();
  });
}
// ingreso con email y contraseña (clientes y prestadores); 5 intentos fallidos bloquean 30 segundos
registerSubmit("fLogin", (ev) => {
  const login = S.login;
  const email = $("#ai_e").value.trim().toLowerCase();
  const pass = $("#ai_p").value;
  // Bloque D: "Recordar mi email en este dispositivo" (marcada por defecto)
  const keep = !$("#ai_rem") || $("#ai_rem").checked;
  login.email = email;
  login.remember = keep;
  if (login.locked) {
    return;
  }
  if (!email || !pass) {
    return authErr("Completá tu email y tu contraseña.", email ? "ai_p" : "ai_e");
  }
  if (!EMAIL.test(email)) {
    return authErr("Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com", "ai_e");
  }
  // credenciales incorrectas: el error va debajo de la contraseña; otros (red, límite de Supabase), en el general
  const fail = (msg, onPassword) => {
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
    login.err = onPassword ? "" : msg;
    render();
    if (onPassword) {
      showFieldErrors({ ai_p: msg });
    } else if ($("#ai_p")) {
      $("#ai_p").focus();
    }
  };
  if (LIVE) {
    const btn = ev.target.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = true;
    }
    captchaToken("fLogin")
      .then((token) =>
        sb.auth.signInWithPassword({
          email: email,
          password: pass,
          options: {
            captchaToken: token,
          },
        }),
      )
      .then(async (res) => {
        if (res.error) {
          if (/Email not confirmed/.test(res.error.message || "")) {
            S.login = {
              mode: "confirm",
              email: email,
              err: "",
              resendAt: 0,
            };
            render();
            return;
          }
          const bad = /invalid login credentials/i.test(res.error.message || "");
          return fail(bad ? BAD_LOGIN : errMsg(res.error), bad);
        }
        rememberEmail(email, keep);
        await api.session();
        afterLogin();
      })
      .catch((err) => fail(errMsg(err)));
    return;
  }
  // demo: las cuentas de ejemplo de clientes y de prestadores entran por el mismo formulario
  const prov = DEMO_PROVIDERS[email];
  if (prov && prov.pass === pass && !pr(prov.pid).deleted) {
    rememberEmail(email, keep);
    demoProviderSignIn(email, prov.pid);
    afterLogin();
    return;
  }
  const user = store.DEMO_USERS[email];
  if (!user || user.pass !== pass) {
    return fail(BAD_LOGIN, true);
  }
  rememberEmail(email, keep);
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
    captchaToken("fForgot")
      .then((token) =>
        sb.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/",
          captchaToken: token,
        }),
      )
      .then((res) => {
        if (res.error && /rate|security purposes|captcha|Failed to fetch/i.test(res.error.message || "")) {
          return authErr(errMsg(res.error));
        }
        showSent();
      })
      .catch((err) => authErr(errMsg(err)));
    return;
  }
  showSent();
  return;
});
// lo que responde Supabase cuando el email no tiene cuenta y no se deja crear una (shouldCreateUser: false)
const NO_ACCOUNT = /signups not allowed|otp_disabled|user not found/i;
registerSubmit("fMail", (ev) => {
  const email = $("#le").value.trim();
  S.login.email = email;
  if (!email) {
    return showFieldErrors({ le: "Escribí tu email." }, "lerr");
  }
  if (!EMAIL.test(email)) {
    return showFieldErrors({ le: "Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com" }, "lerr");
  }
  const keep = !$("#le_rem") || $("#le_rem").checked;
  S.login.remember = keep;
  if (LIVE) {
    captchaToken("fMail")
      .then((token) =>
        sb.auth.signInWithOtp({
          email: email,
          options: {
            // solo para cuentas que ya existen: antes creaba una cuenta sin aceptar los términos
            shouldCreateUser: false,
            captchaToken: token,
          },
        }),
      )
      .then((res) => {
        // "no existe la cuenta" no se muestra: la pantalla es la misma exista o no
        if (res.error && !NO_ACCOUNT.test(res.error.message || res.error.code || "")) {
          S.login.err = errMsg(res.error);
          render();
          return;
        }
        rememberEmail(email, keep);
        S.login = {
          mode: "codeSent",
          email: email,
          err: "",
          resendAt: Date.now() + RESEND_WAIT_MS,
        };
        toast("Código enviado a " + email);
        render();
        tickResend();
      });
    return;
  }
  rememberEmail(email, keep);
  S.login = {
    mode: "codeSent",
    email: email,
    err: "",
    resendAt: Date.now() + RESEND_WAIT_MS,
  };
  toast("Código enviado a " + email);
  render();
  tickResend();
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
        afterLogin();
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
  if (DEMO_PROVIDERS[S.login.email.toLowerCase()]) {
    demoProviderSignIn(S.login.email.toLowerCase(), DEMO_PROVIDERS[S.login.email.toLowerCase()].pid);
  } else {
    demoSignIn(S.login.email, store.DEMO_USERS[S.login.email.toLowerCase()] ? null : name);
  }
  afterLogin();
  return;
});

import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb, sbScratch } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { captchaToken } from "../lib/captcha.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { RESEND_WAIT_MS, resendLeft, tickResend } from "../lib/sesion.js";
import { PWRULE, pwOk } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// 4/11 · Bloque 2: cambiar la contraseña desde Seguridad, en dos pasos.
//   1. Contraseña actual, nueva y repetida. La actual la comprueba Supabase Auth en un cliente aparte (sbScratch), que no
//      toca la sesión de la app; si está bien, Supabase manda el código de reautenticación al email (reauthenticate).
//   2. El código: updateUser con la contraseña nueva y el código (nonce). Con "Secure password change" prendido en
//      Supabase, la base de Auth exige el código si la sesión tiene más de 24 h; la app lo pide siempre.
const resetChange = () => {
  S.npStep = null;
  S.npNew = null;
  S.npResendAt = 0;
};
const sendCode = async () => {
  if (LIVE) {
    const res = await sb.auth.reauthenticate();
    if (res.error) {
      throw res.error;
    }
  }
  S.npResendAt = Date.now() + RESEND_WAIT_MS;
};
async function checkCurrent(email, password) {
  if (!LIVE) {
    const user = store.DEMO_USERS[email];
    return !user || user.pass === password;
  }
  const scratch = sbScratch();
  const res = await scratch.auth.signInWithPassword({ email, password, options: { captchaToken: await captchaToken("fNewPass") } });
  if (res.error) {
    if (/Invalid login credentials/i.test(res.error.message || "")) {
      return false;
    }
    throw res.error;
  }
  // esa sesión de prueba no sigue: se cierra solo ella (la de la app queda igual)
  await scratch.auth.signOut({ scope: "local" }).catch(() => {});
  return true;
}
async function startChange(ev) {
  const current = $("#np0").value;
  const pass = $("#np1").value;
  const showErr = (msg) => {
    $("#nperr").textContent = msg;
  };
  if (!current) {
    return showErr("Escribí tu contraseña actual.");
  }
  if (!pwOk(pass)) {
    return showErr("La contraseña nueva tiene que tener " + PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", ""));
  }
  if (pass !== $("#np2").value) {
    return showErr("Las contraseñas nuevas no coinciden.");
  }
  if (pass === current) {
    return showErr("La contraseña nueva tiene que ser distinta de la actual.");
  }
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    if (!(await checkCurrent(S.user.email, current))) {
      btn.disabled = false;
      return showErr("La contraseña actual no es correcta.");
    }
    await sendCode();
    S.npNew = pass;
    S.npStep = "code";
    render();
    tickResend();
    const field = $("#np_c");
    if (field) {
      field.focus();
    }
  } catch (err) {
    btn.disabled = false;
    showErr(errMsg(err));
  }
}
registerSubmit("fNewPassCode", (ev) => {
  const code = $("#np_c").value.replace(/\D/g, "");
  const showErr = (msg) => {
    $("#nperr").textContent = msg;
  };
  if (code.length !== 6) {
    return showErr("El código tiene 6 números.");
  }
  const btn = ev.target.querySelector("button[type=submit]");
  btn.disabled = true;
  const done = () => {
    resetChange();
    S.npMode = null;
    toast("Listo: tu contraseña cambió.");
    go("ajustes");
  };
  if (!LIVE) {
    if (code !== "123456") {
      btn.disabled = false;
      return showErr("El código no es correcto o venció. Revisalo o pedí uno nuevo.");
    }
    if (store.DEMO_USERS[S.user.email]) {
      store.DEMO_USERS[S.user.email].pass = S.npNew;
    }
    return done();
  }
  sb.auth
    .updateUser({ password: S.npNew, nonce: code })
    .then((res) => {
      if (res.error) {
        btn.disabled = false;
        return showErr(errMsg(res.error));
      }
      done();
    })
    .catch((err) => {
      btn.disabled = false;
      showErr(errMsg(err));
    });
});
registerClick("npResend", (ev, el, act) => {
  if (resendLeft(S.npResendAt) > 0) {
    return;
  }
  sendCode()
    .then(() => {
      toast("Te mandamos otro código a " + S.user.email);
      render();
      tickResend();
    })
    .catch((err) => toast(errMsg(err)));
});
registerClick("npCancel", (ev, el, act) => {
  resetChange();
  S.npMode = null;
  go("ajustes");
});

// guardar la contraseña nueva desde el link de recuperación (desde Seguridad: startChange, en dos pasos)
registerSubmit("fNewPass", (ev) => {
  if (S.npMode === "change" && S.user) {
    startChange(ev);
    return;
  }
  const pass = $("#np1").value;
  const pass2 = $("#np2").value;
  const showErr = (msg) => {
    $("#nperr").textContent = msg;
  };
  if (!pwOk(pass)) {
    return showErr(
      "La contraseña tiene que tener " +
        PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", ""),
    );
  }
  if (pass !== pass2) {
    return showErr("Las contraseñas no coinciden.");
  }
  const isChange = S.npMode === "change";
  if (LIVE) {
    const btn = ev.target.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = true;
    }
    sb.auth
      .updateUser({
        password: pass,
      })
      .then(async (res) => {
        if (res.error) {
          if (btn) {
            btn.disabled = false;
          }
          return showErr(errMsg(res.error));
        }
        S.recovering = false;
        S.npMode = null;
        if (!isChange) {
          await api.session();
        }
        toast(isChange ? "Contraseña cambiada." : "Listo, tu contraseña nueva quedó guardada.");
        go(isChange ? "cuenta" : "home");
      })
      .catch((err) => {
        if (btn) {
          btn.disabled = false;
        }
        showErr(errMsg(err));
      });
    return;
  }
  const email = S.user ? S.user.email : S.recoverEmail;
  if (store.DEMO_USERS[email]) {
    store.DEMO_USERS[email].pass = pass;
  }
  if (!S.user) {
    demoSignIn(email);
  }
  S.recoverEmail = null;
  S.npMode = null;
  toast(isChange ? "Contraseña cambiada." : "Listo, tu contraseña nueva quedó guardada.");
  go(isChange ? "cuenta" : "home");
  return;
});

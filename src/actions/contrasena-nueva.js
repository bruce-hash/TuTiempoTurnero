import { registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { PWRULE, pwOk } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// guardar la contraseña nueva (desde el link de recuperación o desde Mi perfil)
registerSubmit("fNewPass", (ev) => {
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

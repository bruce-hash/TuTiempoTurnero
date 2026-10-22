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

registerSubmit("fNewPass", (e) => {
  const a = $("#np1").value;
  const t = $("#np2").value;
  const s = (i) => {
    $("#nperr").textContent = i;
  };
  if (!pwOk(a)) {
    return s(
      "La contraseña tiene que tener " +
        PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", ""),
    );
  }
  if (a !== t) {
    return s("Las contraseñas no coinciden.");
  }
  const n = S.npMode === "change";
  if (LIVE) {
    const i = e.target.querySelector("button[type=submit]");
    if (i) {
      i.disabled = true;
    }
    sb.auth
      .updateUser({
        password: a,
      })
      .then(async (l) => {
        if (l.error) {
          if (i) {
            i.disabled = false;
          }
          return s(errMsg(l.error));
        }
        S.recovering = false;
        S.npMode = null;
        if (!n) {
          await api.session();
        }
        toast(n ? "Contraseña cambiada." : "Listo, tu contraseña nueva quedó guardada.");
        go(n ? "cuenta" : "home");
      })
      .catch((l) => {
        if (i) {
          i.disabled = false;
        }
        s(errMsg(l));
      });
    return;
  }
  const o = S.user ? S.user.email : S.recoverEmail;
  if (store.DEMO_USERS[o]) {
    store.DEMO_USERS[o].pass = a;
  }
  if (!S.user) {
    demoSignIn(o);
  }
  S.recoverEmail = null;
  S.npMode = null;
  toast(n ? "Contraseña cambiada." : "Listo, tu contraseña nueva quedó guardada.");
  go(n ? "cuenta" : "home");
  return;
});

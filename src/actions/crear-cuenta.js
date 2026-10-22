import { registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { afterLogin, authErr } from "../lib/sesion.js";
import { EMAIL, PWRULE, pwOk } from "../lib/validar.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";

registerSubmit("fSignup", (e) => {
  const a = $("#au_n").value.trim().replace(/\s+/g, " ");
  const t = $("#au_e").value.trim().toLowerCase();
  const s = $("#au_t").value.trim();
  const n = $("#au_p").value;
  const o = $("#au_p2").value;
  Object.assign(S.login, {
    nombre: a,
    email: t,
    tel: s,
  });
  if (a.length < 2 || !/[a-záéíóúñü]/i.test(a)) {
    return authErr("Escribí tu nombre.", "au_n");
  }
  if (!EMAIL.test(t)) {
    return authErr("Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com", "au_e");
  }
  if (s && !/^[+\d][\d\s()-]{7,19}$/.test(s)) {
    return authErr("Ese celular no parece válido. Ejemplo: 2284 123456.", "au_t");
  }
  if (!pwOk(n)) {
    return authErr(
      "La contraseña tiene que tener " +
        PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", ""),
      "au_p",
    );
  }
  if (n.toLowerCase().includes(t.split("@")[0]) && t.split("@")[0].length >= 4) {
    return authErr("La contraseña no puede contener tu email.", "au_p");
  }
  if (n !== o) {
    return authErr("Las contraseñas no coinciden.", "au_p2");
  }
  if (!$("#au_ok").checked) {
    return authErr(
      "Para crear la cuenta tenés que aceptar los términos y la política de privacidad.",
      "au_ok",
    );
  }
  if (LIVE) {
    const i = e.target.querySelector("button[type=submit]");
    if (i) {
      i.disabled = true;
    }
    sb.auth
      .signUp({
        email: t,
        password: n,
        options: {
          data: {
            full_name: a,
            phone: s || null,
          },
          emailRedirectTo: location.origin + location.pathname,
        },
      })
      .then(async (l) => {
        if (l.error) {
          if (i) {
            i.disabled = false;
          }
          return authErr(errMsg(l.error));
        }
        if (l.data && l.data.session) {
          await api.session();
          afterLogin();
          return;
        }
        S.login = {
          mode: "confirm",
          email: t,
          err: "",
        };
        render();
      })
      .catch((l) => {
        if (i) {
          i.disabled = false;
        }
        authErr(errMsg(l));
      });
    return;
  }
  if (store.DEMO_USERS[t]) {
    return authErr("Ese email ya tiene cuenta. Ingresá o recuperá tu contraseña.", "au_e");
  }
  store.DEMO_USERS[t] = {
    name: a,
    pass: n,
    tel: s,
  };
  demoSignIn(t, a);
  S.form.tel = s;
  afterLogin();
  return;
});

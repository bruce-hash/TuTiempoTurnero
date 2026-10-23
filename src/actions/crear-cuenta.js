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

// crear cuenta de cliente: valida y, en vivo, la crea en Supabase Auth (si pide confirmar el email, muestra
// ese paso); en la demo entra directo
registerSubmit("fSignup", (ev) => {
  const name = $("#au_n").value.trim().replace(/\s+/g, " ");
  const email = $("#au_e").value.trim().toLowerCase();
  const tel = $("#au_t").value.trim();
  const pass = $("#au_p").value;
  const pass2 = $("#au_p2").value;
  Object.assign(S.login, {
    nombre: name,
    email: email,
    tel: tel,
  });
  if (name.length < 2 || !/[a-záéíóúñü]/i.test(name)) {
    return authErr("Escribí tu nombre.", "au_n");
  }
  if (!EMAIL.test(email)) {
    return authErr("Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com", "au_e");
  }
  if (tel && !/^[+\d][\d\s()-]{7,19}$/.test(tel)) {
    return authErr("Ese celular no parece válido. Ejemplo: 2284 123456.", "au_t");
  }
  if (!pwOk(pass)) {
    return authErr(
      "La contraseña tiene que tener " +
        PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", ""),
      "au_p",
    );
  }
  if (pass.toLowerCase().includes(email.split("@")[0]) && email.split("@")[0].length >= 4) {
    return authErr("La contraseña no puede contener tu email.", "au_p");
  }
  if (pass !== pass2) {
    return authErr("Las contraseñas no coinciden.", "au_p2");
  }
  if (!$("#au_ok").checked) {
    return authErr(
      "Para crear la cuenta tenés que aceptar los términos y la política de privacidad.",
      "au_ok",
    );
  }
  if (LIVE) {
    const btn = ev.target.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = true;
    }
    sb.auth
      .signUp({
        email: email,
        password: pass,
        options: {
          data: {
            full_name: name,
            phone: tel || null,
          },
          emailRedirectTo: location.origin + "/",
        },
      })
      .then(async (res) => {
        if (res.error) {
          if (btn) {
            btn.disabled = false;
          }
          return authErr(errMsg(res.error));
        }
        if (res.data && res.data.session) {
          await api.session();
          afterLogin();
          return;
        }
        S.login = {
          mode: "confirm",
          email: email,
          err: "",
        };
        render();
      })
      .catch((err) => {
        if (btn) {
          btn.disabled = false;
        }
        authErr(errMsg(err));
      });
    return;
  }
  if (store.DEMO_USERS[email]) {
    return authErr("Ese email ya tiene cuenta. Ingresá o recuperá tu contraseña.", "au_e");
  }
  store.DEMO_USERS[email] = {
    name: name,
    pass: pass,
    tel: tel,
  };
  demoSignIn(email, name);
  S.form.tel = tel;
  afterLogin();
  return;
});

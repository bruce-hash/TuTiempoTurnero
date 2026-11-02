import { registerChange, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoSignIn } from "../demo/usuarios.js";
import { captchaToken } from "../lib/captcha.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { RESEND_WAIT_MS, afterLogin, authErr, showFieldErrors, tickResend } from "../lib/sesion.js";
import { EMAIL, PWRULE, pwOk } from "../lib/validar.js";
import { clearPending, setPending } from "../lib/pendiente.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";

// D32 (2/11): "Tengo un negocio y quiero recibir reservas". Prende o apaga la acción pendiente "negocio" (la misma que
// abre "Registrá tu negocio"): viaja a Google (sessionStorage) y al link del email (tt_pending) y, al terminar la
// cuenta, sigue a "Tu negocio". Lo ya escrito no se pierde (la contraseña tampoco, sin guardarla en S).
registerChange("au_biz", (ev) => {
  const pass = $("#au_p") ? $("#au_p").value : "";
  Object.assign(S.login, {
    nombre: $("#au_n") ? $("#au_n").value : S.login.nombre,
    email: $("#au_e") ? $("#au_e").value : S.login.email,
    tel: $("#au_t") ? $("#au_t").value : S.login.tel,
  });
  if (ev.target.checked) {
    setPending({ a: "negocio" });
  } else {
    clearPending();
  }
  render();
  if ($("#au_p")) {
    $("#au_p").value = pass;
  }
  const box = $("#au_biz");
  if (box) {
    box.focus();
  }
});
// crear cuenta de cliente: valida y, en vivo, la crea en Supabase Auth (si pide confirmar el email, muestra
// ese paso); en la demo entra directo
registerSubmit("fSignup", (ev) => {
  const name = $("#au_n").value.trim().replace(/\s+/g, " ");
  const email = $("#au_e").value.trim().toLowerCase();
  // "Registrá tu negocio" (paso 0) no pide el celular personal: el del negocio va en el paso 1
  const tel = $("#au_t") ? $("#au_t").value.trim() : "";
  const pass = $("#au_p").value;
  Object.assign(S.login, {
    nombre: name,
    email: email,
    tel: tel,
  });
  // Bloque D: todos los errores a la vez, cada uno al lado de su campo
  const errs = {};
  if (name.length < 2 || !/[a-záéíóúñü]/i.test(name)) {
    errs.au_n = "Escribí tu nombre y apellido.";
  }
  if (!EMAIL.test(email)) {
    errs.au_e = "Ese email no es válido. Revisalo, por ejemplo: nombre@gmail.com";
  }
  if (tel && !/^[+\d][\d\s()-]{7,19}$/.test(tel)) {
    errs.au_t = "Ese celular no parece válido. Ejemplo: 2284 123456.";
  }
  if (!pwOk(pass)) {
    errs.au_p = "La contraseña tiene que tener " + PWRULE.toLowerCase().replace("mínimo ", "al menos ").replace(".", "") + ".";
  } else if (pass.toLowerCase().includes(email.split("@")[0]) && email.split("@")[0].length >= 4) {
    errs.au_p = "La contraseña no puede contener tu email.";
  }
  if (!$("#au_ok").checked) {
    errs.au_ok = "Para crear la cuenta tenés que aceptar los términos y la política de privacidad.";
  }
  if (Object.keys(errs).length) {
    return showFieldErrors(errs);
  }
  if (LIVE) {
    const btn = ev.target.querySelector("button[type=submit]");
    if (btn) {
      btn.disabled = true;
    }
    // H30: con CAPTCHA, primero el token de Turnstile (sin CAPTCHA es undefined y la llamada queda igual)
    captchaToken("fSignup")
      .then((token) =>
        sb.auth.signUp({
          email: email,
          password: pass,
          options: {
            data: {
              full_name: name,
              phone: tel || null,
              // la acción pendiente (solo ids): si el link del email se abre en otro navegador, se retoma igual
              ...(S.pending ? { tt_pending: S.pending } : {}),
            },
            emailRedirectTo: location.origin + "/",
            captchaToken: token,
          },
        }),
      )
      .then(async (res) => {
        // un email que ya tiene cuenta ve lo mismo ("Revisá tu email"): desde afuera no se puede saber si existía
        if (res.error && !/already registered|already been registered|user_already_exists/i.test(res.error.message || res.error.code || "")) {
          if (btn) {
            btn.disabled = false;
          }
          return authErr(errMsg(res.error));
        }
        if (!res.error && res.data && res.data.session) {
          await api.session();
          afterLogin();
          return;
        }
        S.login = {
          mode: "confirm",
          email: email,
          err: "",
          // el email de activación acaba de salir: Reenviar se habilita en un minuto
          resendAt: Date.now() + RESEND_WAIT_MS,
        };
        render();
        tickResend();
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

import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { CATS } from "../lib/rubros.js";
import { cfg } from "../lib/turnero.js";
import { EMAIL } from "../lib/validar.js";
import { S } from "../state.js";
import { P, store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { useProvider } from "../views/prestador/panel.js";

async function liveRegister(e) {
  const a = $("#fPrest button[type=submit]");
  if (a) {
    a.disabled = true;
    a.textContent = "Creando tu cuenta…";
  }
  try {
    const t = {
      name: e.nombre,
      address: e.addr || "",
      categories: e.cats,
      phone: e.tel,
      dni: e.dni,
      instagram: null,
    };
    const s = await sb.auth.signUp({
      email: e.email,
      password: e.pass,
      options: {
        data: {
          full_name: e.nombre,
          provider_reg: t,
        },
        emailRedirectTo: location.origin + location.pathname,
      },
    });
    if (s.error) {
      throw s.error;
    }
    if (s.data.session) {
      await api.session();
      if (store.REGFILES.length) {
        await api.m.uploadDni(store.REGFILES);
      }
      S.reg = {};
      S.role = "barbero";
      S.btab = "perfil";
      toast("Cuenta creada. Completá tus servicios y conectá Mercado Pago.");
      render();
      window.scrollTo(0, 0);
      return;
    }
    S.reg = {
      done: true,
      nombre: e.nombre,
      email: e.email,
      confirm: true,
    };
    render();
    window.scrollTo(0, 0);
  } catch (t) {
    toast(errMsg(t));
    if (a) {
      a.disabled = false;
      a.textContent = "Crear cuenta de prestador";
    }
  }
}
export function readReg() {
  const e = (t) => ($("#" + t) || {}).value;
  const a = {};
  if ($("#pn")) {
    a.nombre = e("pn").trim();
    a.email = e("pe").trim();
    a.pass = e("pp");
    a.dni = e("pd").replace(/\D/g, "");
    a.addr = (e("pa") || "").trim();
    a.tel = (e("ptel") || "").trim();
    a.cats = CATS.map((t) => t[0]).filter((t) => $("#rr-" + t) && $("#rr-" + t).checked);
    a.tc = $("#ptc").checked;
  }
  return a;
}
store.REGFILES = [];
registerClick("regGoogle", (e, x, v) => {
  S.reg = Object.assign({}, S.reg, readReg(), {
    nombre: readReg().nombre || S.reg.nombre || "Barbería Don Pepe",
    email: "donpepe.barber@gmail.com",
    pass: "googleauth",
    errs: {},
  });
  toast("Datos completados con Google");
  render();
});
registerClick("regPanel", (e, x, v) => {
  const r = S.reg;
  const m = 100 + P.length;
  P.push({
    id: m,
    cats: r.cats && r.cats.length ? r.cats : ["b"],
    name: r.nombre || "Mi negocio",
    addr: r.addr || "",
    tel: r.tel || "",
    hue: (m * 47) % 360,
    verified: false,
    svcs: (r.cats && r.cats.length ? r.cats : ["b"]).map((f) => [
      {
        b: "Corte",
        p: "Corte y peinado",
        m: "Masaje",
        l: "Lifting de pestañas",
        u: "Esmaltado",
        d: "Depilación",
      }[f],
      30,
      1e4,
      f,
    ]),
  });
  useProvider(m);
  cfg(m).on = false;
  S.reg = {};
  S.barberAuth = true;
  S.role = "barbero";
  S.btab = "perfil";
  toast("Bienvenido. Completá tu perfil y conectá Mercado Pago.");
  render();
  window.scrollTo(0, 0);
});
registerChange("dniUp", (e) => {
  api.m
    .uploadDni([...e.target.files].slice(0, 4))
    .then(() => toast("Recibimos tu DNI. Te avisamos cuando esté verificado."))
    .catch(() => {});
  return;
});
registerSubmit("fPrest", (e) => {
  const a = Object.assign(S.reg, readReg());
  const t = {};
  if (!a.cats || !a.cats.length) {
    t.cats = "Elegí al menos un rubro.";
  }
  if (!a.nombre) {
    t.nombre = "Ingresá el nombre de tu negocio o tu nombre.";
  }
  if (!a.tel || a.tel.replace(/\D/g, "").length < 8) {
    t.tel = "Ingresá un celular válido.";
  }
  if (a.email) {
    if (!EMAIL.test(a.email)) {
      t.email = "Ese email no es válido.";
    }
  } else {
    t.email = "Ingresá tu email.";
  }
  if (!a.pass || a.pass.length < 8) {
    t.pass = "La contraseña debe tener al menos 8 caracteres.";
  }
  if (!/^\d{7,8}$/.test(a.dni || "")) {
    t.dni = "El DNI tiene que tener 7 u 8 números, sin puntos.";
  }
  if (!a.files) {
    t.files = "Subí la foto del DNI (frente y dorso).";
  }
  if (!a.tc) {
    t.tc = "Tenés que aceptar los términos para continuar.";
  }
  a.errs = t;
  if (Object.keys(t).length) {
    render();
    toast("Revisá los campos marcados");
    return;
  }
  if (LIVE) {
    liveRegister(a);
    return;
  }
  a.done = true;
  render();
  window.scrollTo(0, 0);
  return;
});

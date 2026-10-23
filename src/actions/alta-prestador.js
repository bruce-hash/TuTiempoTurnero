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

// alta en vivo: los datos del negocio viajan en provider_reg (metadatos de la cuenta) y session() crea el perfil
// en el primer ingreso. Si Supabase no pide confirmar el email, eso pasa acá mismo: entra al panel y sube el DNI.
async function liveRegister(reg) {
  const btn = $("#fPrest button[type=submit]");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Creando tu cuenta…";
  }
  try {
    const providerReg = {
      name: reg.nombre,
      address: reg.addr || "",
      categories: reg.cats,
      phone: reg.tel,
      dni: reg.dni,
      instagram: null,
    };
    const res = await sb.auth.signUp({
      email: reg.email,
      password: reg.pass,
      options: {
        data: {
          full_name: reg.nombre,
          provider_reg: providerReg,
        },
        emailRedirectTo: location.origin + "/",
      },
    });
    if (res.error) {
      throw res.error;
    }
    if (res.data.session) {
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
      nombre: reg.nombre,
      email: reg.email,
      confirm: true,
    };
    render();
    window.scrollTo(0, 0);
  } catch (err) {
    toast(errMsg(err));
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Crear cuenta de prestador";
    }
  }
}
// lee el formulario de alta
export function readReg() {
  const val = (id) => ($("#" + id) || {}).value;
  const reg = {};
  if ($("#pn")) {
    reg.nombre = val("pn").trim();
    reg.email = val("pe").trim();
    reg.pass = val("pp");
    reg.dni = val("pd").replace(/\D/g, "");
    reg.addr = (val("pa") || "").trim();
    reg.tel = (val("ptel") || "").trim();
    reg.cats = CATS.map((row) => row[0]).filter((cat) => $("#rr-" + cat) && $("#rr-" + cat).checked);
    reg.tc = $("#ptc").checked;
  }
  return reg;
}
store.REGFILES = [];
// demo: completa el formulario como si viniera de Google
registerClick("regGoogle", (ev, el, act) => {
  S.reg = Object.assign({}, S.reg, readReg(), {
    nombre: readReg().nombre || S.reg.nombre || "Barbería Don Pepe",
    email: "donpepe.barber@gmail.com",
    pass: "googleauth",
    errs: {},
  });
  toast("Datos completados con Google");
  render();
});
// demo: crea el prestador nuevo con un servicio por rubro y entra a su panel
registerClick("regPanel", (ev, el, act) => {
  const reg = S.reg;
  const id = 100 + P.length;
  P.push({
    id: id,
    cats: reg.cats && reg.cats.length ? reg.cats : ["b"],
    name: reg.nombre || "Mi negocio",
    addr: reg.addr || "",
    tel: reg.tel || "",
    hue: (id * 47) % 360,
    verified: false,
    svcs: (reg.cats && reg.cats.length ? reg.cats : ["b"]).map((cat) => [
      {
        b: "Corte",
        p: "Corte y peinado",
        m: "Masaje",
        l: "Lifting de pestañas",
        u: "Esmaltado",
        d: "Depilación",
      }[cat],
      30,
      1e4,
      cat,
    ]),
  });
  useProvider(id);
  cfg(id).on = false;
  S.reg = {};
  S.barberAuth = true;
  S.role = "barbero";
  S.btab = "perfil";
  toast("Bienvenido. Completá tu perfil y conectá Mercado Pago.");
  render();
  window.scrollTo(0, 0);
});
registerChange("dniUp", (ev) => {
  api.m
    .uploadDni([...ev.target.files].slice(0, 4))
    .then(() => toast("Recibimos tu DNI. Te avisamos cuando esté verificado."))
    .catch(() => {});
  return;
});
registerSubmit("fPrest", (ev) => {
  const reg = Object.assign(S.reg, readReg());
  const errs = {};
  if (!reg.cats || !reg.cats.length) {
    errs.cats = "Elegí al menos un rubro.";
  }
  if (!reg.nombre) {
    errs.nombre = "Ingresá el nombre de tu negocio o tu nombre.";
  }
  if (!reg.tel || reg.tel.replace(/\D/g, "").length < 8) {
    errs.tel = "Ingresá un celular válido.";
  }
  if (reg.email) {
    if (!EMAIL.test(reg.email)) {
      errs.email = "Ese email no es válido.";
    }
  } else {
    errs.email = "Ingresá tu email.";
  }
  if (!reg.pass || reg.pass.length < 8) {
    errs.pass = "La contraseña debe tener al menos 8 caracteres.";
  }
  if (!/^\d{7,8}$/.test(reg.dni || "")) {
    errs.dni = "El DNI tiene que tener 7 u 8 números, sin puntos.";
  }
  if (!reg.files) {
    errs.files = "Subí la foto del DNI (frente y dorso).";
  }
  if (!reg.tc) {
    errs.tc = "Tenés que aceptar los términos para continuar.";
  }
  reg.errs = errs;
  if (Object.keys(errs).length) {
    render();
    toast("Revisá los campos marcados");
    return;
  }
  if (LIVE) {
    liveRegister(reg);
    return;
  }
  reg.done = true;
  render();
  window.scrollTo(0, 0);
  return;
});

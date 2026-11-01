import { openAuth } from "./auth.js";
import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { bizStartPath, nextStep } from "../lib/alta.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { shrinkImage } from "../lib/imagenes.js";
import { parseWhole } from "../lib/montos.js";
import { setPending } from "../lib/pendiente.js";
import { ME, pr } from "../lib/prestadores.js";
import { CATS, catName } from "../lib/rubros.js";
import { R, cfg } from "../lib/turnero.js";
import { dniMissing, dniRequired } from "../lib/verificacion.js";
import { navigate } from "../router.js";
import { S } from "../state.js";
import { P } from "../store.js";
import { AUTH_PAGES, focusFirstField } from "../ui/ingreso.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { daysFromTemplate } from "../views/auth/negocio.js";
import { useProvider } from "../views/prestador/panel.js";

// Registrá tu negocio (ingreso y registro, aprobado el 1/11): las puertas ("Registrá tu negocio" en el inicio, el footer,
// el pie de Crear cuenta y el menú de un cliente) y los 5 pasos. Cada paso se guarda con las funciones que ya usa el
// panel (register_provider, saveProfile, saveSettings) y se marca en la base (setup_step).

const toStep = (n) => navigate("/registrar-negocio/" + n);
const mark = (n) => {
  const pid = ME();
  const setup = Object.assign({ steps: [] }, (S.setupBy || {})[pid]);
  setup.steps = [...new Set(setup.steps.concat(n))].sort();
  S.setupBy = Object.assign({}, S.setupBy, { [pid]: setup });
  return api.m.setupStep(n);
};
const fail = (errs, msg) => {
  S.biz.errs = errs;
  S.biz.err = msg || "Revisá lo marcado.";
  render();
  const first = document.querySelector(".biz-card .ferr");
  const field = first && document.getElementById(String(first.id).replace(/^berr-/, ""));
  if (field && field.focus) {
    field.focus();
  }
};
const busy = (on) => {
  const btn = document.querySelector(".biz-acts .btn-pri");
  if (btn) {
    btn.disabled = on;
  }
};

registerClick("bizStart", (ev, el, act) => {
  // sin sesión: el paso 0 (la cuenta personal) en la misma ventana; al ingresar sigue con el paso 1
  if (!S.user && !S.barberAuth) {
    if (S.authModal || AUTH_PAGES.includes(S.view)) {
      setPending({ a: "negocio" });
      S.login = { mode: "up", email: S.login.email || "", err: "", fails: S.login.fails || 0 };
      render();
      focusFirstField();
      return;
    }
    openAuth(el, { mode: "up", pending: { a: "negocio" } });
    return;
  }
  navigate(bizStartPath());
});
registerClick("bizGo", (ev, el, act) => toStep(+el.dataset.n));
registerClick("bizBack", (ev, el, act) => {
  S.biz = {};
  toStep(Math.max(1, (+S.bizStep || 2) - 1));
});

// ---------- Paso 1 · Tu negocio ----------
let photoFile = null;
registerChange("bphoto", (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) {
    return;
  }
  photoFile = file;
  S.biz.data = readStep1();
  S.biz.photoPreview = URL.createObjectURL(file);
  render();
});
function readStep1() {
  const val = (id) => (($("#" + id) || {}).value || "").trim();
  return {
    name: val("bn").replace(/\s+/g, " "),
    cats: CATS.map((row) => row[0]).filter((cat) => $("#bc-" + cat) && $("#bc-" + cat).checked),
    addr: val("ba"),
    tel: val("bt"),
    ig: val("bi").replace(/^@+/, "").slice(0, 60),
  };
}
async function uploadPhoto() {
  if (!photoFile) {
    return;
  }
  const file = photoFile;
  photoFile = null;
  try {
    const { blob, data } = await shrinkImage(file);
    pr(ME()).photo = LIVE ? await api.m.setProviderPhoto(blob) : data;
  } catch (err) {
    toast("Tu negocio quedó guardado, pero no pudimos subir la foto. Probá de nuevo desde Perfil.");
  }
}
registerSubmit("fBiz1", async (ev) => {
  const data = readStep1();
  S.biz.data = data;
  const errs = {};
  if (data.name.length < 2) {
    errs.bn = "Escribí el nombre de tu negocio.";
  }
  if (!data.cats.length) {
    errs.cats = "Elegí al menos un rubro.";
  }
  if (data.tel.replace(/\D/g, "").length < 8) {
    errs.bt = "Escribí un celular válido, por ejemplo 2284 123456.";
  }
  if (Object.keys(errs).length) {
    return fail(errs);
  }
  busy(true);
  try {
    if (!S.barberAuth) {
      // crea el negocio de esta cuenta (queda pendiente de aprobación)
      if (LIVE) {
        await api.m.registerBusiness(data);
        await api.session();
      } else {
        demoCreate(data);
      }
    } else {
      const prov = pr(ME());
      Object.assign(prov, { name: data.name.slice(0, 80), addr: data.addr.slice(0, 160), tel: data.tel, ig: data.ig, before: prov.svcs.map((svc) => svc.slice()) });
      const removedCats = prov.cats.filter((cat) => !data.cats.includes(cat));
      prov.cats = data.cats;
      // un rubro que se saca se lleva sus servicios (quedan inactivos, como en Perfil)
      const removed = prov.svcs.filter((svc) => removedCats.includes(svc[3])).map((svc) => svc[4]).filter(Boolean);
      prov.svcs = prov.svcs.filter((svc) => !removedCats.includes(svc[3]));
      if (LIVE) {
        await api.m.saveProfile(prov, removed);
      }
      await mark(1);
    }
    await uploadPhoto();
    S.biz = {};
    toStep(2);
  } catch (err) {
    busy(false);
    if (!err.__shown) {
      toast(errMsg(err));
    }
  }
});
// demo: el negocio nuevo, sin servicios todavía, pendiente de aprobación
function demoCreate(data) {
  const id = 100 + P.length;
  P.push({ id, cats: data.cats, name: data.name, addr: data.addr, tel: data.tel, ig: data.ig, hue: (id * 47) % 360, verified: false, status: "pending", svcs: [] });
  useProvider(id);
  cfg(id).on = false;
  S.barberAuth = true;
  S.setupBy = Object.assign({}, S.setupBy, { [id]: { steps: [1], status: "pending" } });
}

// ---------- Paso 2 · Servicios ----------
function readSvcRows() {
  const rows = S.biz.svcs || [];
  return rows.map((row, i) => {
    const name = ($("#bsn" + i) || { value: row[0] }).value.trim();
    const min = +($("#bsd" + i) || { value: row[1] }).value;
    const priceRaw = ($("#bsp" + i) || { value: row[2] }).value;
    const cat = ($("#bsc" + i) || { value: row[3] }).value;
    return [name, min, priceRaw, cat, row[4], row[5]];
  });
}
registerClick("bizEx", (ev, el, act) => {
  S.biz.svcs = readSvcRows().concat([[el.dataset.n, +el.dataset.d, "", el.dataset.c, null, null]]);
  render();
  const input = $("#bsp" + (S.biz.svcs.length - 1));
  if (input) {
    input.focus();
  }
});
registerClick("bizSvcAdd", (ev, el, act) => {
  const cats = pr(ME()).cats;
  S.biz.svcs = readSvcRows().concat([["", 30, "", cats[0], null, null]]);
  render();
  const input = $("#bsn" + (S.biz.svcs.length - 1));
  if (input) {
    input.focus();
  }
});
registerClick("bizSvcDel", (ev, el, act) => {
  const rows = readSvcRows();
  rows.splice(+el.dataset.i, 1);
  S.biz.svcs = rows;
  render();
});
registerSubmit("fBiz2", async (ev) => {
  const prov = pr(ME());
  const rows = readSvcRows();
  S.biz.svcs = rows;
  const errs = {};
  rows.forEach((row, i) => {
    if (row[0].length < 2) {
      errs["bsn" + i] = "Escribí el nombre del servicio.";
    }
    const price = parseWhole(String(row[2]).replace(/[$.\s]/g, ""));
    if (!(price > 0)) {
      errs["bsp" + i] = "Escribí el precio en pesos enteros, por ejemplo 12000.";
    }
  });
  if (!rows.length) {
    return fail({}, "Agregá al menos un servicio (tocá un ejemplo o “Agregar otro servicio”).");
  }
  if (Object.keys(errs).length) {
    return fail(errs);
  }
  const emptyCats = prov.cats.filter((cat) => !rows.some((row) => row[3] === cat));
  if (emptyCats.length) {
    return fail({}, `Agregá al menos un servicio de ${emptyCats.map(catName).join(", ")}.`);
  }
  busy(true);
  const before = prov.svcs.map((svc) => svc.slice());
  // [nombre, minutos, precio, rubro, id, meta]: los que ya existían conservan su id y sus adicionales
  const svcs = rows.map((row) => {
    const svc = [row[0].slice(0, 80), row[1], parseWhole(String(row[2]).replace(/[$.\s]/g, "")), row[3]];
    if (row[4] || row[5]) {
      svc[4] = row[4] || null;
    }
    if (row[5]) {
      svc[5] = row[5];
    }
    return svc;
  });
  const removed = before.map((svc) => svc[4]).filter((id) => id && !svcs.some((svc) => svc[4] === id));
  prov.svcs = svcs;
  prov.before = before;
  try {
    if (LIVE) {
      await api.m.saveProfile(prov, removed);
    }
    await mark(2);
    S.biz = {};
    toStep(3);
  } catch (err) {
    busy(false);
  }
});

// ---------- Paso 3 · Horarios ----------
function readDays() {
  const days = {};
  for (let dow = 0; dow < 7; dow++) {
    const on = !!($("#wd" + dow) || {}).checked;
    const t = !!($("#wt" + dow) || {}).checked;
    days[dow] = {
      on,
      m: [($("#wm" + dow + "f") || {}).value || "09:00", ($("#wm" + dow + "t") || {}).value || "18:00"],
      t: t ? [($("#wt" + dow + "f") || {}).value || "16:00", ($("#wt" + dow + "t") || {}).value || "20:00"] : null,
    };
  }
  return days;
}
registerClick("bizTpl", (ev, el, act) => {
  S.biz.tpl = el.dataset.k;
  // "Armarlo día por día" deja lo que había para editarlo
  S.biz.days = el.dataset.k === "dd" ? readDays() : daysFromTemplate(el.dataset.k);
  render();
});
document.addEventListener("change", (ev) => {
  if (ev.target && /^w[dt]\d$/.test(ev.target.id) && ev.target.closest("#fBiz3")) {
    S.biz.days = readDays();
    S.biz.tpl = "dd";
    render();
  }
});
registerSubmit("fBiz3", async (ev) => {
  const days = readDays();
  S.biz.days = days;
  const errs = {};
  const open = Object.keys(days).filter((dow) => days[dow].on);
  open.forEach((dow) => {
    const day = days[dow];
    if (!(day.m[0] < day.m[1])) {
      errs["d" + dow] = "El horario tiene que terminar después de empezar.";
    } else if (day.t && !(day.m[1] <= day.t[0] && day.t[0] < day.t[1])) {
      errs["d" + dow] = "El segundo horario tiene que empezar después del primero y terminar después de empezar.";
    }
  });
  if (!open.length) {
    return fail({ days: "Abrí al menos un día." });
  }
  if (Object.keys(errs).length) {
    return fail(errs);
  }
  busy(true);
  const conf = cfg(ME());
  for (let dow = 0; dow < 7; dow++) {
    const day = days[dow];
    conf.days[dow] = {
      on: day.on,
      m: R(day.on, day.m[0], day.m[1]),
      t: day.t ? R(day.on, day.t[0], day.t[1]) : R(false, "16:00", "20:00"),
    };
  }
  try {
    await api.m.saveSettings(conf);
    await mark(3);
    S.biz = {};
    toStep(4);
  } catch (err) {
    busy(false);
  }
});

// ---------- Paso 4 · Seña y cobro ----------
registerClick("bizPay", (ev, el, act) => {
  S.biz.pay = el.dataset.v;
  render();
});
registerClick("bizTerm", (ev, el, act) => {
  S.biz.term = el.dataset.v;
  render();
});
async function saveStep4() {
  const conf = cfg(ME());
  const pay = S.biz.pay || (conf.pay === "total" ? "total" : String(conf.pct || 50));
  conf.pay = pay === "total" ? "total" : "sena";
  if (pay !== "total") {
    conf.pct = +pay;
  }
  conf.term = S.biz.term || conf.term || "instant";
  await api.m.saveSettings(conf);
  await mark(4);
}
// conectar Mercado Pago sale de la app: primero se guarda lo elegido (al volver sigue en la Agenda, con lo que falta)
registerClick("bizMp", async (ev, el, act) => {
  el.disabled = true;
  try {
    await saveStep4();
    if (LIVE) {
      await api.m.mpConnect();
      return;
    }
    S.mp = "ok";
    toast("Mercado Pago conectado (demo)");
    render();
  } catch (err) {
    el.disabled = false;
    if (!err.__shown) {
      toast(errMsg(err));
    }
  }
});
registerClick("bizNext", async (ev, el, act) => {
  busy(true);
  try {
    await saveStep4();
    S.biz = {};
    toStep(5);
  } catch (err) {
    busy(false);
  }
});

// ---------- Paso 5 · Verificación ----------
registerClick("bizFinish", async (ev, el, act) => {
  if (dniRequired()) {
    const missing = dniMissing(S.dniSt);
    if (missing.length) {
      return fail({}, `Para enviarlo falta ${missing.join(", ").replace(/, ([^,]*)$/, " y $1")}. Si no lo tenés a mano, podés seguir después: queda guardado.`);
    }
  }
  busy(true);
  try {
    await mark(5);
    S.biz = {};
    if (!nextStep()) {
      navigate("/registrar-negocio/listo");
    } else {
      toStep(nextStep());
    }
  } catch (err) {
    busy(false);
  }
});

// Enrutador (Bloque B) · de la dirección al estado: al abrir una URL (carga, recarga o atrás/adelante) arma S con la
// pantalla, el prestador, la pestaña, el horario elegido… Si la pantalla pide sesión y no la hay, va al ingreso y
// guarda adónde volver.
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { ME, pr } from "../lib/prestadores.js";
import { CAT_SLUGS } from "../lib/rubros.js";
import { isReservedSlug } from "../lib/rutas.js";
import { selDur } from "../lib/servicios.js";
import { slotsFor } from "../lib/turnero.js";
import { S } from "../state.js";
import { P, store } from "../store.js";
import { svcByKey } from "../ui/sellos.js";
import { toast } from "../ui/toast.js";
import { setBtab } from "../views/prestador/panel.js";
import { ADMIN_TABS, PANEL_TABS, PROFILE_TABS, keyOf } from "./direcciones.js";

const safePath = (value) => (typeof value === "string" && /^\/(?!\/)/.test(value) && !/[\\\s]/.test(value) ? value : null);

function resetTransient() {
  S.story = null;
  S.cli = null;
  S.preview = false;
  S.cancelAsk = false;
  S.delAsk = null;
  S.notFound = null;
  S.rewardFor = null;
}
function showClient(view) {
  if (S.view !== view) {
    S.prev = S.view;
  }
  S.role = "cliente";
  S.view = view;
  if (view !== "turnoOk") {
    S.justBooked = false;
  }
}
function showNotFound(path) {
  showClient("notfound");
  S.notFound = path;
}
function showLogin(back, mode = "in") {
  S.after = back;
  S.login = { mode, email: "", err: "" };
  showClient(mode === "up" ? "register" : "login");
}
// pantallas que piden sesión de cliente: sin sesión, al ingreso (y después vuelve a `path`)
function needUser(path) {
  if (S.user) {
    return true;
  }
  showLogin(path);
  return false;
}
function setStory(params, pid) {
  const index = params.get("historia");
  if (index != null && /^\d{1,3}$/.test(index)) {
    S.story = { pid, i: +index };
  }
}
async function openProfile(pid, parts, params, path) {
  // En vivo no se puede mover un turno (no hay función en la base: F02). Un link viejo con ?reprogramar=<id> lleva al
  // detalle de ese turno, sin modo "Cambiar" (que reservaba y cobraba otro turno dejando el original).
  const moving = params.get("reprogramar");
  if (LIVE && moving != null) {
    if (/^\d{1,12}$/.test(moving) && needUser("/turno/" + moving)) {
      S.turnoId = +moving;
      S.justBooked = false;
      showClient("turnoOk");
    } else if (!/^\d{1,12}$/.test(moving)) {
      showClient("home");
    }
    return;
  }
  if (S.pid !== pid) {
    S.svc = 0;
    S.day = null;
    S.slot = null;
    S.adds = [];
    S.intake = {};
    S.pctx = null;
  }
  S.pid = pid;
  const reprog = params.get("reprogramar");
  // mover un turno existente es solo de la demo y de un turno confirmado (en vivo, ver arriba)
  S.reprog = reprog && store.BOOK.some((booking) => booking.mine && booking.id == reprog && booking.status === "confirmed") ? +reprog : null;
  const sub = parts[1];
  if (parts.length > 2 || (sub && sub !== "reservar" && !keyOf(PROFILE_TABS, sub))) {
    return showNotFound(path);
  }
  if (sub === "reservar") {
    return openCheckout(pid, params, path);
  }
  S.ptab = keyOf(PROFILE_TABS, sub) || "svc";
  showClient("perfil");
  setStory(params, pid);
}
// /<slug>/reservar?servicio=&dia=&hora=: si el horario ya no está libre, vuelve al perfil
async function openCheckout(pid, params, path) {
  if (!needUser(path)) {
    return;
  }
  let prov = pr(pid);
  if (LIVE && (!prov || !prov.full)) {
    prov = await api.loadProvider(pid).catch(() => null);
  }
  const svc = prov && svcByKey(prov, params.get("servicio"));
  const day = params.get("dia");
  const time = params.get("hora");
  S.ptab = "svc";
  if (!svc || !/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !/^\d{2}:\d{2}$/.test(time || "")) {
    return showClient("perfil");
  }
  S.svc = prov.svcs.indexOf(svc);
  S.day = day;
  const free = slotsFor(pid, day, selDur(prov), S.reprog).list.some((slot) => slot.free && slot.time === time);
  if (!free) {
    S.slot = null;
    showClient("perfil");
    toast("Ese horario ya no está libre. Elegí otro.");
    return;
  }
  S.slot = { date: day, time };
  showClient("checkoutT");
}
function openPanel(parts, params, path) {
  if (!S.barberAuth) {
    if (S.user && LIVE) {
      toast("Esa cuenta todavía no tiene perfil de prestador. Podés sumarte desde “Sumate”.");
      return showClient("home");
    }
    S.after = path;
    Object.assign(S.blogin, { step: "form", err: "", show: false });
    return showClient("loginBarbero");
  }
  const word = parts[1] || "agenda";
  if (parts.length > 2) {
    return showNotFound(path);
  }
  S.role = "barbero";
  if (word === "vista-previa") {
    S.preview = true;
    S.pid = ME();
    S.pctx = null;
    S.day = null;
    S.slot = null;
    S.svc = 0;
    return;
  }
  const tab = keyOf(PANEL_TABS, word);
  if (!tab) {
    return showNotFound(path);
  }
  if (tab !== S.btab) {
    setBtab(tab);
  }
  // Bloque C: desde la notificación de una reserva, la Agenda en ese día (/panel/agenda?dia=AAAA-MM-DD)
  const day = params.get("dia");
  if (tab === "agenda" && /^\d{4}-\d\d-\d\d$/.test(day || "")) {
    S.aday = day;
    S.awk = null;
  }
  const clientId = params.get("cliente");
  if (tab === "clientes" && clientId) {
    const name = Object.keys(store.CLIENTS).find((key) => String(store.CLIENTS[key].id) === clientId);
    if (name) {
      S.cli = name;
    }
  }
  setStory(params, ME());
}
function openAdmin(parts, path) {
  if (LIVE && !S.user) {
    return showLogin(path);
  }
  if (LIVE && !S.isAdmin) {
    return showNotFound(path);
  }
  const tab = keyOf(ADMIN_TABS, parts[1] || "resumen");
  const period = parts[2];
  if (!tab || parts.length > 3 || (period && (tab !== "bal" || !/^\d{4}(-\d{2})?$/.test(period)))) {
    return showNotFound(path);
  }
  S.role = "admin";
  S.admT = tab;
  S.admOpen = null;
  S.admDel = null;
  if (tab === "bal") {
    S.admY = period ? +period.slice(0, 4) : S.admY;
    S.admM = period && period.length === 7 ? period : null;
  }
}

export async function applyUrl(href) {
  const url = new URL(href, location.origin);
  const params = url.searchParams;
  const path = url.pathname + url.search;
  let parts;
  try {
    parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch (err) {
    parts = ["\u0000"];
  }
  const first = (parts[0] || "").toLowerCase();
  resetTransient();
  const single = (view) => (parts.length === 1 ? showClient(view) : showNotFound(path));
  switch (first) {
    case "":
      S.cat = "todos";
      S.q = "";
      S.reprog = null;
      return showClient("home");
    case "rubro": {
      const cat = keyOf(CAT_SLUGS, parts[1]);
      if (!cat || parts.length !== 2) {
        return showNotFound(path);
      }
      S.cat = cat;
      S.q = "";
      return showClient("home");
    }
    case "buscar": {
      const cat = keyOf(CAT_SLUGS, params.get("rubro"));
      S.q = (params.get("q") || "").trim().slice(0, 60);
      S.cat = cat || "todos";
      return parts.length === 1 ? showClient("home") : showNotFound(path);
    }
    case "turno":
      if (parts.length !== 2 || !/^\d{1,12}$/.test(parts[1])) {
        return showNotFound(path);
      }
      if (needUser(path)) {
        S.turnoId = +parts[1];
        S.justBooked = false;
        showClient("turnoOk");
      }
      return;
    case "mis-turnos":
    case "cuenta":
      if (parts.length !== 1) {
        return showNotFound(path);
      }
      if (needUser(path)) {
        showClient(first === "cuenta" ? "cuenta" : "misturnos");
      }
      return;
    case "ingresar":
    case "crear-cuenta": {
      const back = safePath(params.get("volver"));
      if (parts.length !== 1) {
        return showNotFound(path);
      }
      if (S.user) {
        // ya ingresó (por ejemplo, recargó el ingreso): directo adonde iba, o a su perfil
        return back ? applyUrl(back) : showClient("cuenta");
      }
      return showLogin(back, first === "crear-cuenta" ? "up" : "in");
    }
    case "nueva-contrasena":
      if (S.user && !S.recovering) {
        S.npMode = "change";
      }
      return single("newpass");
    case "prestadores": {
      if (parts[1] !== "ingresar" || parts.length !== 2) {
        return showNotFound(path);
      }
      const back = safePath(params.get("volver"));
      if (S.barberAuth) {
        return applyUrl(back && back.startsWith("/panel") ? back : "/panel/agenda");
      }
      S.after = back;
      Object.assign(S.blogin, { step: "form", err: "", show: false });
      return showClient("loginBarbero");
    }
    case "sumate":
      if (S.reg.done) {
        S.reg = {};
      }
      return single("prestador");
    case "terminos":
      return single("terminos");
    case "panel":
      return openPanel(parts, params, path);
    case "admin":
      return openAdmin(parts, path);
    case "p":
      if (!/^\d{1,12}$/.test(parts[1] || "")) {
        return showNotFound(path);
      }
      return openProfile(+parts[1], parts.slice(1), params, path);
    default: {
      // una palabra reservada nunca es un perfil, aunque algún prestador tenga ese slug
      if (isReservedSlug(first)) {
        return showNotFound(path);
      }
      const known = P.find((prov) => prov.slug === first);
      const pid = known ? known.id : await api.providerIdBySlug(first).catch(() => null);
      if (!pid) {
        return showNotFound(path);
      }
      return openProfile(pid, parts, params, path);
    }
  }
}

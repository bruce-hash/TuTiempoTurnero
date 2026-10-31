// Enrutador (Bloque B) · del estado a la dirección: qué URL, qué título y qué descripción corresponden a la pantalla
// que muestra S. La usan syncUrl() (src/router.js) y los links para compartir.
import { LIVE } from "../config.js";
import { pr } from "../lib/prestadores.js";
import { CAT_SLUGS, catInfo, pcat } from "../lib/rubros.js";
import { isReservedSlug } from "../lib/rutas.js";
import { skey } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { BTABS } from "../views/prestador/panel.js";

const CITY_NAME = "Olavarría";
const SITE = "TuTiempo";
const HOME_TITLE = "TuTiempo · Turnos online en Olavarría";
// pestañas del panel, del admin y del perfil: id en el estado ↔ palabra en la URL
export const PANEL_TABS = {
  agenda: "agenda",
  caja: "caja",
  finanzas: "finanzas",
  clientes: "clientes",
  productos: "productos",
  horarios: "horarios",
  stats: "estadisticas",
  comunidad: "trabajos",
  perfil: "perfil",
};
export const ADMIN_TABS = { res: "resumen", prov: "prestadores", bal: "balance", com: "comision" };
export const ADMIN_LABELS = { res: "Resumen", prov: "Prestadores", bal: "Balance", com: "Comisión" };
export const PROFILE_TABS = { works: "trabajos", reviews: "resenas" };
export const keyOf = (map, word) => Object.keys(map).find((key) => map[key] === word);
// descripción de la página de inicio (la del index.html), para las pantallas que no tienen una propia
export const META = { homeDesc: "" };

// ---------- Del estado a la URL ----------
// perfil de un prestador: /<slug>, o /p/<id> si todavía no se sabe el slug o es una palabra reservada
export function profilePath(prov, pid) {
  return prov && prov.slug && !isReservedSlug(prov.slug) ? "/" + prov.slug : "/p/" + (prov ? prov.id : pid);
}
// link para compartir (copiar, QR): siempre con el dominio en el que está corriendo la app (Bloque B, H24)
export const profileUrl = (prov) => location.origin + profilePath(prov, prov && prov.id);
// el mismo link para mostrar en pantalla, sin "https://"
export const profileLinkText = (prov) => location.host + profilePath(prov, prov && prov.id);

// adónde volver después de ingresar: S.after es una pantalla del cliente ("misturnos", "checkoutT"…) o una dirección
function afterPath() {
  if (!S.after) {
    return null;
  }
  return String(S.after).startsWith("/") ? S.after : describeClient(S.after).url;
}
const withParams = (path, params) => {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null && value !== "")).toString();
  return path + (query ? "?" + query : "");
};

// pantalla del cliente → { url, key, title, desc }. key identifica la pantalla (mismo key = misma entrada del historial)
function describeClient(view) {
  const prov = pr(S.pid);
  const storyParam = S.story ? S.story.i : null;
  switch (view) {
    case "perfil": {
      const tab = PROFILE_TABS[S.ptab];
      const cat = prov ? catInfo(pcat(prov, S.pctx)).one : "";
      return {
        url: withParams(profilePath(prov, S.pid) + (tab ? "/" + tab : ""), { reprogramar: S.reprog, historia: storyParam }),
        key: `perfil:${S.pid}:${S.ptab || "svc"}:${S.reprog || ""}${S.story ? ":historia" : ""}`,
        overlay: !!S.story,
        title: prov && prov.name ? `${prov.name} · ${cat} en ${CITY_NAME} · ${SITE}` : HOME_TITLE,
        desc:
          prov && prov.name
            ? prov.bio
              ? prov.bio.slice(0, 160)
              : `Reservá tu turno online en ${prov.name}${prov.addr ? ", " + prov.addr : ""}, ${CITY_NAME}. Pagás la seña con Mercado Pago.`
            : META.homeDesc,
      };
    }
    case "checkoutT": {
      const svc = prov && prov.svcs[S.svc];
      return {
        url: withParams(profilePath(prov, S.pid) + "/reservar", {
          servicio: svc ? skey(svc) : null,
          dia: S.slot && S.slot.date,
          hora: S.slot && S.slot.time,
          reprogramar: S.reprog,
        }),
        key: `reservar:${S.pid}`,
        title: `Confirmá tu turno${prov && prov.name ? " · " + prov.name : ""} · ${SITE}`,
      };
    }
    case "turnoOk":
      return { url: "/turno/" + S.turnoId, key: "turno:" + S.turnoId, title: `Tu turno · ${SITE}` };
    case "pagoVuelta":
      return {
        url: withParams("/turno/" + S.turnoId, { pago: S.payToken, mp: S.payBack }),
        key: "pago:" + S.turnoId,
        title: `Tu pago · ${SITE}`,
      };
    case "misturnos":
      return { url: "/mis-turnos", key: "mis-turnos", title: `Mis turnos · ${SITE}` };
    case "cuenta":
      return { url: "/cuenta", key: "cuenta", title: `Mi perfil · ${SITE}` };
    case "login":
    case "register": {
      const up = S.login && S.login.mode === "up";
      return {
        url: withParams(up ? "/crear-cuenta" : "/ingresar", { volver: afterPath() }),
        key: up ? "crear-cuenta" : "ingresar",
        title: `${up ? "Crear cuenta" : "Ingresar"} · ${SITE}`,
      };
    }
    case "newpass":
      return { url: "/nueva-contrasena", key: "nueva-contrasena", title: `Contraseña nueva · ${SITE}` };
    case "prestador":
      return { url: "/sumate", key: "sumate", title: `Sumate como prestador · ${SITE}` };
    case "loginBarbero": {
      const back = afterPath();
      return {
        url: withParams("/prestadores/ingresar", { volver: back && back.startsWith("/panel") ? back : null }),
        key: "prestadores-ingresar",
        title: `Acceso prestadores · ${SITE}`,
      };
    }
    case "terminos":
      return { url: "/terminos", key: "terminos", title: `Términos y condiciones · ${SITE}` };
    case "notfound":
      return { url: S.notFound || "/", key: "notfound:" + S.notFound, title: `No encontrado · ${SITE}` };
    default: {
      const cat = S.cat && S.cat !== "todos" && CAT_SLUGS[S.cat] ? S.cat : null;
      if (S.q) {
        return {
          url: withParams("/buscar", { q: S.q, rubro: cat && CAT_SLUGS[cat] }),
          key: `buscar:${S.q}:${cat || ""}`,
          title: `Resultados para “${S.q}” · ${SITE}`,
        };
      }
      if (cat) {
        const name = catInfo(cat).name;
        return {
          url: "/rubro/" + CAT_SLUGS[cat],
          key: "rubro:" + cat,
          title: `${name} en ${CITY_NAME} · ${SITE}`,
          desc: `Turnos online de ${name.toLowerCase()} en ${CITY_NAME}: elegí día y horario y pagá la seña con Mercado Pago.`,
        };
      }
      return { url: "/", key: "inicio", title: HOME_TITLE };
    }
  }
}
export function describe() {
  if (S.role === "admin") {
    const tab = ADMIN_TABS[S.admT] ? S.admT : "res";
    const period = tab === "bal" ? S.admM || (S.admY ? String(S.admY) : "") : "";
    const url = "/admin/" + ADMIN_TABS[tab] + (period ? "/" + period : "");
    return { url, key: url, title: `${ADMIN_LABELS[tab]} · Admin · ${SITE}` };
  }
  if (S.role === "barbero") {
    if (S.preview) {
      return { url: "/panel/vista-previa", key: "panel:vista-previa", title: `Vista previa de tu perfil · ${SITE}` };
    }
    const tab = PANEL_TABS[S.btab] ? S.btab : "agenda";
    const label = (BTABS.find((row) => row[0] === tab) || [])[1] || "Panel";
    const clientId = tab === "clientes" && S.cli ? clientIdOf(S.cli) : null;
    return {
      url: withParams("/panel/" + PANEL_TABS[tab], { cliente: clientId, historia: S.story ? S.story.i : null }),
      key: `panel:${tab}${clientId != null ? ":cliente:" + clientId : ""}${S.story ? ":historia" : ""}`,
      overlay: clientId != null || !!S.story,
      title: `${label} · Panel · ${SITE}`,
    };
  }
  return describeClient(S.view);
}
// id de la ficha de un cliente (el de provider_clients): nunca el nombre en la URL
function clientIdOf(name) {
  const client = store.CLIENTS[name];
  if (!client) {
    return null;
  }
  if (!LIVE && client.id == null) {
    // demo: los clientes de ejemplo no tienen id de la base; se les da uno al abrir su ficha
    store.DEMO_CLID = (store.DEMO_CLID || 9e3) + 1;
    client.id = store.DEMO_CLID;
  }
  return client.id == null ? null : client.id;
}
// dirección para recordar antes de ir a ingresar con Google (saveAfter): una pantalla del cliente, "panel" o una dirección
export function afterPathFor(view) {
  const back = String(S.after || "");
  if (String(view).startsWith("/")) {
    return view;
  }
  if (view === "panel") {
    return back.startsWith("/panel") ? back : "/panel/agenda";
  }
  return view === "home" ? "/" : describeClient(view).url;
}

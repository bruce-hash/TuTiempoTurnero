import "./styles/fuentes.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/turnero.css";
import "./styles/agenda.css";
import "./styles/componentes.css";
import "./styles/rubros.css";
import "./styles/marketplace.css";
import "./styles/compu.css";
import "./actions/admin-balance.js";
import "./actions/admin.js";
import "./actions/negocio.js";
import "./actions/auth.js";
import "./actions/avisos.js";
import "./actions/cambios.js";
import "./actions/cliente.js";
import "./actions/contrasena-nueva.js";
import "./actions/crear-cuenta.js";
import "./actions/cuenta.js";
import "./actions/cuentas.js";
import "./actions/formularios.js";
import "./actions/navegacion.js";
import "./actions/prestador-agenda.js";
import "./actions/prestador-caja.js";
import "./actions/prestador-clientes.js";
import "./actions/prestador-finanzas.js";
import "./actions/prestador-horarios.js";
import "./actions/prestador-perfil.js";
import "./actions/prestador-productos.js";
import "./actions/reserva.js";
import "./actions/toques.js";
import { exponerParaPruebas } from "./ganchos-prueba.js";
import { api } from "./api/index.js";
import { CONFIG_OK, LIVE, sb } from "./config.js";
import { errMsg } from "./lib/errores.js";
import { startPriceRefresh } from "./lib/precios.js";
import { startAgendaRefresh } from "./lib/agenda-al-dia.js";
import { refreshPush } from "./lib/push.js";
import { unstashPending } from "./lib/pendiente.js";
import { resumePending } from "./actions/pendiente.js";
import { startPwa } from "./lib/pwa.js";
import { S } from "./state.js";
import { P, store } from "./store.js";
import { startRouter } from "./router.js";
import { render } from "./ui/render.js";
import { reloadTarget } from "./lib/recarga.js";
import { toast } from "./ui/toast.js";
import "./demo/index.js";

if (typeof window != "undefined") {
  // los errores que ya se mostraron en un aviso (saved) no vuelven a aparecer en la consola
  window.addEventListener("unhandledrejection", (ev) => {
    if (ev.reason && ev.reason.__shown) {
      ev.preventDefault();
    }
  });
}
// arranque. En vivo: vacía los datos de la demo, escucha la sesión, procesa los links de los emails
// (confirmación, recuperación), recupera adónde iba el usuario antes de ingresar y la vuelta de Mercado Pago (?b=).
async function boot() {
  if (LIVE) {
    const demoBar = document.querySelector(".demo");
    if (demoBar) {
      demoBar.hidden = true;
    }
    P.length = 0;
    store.BOOK = [];
    store.CFGS = {};
    store.COMMBY = {};
    store.CLIENTS = {};
    store.PRODS = [];
    store.GASTOS = [];
    store.FIN = [];
    S.user = null;
    S.walk = [];
    S.me = null;
    render();
    sb.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        S.recovering = true;
        S.npMode = "recover";
        S.role = "cliente";
        S.view = "newpass";
        setTimeout(render, 0);
      }
      if (event === "SIGNED_OUT") {
        S.user = null;
        S.barberAuth = false;
        if (S.role === "barbero") {
          S.role = "cliente";
          S.view = "home";
        }
        store.BOOK = store.BOOK.filter((booking) => !booking.mine);
        render();
      }
    });
    {
      const query = new URLSearchParams(location.search);
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      const tokenHash = query.get("token_hash");
      const type = query.get("type");
      const errDesc = query.get("error_description") || hash.get("error_description");
      if (tokenHash || errDesc || query.get("error") || hash.get("error")) {
        history.replaceState(null, "", location.pathname);
      }
      if (errDesc) {
        toast(
          /expired|invalid/i.test(errDesc)
            ? "El link venció o ya se usó. Pedí uno nuevo."
            : "No pudimos completar el ingreso. Probá de nuevo.",
        );
      }
      if (
        tokenHash &&
        /^[A-Za-z0-9_-]{10,200}$/.test(tokenHash) &&
        /^(signup|recovery|email|email_change|invite|magiclink)$/.test(type || "")
      ) {
        try {
          const res = await sb.auth.verifyOtp({
            token_hash: tokenHash,
            type: type,
          });
          if (res.error) {
            throw res.error;
          }
          if (type === "recovery") {
            S.recovering = true;
            S.npMode = "recover";
          } else {
            toast(
              type === "email_change" ? "Tu email nuevo quedó confirmado." : "¡Listo! Tu cuenta quedó activada.",
            );
          }
        } catch (err) {
          toast(
            /expired|invalid/i.test(err.message || "")
              ? "El link venció o ya se usó. Pedí uno nuevo."
              : errMsg(err),
          );
        }
      }
    }
    try {
      await api.session();
    } catch (err) {
      toast(errMsg(err));
    }
    // Bloque C: el service worker y si este dispositivo ya recibe notificaciones
    startPwa(() => render());
    refreshPush()
      .then(() => render())
      .catch(() => {});
    api.fees().catch(() => {});
    // C52 (V8): precios al día al volver a la pestaña y cada minuto (perfil y confirmación del turno)
    startPriceRefresh();
    // C22 (V3b): la Agenda del prestador al día cada 30 segundos y al volver a la pestaña
    startAgendaRefresh();
    // D26 y C29: lo que dice TuTiempo (exigir DNI, tarjetas de sellos); al llegar, se vuelve a dibujar
    api.requireDni()
      .then(() => render())
      .catch(() => {});
    // dirección con la que arranca el enrutador: la actual, salvo que el arranque ya decida la pantalla
    // C02: si una recarga cayó en el inicio porque el servidor no devolvió la dirección, la de antes de recargar
    const back = reloadTarget();
    if (back) {
      history.replaceState(null, "", back);
    }
    let start = location.href;
    if (S.recovering && S.user) {
      S.view = "newpass";
      S.npMode = "recover";
      start = null;
    } else {
      // vuelta de ingresar con Google: a la dirección que se había guardado (saveAfter)
      let after = null;
      try {
        after = JSON.parse(sessionStorage.getItem("tt_after") || "null");
        sessionStorage.removeItem("tt_after");
      } catch (ignored) {}
      if (after && S.user && typeof after.path === "string" && /^\/(?!\/)/.test(after.path)) {
        start = after.path;
      }
      // la acción pendiente que quedó en esta pestaña antes de ir a Google
      const stashed = unstashPending();
      if (S.user && stashed && !S.pending) {
        S.pending = stashed;
      }
      // el prestador entra siempre a su Agenda (también al abrir la app instalada, que arranca en "/")
      const startUrl = new URL(start, location.origin);
      if (S.barberAuth && !S.pending && ((startUrl.pathname === "/" && !startUrl.search) || (after && after.soft))) {
        start = location.origin + "/panel/agenda";
      }
    }
    // vuelta de Mercado Pago de los cobros abiertos antes del Paso 1: ?b=<turno>&mp=success (los nuevos vuelven a
    // /turno/<id>?pago=<token>, que anda sin sesión). Sin sesión, al ingreso y después al turno (antes, al inicio).
    const params = new URLSearchParams(location.search);
    if (params.get("b") && /^\d+$/.test(params.get("b"))) {
      S.turnoId = +params.get("b");
      S.justBooked = params.get("mp") === "success";
      if (S.user) {
        S.view = "turnoOk";
        start = null;
      } else {
        start = "/turno/" + S.turnoId;
      }
    }
    // vuelta de conectar Mercado Pago (mp-oauth): ?mp_connected=1, o 0 con el motivo en mp_error. Al Perfil del
    // panel, donde está Cobros, con el resultado a la vista (antes volvía al inicio sin decir nada)
    const mpBack = params.get("mp_connected");
    if (mpBack === "1" || mpBack === "0") {
      S.mpBack = mpBack === "1" ? "ok" : params.get("mp_error") || "error";
      if (S.barberAuth) {
        start = "/panel/perfil";
      }
      if (S.mpBack === "ok") {
        toast("¡Listo! Mercado Pago conectado.");
      }
    }
    await startRouter(start);
    // ingreso y registro: la acción que pidió ingresar (link del email de la cuenta nueva o vuelta de Google) sigue sola
    if (S.user && S.pending) {
      await resumePending();
    }
    return;
  } else {
    const bar = document.createElement("div");
    bar.className = "modebar";
    bar.innerHTML =
      "<b>Modo demo:</b> datos de ejemplo, nada se guarda. Para conectar tu base, completá config.js con tu proyecto de Supabase.";
    const demoBar = document.querySelector(".demo");
    if (demoBar && demoBar.parentNode) {
      demoBar.parentNode.insertBefore(bar, demoBar.nextSibling);
    }
  }
  const back = reloadTarget();
  if (back) {
    history.replaceState(null, "", back);
  }
  await startRouter(location.href);
}
// Producción sin config.js completo: en vez de la demo, un aviso claro (la demo no viaja en el build de producción).
function faltaConfig() {
  document.getElementById("app").innerHTML =
    '<section class="in" style="padding:48px 0"><h1 class="h1">Falta configurar el sitio</h1><p class="hint">Completá config.js con la URL y la clave anon del proyecto de Supabase.</p></section>';
}
if (import.meta.env.VITE_TEST_HOOKS) {
  exponerParaPruebas();
}
if (!CONFIG_OK && !import.meta.env.VITE_DEMO) {
  faltaConfig();
} else {
  // C02: si el arranque falla antes de resolver la dirección, igual se sale de la carga (nunca queda colgada)
  boot()
    .catch((err) => console.error(err))
    .finally(() => {
      if (S.booting) {
        S.booting = false;
        render();
      }
    });
}

import "./styles/fuentes.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/turnero.css";
import "./styles/agenda.css";
import "./styles/componentes.css";
import "./styles/rubros.css";
import "./styles/marketplace.css";
import "./actions/acceso-prestadores.js";
import "./actions/admin-balance.js";
import "./actions/admin.js";
import "./actions/alta-prestador.js";
import "./actions/auth.js";
import "./actions/cambios.js";
import "./actions/cliente.js";
import "./actions/contrasena-nueva.js";
import "./actions/crear-cuenta.js";
import "./actions/cuenta.js";
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
import { S } from "./state.js";
import { P, store } from "./store.js";
import { startRouter } from "./router.js";
import { render } from "./ui/render.js";
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
    S.wallet = 0;
    S.wmov = [];
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
        S.wallet = 0;
        S.wmov = [];
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
    api.commission().catch(() => {});
    // dirección con la que arranca el enrutador: la actual, salvo que el arranque ya decida la pantalla
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
    }
    // vuelta de Mercado Pago: ?b=<turno>&mp=success (la dirección de vuelta la arma la Edge Function: no cambia)
    const params = new URLSearchParams(location.search);
    if (params.get("b") && /^\d+$/.test(params.get("b"))) {
      S.turnoId = +params.get("b");
      S.justBooked = params.get("mp") === "success";
      S.view = "turnoOk";
      start = null;
    }
    await startRouter(start);
    return;
  } else {
    const bar = document.createElement("div");
    bar.className = "modebar";
    bar.innerHTML =
      "<b>Modo demo:</b> datos de ejemplo, nada se guarda. Para conectar tu base, completá config.cjs con tu proyecto de Supabase.";
    const demoBar = document.querySelector(".demo");
    if (demoBar && demoBar.parentNode) {
      demoBar.parentNode.insertBefore(bar, demoBar.nextSibling);
    }
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
  boot();
}

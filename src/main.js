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
import { render } from "./ui/render.js";
import { toast } from "./ui/toast.js";
import "./demo/index.js";

if (typeof window != "undefined") {
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.__shown) {
      e.preventDefault();
    }
  });
}
async function boot() {
  if (LIVE) {
    const e = document.querySelector(".demo");
    if (e) {
      e.hidden = true;
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
    sb.auth.onAuthStateChange((t) => {
      if (t === "PASSWORD_RECOVERY") {
        S.recovering = true;
        S.npMode = "recover";
        S.role = "cliente";
        S.view = "newpass";
        setTimeout(render, 0);
      }
      if (t === "SIGNED_OUT") {
        S.user = null;
        S.barberAuth = false;
        if (S.role === "barbero") {
          S.role = "cliente";
          S.view = "home";
        }
        store.BOOK = store.BOOK.filter((s) => !s.mine);
        S.wallet = 0;
        S.wmov = [];
        render();
      }
    });
    {
      const t = new URLSearchParams(location.search);
      const s = new URLSearchParams(location.hash.replace(/^#/, ""));
      const n = t.get("token_hash");
      const o = t.get("type");
      const i = t.get("error_description") || s.get("error_description");
      if (n || i || t.get("error") || s.get("error")) {
        history.replaceState(null, "", location.pathname);
      }
      if (i) {
        toast(
          /expired|invalid/i.test(i)
            ? "El link venció o ya se usó. Pedí uno nuevo."
            : "No pudimos completar el ingreso. Probá de nuevo.",
        );
      }
      if (
        n &&
        /^[A-Za-z0-9_-]{10,200}$/.test(n) &&
        /^(signup|recovery|email|email_change|invite|magiclink)$/.test(o || "")
      ) {
        try {
          const l = await sb.auth.verifyOtp({
            token_hash: n,
            type: o,
          });
          if (l.error) {
            throw l.error;
          }
          if (o === "recovery") {
            S.recovering = true;
            S.npMode = "recover";
          } else {
            toast(
              o === "email_change" ? "Tu email nuevo quedó confirmado." : "¡Listo! Tu cuenta quedó activada.",
            );
          }
        } catch (l) {
          toast(
            /expired|invalid/i.test(l.message || "")
              ? "El link venció o ya se usó. Pedí uno nuevo."
              : errMsg(l),
          );
        }
      }
    }
    try {
      await api.session();
    } catch (t) {
      toast(errMsg(t));
    }
    api.commission().catch(() => {});
    if (S.recovering && S.user) {
      S.view = "newpass";
      S.npMode = "recover";
    } else {
      let t = null;
      try {
        t = JSON.parse(sessionStorage.getItem("tt_after") || "null");
        sessionStorage.removeItem("tt_after");
      } catch (s) {}
      if (t && S.user) {
        if (t.v === "panel") {
          if (S.barberAuth) {
            S.role = "barbero";
            S.btab = "agenda";
          } else {
            toast("Esa cuenta todavía no tiene perfil de prestador. Podés sumarte desde “Sumate”.");
          }
        } else if ((t.v === "checkoutT" || t.v === "perfil") && /^\d{1,12}$/.test(String(t.pid))) {
          S.pid = +t.pid;
          S.view = "perfil";
          toast("Ingresaste. Elegí tu horario y confirmá.");
        } else if (t.v === "misturnos" || t.v === "cuenta") {
          S.view = t.v;
        }
      }
    }
    const a = new URLSearchParams(location.search);
    if (a.get("b") && /^\d+$/.test(a.get("b"))) {
      S.turnoId = +a.get("b");
      S.justBooked = a.get("mp") === "success";
      S.view = "turnoOk";
      history.replaceState(null, "", location.pathname);
    }
  } else {
    const e = document.createElement("div");
    e.className = "modebar";
    e.innerHTML =
      "<b>Modo demo:</b> datos de ejemplo, nada se guarda. Para conectar tu base, completá config.cjs con tu proyecto de Supabase.";
    const a = document.querySelector(".demo");
    if (a && a.parentNode) {
      a.parentNode.insertBefore(e, a.nextSibling);
    }
  }
  render();
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

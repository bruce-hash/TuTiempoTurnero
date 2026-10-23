import { $, ini } from "../lib/dom.js";
import { ME, avatar, pr } from "../lib/prestadores.js";
import { CAT, pcat } from "../lib/rubros.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { LOGO } from "./iconos.js";
import { vAdmin } from "../views/admin/admin.js";
import { vLoginBarbero } from "../views/auth/acceso-prestadores.js";
import { vRegPrest } from "../views/auth/alta-prestador.js";
import { vNewPass } from "../views/auth/contrasena-nueva.js";
import { vLogin } from "../views/auth/login.js";
import { vCheckoutTurno } from "../views/cliente/checkout.js";
import { vCuenta } from "../views/cliente/cuenta.js";
import { storyTick, vStory } from "../views/cliente/historias.js";
import { myUpcoming, vHome } from "../views/cliente/home.js";
import { vMisTurnos } from "../views/cliente/mis-turnos.js";
import { vPerfil } from "../views/cliente/perfil.js";
import { vTurnoOk } from "../views/cliente/turno.js";
import { vTerminos } from "../views/legal/terminos.js";
import { vBarbero } from "../views/prestador/panel.js";

function nav() {
  $("#logoLink").innerHTML = LOGO;
  $("#logoFoot").innerHTML = LOGO;
  if (S.role === "admin") {
    $("#nav").innerHTML =
      '<span class="user"><span class="chip">🛠️ Admin</span><button class="btn btn-ghost" data-act="salirAdmin">Salir</button></span>';
    return;
  }
  if (S.role === "barbero") {
    $("#nav").innerHTML =
      `<span class="user"><span class="av">${ini(pr(ME()).name)}</span><button class="btn btn-ghost" data-act="salirBarbero">Salir</button></span>`;
    return;
  }
  const upcoming = myUpcoming().length;
  $("#nav").innerHTML = S.user
    ? `<span class="user"><button class="btn btn-ghost nbtn" data-go="misturnos" aria-label="Mis turnos">📅 <span class="nb-l">Mis turnos</span>${upcoming ? `<span class="cnt">${upcoming}</span>` : ""}${(S.inbox || []).some((msg) => !msg.read) ? '<i class="dotn" title="Tenés avisos nuevos"></i>' : ""}</button><button class="avbtn" data-go="cuenta" aria-label="Mi perfil" title="Mi perfil">${avatar(S.user)}</button></span>`
    : '<button class="btn btn-ghost" data-go="loginBarbero">Soy prestador</button><button class="btn btn-pri" data-go="login">Ingresar</button>';
}
// rubro que tiñe la página (data-seg del body): el del prestador que se está viendo, o "n" (neutro)
function segNow() {
  if (S.role === "admin") {
    return "n";
  }
  if (S.role === "barbero") {
    return pcat(pr(ME()), S.pctx);
  }
  const view = S.view;
  if (view === "perfil" || view === "checkoutT") {
    const prov = pr(S.pid);
    if (prov) {
      return pcat(prov, S.pctx);
    } else {
      return "n";
    }
  }
  if (view === "turnoOk") {
    const booking = store.BOOK.find((item) => item.id === S.turnoId);
    const prov = booking && pr(booking.pid);
    if (prov) {
      return pcat(prov, booking.cat || S.pctx);
    } else {
      return "n";
    }
  }
  if ((!view || view === "home") && CAT[S.cat] && S.cat !== "n") {
    return S.cat;
  } else {
    return "n";
  }
}
// dibuja toda la app desde el estado S; si una vista falla, muestra un aviso en lugar de una página rota
export function render() {
  try {
    renderInner();
  } catch (err) {
    console.error(err);
    const app = document.getElementById("app");
    if (app) {
      app.innerHTML =
        '<div class="apperr panel"><div style="font-size:36px">😕</div><h1 class="h1">Algo salió mal</h1><p class="lead">No se perdió nada de lo que ya guardaste.</p><button class="btn btn-pri btn-block" data-act="recover">Volver al inicio</button></div>';
    }
  }
}
function renderInner() {
  renderMain();
  const tab = document.querySelector(".btabs [aria-selected=true]");
  if (tab && tab.parentElement) {
    const bar = tab.parentElement;
    bar.scrollLeft = Math.max(0, tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2);
  }
  const app = document.getElementById("app");
  if (app && S.story) {
    app.insertAdjacentHTML("beforeend", vStory());
    storyTick();
  }
}
function renderMain() {
  document.body.dataset.seg = segNow();
  nav();
  document.querySelectorAll("[data-role-view]").forEach((btn) => {
    if (btn.closest(".sw")) {
      btn.setAttribute("aria-pressed", btn.dataset.roleView === S.role);
    }
  });
  let html;
  if (S.role === "admin") {
    html = vAdmin();
  } else if (S.role === "barbero") {
    html = S.preview
      ? `<div class="prevbar"><span>👁 Así ve tu perfil un cliente</span><button class="btn btn-pri" data-act="exitPreview">Volver al panel</button></div>${vPerfil()}`
      : vBarbero();
  } else {
    switch (S.view) {
      case "perfil":
        html =
          pr(S.pid) && pr(S.pid).deleted
            ? '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Este perfil ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Ver otros profesionales</button></div></div>'
            : vPerfil();
        break;
      case "login":
        html = vLogin(false);
        break;
      case "register":
        html = vLogin(true);
        break;
      case "newpass":
        html = vNewPass();
        break;
      case "prestador":
        html = vRegPrest();
        break;
      case "loginBarbero":
        html = vLoginBarbero();
        break;
      case "cuenta":
        html = S.user ? vCuenta() : vLogin(false);
        break;
      case "terminos":
        html = vTerminos();
        break;
      case "misturnos":
        html = S.user ? vMisTurnos() : vLogin(false);
        break;
      case "checkoutT":
        html = vCheckoutTurno();
        break;
      case "turnoOk":
        html = vTurnoOk();
        break;
      default:
        html = vHome();
    }
  }
  $("#app").innerHTML = html;
}
// navegación entre pantallas del cliente (id = prestador, para "perfil")
export function go(view, id) {
  if (S.role === "barbero" && S.preview) {
    S.preview = false;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (view === "misturnos" && !S.user) {
    S.after = "misturnos";
    view = "login";
  }
  if (view === "loginBarbero" && S.barberAuth) {
    S.role = "barbero";
    render();
    window.scrollTo(0, 0);
    return;
  }
  S.role = "cliente";
  if (view !== S.view) {
    S.prev = S.view;
  }
  if ((view === "login" || view === "register") && !S.keepLogin) {
    S.login = {
      mode: view === "register" ? "up" : "in",
      email: "",
      err: "",
    };
  }
  S.keepLogin = false;
  if (view === "loginBarbero") {
    Object.assign(S.blogin, {
      step: "form",
      err: "",
      show: false,
    });
  }
  if (view === "prestador" && S.reg.done) {
    S.reg = {};
  }
  if ((view === "login" || view === "register") && S.user) {
    S.view = "cuenta";
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (view === "home") {
    S.reprog = null;
  }
  if (view !== "turnoOk") {
    S.justBooked = false;
    S.cancelAsk = false;
  }
  if (view === "perfil" && (!id || +id !== S.pid || S.view !== "perfil")) {
    S.ptab = "svc";
  }
  S.story = null;
  if (id) {
    S.pid = +id;
  }
  S.view = view;
  render();
  window.scrollTo(0, 0);
}

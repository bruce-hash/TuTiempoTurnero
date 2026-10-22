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
  const e = myUpcoming().length;
  $("#nav").innerHTML = S.user
    ? `<span class="user"><button class="btn btn-ghost nbtn" data-go="misturnos" aria-label="Mis turnos">📅 <span class="nb-l">Mis turnos</span>${e ? `<span class="cnt">${e}</span>` : ""}${(S.inbox || []).some((a) => !a.read) ? '<i class="dotn" title="Tenés avisos nuevos"></i>' : ""}</button><button class="avbtn" data-go="cuenta" aria-label="Mi perfil" title="Mi perfil">${avatar(S.user)}</button></span>`
    : '<button class="btn btn-ghost" data-go="loginBarbero">Soy prestador</button><button class="btn btn-pri" data-go="login">Ingresar</button>';
}
function segNow() {
  if (S.role === "admin") {
    return "n";
  }
  if (S.role === "barbero") {
    return pcat(pr(ME()), S.pctx);
  }
  const e = S.view;
  if (e === "perfil" || e === "checkoutT") {
    const a = pr(S.pid);
    if (a) {
      return pcat(a, S.pctx);
    } else {
      return "n";
    }
  }
  if (e === "turnoOk") {
    const a = store.BOOK.find((s) => s.id === S.turnoId);
    const t = a && pr(a.pid);
    if (t) {
      return pcat(t, a.cat || S.pctx);
    } else {
      return "n";
    }
  }
  if ((!e || e === "home") && CAT[S.cat] && S.cat !== "n") {
    return S.cat;
  } else {
    return "n";
  }
}
export function render() {
  try {
    renderInner();
  } catch (e) {
    console.error(e);
    const a = document.getElementById("app");
    if (a) {
      a.innerHTML =
        '<div class="apperr panel"><div style="font-size:36px">😕</div><h1 class="h1">Algo salió mal</h1><p class="lead">No se perdió nada de lo que ya guardaste.</p><button class="btn btn-pri btn-block" data-act="recover">Volver al inicio</button></div>';
    }
  }
}
function renderInner() {
  renderMain();
  const e = document.querySelector(".btabs [aria-selected=true]");
  if (e && e.parentElement) {
    const t = e.parentElement;
    t.scrollLeft = Math.max(0, e.offsetLeft - (t.clientWidth - e.offsetWidth) / 2);
  }
  const a = document.getElementById("app");
  if (a && S.story) {
    a.insertAdjacentHTML("beforeend", vStory());
    storyTick();
  }
}
function renderMain() {
  document.body.dataset.seg = segNow();
  nav();
  document.querySelectorAll("[data-role-view]").forEach((a) => {
    if (a.closest(".sw")) {
      a.setAttribute("aria-pressed", a.dataset.roleView === S.role);
    }
  });
  let e;
  if (S.role === "admin") {
    e = vAdmin();
  } else if (S.role === "barbero") {
    e = S.preview
      ? `<div class="prevbar"><span>👁 Así ve tu perfil un cliente</span><button class="btn btn-pri" data-act="exitPreview">Volver al panel</button></div>${vPerfil()}`
      : vBarbero();
  } else {
    switch (S.view) {
      case "perfil":
        e =
          pr(S.pid) && pr(S.pid).deleted
            ? '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Este perfil ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Ver otros profesionales</button></div></div>'
            : vPerfil();
        break;
      case "login":
        e = vLogin(false);
        break;
      case "register":
        e = vLogin(true);
        break;
      case "newpass":
        e = vNewPass();
        break;
      case "prestador":
        e = vRegPrest();
        break;
      case "loginBarbero":
        e = vLoginBarbero();
        break;
      case "cuenta":
        e = S.user ? vCuenta() : vLogin(false);
        break;
      case "terminos":
        e = vTerminos();
        break;
      case "misturnos":
        e = S.user ? vMisTurnos() : vLogin(false);
        break;
      case "checkoutT":
        e = vCheckoutTurno();
        break;
      case "turnoOk":
        e = vTurnoOk();
        break;
      default:
        e = vHome();
    }
  }
  $("#app").innerHTML = e;
}
export function go(e, id) {
  if (S.role === "barbero" && S.preview) {
    S.preview = false;
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (e === "misturnos" && !S.user) {
    S.after = "misturnos";
    e = "login";
  }
  if (e === "loginBarbero" && S.barberAuth) {
    S.role = "barbero";
    render();
    window.scrollTo(0, 0);
    return;
  }
  S.role = "cliente";
  if (e !== S.view) {
    S.prev = S.view;
  }
  if ((e === "login" || e === "register") && !S.keepLogin) {
    S.login = {
      mode: e === "register" ? "up" : "in",
      email: "",
      err: "",
    };
  }
  S.keepLogin = false;
  if (e === "loginBarbero") {
    Object.assign(S.blogin, {
      step: "form",
      err: "",
      show: false,
    });
  }
  if (e === "prestador" && S.reg.done) {
    S.reg = {};
  }
  if ((e === "login" || e === "register") && S.user) {
    S.view = "cuenta";
    render();
    window.scrollTo(0, 0);
    return;
  }
  if (e === "home") {
    S.reprog = null;
  }
  if (e !== "turnoOk") {
    S.justBooked = false;
    S.cancelAsk = false;
  }
  if (e === "perfil" && (!id || +id !== S.pid || S.view !== "perfil")) {
    S.ptab = "svc";
  }
  S.story = null;
  if (id) {
    S.pid = +id;
  }
  S.view = e;
  render();
  window.scrollTo(0, 0);
}

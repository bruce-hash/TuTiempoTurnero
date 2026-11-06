import { registerClick } from "./registro.js";
import { S } from "../state.js";
import { markBellRead } from "../ui/campanita.js";
import { render } from "../ui/render.js";
import { setBtab } from "../views/prestador/panel.js";
import { loadFollowers } from "../views/prestador/seguidores.js";

// 4/11 · La campanita de avisos (src/ui/campanita.js): abrir y cerrar, y a dónde llevan los avisos del profesional
registerClick("bellToggle", (ev, el, act) => {
  S.bellOpen = !S.bellOpen;
  if (S.bellOpen) {
    markBellRead();
  }
  render();
  if (S.bellOpen) {
    const panel = document.getElementById("bellPanel");
    if (panel) {
      panel.setAttribute("tabindex", "-1");
      panel.focus({ preventScroll: true });
    }
  }
});
registerClick("bellGo", (ev, el, act) => {
  S.bellOpen = false;
  S.role = "barbero";
  S.preview = false;
  if (el.dataset.to === "seguidores") {
    setBtab("clientes");
    S.ctab = "seguidores";
    loadFollowers(true);
  } else {
    // 4/11: el aviso del plazo de Mercado Pago lleva a Horarios (donde se elige); el resto, a Perfil
    setBtab(el.dataset.to === "horarios" ? "horarios" : "perfil");
  }
  render();
  window.scrollTo(0, 0);
});
// elegir una acción de un aviso (ver el turno, reservar, ver el perfil…) cierra la lista; el ✕ y "Borrar los leídos", no
document.addEventListener(
  "click",
  (ev) => {
    const el = S.bellOpen && ev.target.closest(".bellpanel [data-go], .bellpanel [data-act]");
    if (el && !["inboxDel", "inboxClear"].includes(el.dataset.act)) {
      S.bellOpen = false;
    }
  },
  true,
);
// tocar afuera o Esc cierra
document.addEventListener("click", (ev) => {
  if (S.bellOpen && !ev.target.closest(".bellw") && document.contains(ev.target)) {
    S.bellOpen = false;
    render();
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && S.bellOpen) {
    S.bellOpen = false;
    render();
    const btn = document.querySelector("#nav .bell-btn");
    if (btn) {
      btn.focus();
    }
  }
});

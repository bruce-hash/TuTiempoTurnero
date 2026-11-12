import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { S } from "../state.js";
import { toast } from "../ui/toast.js";
import { markBellRead } from "../ui/campanita.js";
import { render } from "../ui/render.js";
import { setBtab } from "../lib/panel-nav.js";
import { loadPart } from "../partes.js";
import { refreshInboxNow } from "../lib/avisos-al-dia.js";

// 4/11 · La campanita de avisos (src/ui/campanita.js): abrir y cerrar, y a dónde llevan los avisos del profesional
registerClick("bellToggle", (ev, el, act) => {
  S.bellOpen = !S.bellOpen;
  if (S.bellOpen) {
    markBellRead();
    // 12/11: al abrir, los avisos de la base (uno que acaba de llegar por push se ve ya, sin esperar el repaso del minuto);
    // lo nuevo también queda leído
    refreshInboxNow().then((changed) => {
      if (changed && S.bellOpen) {
        markBellRead(true);
        render();
      }
    });
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
    loadPart("panel").then((mod) => mod.loadFollowers(true));
  } else if (el.dataset.to === "agenda") {
    // 10/11 · turnos en un feriado: a la Agenda, en ese día
    setBtab("agenda");
    if (el.dataset.d) {
      S.aday = el.dataset.d;
      S.awk = null;
    }
  } else {
    // el plazo de Mercado Pago (9/11: se elige en Perfil → Cobros con Mercado Pago) y los demás avisos, a Perfil
    setBtab("perfil");
  }
  render();
  window.scrollTo(0, 0);
});
// elegir una acción de un aviso (ver el turno, reservar, ver el perfil…) cierra la lista; el ✕ y "Borrar los leídos", no
document.addEventListener(
  "click",
  (ev) => {
    const el = S.bellOpen && ev.target.closest(".bellpanel [data-go], .bellpanel [data-act]");
    if (el && !["inboxDel", "inboxClear", "noticeDel", "noticeClear"].includes(el.dataset.act)) {
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

// 7/11: los avisos del profesional se borran como los del cliente (la ✕ y «Borrar los leídos»); en la base queda
// dismissed_at, así uno que sale una sola vez no vuelve
registerClick("noticeDel", (ev, el, act) => {
  const id = el.dataset.id;
  S.notices = (S.notices || []).filter((notice) => String(notice.id) !== id);
  api.m.dismissNotices([+id]).catch(() => {});
  render();
});
registerClick("noticeClear", (ev, el, act) => {
  (S.notices || []).forEach((notice) => (notice.read = true));
  S.notices = [];
  Promise.resolve(api.m.readNotices())
    .then(() => api.m.dismissNotices(null))
    .catch(() => {});
  toast("Borramos los avisos leídos");
  render();
});

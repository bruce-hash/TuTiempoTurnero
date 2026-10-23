import { CHANGE, INPUT } from "./registro.js";
import { api } from "../api/index.js";
import { $ } from "../lib/dom.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { comm } from "../views/prestador/comunidad.js";
import { fillMsg, updMsgCount } from "../views/prestador/mensajes.js";
import { readSvcEditor } from "../views/prestador/perfil.js";

document.addEventListener("change", (e) => {
  if (e.target.dataset && e.target.dataset.add != null) {
    const n = +e.target.dataset.add;
    S.adds = (S.adds || []).filter((o) => o !== n);
    if (e.target.checked) {
      S.adds.push(n);
    }
    S.slot = null;
    render();
    return;
  }
  const accion = CHANGE.get(e.target.id);
  if (accion) {
    accion(e);
    return;
  }
  const a = e.target.id && e.target.id.match(/^hd(\d)$/);
  if (a) {
    const n = a[1];
    const o = e.target.checked;
    ["m", "t"].forEach((i) => {
      const l = $("#h" + i + n);
      l.disabled = !o;
      const c = o && l.checked;
      $("#h" + i + "f" + n).disabled = !c;
      $("#h" + i + "t" + n).disabled = !c;
      l.closest(".rng").classList.toggle("off", !c);
    });
    e.target.closest(".hday").classList.toggle("off", !o);
    return;
  }
  const t = e.target.id && e.target.id.match(/^h([mt])(\d)$/);
  if (t) {
    const n = e.target.checked;
    $("#h" + t[1] + "f" + t[2]).disabled = !n;
    $("#h" + t[1] + "t" + t[2]).disabled = !n;
    e.target.closest(".rng").classList.toggle("off", !n);
    return;
  }
  const s = e.target.dataset && e.target.dataset.mon;
  if (s != null) {
    store.MSGS[+s].on = e.target.checked;
    api.m.saveTemplate(store.MSGS[+s]);
    toast(`${store.MSGS[+s].t}: ${e.target.checked ? "activado" : "desactivado"}`);
    return;
  }
  if (e.target.dataset && e.target.dataset.mc !== void 0) {
    S.msg.sel[e.target.dataset.mc] = e.target.checked;
    updMsgCount();
    return;
  }
  if (e.target.dataset && e.target.dataset.rc) {
    readSvcEditor();
    render();
    return;
  }
});
document.addEventListener("input", (e) => {
  if (e.target.dataset && e.target.dataset.iq) {
    S.intake = S.intake || {};
    const a = e.target.value.slice(0, 200);
    if (a.trim()) {
      S.intake[e.target.dataset.iq] = a;
    } else {
      delete S.intake[e.target.dataset.iq];
    }
    return;
  }
  if (e.target.id && /^mtx\d$/.test(e.target.id)) {
    const a = $(".ntf-t");
    if (a) {
      a.textContent = fillMsg(e.target.value);
    }
    return;
  }
  const accion = INPUT.get(e.target.id);
  if (accion) {
    accion(e);
    return;
  }
});
document.addEventListener("keydown", (e) => {
  if (S.story) {
    if (e.key === "Escape") {
      S.story = null;
      render();
    } else if (e.key === "ArrowRight") {
      const a = comm(S.story.pid).media;
      if (S.story.i < a.length - 1) {
        S.story.i++;
      } else {
        S.story = null;
      }
      render();
    } else if (e.key === "ArrowLeft") {
      S.story.i = Math.max(0, S.story.i - 1);
      render();
    }
  }
});

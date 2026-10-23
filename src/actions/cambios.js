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

// cambios en casillas y selectores: adicionales del servicio, acciones registradas por id, días y franjas de
// Horarios, avisos automáticos, destinatarios de mensajes y rubros del editor de servicios
document.addEventListener("change", (ev) => {
  if (ev.target.dataset && ev.target.dataset.add != null) {
    const index = +ev.target.dataset.add;
    S.adds = (S.adds || []).filter((item) => item !== index);
    if (ev.target.checked) {
      S.adds.push(index);
    }
    S.slot = null;
    render();
    return;
  }
  const accion = CHANGE.get(ev.target.id);
  if (accion) {
    accion(ev);
    return;
  }
  const dayMatch = ev.target.id && ev.target.id.match(/^hd(\d)$/);
  if (dayMatch) {
    const dow = dayMatch[1];
    const on = ev.target.checked;
    ["m", "t"].forEach((part) => {
      const box = $("#h" + part + dow);
      box.disabled = !on;
      const rngOn = on && box.checked;
      $("#h" + part + "f" + dow).disabled = !rngOn;
      $("#h" + part + "t" + dow).disabled = !rngOn;
      box.closest(".rng").classList.toggle("off", !rngOn);
    });
    ev.target.closest(".hday").classList.toggle("off", !on);
    return;
  }
  const rngMatch = ev.target.id && ev.target.id.match(/^h([mt])(\d)$/);
  if (rngMatch) {
    const on = ev.target.checked;
    $("#h" + rngMatch[1] + "f" + rngMatch[2]).disabled = !on;
    $("#h" + rngMatch[1] + "t" + rngMatch[2]).disabled = !on;
    ev.target.closest(".rng").classList.toggle("off", !on);
    return;
  }
  const mon = ev.target.dataset && ev.target.dataset.mon;
  if (mon != null) {
    store.MSGS[+mon].on = ev.target.checked;
    api.m.saveTemplate(store.MSGS[+mon]);
    toast(`${store.MSGS[+mon].t}: ${ev.target.checked ? "activado" : "desactivado"}`);
    return;
  }
  if (ev.target.dataset && ev.target.dataset.mc !== void 0) {
    S.msg.sel[ev.target.dataset.mc] = ev.target.checked;
    updMsgCount();
    return;
  }
  if (ev.target.dataset && ev.target.dataset.rc) {
    readSvcEditor();
    render();
    return;
  }
});
// lo que se escribe: preguntas previas al turno, vista previa del aviso y acciones registradas por id
document.addEventListener("input", (ev) => {
  if (ev.target.dataset && ev.target.dataset.iq) {
    S.intake = S.intake || {};
    const value = ev.target.value.slice(0, 200);
    if (value.trim()) {
      S.intake[ev.target.dataset.iq] = value;
    } else {
      delete S.intake[ev.target.dataset.iq];
    }
    return;
  }
  if (ev.target.id && /^mtx\d$/.test(ev.target.id)) {
    const preview = $(".ntf-t");
    if (preview) {
      preview.textContent = fillMsg(ev.target.value);
    }
    return;
  }
  const accion = INPUT.get(ev.target.id);
  if (accion) {
    accion(ev);
    return;
  }
});
// historias: Escape cierra, flechas pasan
document.addEventListener("keydown", (ev) => {
  if (S.story) {
    if (ev.key === "Escape") {
      S.story = null;
      render();
    } else if (ev.key === "ArrowRight") {
      const media = comm(S.story.pid).media;
      if (S.story.i < media.length - 1) {
        S.story.i++;
      } else {
        S.story = null;
      }
      render();
    } else if (ev.key === "ArrowLeft") {
      S.story.i = Math.max(0, S.story.i - 1);
      render();
    }
  }
});

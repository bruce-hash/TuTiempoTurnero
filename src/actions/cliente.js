import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { ME, pr } from "../lib/prestadores.js";
import { uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { loadList } from "../views/cliente/home.js";
import { comm } from "../views/prestador/comunidad.js";

registerClick("inboxAll", (ev, el, act) => {
  S.inboxAll = true;
  render();
  return;
});
registerClick("ptab", (ev, el, act) => {
  S.ptab = el.dataset.t;
  S.rateFor = null;
  render();
  return;
});
registerClick("story", (ev, el, act) => {
  const pid = S.view === "perfil" ? S.pid : ME();
  S.story = {
    pid: pid,
    i: +el.dataset.i || 0,
  };
  render();
  return;
});
registerClick("storyClose", (ev, el, act) => {
  S.story = null;
  clearTimeout(store.STORY_T);
  render();
  return;
});
registerClick("storyNext", (ev, el, act) => {
  const media = comm(S.story.pid).media;
  if (S.story.i < media.length - 1) {
    S.story.i++;
  } else {
    S.story = null;
  }
  render();
  return;
});
registerClick("storyPrev", (ev, el, act) => {
  S.story.i = Math.max(0, S.story.i - 1);
  render();
  return;
});
registerClick("storyBook", (ev, el, act) => {
  const pid = S.story.pid;
  S.story = null;
  clearTimeout(store.STORY_T);
  S.ptab = "svc";
  if (S.role === "barbero") {
    render();
    return;
  }
  go("perfil", pid);
  return;
});
registerClick("verTodos", (ev, el, act) => {
  S.cat = "todos";
  S.q = "";
  render();
  return;
});
registerClick("rateOpen", (ev, el, act) => {
  S.rateFor = +el.dataset.id;
  S.rateN = 0;
  render();
  return;
});
// reseña de un turno hecho; en vivo, el perfil se vuelve a pedir completo para que aparezca
registerClick("sendReview", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === +el.dataset.id);
  const body = (($("#rateTxt") || {}).value || "").trim().slice(0, 600);
  if (!booking || !S.rateN) {
    return;
  }
  const stars = S.rateN;
  booking.reviewed = true;
  S.rateFor = null;
  S.rateN = 0;
  if (LIVE) {
    api.m
      .review(booking, stars, body)
      .then(() => {
        const prov = pr(booking.pid);
        if (prov) {
          prov.full = 0;
        }
        toast("¡Gracias! Tu reseña ya está publicada.");
      })
      .catch(() => {
        booking.reviewed = false;
        render();
      });
  } else {
    comm(booking.pid).reviews.unshift({
      n: uname() || "Cliente",
      s: stars,
      t: body,
      d: "hoy",
      reply: "",
    });
    toast("¡Gracias! Tu reseña ya está publicada.");
  }
  render();
  return;
});
registerClick("moreList", (ev, el, act) => {
  loadList(true);
  render();
  return;
});
registerClick("reloadList", (ev, el, act) => {
  S.list = null;
  render();
  return;
});
registerClick("refreshMine", (ev, el, act) => {
  api
    .myBookings()
    .then(render)
    .catch((err) => toast(errMsg(err)));
  return;
});
registerClick("verTurno", (ev, el, act) => {
  S.turnoId = +el.dataset.id;
  S.justBooked = false;
  go("turnoOk");
});
registerClick("goLocal", (ev, el, act) => {
  go("home");
});
// filtra la lista de clientes del panel mientras se escribe, sin volver a dibujar
registerInput("csearch", (ev) => {
  const query = ev.target.value.trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll(".clist li").forEach((row) => {
    const match = !query || row.dataset.name.includes(query);
    row.hidden = !match;
    if (match) {
      shown++;
    }
  });
  const none = $("#cnone");
  if (none) {
    none.hidden = shown > 0;
  }
  return;
});
registerSubmit("fSearch", (ev) => {
  S.q = ($("#q").value || "").trim().slice(0, 60);
  S.list = null;
  render();
  return;
});

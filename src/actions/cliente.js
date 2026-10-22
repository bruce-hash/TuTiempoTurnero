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

registerClick("inboxAll", (e, x, v) => {
  S.inboxAll = true;
  render();
  return;
});
registerClick("ptab", (e, x, v) => {
  S.ptab = x.dataset.t;
  S.rateFor = null;
  render();
  return;
});
registerClick("story", (e, x, v) => {
  const r = S.view === "perfil" ? S.pid : ME();
  S.story = {
    pid: r,
    i: +x.dataset.i || 0,
  };
  render();
  return;
});
registerClick("storyClose", (e, x, v) => {
  S.story = null;
  clearTimeout(store.STORY_T);
  render();
  return;
});
registerClick("storyNext", (e, x, v) => {
  const r = comm(S.story.pid).media;
  if (S.story.i < r.length - 1) {
    S.story.i++;
  } else {
    S.story = null;
  }
  render();
  return;
});
registerClick("storyPrev", (e, x, v) => {
  S.story.i = Math.max(0, S.story.i - 1);
  render();
  return;
});
registerClick("storyBook", (e, x, v) => {
  const r = S.story.pid;
  S.story = null;
  clearTimeout(store.STORY_T);
  S.ptab = "svc";
  if (S.role === "barbero") {
    render();
    return;
  }
  go("perfil", r);
  return;
});
registerClick("verTodos", (e, x, v) => {
  S.cat = "todos";
  S.q = "";
  render();
  return;
});
registerClick("rateOpen", (e, x, v) => {
  S.rateFor = +x.dataset.id;
  S.rateN = 0;
  render();
  return;
});
registerClick("sendReview", (e, x, v) => {
  const r = store.BOOK.find((u) => u.id === +x.dataset.id);
  const m = (($("#rateTxt") || {}).value || "").trim().slice(0, 600);
  if (!r || !S.rateN) {
    return;
  }
  const f = S.rateN;
  r.reviewed = true;
  S.rateFor = null;
  S.rateN = 0;
  if (LIVE) {
    api.m
      .review(r, f, m)
      .then(() => {
        const u = pr(r.pid);
        if (u) {
          u.full = 0;
        }
        toast("¡Gracias! Tu reseña ya está publicada.");
      })
      .catch(() => {
        r.reviewed = false;
        render();
      });
  } else {
    comm(r.pid).reviews.unshift({
      n: uname() || "Cliente",
      s: f,
      t: m,
      d: "hoy",
      reply: "",
    });
    toast("¡Gracias! Tu reseña ya está publicada.");
  }
  render();
  return;
});
registerClick("moreList", (e, x, v) => {
  loadList(true);
  render();
  return;
});
registerClick("reloadList", (e, x, v) => {
  S.list = null;
  render();
  return;
});
registerClick("refreshMine", (e, x, v) => {
  api
    .myBookings()
    .then(render)
    .catch((r) => toast(errMsg(r)));
  return;
});
registerClick("verTurno", (e, x, v) => {
  S.turnoId = +x.dataset.id;
  S.justBooked = false;
  go("turnoOk");
});
registerClick("goLocal", (e, x, v) => {
  go("home");
});
registerInput("csearch", (e) => {
  const a = e.target.value.trim().toLowerCase();
  let t = 0;
  document.querySelectorAll(".clist li").forEach((n) => {
    const o = !a || n.dataset.name.includes(a);
    n.hidden = !o;
    if (o) {
      t++;
    }
  });
  const s = $("#cnone");
  if (s) {
    s.hidden = t > 0;
  }
  return;
});
registerSubmit("fSearch", (e) => {
  S.q = ($("#q").value || "").trim().slice(0, 60);
  S.list = null;
  render();
  return;
});

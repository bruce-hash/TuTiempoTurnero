import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { feeFor, mustPayTotal, payNow } from "../lib/dinero.js";
import { $, esc } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { TODAY, addDays, dkey, toMin } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { selAdds, selDur, selPrice } from "../lib/servicios.js";
import { cfg, freed, happyAt, priceAt, seriesDates, skey, slotsFor, uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { myStamps, setMyStamps, stampGoal, svcByKey } from "../ui/sellos.js";
import { notif, toast } from "../ui/toast.js";
import { pushNotice } from "../views/prestador/mensajes.js";

async function liveBook(form) {
  const a = form.querySelector("button[type=submit]");
  if (a) {
    a.disabled = true;
    a.textContent = "Procesando…";
  }
  try {
    const t = await api.book({
      pid: S.pid,
      svcIdx: S.svc,
      date: S.slot.date,
      time: S.slot.time,
      rep: S.rep,
    });
    if (!t || t.redirect) {
      return;
    }
    if (S.payM === "reward") {
      S.payM = "mp";
    }
    S.turnoId = t.id;
    S.seriesMsg =
      t.count > 1
        ? `También reservaste ${t.count - 1} turno${t.count > 2 ? "s" : ""} más${t.skipped ? ` (${t.skipped} se salteó por estar ocupado)` : ""}.`
        : "";
    S.slot = null;
    S.rep = 0;
    S.justBooked = true;
    S.view = "turnoOk";
    render();
    window.scrollTo(0, 0);
    toast("Turno confirmado.");
  } catch (t) {
    const s = errMsg(t);
    const n = $("#terr");
    if (n) {
      n.textContent = s;
    } else {
      toast(s);
    }
    if (a) {
      a.disabled = false;
      a.textContent = "Reintentar";
    }
    if (/ocupar|disponible/.test(s)) {
      try {
        await api.loadProvider(S.pid, true);
      } catch (o) {}
      S.slot = null;
      go("perfil", S.pid);
      toast(s);
    }
  }
}
export function readIntake() {
  document.querySelectorAll("[data-iq]").forEach((e) => {
    S.intake = S.intake || {};
    const a = e.value.trim().slice(0, 200);
    if (a) {
      S.intake[e.dataset.iq] = a;
    } else {
      delete S.intake[e.dataset.iq];
    }
  });
}
registerClick("useReward", (e, x, v) => {
  const r = +x.dataset.id;
  const m = x.dataset.sk;
  const f = pr(r);
  if (LIVE && (!f || !f.full)) {
    S.payM = "reward";
    S.rewardFor = {
      pid: r,
      sk: m,
    };
    go("perfil", r);
    return;
  }
  const u = svcByKey(f, m);
  go("perfil", r);
  if (u) {
    S.svc = f.svcs.indexOf(u);
    S.slot = null;
    S.day = null;
  }
  S.payM = "reward";
  render();
  return;
});
registerClick("rebook", (e, x, v) => {
  const r = store.BOOK.find((N) => N.id === +x.dataset.id);
  if (!r) {
    return;
  }
  if (r.byProv) {
    r.rebooked = true;
  }
  const m = pr(r.pid);
  const f = m && m.svcs.findIndex((N) => N[0] === r.svc);
  S.pctx = r.cat || null;
  S.svc = f >= 0 ? f : 0;
  S.adds = [];
  S.intake = Object.assign({}, r.intake || {});
  S.slot = null;
  const u = dkey(addDays(+x.dataset.in || 0, +x.dataset.in ? r.date : TODAY()));
  const E = cfg(r.pid);
  const O = dkey(addDays(E.ahead - 1));
  S.day = u < TODAY() ? TODAY() : u > O ? O : u;
  S.wk = null;
  go("perfil", r.pid);
  return;
});
registerClick("reservarT", (e, x, v) => {
  if (!S.slot) {
    return;
  }
  S.rep = 0;
  if (S.user) {
    go("checkoutT");
  } else {
    S.after = "checkoutT";
    go("login");
  }
});
registerClick("waitlist", (e, x, v) => {
  if (!S.user) {
    S.after = "perfil";
    go("login");
    return;
  }
  store.WAIT.push({
    pid: S.pid,
    date: S.day,
    user: S.user.email,
  });
  api.m.waitlist(S.pid, S.day);
  toast("Listo. Si se libera un turno ese día, te avisamos con una notificación.");
  render();
});
registerClick("cancelAsk", (e, x, v) => {
  S.cancelAsk = true;
  render();
});
registerClick("cancelNo", (e, x, v) => {
  S.cancelAsk = false;
  render();
});
registerClick("cancelYes", (e, x, v) => {
  const r = store.BOOK.find((m) => m.id === S.turnoId);
  if (LIVE) {
    api.m
      .cancelClient(r)
      .then(() => Promise.all([api.myBookings(), api.myStamps()]))
      .then(() => {
        toast("Le avisamos al profesional. Lo pagado queda para el profesional.");
        S.cancelAsk = false;
        render();
      })
      .catch(() => {});
    return;
  }
  r.status = "cancelled";
  r.refund = 0;
  r.noGo = true;
  S.cancelAsk = false;
  S.justBooked = false;
  freed(r);
  if (r.pay === "reward" && !r.stampBack) {
    r.stampBack = true;
    const m = (pr(r.pid).svcs || []).find((f) => f[0] === r.svc);
    if (m) {
      setMyStamps(r.pid, m, myStamps(r.pid, m) + (r.rwGoal || stampGoal(r.pid, m)));
    }
  }
  toast("Le avisamos al profesional. Lo pagado queda para el profesional.");
  render();
});
registerClick("reprog", (e, x, v) => {
  const r = store.BOOK.find((f) => f.id === S.turnoId);
  S.reprog = r.id;
  S.pid = r.pid;
  const m = pr(r.pid);
  S.svc = Math.max(
    0,
    m.svcs.findIndex((f) => f[0] === r.svc),
  );
  S.day = r.date;
  S.slot = null;
  go("perfil", r.pid);
});
registerClick("reprogCancel", (e, x, v) => {
  const r = S.reprog;
  S.reprog = null;
  S.turnoId = r;
  go("turnoOk");
});
registerSubmit("fTurno", (e) => {
  const a = pr(S.pid);
  const t = a.svcs[S.svc];
  if (!S.slot) {
    go("perfil", a.id);
    return;
  }
  if (LIVE) {
    liveBook(e.target);
    return;
  }
  readIntake();
  const s = selDur(a);
  const n = selPrice(a);
  const o = selAdds(a).map((l) => l.slice(0, 3));
  if (!slotsFor(a.id, S.slot.date, s, S.reprog).list.some((l) => l.free && l.time === S.slot.time)) {
    S.slot = null;
    toast("Ese horario se acaba de ocupar. Elegí otro.");
    go("perfil", a.id);
    return;
  }
  S.seriesMsg = "";
  if (S.reprog) {
    const l = store.BOOK.find((c) => c.id === S.reprog);
    l.date = S.slot.date;
    l.time = S.slot.time;
    l.disc = happyAt(a.id, l.date, toMin(l.time));
    l.moved = true;
    S.turnoId = l.id;
    S.reprog = null;
  } else {
    const l = priceAt(a.id, n, S.slot.date, S.slot.time);
    const c = uname();
    const d = (j, b, g) => {
      const M = {
        id: store.BID++,
        pid: a.id,
        cat: t[3],
        addons: o,
        intake: Object.assign({}, S.intake),
        buf: cfg(a.id).buffer || 0,
        date: j,
        time: S.slot.time,
        dur: s,
        svc: t[0],
        price: priceAt(a.id, n, j, S.slot.time),
        disc: happyAt(a.id, j, toMin(S.slot.time)),
        cliente: c,
        src: "app",
        type: "local",
        status: "confirmed",
        paid: b,
        mine: true,
        late: 0,
        series: g,
      };
      M.fee = b > 0 ? feeFor(M.price) : 0;
      store.BOOK.push(M);
      return M;
    };
    const p = S.rep ? store.SID++ : 0;
    const w = stampGoal(a.id, t);
    const y = S.payM === "reward" && w > 0 && myStamps(a.id, t) >= w;
    const k = !y && S.payM === "cash" && cfg(a.id).cash !== false && !mustPayTotal(a.id, c);
    const h = d(S.slot.date, y ? 0 : payNow(a.id, l, c), p);
    h.pay = y ? "reward" : k ? "cash" : "mp";
    h.sk = skey(t);
    if (y) {
      h.list = h.price;
      h.price = 0;
      h.disc = 0;
      h.rwGoal = w;
      setMyStamps(a.id, t, myStamps(a.id, t) - w);
    }
    S.turnoId = h.id;
    S.newT++;
    S.payInfo = {
      b: h,
      what: t[0] + " en " + a.name,
    };
    if (S.rep) {
      let j = 0;
      let b = 0;
      seriesDates(S.slot.date, S.rep, 3).forEach((g) => {
        if (slotsFor(a.id, g, s, null, true).list.some((M) => M.free && M.time === S.slot.time)) {
          const M = d(g, payNow(a.id, priceAt(a.id, n, g, S.slot.time), c), p);
          M.pay = h.pay;
          j++;
        } else {
          b++;
        }
      });
      S.seriesMsg = `También reservaste ${j} turno${j === 1 ? "" : "s"} más, cada ${S.rep} semanas${b ? ` (${b} se salteó por estar ocupado)` : ""}.`;
    }
    pushNotice(a.id, "conf", h);
    notif(
      `<span class="mp" style="background:var(--brand)">🔔</span><div><b>${esc(a.name)}</b> ya tiene tu turno en su agenda.<br><span class="hint">En la demo, entrá como Prestador y abrí Agenda para verlo.</span></div>`,
    );
  }
  S.slot = null;
  S.rep = 0;
  S.adds = [];
  S.intake = {};
  if (S.payM === "reward") {
    S.payM = "mp";
  }
  S.justBooked = true;
  S.view = "turnoOk";
  render();
  window.scrollTo(0, 0);
  toast(
    S.turnoId && store.BOOK.find((l) => l.id === S.turnoId && l.pay === "reward")
      ? "Turno confirmado."
      : "Seña pagada. Turno confirmado.",
  );
  return;
});

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

// reserva en vivo: book() crea el turno en la base y, si hay que pagar, redirige a Mercado Pago.
// Si el horario se ocupó mientras tanto, vuelve al perfil con los horarios actualizados.
async function liveBook(form) {
  const btn = form.querySelector("button[type=submit]");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Procesando…";
  }
  try {
    const res = await api.book({
      pid: S.pid,
      svcIdx: S.svc,
      date: S.slot.date,
      time: S.slot.time,
      rep: S.rep,
    });
    if (!res || res.redirect) {
      return;
    }
    if (S.payM === "reward") {
      S.payM = "mp";
    }
    S.turnoId = res.id;
    S.seriesMsg =
      res.count > 1
        ? `También reservaste ${res.count - 1} turno${res.count > 2 ? "s" : ""} más${res.skipped ? ` (${res.skipped} se salteó por estar ocupado)` : ""}.`
        : "";
    S.slot = null;
    S.rep = 0;
    S.justBooked = true;
    S.view = "turnoOk";
    render();
    window.scrollTo(0, 0);
    toast("Turno confirmado.");
  } catch (err) {
    const msg = errMsg(err);
    const box = $("#terr");
    if (box) {
      box.textContent = msg;
    } else {
      toast(msg);
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Reintentar";
    }
    if (/ocupar|disponible/.test(msg)) {
      try {
        await api.loadProvider(S.pid, true);
      } catch (ignored) {}
      S.slot = null;
      go("perfil", S.pid);
      toast(msg);
    }
  }
}
// guarda en S.intake las respuestas a las preguntas previas al turno
export function readIntake() {
  document.querySelectorAll("[data-iq]").forEach((input) => {
    S.intake = S.intake || {};
    const value = input.value.trim().slice(0, 200);
    if (value) {
      S.intake[input.dataset.iq] = value;
    } else {
      delete S.intake[input.dataset.iq];
    }
  });
}
// “Reservar mi premio”: abre el perfil con el servicio del premio elegido
registerClick("useReward", (ev, el, act) => {
  const pid = +el.dataset.id;
  const sk = el.dataset.sk;
  const prov = pr(pid);
  if (LIVE && (!prov || !prov.full)) {
    S.payM = "reward";
    S.rewardFor = {
      pid: pid,
      sk: sk,
    };
    go("perfil", pid);
    return;
  }
  const svc = svcByKey(prov, sk);
  go("perfil", pid);
  if (svc) {
    S.svc = prov.svcs.indexOf(svc);
    S.slot = null;
    S.day = null;
  }
  S.payM = "reward";
  render();
  return;
});
// volver a sacar un turno parecido (data-in = días después del anterior), dentro de los días habilitados
registerClick("rebook", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === +el.dataset.id);
  if (!booking) {
    return;
  }
  if (booking.byProv || booking.byRefund) {
    booking.rebooked = true;
  }
  const prov = pr(booking.pid);
  const svcIndex = prov && prov.svcs.findIndex((row) => row[0] === booking.svc);
  S.pctx = booking.cat || null;
  S.svc = svcIndex >= 0 ? svcIndex : 0;
  S.adds = [];
  S.intake = Object.assign({}, booking.intake || {});
  S.slot = null;
  const wanted = dkey(addDays(+el.dataset.in || 0, +el.dataset.in ? booking.date : TODAY()));
  const conf = cfg(booking.pid);
  const lastDay = dkey(addDays(conf.ahead - 1));
  S.day = wanted < TODAY() ? TODAY() : wanted > lastDay ? lastDay : wanted;
  S.wk = null;
  go("perfil", booking.pid);
  return;
});
registerClick("reservarT", (ev, el, act) => {
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
registerClick("waitlist", (ev, el, act) => {
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
registerClick("cancelAsk", (ev, el, act) => {
  S.cancelAsk = true;
  render();
});
registerClick("cancelNo", (ev, el, act) => {
  S.cancelAsk = false;
  render();
});
registerClick("cancelYes", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === S.turnoId);
  if (LIVE) {
    api.m
      .cancelClient(booking)
      .then(() => Promise.all([api.myBookings(), api.myStamps()]))
      .then(() => {
        toast("Le avisamos al profesional. Lo pagado queda para el profesional.");
        S.cancelAsk = false;
        render();
      })
      .catch(() => {});
    return;
  }
  booking.status = "cancelled";
  booking.refund = 0;
  booking.noGo = true;
  S.cancelAsk = false;
  S.justBooked = false;
  freed(booking);
  if (booking.pay === "reward" && !booking.stampBack) {
    booking.stampBack = true;
    const svc = (pr(booking.pid).svcs || []).find((row) => row[0] === booking.svc);
    if (svc) {
      setMyStamps(booking.pid, svc, myStamps(booking.pid, svc) + (booking.rwGoal || stampGoal(booking.pid, svc)));
    }
  }
  toast("Le avisamos al profesional. Lo pagado queda para el profesional.");
  render();
});
registerClick("reprog", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === S.turnoId);
  S.reprog = booking.id;
  S.pid = booking.pid;
  const prov = pr(booking.pid);
  S.svc = Math.max(
    0,
    prov.svcs.findIndex((row) => row[0] === booking.svc),
  );
  S.day = booking.date;
  S.slot = null;
  go("perfil", booking.pid);
});
registerClick("reprogCancel", (ev, el, act) => {
  const id = S.reprog;
  S.reprog = null;
  S.turnoId = id;
  go("turnoOk");
});
// confirmar la reserva. En vivo, liveBook; en la demo se crea acá (o se mueve, si es una reprogramación),
// con la serie si se repite (los ocupados se saltean) y el pago con seña, efectivo o premio de sellos
registerSubmit("fTurno", (ev) => {
  const prov = pr(S.pid);
  const svc = prov.svcs[S.svc];
  if (!S.slot) {
    go("perfil", prov.id);
    return;
  }
  if (LIVE) {
    liveBook(ev.target);
    return;
  }
  readIntake();
  const dur = selDur(prov);
  const base = selPrice(prov);
  const addons = selAdds(prov).map((addon) => addon.slice(0, 3));
  if (!slotsFor(prov.id, S.slot.date, dur, S.reprog).list.some((slot) => slot.free && slot.time === S.slot.time)) {
    S.slot = null;
    toast("Ese horario se acaba de ocupar. Elegí otro.");
    go("perfil", prov.id);
    return;
  }
  S.seriesMsg = "";
  if (S.reprog) {
    const booking = store.BOOK.find((item) => item.id === S.reprog);
    booking.date = S.slot.date;
    booking.time = S.slot.time;
    booking.disc = happyAt(prov.id, booking.date, toMin(booking.time));
    booking.moved = true;
    S.turnoId = booking.id;
    S.reprog = null;
  } else {
    const price = priceAt(prov.id, base, S.slot.date, S.slot.time);
    const user = uname();
    const makeBooking = (date, paid, series) => {
      const booking = {
        id: store.BID++,
        pid: prov.id,
        cat: svc[3],
        addons: addons,
        intake: Object.assign({}, S.intake),
        buf: cfg(prov.id).buffer || 0,
        date: date,
        time: S.slot.time,
        dur: dur,
        svc: svc[0],
        price: priceAt(prov.id, base, date, S.slot.time),
        disc: happyAt(prov.id, date, toMin(S.slot.time)),
        cliente: user,
        src: "app",
        type: "local",
        status: "confirmed",
        paid: paid,
        mine: true,
        late: 0,
        series: series,
      };
      booking.fee = paid > 0 ? feeFor(booking.price) : 0;
      store.BOOK.push(booking);
      return booking;
    };
    const seriesId = S.rep ? store.SID++ : 0;
    const goal = stampGoal(prov.id, svc);
    const redeem = S.payM === "reward" && goal > 0 && myStamps(prov.id, svc) >= goal;
    const cash = !redeem && S.payM === "cash" && cfg(prov.id).cash !== false && !mustPayTotal(prov.id, user);
    const first = makeBooking(S.slot.date, redeem ? 0 : payNow(prov.id, price, user), seriesId);
    first.pay = redeem ? "reward" : cash ? "cash" : "mp";
    first.sk = skey(svc);
    if (redeem) {
      first.list = first.price;
      first.price = 0;
      first.disc = 0;
      first.rwGoal = goal;
      setMyStamps(prov.id, svc, myStamps(prov.id, svc) - goal);
    }
    S.turnoId = first.id;
    S.newT++;
    S.payInfo = {
      b: first,
      what: svc[0] + " en " + prov.name,
    };
    if (S.rep) {
      let made = 0;
      let skipped = 0;
      seriesDates(S.slot.date, S.rep, 3).forEach((date) => {
        if (slotsFor(prov.id, date, dur, null, true).list.some((slot) => slot.free && slot.time === S.slot.time)) {
          const booking = makeBooking(date, payNow(prov.id, priceAt(prov.id, base, date, S.slot.time), user), seriesId);
          booking.pay = first.pay;
          made++;
        } else {
          skipped++;
        }
      });
      S.seriesMsg = `También reservaste ${made} turno${made === 1 ? "" : "s"} más, cada ${S.rep} semanas${skipped ? ` (${skipped} se salteó por estar ocupado)` : ""}.`;
    }
    pushNotice(prov.id, "conf", first);
    notif(
      `<span class="mp" style="background:var(--brand)">🔔</span><div><b>${esc(prov.name)}</b> ya tiene tu turno en su agenda.<br><span class="hint">En la demo, entrá como Prestador y abrí Agenda para verlo.</span></div>`,
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
    S.turnoId && store.BOOK.find((item) => item.id === S.turnoId && item.pay === "reward")
      ? "Turno confirmado."
      : "Seña pagada. Turno confirmado.",
  );
  return;
});

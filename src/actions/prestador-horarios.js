import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { parseWhole } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, addDays, dkey, pad, toMin } from "../lib/fechas.js";
import { ME } from "../lib/prestadores.js";
import { busy, cfg, isDayBlock, ranges } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { blockDays } from "../views/prestador/bloqueo-dias.js";
import { lowWindows } from "../views/prestador/estadisticas.js";

registerClick("dbConfirm", (ev, el, act) => {
  const ask = S.dbAsk;
  if (!ask) {
    return;
  }
  blockDays(ask.from, ask.to, ask.why);
  return;
});
registerClick("dbAskNo", (ev, el, act) => {
  S.dbAsk = null;
  render();
  return;
});
registerClick("dbCancelClose", (ev, el, act) => {
  S.dbCancelled = null;
  render();
  return;
});
registerClick("dbQuick", (ev, el, act) => {
  const from = ($("#dbf") || {}).value || dkey(addDays(1));
  S.db = {
    from: from,
    to: dkey(addDays(+el.dataset.d, from)),
    why: ($("#dbr") || {}).value || "Vacaciones",
  };
  render();
  return;
});
registerClick("dbDel", (ev, el, act) => {
  const ids = el.dataset.ids.split(",").map(Number);
  const blocks = store.BOOK.filter((booking) => ids.includes(booking.id));
  store.BOOK = store.BOOK.filter((booking) => !ids.includes(booking.id));
  blocks.forEach((block) => api.m.delBooking(block));
  toast(`Desbloqueaste ${blocks.length} día${blocks.length > 1 ? "s" : ""}.`);
  render();
  return;
});
// completa el happy hour con los días y horas de las franjas más tranquilas (falta tocar Guardar)
registerClick("hhSuggest", (ev, el, act) => {
  const wins = lowWindows();
  if (!wins.length) {
    toast("Todavía no hay datos suficientes");
    return;
  }
  const dows = [...new Set(wins.map((win) => win.dow))];
  const fromH = Math.min(...wins.map((win) => win.h));
  const toH = Math.max(...wins.map((win) => win.e));
  $("#hhon").checked = true;
  [0, 1, 2, 3, 4, 5, 6].forEach((dow) => {
    $("#hhd" + dow).checked = dows.includes(dow);
  });
  $("#hhf").value = pad(fromH) + ":00";
  $("#hht").value = pad(toH) + ":00";
  toast("Cargamos tus horarios más flojos. Tocá Guardar para aplicarlo.");
});
registerClick("copyMon", (ev, el, act) => {
  const mon = [
    $("#hmf1").value,
    $("#hmt1").value,
    $("#hm1").checked,
    $("#htf1").value,
    $("#htt1").value,
    $("#ht1").checked,
  ];
  [2, 3, 4, 5, 6, 0].forEach((dow) => {
    if ($("#hd" + dow).checked) {
      $("#hmf" + dow).value = mon[0];
      $("#hmt" + dow).value = mon[1];
      $("#hm" + dow).checked = mon[2];
      $("#htf" + dow).value = mon[3];
      $("#htt" + dow).value = mon[4];
      $("#ht" + dow).checked = mon[5];
      ["m", "t"].forEach((part) => {
        const on = $("#h" + part + dow).checked;
        $("#h" + part + "f" + dow).disabled = !on;
        $("#h" + part + "t" + dow).disabled = !on;
        $("#h" + part + dow)
          .closest(".rng")
          .classList.toggle("off", !on);
      });
    }
  });
  toast("Copiado a los días abiertos. Tocá Guardar horarios.");
});
// bloquear días: valida (hasta 92 días, no en el pasado) y, si hay turnos esos días, pide confirmar antes
registerSubmit("fDayBlock", (ev) => {
  const pid = ME();
  const conf = cfg(pid);
  const from = $("#dbf").value;
  const to = $("#dbt").value;
  const reason = ($("#dbr").value.trim() || "Día libre").slice(0, 40);
  const showErr = (msg) => {
    $("#dberr").textContent = msg;
  };
  if (!from || !to) {
    return showErr("Elegí desde y hasta.");
  }
  if (from < TODAY()) {
    return showErr("No se pueden bloquear días que ya pasaron.");
  }
  if (to < from) {
    return showErr("“Hasta” tiene que ser igual o posterior a “Desde”.");
  }
  const nDays =
    Math.round(
      /* @__PURE__ */ (new Date(to + "T12:00:00") - /* @__PURE__ */ new Date(from + "T12:00:00")) / 864e5,
    ) + 1;
  if (nDays > 92) {
    return showErr("Podés bloquear hasta 3 meses de una vez.");
  }
  const openDays = [];
  const affected = [];
  for (let offset = 0; offset < nDays; offset++) {
    const date = dkey(addDays(offset, from));
    if (!ranges(conf, /* @__PURE__ */ new Date(date + "T12:00:00").getDay()).length) {
      continue;
    }
    const dayBookings = busy(pid, date);
    if (!dayBookings.some((item) => isDayBlock(item))) {
      openDays.push(date);
      dayBookings.filter((item) => item.type !== "block" && item.type !== "walk" && item.status === "confirmed").forEach((item) =>
        affected.push(item),
      );
    }
  }
  if (!openDays.length) {
    return showErr("Esos días ya estaban cerrados o bloqueados.");
  }
  S.db = {
    from: from,
    to: to,
    why: reason,
  };
  if (affected.length) {
    S.dbAsk = {
      from: from,
      to: to,
      why: reason,
      list: affected.sort((one, other) => (one.date + one.time).localeCompare(other.date + other.time)),
    };
    render();
    return;
  }
  blockDays(from, to, reason);
  return;
});
// guardar horarios: valida cada día y el happy hour; con errores los marca y no guarda nada
registerSubmit("fHorarios", (ev) => {
  const conf = cfg(ME());
  const errs = {};
  const days = {};
  let anyOpen = false;
  for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
    const open = $("#hd" + dow).checked;
    const readRange = (part) => ({
      on: $("#h" + part + dow).checked,
      from: $("#h" + part + "f" + dow).value || conf.days[dow][part].from,
      to: $("#h" + part + "t" + dow).value || conf.days[dow][part].to,
    });
    const morning = readRange("m");
    const afternoon = readRange("t");
    days[dow] = {
      on: open,
      m: morning,
      t: afternoon,
    };
    if (open) {
      anyOpen = true;
      if (!morning.on && !afternoon.on) {
        errs["d" + dow] = "Activá el turno mañana, el de la tarde o los dos.";
      } else if (morning.on && toMin(morning.to) <= toMin(morning.from)) {
        errs["d" + dow] = "La mañana tiene que terminar después de empezar.";
      } else if (afternoon.on && toMin(afternoon.to) <= toMin(afternoon.from)) {
        errs["d" + dow] = "La tarde tiene que terminar después de empezar.";
      } else if (morning.on && afternoon.on && toMin(afternoon.from) < toMin(morning.to)) {
        errs["d" + dow] = "La tarde tiene que empezar cuando termina la mañana o después.";
      }
    }
  }
  if (!anyOpen) {
    errs.days = "Activá al menos un día.";
  }
  const pct = parseWhole($("#hhp").value);
  if ($("#hhon").checked) {
    const from = $("#hhf").value;
    const to = $("#hht").value;
    if (!pct || pct < 1 || pct > 90) {
      errs.hh = "El descuento tiene que ser un número entre 1 y 90.";
    } else if (!from || !to || toMin(to) <= toMin(from)) {
      errs.hh = "El happy hour tiene que terminar después de empezar.";
    } else if (![0, 1, 2, 3, 4, 5, 6].some((dow) => $("#hhd" + dow).checked)) {
      errs.hh = "Elegí al menos un día para el happy hour.";
    }
  }
  document.querySelectorAll("#fHorarios .ferr").forEach((el) => (el.textContent = ""));
  if (Object.keys(errs).length) {
    Object.entries(errs).forEach(([key, msg]) => {
      const el = $("#herr-" + key);
      if (el) {
        el.textContent = msg;
      }
    });
    const first = $("#herr-" + Object.keys(errs)[0]);
    if (first && first.scrollIntoView) {
      first.scrollIntoView({
        block: "center",
      });
    }
    toast("Revisá lo marcado en rojo. Tus cambios siguen ahí.");
    return;
  }
  conf.days = days;
  conf.buffer = +(($("#hbuf") || {}).value || 0);
  conf.step = +$("#hst").value;
  conf.ahead = 31;
  conf.notice = +$("#hno").value;
  const pay = $("#hpay").value;
  if (pay === "total") {
    conf.pay = "total";
  } else {
    conf.pay = "sena";
    conf.pct = +pay.replace("sena", "");
  }
  conf.strict = false;
  conf.happy = {
    on: $("#hhon").checked,
    pct: pct || conf.happy.pct,
    from: $("#hhf").value,
    to: $("#hht").value,
    days: [0, 1, 2, 3, 4, 5, 6].filter((dow) => $("#hhd" + dow).checked),
  };
  S.hErr = null;
  api.m.saveSettings(conf);
  toast("Horarios guardados. Ya se ven en tu perfil.");
  render();
  return;
});

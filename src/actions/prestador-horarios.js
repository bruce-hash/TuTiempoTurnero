import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
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

registerClick("dbConfirm", (e, x, v) => {
  const r = S.dbAsk;
  if (!r) {
    return;
  }
  blockDays(r.from, r.to, r.why);
  return;
});
registerClick("dbAskNo", (e, x, v) => {
  S.dbAsk = null;
  render();
  return;
});
registerClick("dbCancelClose", (e, x, v) => {
  S.dbCancelled = null;
  render();
  return;
});
registerClick("dbQuick", (e, x, v) => {
  const r = ($("#dbf") || {}).value || dkey(addDays(1));
  S.db = {
    from: r,
    to: dkey(addDays(+x.dataset.d, r)),
    why: ($("#dbr") || {}).value || "Vacaciones",
  };
  render();
  return;
});
registerClick("dbDel", (e, x, v) => {
  const r = x.dataset.ids.split(",").map(Number);
  const m = store.BOOK.filter((f) => r.includes(f.id));
  store.BOOK = store.BOOK.filter((f) => !r.includes(f.id));
  m.forEach((f) => api.m.delBooking(f));
  toast(`Desbloqueaste ${m.length} día${m.length > 1 ? "s" : ""}.`);
  render();
  return;
});
registerClick("hhSuggest", (e, x, v) => {
  const r = lowWindows();
  if (!r.length) {
    toast("Todavía no hay datos suficientes");
    return;
  }
  const m = [...new Set(r.map((E) => E.dow))];
  const f = Math.min(...r.map((E) => E.h));
  const u = Math.max(...r.map((E) => E.e));
  $("#hhon").checked = true;
  [0, 1, 2, 3, 4, 5, 6].forEach((E) => {
    $("#hhd" + E).checked = m.includes(E);
  });
  $("#hhf").value = pad(f) + ":00";
  $("#hht").value = pad(u) + ":00";
  toast("Cargamos tus horarios más flojos. Tocá Guardar para aplicarlo.");
});
registerClick("copyMon", (e, x, v) => {
  const r = [
    $("#hmf1").value,
    $("#hmt1").value,
    $("#hm1").checked,
    $("#htf1").value,
    $("#htt1").value,
    $("#ht1").checked,
  ];
  [2, 3, 4, 5, 6, 0].forEach((m) => {
    if ($("#hd" + m).checked) {
      $("#hmf" + m).value = r[0];
      $("#hmt" + m).value = r[1];
      $("#hm" + m).checked = r[2];
      $("#htf" + m).value = r[3];
      $("#htt" + m).value = r[4];
      $("#ht" + m).checked = r[5];
      ["m", "t"].forEach((f) => {
        const u = $("#h" + f + m).checked;
        $("#h" + f + "f" + m).disabled = !u;
        $("#h" + f + "t" + m).disabled = !u;
        $("#h" + f + m)
          .closest(".rng")
          .classList.toggle("off", !u);
      });
    }
  });
  toast("Copiado a los días abiertos. Tocá Guardar horarios.");
});
registerSubmit("fDayBlock", (e) => {
  const a = ME();
  const t = cfg(a);
  const s = $("#dbf").value;
  const n = $("#dbt").value;
  const o = ($("#dbr").value.trim() || "Día libre").slice(0, 40);
  const i = (p) => {
    $("#dberr").textContent = p;
  };
  if (!s || !n) {
    return i("Elegí desde y hasta.");
  }
  if (s < TODAY()) {
    return i("No se pueden bloquear días que ya pasaron.");
  }
  if (n < s) {
    return i("“Hasta” tiene que ser igual o posterior a “Desde”.");
  }
  const l =
    Math.round(
      /* @__PURE__ */ (new Date(n + "T12:00:00") - /* @__PURE__ */ new Date(s + "T12:00:00")) / 864e5,
    ) + 1;
  if (l > 92) {
    return i("Podés bloquear hasta 3 meses de una vez.");
  }
  const c = [];
  const d = [];
  for (let p = 0; p < l; p++) {
    const w = dkey(addDays(p, s));
    if (!ranges(t, /* @__PURE__ */ new Date(w + "T12:00:00").getDay()).length) {
      continue;
    }
    const y = busy(a, w);
    if (!y.some((k) => isDayBlock(k))) {
      c.push(w);
      y.filter((k) => k.type !== "block" && k.type !== "walk" && k.status === "confirmed").forEach((k) =>
        d.push(k),
      );
    }
  }
  if (!c.length) {
    return i("Esos días ya estaban cerrados o bloqueados.");
  }
  S.db = {
    from: s,
    to: n,
    why: o,
  };
  if (d.length) {
    S.dbAsk = {
      from: s,
      to: n,
      why: o,
      list: d.sort((p, w) => (p.date + p.time).localeCompare(w.date + w.time)),
    };
    render();
    return;
  }
  blockDays(s, n, o);
  return;
});
registerSubmit("fHorarios", (e) => {
  const a = cfg(ME());
  const t = {};
  const s = {};
  let n = false;
  for (const l of [0, 1, 2, 3, 4, 5, 6]) {
    const c = $("#hd" + l).checked;
    const d = (y) => ({
      on: $("#h" + y + l).checked,
      from: $("#h" + y + "f" + l).value || a.days[l][y].from,
      to: $("#h" + y + "t" + l).value || a.days[l][y].to,
    });
    const p = d("m");
    const w = d("t");
    s[l] = {
      on: c,
      m: p,
      t: w,
    };
    if (c) {
      n = true;
      if (!p.on && !w.on) {
        t["d" + l] = "Activá el turno mañana, el de la tarde o los dos.";
      } else if (p.on && toMin(p.to) <= toMin(p.from)) {
        t["d" + l] = "La mañana tiene que terminar después de empezar.";
      } else if (w.on && toMin(w.to) <= toMin(w.from)) {
        t["d" + l] = "La tarde tiene que terminar después de empezar.";
      } else if (p.on && w.on && toMin(w.from) < toMin(p.to)) {
        t["d" + l] = "La tarde tiene que empezar cuando termina la mañana o después.";
      }
    }
  }
  if (!n) {
    t.days = "Activá al menos un día.";
  }
  const o = parseInt(($("#hhp").value || "").replace(/\D/g, ""));
  if ($("#hhon").checked) {
    const l = $("#hhf").value;
    const c = $("#hht").value;
    if (!o || o < 1 || o > 90) {
      t.hh = "El descuento tiene que ser un número entre 1 y 90.";
    } else if (!l || !c || toMin(c) <= toMin(l)) {
      t.hh = "El happy hour tiene que terminar después de empezar.";
    } else if (![0, 1, 2, 3, 4, 5, 6].some((d) => $("#hhd" + d).checked)) {
      t.hh = "Elegí al menos un día para el happy hour.";
    }
  }
  document.querySelectorAll("#fHorarios .ferr").forEach((l) => (l.textContent = ""));
  if (Object.keys(t).length) {
    Object.entries(t).forEach(([c, d]) => {
      const p = $("#herr-" + c);
      if (p) {
        p.textContent = d;
      }
    });
    const l = $("#herr-" + Object.keys(t)[0]);
    if (l && l.scrollIntoView) {
      l.scrollIntoView({
        block: "center",
      });
    }
    toast("Revisá lo marcado en rojo. Tus cambios siguen ahí.");
    return;
  }
  a.days = s;
  a.buffer = +(($("#hbuf") || {}).value || 0);
  a.step = +$("#hst").value;
  a.ahead = 31;
  a.notice = +$("#hno").value;
  const i = $("#hpay").value;
  if (i === "total") {
    a.pay = "total";
  } else {
    a.pay = "sena";
    a.pct = +i.replace("sena", "");
  }
  a.strict = false;
  a.happy = {
    on: $("#hhon").checked,
    pct: o || a.happy.pct,
    from: $("#hhf").value,
    to: $("#hht").value,
    days: [0, 1, 2, 3, 4, 5, 6].filter((l) => $("#hhd" + l).checked),
  };
  S.hErr = null;
  api.m.saveSettings(a);
  toast("Horarios guardados. Ya se ven en tu perfil.");
  render();
  return;
});

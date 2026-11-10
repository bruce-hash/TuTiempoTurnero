import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { admCloseDemo, admFixedSaveDemo, admFixedStopDemo } from "../demo/admin.js";
import { PESOS_ERR, money, parsePesos } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { MESES, TODAY, pad } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { admFin } from "../views/admin/datos.js";

registerClick("admY", (ev, el, act) => {
  S.admY = +el.dataset.y;
  S.admM = null;
  render();
  return;
});
registerClick("admM", (ev, el, act) => {
  S.admM = el.dataset.m || null;
  S.admFxEd = S.admExpEd = null;
  if (S.admM) {
    S.admY = +S.admM.slice(0, 4);
  }
  render();
  window.scrollTo(0, 0);
  return;
});
// mes anterior o siguiente en el balance (nunca después del mes en curso)
registerClick("admMn", (ev, el, act) => {
  if (!S.admM) {
    return;
  }
  const [year, month] = S.admM.split("-").map(Number);
  const date = new Date(year, month - 1 + +el.dataset.d, 15);
  const ym = date.getFullYear() + "-" + pad(date.getMonth() + 1);
  if (ym > TODAY().slice(0, 7)) {
    return;
  }
  S.admM = ym;
  S.admY = date.getFullYear();
  S.admFxEd = S.admExpEd = null;
  render();
  return;
});
// cerrar (con doble toque de confirmación) o reabrir un mes o un año del balance
registerClick(["admClose", "admReopen"], (ev, el, act) => {
  const kind = el.dataset.k;
  const period = el.dataset.p;
  const closing = act === "admClose";
  const label = kind === "year" ? "el año " + period.slice(0, 4) : MESES[+period.slice(5, 7) - 1];
  if (closing && S.admCloseAsk !== kind + period) {
    S.admCloseAsk = kind + period;
    toast(`Tocá de nuevo para cerrar ${label}: los números quedan fijos.`);
    setTimeout(() => {
      S.admCloseAsk = null;
    }, 3500);
    return;
  }
  S.admCloseAsk = null;
  if (LIVE) {
    el.disabled = true;
    (closing ? api.m.adminClose(kind, period) : api.m.adminReopen(kind, period))
      .then(() => {
        if (S.admFin) {
          delete S.admFin[+period.slice(0, 4)];
        }
        toast(closing ? `Cerraste ${label}.` : `Reabriste ${label}.`);
        render();
      })
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  if (!closing && kind === "month" && store.DEMO_ACL["year|" + period.slice(0, 4)]) {
    toast("El año está cerrado: reabrí el año primero.");
    return;
  }
  admCloseDemo(closing, kind, period);
  toast(closing ? `Cerraste ${label}. Los números quedaron fijos.` : `Reabriste ${label}.`);
  render();
  return;
});
registerClick("admExpDel", (ev, el, act) => {
  const id = +el.dataset.id;
  if (LIVE) {
    api.m
      .adminDelExp(id)
      .then(() => {
        S.admFin = null;
        toast("Gasto borrado.");
        render();
      })
      .catch(() => {});
    return;
  }
  const exp = store.DEMO_AEXP.find((item) => item.id === id);
  if (!exp || exp.fixed_id) {
    return;
  }
  if (store.DEMO_ACL["month|" + exp.day.slice(0, 7)]) {
    toast("El mes está cerrado: reabrilo para cambiarlo.");
    return;
  }
  store.DEMO_AEXP = store.DEMO_AEXP.filter((item) => item.id !== id);
  toast("Gasto borrado.");
  render();
  return;
});
// gasto variable de la plataforma: en el mes en curso se fecha hoy, en meses pasados el día 1
registerSubmit("fAdmExp", (ev) => {
  const ym = ev.target.dataset.m;
  const concept = String($("#aec").value || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80);
  const amount = parsePesos($("#aem").value);
  const showErr = (msg) => {
    $("#aeerr").textContent = msg;
  };
  if (!concept) {
    return showErr("Escribí el concepto.");
  }
  if (isNaN(amount)) {
    return showErr(PESOS_ERR);
  }
  if (!(amount >= 1) || !(amount <= 2e9)) {
    return showErr("Escribí el monto.");
  }
  const day = ym === TODAY().slice(0, 7) ? TODAY() : ym + "-01";
  if (LIVE) {
    api.m
      .adminAddExp(day, concept, amount)
      .then(() => {
        S.admFin = null;
        toast("Gasto cargado.");
        render();
      })
      .catch(() => {});
    return;
  }
  if (store.DEMO_ACL["month|" + ym]) {
    return showErr("El mes está cerrado: reabrilo para cambiarlo.");
  }
  store.DEMO_AEXP.push({
    id: store.AEID++,
    day: day,
    concept: concept,
    amount: amount,
  });
  toast("Gasto cargado.");
  render();
  return;
});

// D44 · gastos variables: ✎ abre el editor de un gasto (otra vez, lo cierra); se cambia el concepto y el monto
const cleanConcept = (value) =>
  String(value || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80);
registerClick("admExpEdit", (ev, el, act) => {
  const id = el.dataset.id ? +el.dataset.id : null;
  S.admExpEd = id && S.admExpEd !== id ? id : null;
  render();
  $("#aeem") && $("#aeem").focus();
});
registerSubmit("fAdmExpEd", (ev) => {
  const id = +ev.target.dataset.id;
  const concept = cleanConcept($("#aeec").value);
  const amount = parsePesos($("#aeem").value);
  const showErr = (msg) => {
    $("#aeeerr").textContent = msg;
  };
  if (!concept) {
    return showErr("Escribí el concepto.");
  }
  if (isNaN(amount)) {
    return showErr(PESOS_ERR);
  }
  if (!(amount >= 1) || !(amount <= 2e9)) {
    return showErr("Escribí el monto.");
  }
  if (LIVE) {
    api.m
      .adminUpdExp(id, concept, amount)
      .then(() => {
        S.admExpEd = null;
        S.admFin = null;
        toast("Gasto cambiado.");
        render();
      })
      .catch(() => {});
    return;
  }
  const exp = store.DEMO_AEXP.find((item) => item.id === id);
  if (!exp || exp.fixed_id) {
    return;
  }
  if (store.DEMO_ACL["month|" + exp.day.slice(0, 7)]) {
    return showErr("El mes está cerrado: reabrilo para cambiarlo.");
  }
  Object.assign(exp, { concept, amount });
  S.admExpEd = null;
  toast("Gasto cambiado.");
  render();
});
// D44 · gastos fijos de TuTiempo (como C31/S17 del profesional): ✎ abre el editor; guardar vale desde el mes actual en
// adelante; «Dejar de repetirlo» lo saca desde el mes actual. En vivo lo hace la base y se vuelve a pedir el balance.
const fixedById = (id) => {
  const fin = admFin(+String(S.admM || TODAY()).slice(0, 4));
  return ((fin && fin.fixed_items) || []).find((item) => String(item.id) === String(id)) || null;
};
const demoFixed = (id) => (store.DEMO_AFIX || []).find((item) => String(item.id) === String(id)) || null;
registerClick("admFxEdit", (ev, el, act) => {
  const item = fixedById(el.dataset.id);
  S.admFxEd = item && S.admFxEd !== item.id ? item.id : null;
  render();
  $("#afm") && $("#afm").focus();
});
registerClick("admFxNew", (ev, el, act) => {
  S.admFxEd = "new";
  render();
  $("#afc") && $("#afc").focus();
});
registerClick("admFxClose", (ev, el, act) => {
  S.admFxEd = null;
  render();
});
registerSubmit("fAdmFixed", (ev) => {
  const form = ev.target;
  const ym = form.dataset.ym;
  const item = form.dataset.id ? fixedById(form.dataset.id) : null;
  const concept = cleanConcept($("#afc").value);
  const amountTxt = ($("#afm").value || "").trim();
  const amount = amountTxt === "" ? 0 : parsePesos(amountTxt);
  const showErr = (msg) => {
    $("#aferr").textContent = msg;
  };
  if (!concept) {
    return showErr("Escribí qué gasto es.");
  }
  if (isNaN(amount) || amount < 0 || amount > 2e9) {
    return showErr(PESOS_ERR);
  }
  if (!item && amount <= 0) {
    return showErr("Ingresá cuánto se paga por mes.");
  }
  const done = () => {
    S.admFxEd = null;
    toast(amount ? `Guardado: ${concept} · ${money(amount)} por mes, desde ${MESES[+ym.slice(5) - 1]}.` : `${concept} quedó sin monto desde ${MESES[+ym.slice(5) - 1]}.`);
    render();
  };
  if (LIVE) {
    api.m
      .adminFixedSave(item ? item.id : null, concept, amount, ym)
      .then(() => {
        S.admFin = null;
        done();
      })
      .catch(() => {});
    return;
  }
  const problem = admFixedSaveDemo(item ? demoFixed(item.id) : null, concept, amount, ym);
  if (problem) {
    return showErr(problem);
  }
  done();
});
registerClick("admFxStop", (ev, el, act) => {
  const item = fixedById(el.dataset.id);
  const ym = el.dataset.ym;
  if (!item) {
    return;
  }
  const done = () => {
    S.admFxEd = null;
    toast(`${item.concept} deja de repetirse desde ${MESES[+ym.slice(5) - 1]}.`);
    render();
  };
  if (LIVE) {
    api.m
      .adminFixedStop(item.id, ym)
      .then(() => {
        S.admFin = null;
        done();
      })
      .catch(() => {});
    return;
  }
  const problem = admFixedStopDemo(demoFixed(item.id), ym);
  if (problem) {
    toast(problem);
    return;
  }
  done();
});

import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { admCloseDemo } from "../demo/admin.js";
import { $ } from "../lib/dom.js";
import { MESES, TODAY, pad } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("admY", (ev, el, act) => {
  S.admY = +el.dataset.y;
  S.admM = null;
  render();
  return;
});
registerClick("admM", (ev, el, act) => {
  S.admM = el.dataset.m || null;
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
  if (!exp) {
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
// gasto de la plataforma: en el mes en curso se fecha hoy, en meses pasados el día 1
registerSubmit("fAdmExp", (ev) => {
  const ym = ev.target.dataset.m;
  const concept = String($("#aec").value || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80);
  const amount = parseInt(String($("#aem").value).replace(/\D/g, ""), 10);
  const showErr = (msg) => {
    $("#aeerr").textContent = msg;
  };
  if (!concept) {
    return showErr("Escribí el concepto.");
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

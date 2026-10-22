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

registerClick("admY", (e, x, v) => {
  S.admY = +x.dataset.y;
  S.admM = null;
  render();
  return;
});
registerClick("admM", (e, x, v) => {
  S.admM = x.dataset.m || null;
  if (S.admM) {
    S.admY = +S.admM.slice(0, 4);
  }
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("admMn", (e, x, v) => {
  if (!S.admM) {
    return;
  }
  const [r, m] = S.admM.split("-").map(Number);
  const f = new Date(r, m - 1 + +x.dataset.d, 15);
  const u = f.getFullYear() + "-" + pad(f.getMonth() + 1);
  if (u > TODAY().slice(0, 7)) {
    return;
  }
  S.admM = u;
  S.admY = f.getFullYear();
  render();
  return;
});
registerClick(["admClose", "admReopen"], (e, x, v) => {
  const r = x.dataset.k;
  const m = x.dataset.p;
  const f = v === "admClose";
  const u = r === "year" ? "el año " + m.slice(0, 4) : MESES[+m.slice(5, 7) - 1];
  if (f && S.admCloseAsk !== r + m) {
    S.admCloseAsk = r + m;
    toast(`Tocá de nuevo para cerrar ${u}: los números quedan fijos.`);
    setTimeout(() => {
      S.admCloseAsk = null;
    }, 3500);
    return;
  }
  S.admCloseAsk = null;
  if (LIVE) {
    x.disabled = true;
    (f ? api.m.adminClose(r, m) : api.m.adminReopen(r, m))
      .then(() => {
        if (S.admFin) {
          delete S.admFin[+m.slice(0, 4)];
        }
        toast(f ? `Cerraste ${u}.` : `Reabriste ${u}.`);
        render();
      })
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  if (!f && r === "month" && store.DEMO_ACL["year|" + m.slice(0, 4)]) {
    toast("El año está cerrado: reabrí el año primero.");
    return;
  }
  admCloseDemo(f, r, m);
  toast(f ? `Cerraste ${u}. Los números quedaron fijos.` : `Reabriste ${u}.`);
  render();
  return;
});
registerClick("admExpDel", (e, x, v) => {
  const r = +x.dataset.id;
  if (LIVE) {
    api.m
      .adminDelExp(r)
      .then(() => {
        S.admFin = null;
        toast("Gasto borrado.");
        render();
      })
      .catch(() => {});
    return;
  }
  const m = store.DEMO_AEXP.find((f) => f.id === r);
  if (!m) {
    return;
  }
  if (store.DEMO_ACL["month|" + m.day.slice(0, 7)]) {
    toast("El mes está cerrado: reabrilo para cambiarlo.");
    return;
  }
  store.DEMO_AEXP = store.DEMO_AEXP.filter((f) => f.id !== r);
  toast("Gasto borrado.");
  render();
  return;
});
registerSubmit("fAdmExp", (e) => {
  const a = e.target.dataset.m;
  const t = String($("#aec").value || "")
    .replace(/[<>\u0000-\u001f]/g, "")
    .trim()
    .slice(0, 80);
  const s = parseInt(String($("#aem").value).replace(/\D/g, ""), 10);
  const n = (i) => {
    $("#aeerr").textContent = i;
  };
  if (!t) {
    return n("Escribí el concepto.");
  }
  if (!(s >= 1) || !(s <= 2e9)) {
    return n("Escribí el monto.");
  }
  const o = a === TODAY().slice(0, 7) ? TODAY() : a + "-01";
  if (LIVE) {
    api.m
      .adminAddExp(o, t, s)
      .then(() => {
        S.admFin = null;
        toast("Gasto cargado.");
        render();
      })
      .catch(() => {});
    return;
  }
  if (store.DEMO_ACL["month|" + a]) {
    return n("El mes está cerrado: reabrilo para cambiarlo.");
  }
  store.DEMO_AEXP.push({
    id: store.AEID++,
    day: o,
    concept: t,
    amount: s,
  });
  toast("Gasto cargado.");
  render();
  return;
});

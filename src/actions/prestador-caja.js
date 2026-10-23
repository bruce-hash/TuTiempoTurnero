import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { money } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { cli } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { closeDay, dayLines, finTot, ymk } from "../views/prestador/finanzas.js";

registerClick("reopenDay", (e, x, v) => {
  delete store.CLOSINGS["day|" + TODAY()];
  api.m.reopenCash("day", TODAY());
  render();
  return;
});
registerClick(["closePast", "closeAllPast"], (e, x, v) => {
  const r = TODAY();
  const m = store.FIN.filter(
    (f) =>
      ymk(f.date) === ymk(r) &&
      f.date < r &&
      finTot(f) > 0 &&
      !store.CLOSINGS["day|" + f.date] &&
      (v === "closeAllPast" || f.date === x.dataset.d),
  );
  m.forEach((f) => {
    const u = {
      income: finTot(f),
      cash: 0,
      mp: 0,
      counted: null,
      at: "—",
    };
    store.CLOSINGS["day|" + f.date] = u;
    api.m.closeCash("day", f.date, u);
  });
  toast(`Cerraste ${m.length} día${m.length === 1 ? "" : "s"}.`);
  render();
  return;
});
registerClick("walkOpen", (e, x, v) => {
  S.walkOpen = true;
  S.walkMedio = "Efectivo";
  render();
  const r = $("#wsv");
  if (r) {
    r.focus();
  }
});
registerClick("walkClose", (e, x, v) => {
  S.walkOpen = false;
  render();
});
registerClick("walkDel", (e, x, v) => {
  const r = S.walk.splice(+x.dataset.i, 1)[0];
  api.m.delWalk(r);
  toast("Borraste " + r.svc + " de las " + r.hora);
  render();
});
registerChange("wsv", (e) => {
  const n = pr(ME());
  const o = e.target.value;
  $("#wotroBox").hidden = o !== "otro";
  if (o[0] === "p") {
    $("#wpr").value = store.PRODS[+o.slice(1)].p;
  } else if (o !== "otro") {
    $("#wpr").value = n.svcs[+o][2];
  } else {
    $("#wpr").value = "";
    $("#wotro").focus();
  }
  return;
});
registerSubmit("fWalk", (e) => {
  const a = pr(ME());
  const t = $("#wsv").value;
  const s = t[0] === "p";
  const n = s ? store.PRODS[+t.slice(1)] : null;
  const o = s ? n.n : t === "otro" ? $("#wotro").value.trim() : a.svcs[+t][0];
  if (s && n.stock <= 0) {
    $("#werr").textContent = "No te queda stock de ese producto.";
    return;
  }
  const i = parseInt($("#wpr").value.replace(/\D/g, "")) || 0;
  const l = 0;
  const c = $("#whr").value;
  if (!o) {
    $("#werr").textContent = "Escribí qué servicio hiciste.";
    return;
  }
  if (i <= 0) {
    $("#werr").textContent = "Ingresá cuánto cobraste.";
    return;
  }
  if (!c) {
    $("#werr").textContent = "Ingresá la hora.";
    return;
  }
  const d = $("#wcl").value.trim();
  if (s) {
    n.stock--;
  } else if (d) {
    const w = cli(d);
    w.v++;
    w.last = 0;
    w.spend ||= i;
  }
  const p = {
    svc: o,
    precio: i,
    propina: l,
    hora: c,
    medio: S.walkMedio || "Efectivo",
    cliente: d,
    kind: s ? "prod" : "svc",
    pid: (s && n.id) || null,
  };
  S.walk.push(p);
  api.m.addWalk(p);
  if (s) {
    api.m.setStock(n);
  }
  S.walk.sort((w, y) => w.hora.localeCompare(y.hora));
  S.walkOpen = false;
  toast(s ? `Venta guardada: ${o}. Quedan ${n.stock} en stock.` : `Guardado: ${o} · ${money(i)}`);
  render();
  return;
});
registerSubmit("fCloseDay", (e) => {
  const a = TODAY();
  const t = dayLines(a);
  const s = t.reduce((c, d) => c + d.m, 0);
  const n = t.filter((c) => c.medio === "Efectivo").reduce((c, d) => c + d.m, 0);
  const o = ($("#cdCount").value || "").trim();
  const i = o === "" ? null : parseInt(o.replace(/\D/g, ""));
  if (o !== "" && !(i >= 0)) {
    $("#cderr").textContent = "Escribí solo números.";
    return;
  }
  closeDay(a, s, n, s - n, i);
  const l = i == null ? null : i - n;
  toast(
    `Caja cerrada: ${money(s)}.${l == null ? "" : l === 0 ? " El efectivo da justo." : l > 0 ? ` Te sobran ${money(l)}.` : ` Te faltan ${money(-l)}.`}`,
  );
  render();
  return;
});

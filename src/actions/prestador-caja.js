import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { PESOS_ERR, money, parsePesos } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { cli } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { closeDay, dayLines, finTot, ymk } from "../views/prestador/finanzas.js";

registerClick("reopenDay", (ev, el, act) => {
  delete store.CLOSINGS["day|" + TODAY()];
  api.m.reopenCash("day", TODAY());
  render();
  return;
});
// cerrar días anteriores del mes que quedaron abiertos (uno o todos), sin detalle de efectivo
registerClick(["closePast", "closeAllPast"], (ev, el, act) => {
  const today = TODAY();
  const days = store.FIN.filter(
    (day) =>
      ymk(day.date) === ymk(today) &&
      day.date < today &&
      finTot(day) > 0 &&
      !store.CLOSINGS["day|" + day.date] &&
      (act === "closeAllPast" || day.date === el.dataset.d),
  );
  days.forEach((day) => {
    const closing = {
      income: finTot(day),
      cash: 0,
      mp: 0,
      counted: null,
      at: "—",
    };
    store.CLOSINGS["day|" + day.date] = closing;
    api.m.closeCash("day", day.date, closing);
  });
  toast(`Cerraste ${days.length} día${days.length === 1 ? "" : "s"}.`);
  render();
  return;
});
registerClick("walkOpen", (ev, el, act) => {
  S.walkOpen = true;
  S.walkMedio = "Efectivo";
  render();
  const input = $("#wsv");
  if (input) {
    input.focus();
  }
});
registerClick("walkClose", (ev, el, act) => {
  S.walkOpen = false;
  render();
});
registerClick("walkDel", (ev, el, act) => {
  const walk = S.walk.splice(+el.dataset.i, 1)[0];
  api.m.delWalk(walk);
  toast("Borraste " + walk.svc + " de las " + walk.hora);
  render();
});
registerChange("wsv", (ev) => {
  const prov = pr(ME());
  const value = ev.target.value;
  $("#wotroBox").hidden = value !== "otro";
  if (value[0] === "p") {
    $("#wpr").value = store.PRODS[+value.slice(1)].p;
  } else if (value !== "otro") {
    $("#wpr").value = prov.svcs[+value][2];
  } else {
    $("#wpr").value = "";
    $("#wotro").focus();
  }
  return;
});
// servicio sin turno o venta de producto cargado en la caja (sin comisión; la propina no se pide: va en 0)
registerSubmit("fWalk", (ev) => {
  const prov = pr(ME());
  const value = $("#wsv").value;
  const isProd = value[0] === "p";
  const prod = isProd ? store.PRODS[+value.slice(1)] : null;
  const label = isProd ? prod.n : value === "otro" ? $("#wotro").value.trim() : prov.svcs[+value][0];
  if (isProd && prod.stock <= 0) {
    $("#werr").textContent = "No te queda stock de ese producto.";
    return;
  }
  const price = parsePesos($("#wpr").value);
  const tip = 0;
  const time = $("#whr").value;
  if (!label) {
    $("#werr").textContent = "Escribí qué servicio hiciste.";
    return;
  }
  if (isNaN(price)) {
    $("#werr").textContent = PESOS_ERR;
    return;
  }
  if (price <= 0) {
    $("#werr").textContent = "Ingresá cuánto cobraste.";
    return;
  }
  if (!time) {
    $("#werr").textContent = "Ingresá la hora.";
    return;
  }
  const client = $("#wcl").value.trim();
  if (isProd) {
    prod.stock--;
  } else if (client) {
    const stats = cli(client);
    stats.v++;
    stats.last = 0;
    stats.spend ||= price;
  }
  const walk = {
    svc: label,
    precio: price,
    propina: tip,
    hora: time,
    medio: S.walkMedio || "Efectivo",
    cliente: client,
    kind: isProd ? "prod" : "svc",
    pid: (isProd && prod.id) || null,
  };
  S.walk.push(walk);
  api.m.addWalk(walk);
  if (isProd) {
    api.m.setStock(prod);
  }
  S.walk.sort((one, other) => one.hora.localeCompare(other.hora));
  S.walkOpen = false;
  toast(isProd ? `Venta guardada: ${label}. Quedan ${prod.stock} en stock.` : `Guardado: ${label} · ${money(price)}`);
  render();
  return;
});
// cierre de la caja de hoy; con el efectivo contado, avisa si sobra o falta
registerSubmit("fCloseDay", (ev) => {
  const today = TODAY();
  const lines = dayLines(today);
  const total = lines.reduce((sum, line) => sum + line.m, 0);
  const cash = lines.filter((line) => line.medio === "Efectivo").reduce((sum, line) => sum + line.m, 0);
  const counted = ($("#cdCount").value || "").trim();
  const countedN = counted === "" ? null : parsePesos(counted);
  if (counted !== "" && !(countedN >= 0)) {
    $("#cderr").textContent = PESOS_ERR;
    return;
  }
  closeDay(today, total, cash, total - cash, countedN);
  const diff = countedN == null ? null : countedN - cash;
  toast(
    `Caja cerrada: ${money(total)}.${diff == null ? "" : diff === 0 ? " El efectivo da justo." : diff > 0 ? ` Te sobran ${money(diff)}.` : ` Te faltan ${money(-diff)}.`}`,
  );
  render();
  return;
});

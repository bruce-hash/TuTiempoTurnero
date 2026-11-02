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
import { medioToDb } from "../lib/medios.js";

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
  S.movEd = null;
  S.movDel = null;
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
// C25 (V4): editar y borrar cada movimiento de la Caja del día. k: "w<índice>" (lo cargado sin turno o una venta) o
// "b<id>" (un turno: solo el medio con que se cobró el resto)
const walkOf = (key) => (String(key).startsWith("w") ? S.walk[+String(key).slice(1)] : null);
registerClick("movEdit", (ev, el, act) => {
  S.movEd = el.dataset.k;
  S.movDel = null;
  S.walkOpen = false;
  const walk = walkOf(el.dataset.k);
  S.walkMedio = walk ? walk.medio : S.walkMedio;
  render();
});
registerClick("movEdClose", (ev, el, act) => {
  S.movEd = null;
  render();
});
registerClick("movDel", (ev, el, act) => {
  S.movDel = el.dataset.k;
  S.movEd = null;
  render();
});
registerClick("movDelNo", (ev, el, act) => {
  S.movDel = null;
  render();
});
registerClick("movDelYes", (ev, el, act) => {
  const index = +String(el.dataset.k).slice(1);
  const walk = S.walk.splice(index, 1)[0];
  S.movDel = null;
  if (!walk) {
    return render();
  }
  api.m.delWalk(walk);
  // una venta borrada devuelve la unidad al stock
  const prod = walk.kind === "prod" && store.PRODS.find((item) => (walk.pid && item.id === walk.pid) || item.n === walk.svc);
  if (prod) {
    prod.stock++;
    api.m.setStock(prod);
  }
  toast("Borraste " + walk.svc + " de las " + walk.hora);
  render();
});
registerSubmit("fWalkEd", (ev) => {
  const walk = walkOf(S.movEd);
  if (!walk) {
    S.movEd = null;
    return render();
  }
  const label = walk.kind === "prod" ? walk.svc : $("#wed_d").value.trim();
  const price = parsePesos($("#wed_m").value);
  const time = $("#wed_h").value;
  const err = (msg) => {
    $("#wederr").textContent = msg;
  };
  if (!label) {
    return err("Escribí qué cobraste.");
  }
  if (isNaN(price)) {
    return err(PESOS_ERR);
  }
  if (price <= 0) {
    return err("Ingresá cuánto cobraste.");
  }
  if (!time) {
    return err("Ingresá la hora.");
  }
  Object.assign(walk, { svc: label.slice(0, 80), precio: price, hora: time, medio: S.walkMedio || walk.medio, cliente: $("#wed_c").value.trim().slice(0, 80) });
  api.m.updWalk(walk);
  S.walk.sort((one, other) => one.hora.localeCompare(other.hora));
  S.movEd = null;
  toast("Movimiento actualizado");
  render();
});
registerClick("restMedio", (ev, el, act) => {
  const booking = store.BOOK.find((item) => String(item.id) === el.dataset.id);
  if (!booking) {
    return;
  }
  booking.restMethod = medioToDb(el.dataset.m);
  api.m.setRestMethod(booking, el.dataset.m);
  S.movEd = null;
  toast("Anotado: el resto con " + el.dataset.m.toLowerCase());
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

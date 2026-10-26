import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { money } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, dayLabel, toMin } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { busy, cfg, cli, freed, overlaps, slotsFor } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { cliStamps, setCliStamps, stampGoal } from "../ui/sellos.js";
import { toast } from "../ui/toast.js";
import { pushCancel } from "../views/prestador/bloqueo-dias.js";
import { feeOf } from "../views/prestador/finanzas.js";
import { pushNotice } from "../views/prestador/mensajes.js";
import { BTABS, selectBtab } from "../views/prestador/panel.js";

registerClick(["tabPrev", "tabNext"], (ev, el, act) => {
  const current = Math.max(
    0,
    BTABS.findIndex((tab) => tab[0] === S.btab),
  );
  const next = Math.max(0, Math.min(BTABS.length - 1, current + (act === "tabNext" ? 1 : -1)));
  selectBtab(BTABS[next][0]);
  return;
});
registerClick("selClose", (ev, el, act) => {
  S.sel = null;
  S.bAsk = null;
  render();
});
// “Ofrecer” un hueco libre: se publica como aviso a los seguidores
registerClick("offerGap", (ev, el, act) => {
  S.offered[el.dataset.g] = true;
  const [day, from] = el.dataset.g.split("|");
  api.m.post(`Tengo lugar ${dayLabel(day).toLowerCase()} de ${from} a ${el.dataset.z}. Reservá en TuTiempo.`);
  toast(
    `Avisamos a ${store.COMM.followers} seguidores: “Tengo lugar ${dayLabel(day).toLowerCase()} de ${from} a ${el.dataset.z}”`,
  );
  render();
});
// el cliente vino: suma la visita y, si el servicio da sellos y reservó por la app, un sello
registerClick("bDone", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === +el.dataset.id);
  if (!booking || booking.status !== "confirmed") {
    return;
  }
  booking.status = "done";
  api.m.markBooking(booking, "done");
  cli(booking.cliente).v++;
  cli(booking.cliente).last = 0;
  const svc = pr(ME()).svcs.find((row) => row[0] === booking.svc);
  const goal = stampGoal(ME(), svc);
  let stampMsg = "";
  if (
    goal &&
    booking.src === "app" &&
    booking.pay !== "reward" &&
    (!LIVE || (store.CLIENTS[booking.cliente] && store.CLIENTS[booking.cliente].user))
  ) {
    const have = cliStamps(booking.cliente, svc) + 1;
    setCliStamps(booking.cliente, svc, have);
    booking.stamped = true;
    stampMsg = ` 🎟️ Sumó un sello en ${svc[0]} (${Math.min(have, goal)}/${goal})${have >= goal ? ": ¡ya tiene su premio!" : "."}`;
  }
  if (booking.mine) {
    pushNotice(ME(), "rev", booking, booking.stamped ? ` 🎟️ Sumaste 1 sello en tu tarjeta de ${booking.svc}.` : "");
  }
  if (booking.date === TODAY()) {
    S.jobsToday++;
    S.earnToday += booking.price - (booking.src === "app" ? feeOf(booking) : 0);
  }
  toast(
    `${booking.cliente} asistió. ${booking.price > booking.paid ? "Cobrale " + money(booking.price - booking.paid) + " en el local." : ""}${stampMsg}`,
  );
  render();
});
registerClick("bNoShow", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === +el.dataset.id);
  booking.status = "noshow";
  api.m.markBooking(booking, "noshow");
  cli(booking.cliente).n++;
  toast(
    booking.paid ? `Marcado como ausente. Te quedás con la seña de ${money(booking.paid)}.` : "Marcado como ausente.",
  );
  render();
});
registerClick("bCancel", (ev, el, act) => {
  S.bAsk = +el.dataset.id;
  render();
});
registerClick("bCancelNo", (ev, el, act) => {
  S.bAsk = null;
  render();
});
// el prestador cancela un turno: al cliente se le devuelve todo (seña y comisión) y los sellos canjeados;
// se avisa a la lista de espera
registerClick("bCancelYes", (ev, el, act) => {
  const booking = store.BOOK.find((item) => item.id === +el.dataset.id);
  booking.status = "cancelled";
  booking.byProv = true;
  if (booking.mine) {
    pushCancel(booking);
  }
  api.m.cancelProvider(booking);
  if (booking.pay === "reward" && !booking.stampBack) {
    booking.stampBack = true;
    const svc = pr(ME()).svcs.find((row) => row[0] === booking.svc);
    if (svc) {
      setCliStamps(booking.cliente, svc, cliStamps(booking.cliente, svc) + (booking.rwGoal || stampGoal(ME(), svc)));
    }
  }
  booking.refund = (booking.paid || 0) + (booking.fee || 0);
  S.bAsk = null;
  const notified = freed(booking);
  toast(
    `Turno cancelado. ${booking.paid ? "Le devolvemos " + money(booking.paid) + " al cliente. " : ""}${notified ? "Avisamos a " + notified + " persona" + (notified > 1 ? "s" : "") + " en lista de espera." : ""}`,
  );
  render();
});
registerClick("bUnblock", (ev, el, act) => {
  const block = store.BOOK.find((item) => item.id === +el.dataset.id);
  store.BOOK = store.BOOK.filter((item) => item.id !== +el.dataset.id);
  if (block) {
    api.m.delBooking(block);
  }
  toast("Horario desbloqueado");
  render();
});
registerClick("manOpen", (ev, el, act) => {
  S.manOpen = true;
  S.blockOpen = false;
  S.manSvc = 0;
  render();
});
registerClick("manClose", (ev, el, act) => {
  S.manOpen = false;
  render();
});
registerClick("turnosOn", (ev, el, act) => {
  const conf = cfg(ME());
  conf.on = !conf.on;
  api.m.saveSettings(conf);
  toast(conf.on ? "Turnos online activados" : "Turnos online pausados");
  render();
});
registerClick("walkFromAgenda", (ev, el, act) => {
  S.btab = "caja";
  S.walkOpen = true;
  S.walkMedio = "Efectivo";
  render();
});
registerClick("blockOpen", (ev, el, act) => {
  S.blockOpen = true;
  S.manOpen = false;
  render();
});
registerClick("blockClose", (ev, el, act) => {
  S.blockOpen = false;
  render();
});
registerSubmit("fBlock", (ev) => {
  const day = S.aday || TODAY();
  const from = $("#bkf").value;
  const to = $("#bkt").value;
  if (!from || !to || to <= from) {
    $("#bkerr").textContent = "La hora de fin tiene que ser posterior a la de inicio.";
    return;
  }
  const clash = busy(ME(), day).filter(
    (item) => item.type !== "block" && overlaps(toMin(from), toMin(to), toMin(item.time), toMin(item.time) + item.dur),
  );
  if (clash.length) {
    $("#bkerr").textContent =
      `Ya tenés ${clash.length} turno${clash.length > 1 ? "s" : ""} en esa franja (${clash.map((item) => item.time).join(", ")}). Cancelalos primero o elegí otro horario.`;
    return;
  }
  {
    const block = {
      id: store.BID++,
      pid: ME(),
      date: day,
      time: from,
      dur: toMin(to) - toMin(from),
      svc: `${from} a ${to} h`,
      cliente: "Horario bloqueado",
      type: "block",
      status: "confirmed",
      paid: 0,
      price: 0,
    };
    store.BOOK.push(block);
    api.m.addBooking(block);
  }
  S.blockOpen = false;
  toast("Horario bloqueado. Nadie puede reservar en esa franja.");
  render();
  return;
});
// turno agendado a mano (sin pago ni comisión); si el cliente no estaba, se suma a la lista
registerSubmit("fManual", (ev) => {
  const day = S.aday || TODAY();
  const prov = pr(ME());
  const svcIndex = +$("#msv").value;
  const svc = prov.svcs[svcIndex];
  const time = ($("#mhr") || {}).value;
  const client = $("#mcl").value.trim();
  if (!time) {
    $("#merr").textContent = "No quedan horarios libres este día.";
    return;
  }
  if (!client) {
    $("#merr").textContent = "Escribí el nombre del cliente.";
    return;
  }
  if (!slotsFor(ME(), day, svc[1]).list.some((slot) => slot.free && slot.time === time)) {
    $("#merr").textContent = "Ese horario se acaba de ocupar. Elegí otro.";
    render();
    return;
  }
  {
    const booking = {
      id: store.BID++,
      pid: ME(),
      date: day,
      time: time,
      dur: svc[1],
      svc: svc[0],
      price: svc[2],
      cliente: client,
      tel: $("#mtel").value.trim(),
      src: "manual",
      type: "local",
      status: "confirmed",
      paid: 0,
    };
    store.BOOK.push(booking);
    api.m.addBooking(booking);
  }
  S.manOpen = false;
  S.manName = "";
  if (!store.CLIENTS[client]) {
    store.CLIENTS[client] = {
      v: 0,
      n: 0,
      last: null,
      spend: svc[2],
      tel: $("#mtel").value.trim(),
      notes: "",
      bday: "",
    };
    api.m.upsertClient(client, store.CLIENTS[client]);
  }
  toast(`Agendado: ${client}, ${dayLabel(day)} ${time}`);
  render();
  return;
});

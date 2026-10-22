import { registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { money } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, dayLabel, toMin } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { refundPay } from "../lib/saldo.js";
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

registerClick(["tabPrev", "tabNext"], (e, x, v) => {
  const r = Math.max(
    0,
    BTABS.findIndex((f) => f[0] === S.btab),
  );
  const m = Math.max(0, Math.min(BTABS.length - 1, r + (v === "tabNext" ? 1 : -1)));
  selectBtab(BTABS[m][0]);
  return;
});
registerClick("selClose", (e, x, v) => {
  S.sel = null;
  S.bAsk = null;
  render();
});
registerClick("offerGap", (e, x, v) => {
  S.offered[x.dataset.g] = true;
  const [r, m] = x.dataset.g.split("|");
  api.m.post(`Tengo lugar ${dayLabel(r).toLowerCase()} de ${m} a ${x.dataset.z}. Reservá en TuTiempo.`);
  toast(
    `Avisamos a ${store.COMM.followers} seguidores: “Tengo lugar ${dayLabel(r).toLowerCase()} de ${m} a ${x.dataset.z}”`,
  );
  render();
});
registerClick("bDone", (e, x, v) => {
  const r = store.BOOK.find((E) => E.id === +x.dataset.id);
  if (!r || r.status !== "confirmed") {
    return;
  }
  r.status = "done";
  api.m.markBooking(r, "done");
  cli(r.cliente).v++;
  cli(r.cliente).last = 0;
  const m = pr(ME()).svcs.find((E) => E[0] === r.svc);
  const f = stampGoal(ME(), m);
  let u = "";
  if (
    f &&
    r.src === "app" &&
    r.pay !== "reward" &&
    (!LIVE || (store.CLIENTS[r.cliente] && store.CLIENTS[r.cliente].user))
  ) {
    const E = cliStamps(r.cliente, m) + 1;
    setCliStamps(r.cliente, m, E);
    r.stamped = true;
    u = ` 🎟️ Sumó un sello en ${m[0]} (${Math.min(E, f)}/${f})${E >= f ? ": ¡ya tiene su premio!" : "."}`;
  }
  if (r.mine) {
    pushNotice(ME(), "rev", r, r.stamped ? ` 🎟️ Sumaste 1 sello en tu tarjeta de ${r.svc}.` : "");
  }
  if (r.date === TODAY()) {
    S.jobsToday++;
    S.earnToday += r.price - (r.src === "app" ? feeOf(r) : 0);
  }
  toast(
    `${r.cliente} asistió. ${r.price > r.paid ? "Cobrale " + money(r.price - r.paid) + " en el local." : ""}${u}`,
  );
  render();
});
registerClick("bNoShow", (e, x, v) => {
  const r = store.BOOK.find((m) => m.id === +x.dataset.id);
  r.status = "noshow";
  api.m.markBooking(r, "noshow");
  cli(r.cliente).n++;
  toast(
    r.paid ? `Marcado como ausente. Te quedás con la seña de ${money(r.paid)}.` : "Marcado como ausente.",
  );
  render();
});
registerClick("bCancel", (e, x, v) => {
  S.bAsk = +x.dataset.id;
  render();
});
registerClick("bCancelNo", (e, x, v) => {
  S.bAsk = null;
  render();
});
registerClick("bCancelYes", (e, x, v) => {
  const r = store.BOOK.find((f) => f.id === +x.dataset.id);
  r.status = "cancelled";
  r.byProv = true;
  if (r.mine) {
    pushCancel(r);
  }
  api.m.cancelProvider(r);
  if (r.pay === "reward" && !r.stampBack) {
    r.stampBack = true;
    const f = pr(ME()).svcs.find((u) => u[0] === r.svc);
    if (f) {
      setCliStamps(r.cliente, f, cliStamps(r.cliente, f) + (r.rwGoal || stampGoal(ME(), f)));
    }
  }
  r.refund = (r.paid || 0) + (r.fee || 0);
  if (r.mine) {
    refundPay(r, r.svc + " en " + pr(r.pid).name);
  }
  S.bAsk = null;
  const m = freed(r);
  toast(
    `Turno cancelado. ${r.paid ? "Le devolvemos " + money(r.paid) + " al cliente. " : ""}${m ? "Avisamos a " + m + " persona" + (m > 1 ? "s" : "") + " en lista de espera." : ""}`,
  );
  render();
});
registerClick("bUnblock", (e, x, v) => {
  const r = store.BOOK.find((m) => m.id === +x.dataset.id);
  store.BOOK = store.BOOK.filter((m) => m.id !== +x.dataset.id);
  if (r) {
    api.m.delBooking(r);
  }
  toast("Horario desbloqueado");
  render();
});
registerClick("manOpen", (e, x, v) => {
  S.manOpen = true;
  S.blockOpen = false;
  S.manSvc = 0;
  render();
});
registerClick("manClose", (e, x, v) => {
  S.manOpen = false;
  render();
});
registerClick("turnosOn", (e, x, v) => {
  const r = cfg(ME());
  r.on = !r.on;
  api.m.saveSettings(r);
  toast(r.on ? "Turnos online activados" : "Turnos online pausados");
  render();
});
registerClick("walkFromAgenda", (e, x, v) => {
  S.btab = "caja";
  S.walkOpen = true;
  S.walkMedio = "Efectivo";
  render();
});
registerClick("blockOpen", (e, x, v) => {
  S.blockOpen = true;
  S.manOpen = false;
  render();
});
registerClick("blockClose", (e, x, v) => {
  S.blockOpen = false;
  render();
});
registerSubmit("fBlock", (e) => {
  const a = S.aday || TODAY();
  const t = $("#bkf").value;
  const s = $("#bkt").value;
  if (!t || !s || s <= t) {
    $("#bkerr").textContent = "La hora de fin tiene que ser posterior a la de inicio.";
    return;
  }
  const n = busy(ME(), a).filter(
    (o) => o.type !== "block" && overlaps(toMin(t), toMin(s), toMin(o.time), toMin(o.time) + o.dur),
  );
  if (n.length) {
    $("#bkerr").textContent =
      `Ya tenés ${n.length} turno${n.length > 1 ? "s" : ""} en esa franja (${n.map((o) => o.time).join(", ")}). Cancelalos primero o elegí otro horario.`;
    return;
  }
  {
    const o = {
      id: store.BID++,
      pid: ME(),
      date: a,
      time: t,
      dur: toMin(s) - toMin(t),
      svc: `${t} a ${s} h`,
      cliente: "Horario bloqueado",
      type: "block",
      status: "confirmed",
      paid: 0,
      price: 0,
    };
    store.BOOK.push(o);
    api.m.addBooking(o);
  }
  S.blockOpen = false;
  toast("Horario bloqueado. Nadie puede reservar en esa franja.");
  render();
  return;
});
registerSubmit("fManual", (e) => {
  const a = S.aday || TODAY();
  const t = pr(ME());
  const s = +$("#msv").value;
  const n = t.svcs[s];
  const o = ($("#mhr") || {}).value;
  const i = $("#mcl").value.trim();
  if (!o) {
    $("#merr").textContent = "No quedan horarios libres este día.";
    return;
  }
  if (!i) {
    $("#merr").textContent = "Escribí el nombre del cliente.";
    return;
  }
  if (!slotsFor(ME(), a, n[1]).list.some((l) => l.free && l.time === o)) {
    $("#merr").textContent = "Ese horario se acaba de ocupar. Elegí otro.";
    render();
    return;
  }
  {
    const l = {
      id: store.BID++,
      pid: ME(),
      date: a,
      time: o,
      dur: n[1],
      svc: n[0],
      price: n[2],
      cliente: i,
      tel: $("#mtel").value.trim(),
      src: "manual",
      type: "local",
      status: "confirmed",
      paid: 0,
    };
    store.BOOK.push(l);
    api.m.addBooking(l);
  }
  S.manOpen = false;
  S.manName = "";
  if (!store.CLIENTS[i]) {
    store.CLIENTS[i] = {
      v: 0,
      n: 0,
      last: null,
      spend: n[2],
      tel: $("#mtel").value.trim(),
      notes: "",
      bday: "",
    };
    api.m.upsertClient(i, store.CLIENTS[i]);
  }
  toast(`Agendado: ${i}, ${dayLabel(a)} ${o}`);
  render();
  return;
});

import { feeFor, money, payNow } from "../lib/dinero.js";
import { esc } from "../lib/dom.js";
import { dayLabel, toMin } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { selAdds, selPrice } from "../lib/servicios.js";
import { happyAt, priceAt, uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";

// barra fija de la reserva: horario elegido, precio (con happy hour tachado), seña y comisión
export function bookBar(prov) {
  const svc = prov.svcs[S.svc];
  const base = selPrice(prov);
  const price = S.slot ? priceAt(prov.id, base, S.slot.date, S.slot.time) : base;
  const happy = S.slot ? happyAt(prov.id, S.slot.date, toMin(S.slot.time)) : 0;
  const deposit = payNow(prov.id, price, uname());
  const fee = feeFor(price);
  return `<div class="bookbar">
   <div class="bb-info">${S.slot ? `<b>${esc(dayLabel(S.slot.date, true))} · ${S.slot.time}</b><span>${esc(svc[0])}${selAdds(prov).length ? " + " + selAdds(prov).length : ""} · ${happy ? `<s>${money(base)}</s> ` : ""}${money(price)}${S.reprog ? "" : (deposit < price ? ` · seña ${money(deposit)}` : "") + (fee ? ` + ${money(fee)} comisión` : "")}</span>` : `<b>Elegí un horario</b><span>${esc(svc[0])} · ${money(base)}</span>`}</div>
   <button class="btn btn-pri" data-act="reservarT" ${S.slot ? "" : "disabled"}>${S.reprog ? "Cambiar" : "Reservar"}</button></div>`;
}
// no se usa (código muerto heredado del original)
function misTurnosHtml() {
  const list = store.BOOK.filter((booking) => booking.mine && booking.status === "confirmed").sort((one, other) =>
    (one.date + one.time).localeCompare(other.date + other.time),
  );
  return `<div class="panel"><p class="lbl">Mis turnos</p>${list.length ? `<ul class="ag">${list.map((booking) => `<li><span class="ag-t">${booking.time}</span><div><b>${esc(dayLabel(booking.date))} · ${esc(pr(booking.pid).name)}</b><span>${esc(booking.svc)}${booking.series ? " · se repite" : ""}${booking.att ? " · ✓ confirmado" : ""}</span></div><button class="btn btn-ghost" data-act="verTurno" data-id="${booking.id}">Ver</button></li>`).join("")}</ul>` : '<p class="note">No tenés turnos reservados.</p>'}</div>`;
}

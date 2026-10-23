import { feeFor, money, payNow } from "../lib/dinero.js";
import { esc } from "../lib/dom.js";
import { dayLabel, toMin } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { selAdds, selPrice } from "../lib/servicios.js";
import { happyAt, priceAt, uname } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";

export function bookBar(e) {
  const a = e.svcs[S.svc];
  const t = selPrice(e);
  const s = S.slot ? priceAt(e.id, t, S.slot.date, S.slot.time) : t;
  const n = S.slot ? happyAt(e.id, S.slot.date, toMin(S.slot.time)) : 0;
  const o = payNow(e.id, s, uname());
  const i = feeFor(s);
  return `<div class="bookbar">
   <div class="bb-info">${S.slot ? `<b>${esc(dayLabel(S.slot.date, true))} · ${S.slot.time}</b><span>${esc(a[0])}${selAdds(e).length ? " + " + selAdds(e).length : ""} · ${n ? `<s>${money(t)}</s> ` : ""}${money(s)}${S.reprog ? "" : (o < s ? ` · seña ${money(o)}` : "") + (i ? ` + ${money(i)} comisión` : "")}</span>` : `<b>Elegí un horario</b><span>${esc(a[0])} · ${money(t)}</span>`}</div>
   <button class="btn btn-pri" data-act="reservarT" ${S.slot ? "" : "disabled"}>${S.reprog ? "Cambiar" : "Reservar"}</button></div>`;
}
function misTurnosHtml() {
  const e = store.BOOK.filter((a) => a.mine && a.status === "confirmed").sort((a, t) =>
    (a.date + a.time).localeCompare(t.date + t.time),
  );
  return `<div class="panel"><p class="lbl">Mis turnos</p>${e.length ? `<ul class="ag">${e.map((a) => `<li><span class="ag-t">${a.time}</span><div><b>${esc(dayLabel(a.date))} · ${esc(pr(a.pid).name)}</b><span>${esc(a.svc)}${a.series ? " · se repite" : ""}${a.att ? " · ✓ confirmado" : ""}</span></div><button class="btn btn-ghost" data-act="verTurno" data-id="${a.id}">Ver</button></li>`).join("")}</ul>` : '<p class="note">No tenés turnos reservados.</p>'}</div>`;
}

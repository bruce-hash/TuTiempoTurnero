import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { cap, notByProvider, refundText } from "../../lib/devoluciones.js";
import { esc } from "../../lib/dom.js";
import { dayLabel, fromMin, hoursUntil, longLabel, toMin } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { PREP } from "../../lib/servicios.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { vHome } from "./home.js";

// detalle de un turno del cliente (también la pantalla de “¡Listo!” después de reservar). En vivo, si todavía
// no está cargado, lo pide y muestra un esqueleto; según el estado: pago en curso, vencido, cancelado, hecho o confirmado.
export function vTurnoOk() {
  const booking = store.BOOK.find((item) => item.id === S.turnoId);
  if (!booking && LIVE && S.user) {
    api
      .myBookings()
      .then(() => {
        if (store.BOOK.find((item) => item.id === S.turnoId)) {
          render();
        }
      })
      .catch(() => {});
    return '<div class="narrow" style="margin-top:24px"><div class="skel" style="min-height:240px"></div></div>';
  }
  if (!booking) {
    return vHome();
  }
  if (booking.status === "hold") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">⏳</div><h1 class="h1">Estamos confirmando tu pago</h1>
    <p class="lead">Mercado Pago nos avisa en segundos. Tu horario queda reservado mientras tanto.</p><button class="btn btn-pri btn-block" data-act="refreshMine">Actualizar</button></div></div>`;
  }
  if (booking.status === "expired") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><h1 class="h1">El pago no se completó</h1><p class="lead">El horario se liberó.</p><button class="btn btn-pri btn-block" data-go="perfil" data-id="${booking.pid}">Elegir otro horario</button></div></div>`;
  }
  const prov = pr(booking.pid);
  // no se usa
  const hours = hoursUntil(booking);
  const calUrl =
    "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" +
    encodeURIComponent(booking.svc + " · " + prov.name) +
    "&dates=" +
    booking.date.replace(/-/g, "") +
    "T" +
    booking.time.replace(":", "") +
    "00/" +
    booking.date.replace(/-/g, "") +
    "T" +
    fromMin(toMin(booking.time) + booking.dur).replace(":", "") +
    "00&location=" +
    encodeURIComponent(prov.addr + ", Olavarría");
  const mapUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(prov.addr + ", Olavarría");
  if (booking.status === "cancelled" && booking.byRefund) {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">💳</div><h1 class="h1">Tu pago se devolvió</h1>
    <p class="lead">${esc(booking.svc)} · ${esc(longLabel(booking.date))} a las ${booking.time}. Mercado Pago te devolvió el pago, así que el turno en ${esc(prov.name)} quedó cancelado.</p>
    <button class="btn btn-pri btn-block" data-act="rebook" data-id="${booking.id}">Reservar de nuevo</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (booking.status === "cancelled" && booking.byProv && notByProvider(booking)) {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">💳</div><h1 class="h1">No pudimos confirmar tu turno</h1>
    <p class="lead">${esc(booking.svc)} · ${esc(longLabel(booking.date))} a las ${booking.time} en ${esc(prov.name)}: ${esc(refundText(booking))} a tu Mercado Pago.</p>
    <button class="btn btn-pri btn-block" data-act="rebook" data-id="${booking.id}">Elegir otro horario</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (booking.status === "cancelled" && booking.byProv) {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">📅</div><h1 class="h1">${esc(prov.name)} canceló tu turno</h1>
    <p class="lead">${esc(booking.svc)} · ${esc(longLabel(booking.date))} a las ${booking.time}.${booking.self ? (booking.paid ? ` ${esc(prov.name)} se va a comunicar con vos para devolverte la seña (${money(booking.paid)}) o pasarte el turno a otro día.` : "") : booking.refund ? ` ${esc(cap(refundText(booking)))} a tu Mercado Pago.` : booking.paid ? ` Te devolvemos todo lo que pagaste (${money(booking.paid + (booking.fee || 0))}) a tu Mercado Pago.` : ""}</p>
    ${booking.self ? "" : `<button class="btn btn-pri btn-block" data-act="rebook" data-id="${booking.id}">Reprogramar mi turno</button>`}<button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (booking.status === "cancelled") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">🗓️</div><h1 class="h1">Avisaste que no vas</h1>
    <p class="lead">Le avisamos a ${esc(prov.name)} y el horario quedó libre para otra persona.${booking.paid ? ` La seña (${money(booking.paid)}) queda para el profesional.` : ""}</p>
    <button class="btn btn-pri btn-block" data-go="perfil" data-id="${prov.id}">Sacar otro turno</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (booking.status === "done" || booking.status === "noshow") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">${booking.status === "done" ? "✔" : "✕"}</div><h1 class="h1">${booking.status === "done" ? "Fuiste a tu turno" : "No fuiste a este turno"}</h1>
    <p class="lead">${esc(booking.svc)} · ${esc(dayLabel(booking.date))} ${booking.time} en ${esc(prov.name)}.${booking.status === "done" && booking.stamped ? " 🎟️ Sumaste 1 sello." : ""}</p>
    <button class="btn btn-pri btn-block" data-go="perfil" data-id="${prov.id}">Volver a reservar</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  const siblings = booking.series
    ? store.BOOK.filter((item) => item.series === booking.series && item.id !== booking.id && item.status === "confirmed")
    : [];
  const canCancel = booking.status === "confirmed" && hoursUntil(booking) > 0;
  return `<div class="narrow stack" style="margin-top:20px">
   ${
     S.justBooked
       ? `<div class="booked"><div class="bk-ic">✓</div><b class="bk-h">¡Listo! Tenés turno</b>
     <p class="bk-when">${esc(longLabel(booking.date))}<br><span>${booking.time} h</span></p>
     <p class="bk-svc">${esc(booking.svc)}${(booking.addons || []).length ? " + " + (booking.addons || []).map((addon) => esc(addon[0])).join(" + ") : ""} · ${booking.dur} min</p>
     <p style="margin:0">en <b>${esc(prov.name)}</b> · ${esc(prov.addr)}</p>
     <p class="bk-must">${booking.pay === "reward" ? "🎁 Canjeaste tu premio: este turno es gratis" : booking.pay === "cash" ? `Pagaste la seña de ${money(booking.paid)}${booking.fee ? ` + ${money(booking.fee)} de comisión` : ""} de tu ${esc(booking.svc)}${booking.price > booking.paid ? ` · el resto (${money(booking.price - booking.paid)}) en efectivo en el local` : ""}` : `Pagaste ${money(booking.paid)}${booking.fee ? ` + ${money(booking.fee)} de comisión` : ""} de tu ${esc(booking.svc)} con Mercado Pago${booking.price > booking.paid ? ` · en el local: ${money(booking.price - booking.paid)}` : ""}`}</p>
     ${S.seriesMsg ? `<p class="note" style="margin:6px 0 0">${esc(S.seriesMsg)}</p>` : ""}
</div>`
       : '<h1 class="h1">Tu turno</h1>'
   }
   ${(() => {
     const svc = prov.svcs.find((row) => row[0] === booking.svc);
     const prep = booking.note ?? PREP(prov, svc);
     if (prep) {
       return `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(prep)}</p></div>`;
     } else {
       return "";
     }
   })()}
   ${
     S.justBooked
       ? ""
       : `<div class="panel turnocard"><div class="tdate"><span>${esc(dayLabel(booking.date, true))}</span><b>${booking.time}</b></div>
    <div><b>${esc(booking.svc)}</b>${(booking.addons || []).length ? `<div class="hint">+ ${(booking.addons || []).map((addon) => esc(addon[0])).join(" · ")}</div>` : ""}<div class="hint">${booking.dur} min · ${esc(prov.name)}</div><div class="hint">📍 ${esc(prov.addr)}</div>
    <div style="margin-top:6px"><span class="chip ok">✓ Confirmado</span>${booking.pay === "reward" ? '<span class="chip ok">🎁 Premio</span>' : booking.pay === "cash" ? '<span class="chip">Seña pagada · resto en efectivo</span>' : '<span class="chip">Seña pagada · resto con Mercado Pago</span>'}</div></div></div>`
   }
   ${S.justBooked || booking.pay === "reward" ? "" : `<div class="panel"><div class="sum">${booking.disc ? `<div style="color:var(--ok)"><span>Happy hour</span><span>−${booking.disc}%</span></div>` : ""}${booking.fee ? `<div><span>Comisión TuTiempo (pagada)</span><span>${money(booking.fee)}</span></div>` : ""}${booking.pay === "cash" ? `<div><span>Seña pagada (Mercado Pago)</span><span>${money(booking.paid)}</span></div>${booking.price > booking.paid ? `<div class="tot"><span>Resto en el local, en efectivo</span><span>${money(booking.price - booking.paid)}</span></div>` : ""}` : `<div><span>Pagado con Mercado Pago</span><span>${money(booking.paid)}</span></div>${booking.price > booking.paid ? `<div class="tot"><span>Pagás en el local</span><span>${money(booking.price - booking.paid)}</span></div>` : ""}`}</div></div>`}
   ${siblings.length ? `<div class="panel"><p class="lbl">Se repite</p><div class="chips" style="justify-content:flex-start">${siblings.map((item) => `<button class="chip" data-act="verTurno" data-id="${item.id}">${esc(dayLabel(item.date))} ${item.time}</button>`).join("")}</div></div>` : ""}
   ${
     S.cancelAsk && canCancel
       ? `<div class="panel" style="border-color:var(--bad-line)"><b>¿Avisar que no vas?</b><p style="margin:6px 0 12px;font-size:14px">${booking.paid ? `La seña (${money(booking.paid)})${booking.fee ? " y la comisión" : ""} no se devuelve${booking.fee ? "n" : ""}. ` : ""}El horario se libera para otra persona.</p>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ghost" data-act="cancelNo">Volver</button><button class="btn btn-bad" data-act="cancelYes">Sí, avisar</button></div></div>`
       : ""
   }
   <div class="tacts"><a class="btn btn-ghost" href="${mapUrl}" target="_blank" rel="noopener">🗺️ Cómo llegar</a><a class="btn btn-ghost" href="${calUrl}" target="_blank" rel="noopener">📅 Al calendario</a>
    ${canCancel ? `<button class="btn btn-bad" data-act="cancelAsk" ${S.cancelAsk ? "disabled" : ""}>🙅 No voy a poder ir</button>` : ""}<button class="btn btn-ghost" data-go="misturnos">📋 Mis turnos</button></div>
  </div>`;
}

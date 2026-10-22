import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dayLabel, fromMin, hoursUntil, longLabel, toMin } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { PREP } from "../../lib/servicios.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { vHome } from "./home.js";

export function vTurnoOk() {
  const e = store.BOOK.find((l) => l.id === S.turnoId);
  if (!e && LIVE && S.user) {
    api
      .myBookings()
      .then(() => {
        if (store.BOOK.find((l) => l.id === S.turnoId)) {
          render();
        }
      })
      .catch(() => {});
    return '<div class="narrow" style="margin-top:24px"><div class="skel" style="min-height:240px"></div></div>';
  }
  if (!e) {
    return vHome();
  }
  if (e.status === "hold") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">⏳</div><h1 class="h1">Estamos confirmando tu pago</h1>
    <p class="lead">Mercado Pago nos avisa en segundos. Tu horario queda reservado mientras tanto.</p><button class="btn btn-pri btn-block" data-act="refreshMine">Actualizar</button></div></div>`;
  }
  if (e.status === "expired") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><h1 class="h1">El pago no se completó</h1><p class="lead">El horario se liberó.</p><button class="btn btn-pri btn-block" data-go="perfil" data-id="${e.pid}">Elegir otro horario</button></div></div>`;
  }
  const a = pr(e.pid);
  const t = hoursUntil(e);
  const s =
    "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" +
    encodeURIComponent(e.svc + " · " + a.name) +
    "&dates=" +
    e.date.replace(/-/g, "") +
    "T" +
    e.time.replace(":", "") +
    "00/" +
    e.date.replace(/-/g, "") +
    "T" +
    fromMin(toMin(e.time) + e.dur).replace(":", "") +
    "00&location=" +
    encodeURIComponent(a.addr + ", Olavarría");
  const n = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(a.addr + ", Olavarría");
  if (e.status === "cancelled" && e.byProv) {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">📅</div><h1 class="h1">${esc(a.name)} canceló tu turno</h1>
    <p class="lead">${esc(e.svc)} · ${esc(longLabel(e.date))} a las ${e.time}.${e.self ? (e.paid ? ` ${esc(a.name)} se va a comunicar con vos para devolverte la seña (${money(e.paid)}) o pasarte el turno a otro día.` : "") : e.paid ? ` Te devolvemos todo lo que pagaste (${money(e.paid + (e.fee || 0))}) a tu Mercado Pago.` : ""}</p>
    ${e.self ? "" : `<button class="btn btn-pri btn-block" data-act="rebook" data-id="${e.id}">Reprogramar mi turno</button>`}<button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (e.status === "cancelled") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">🗓️</div><h1 class="h1">Avisaste que no vas</h1>
    <p class="lead">Le avisamos a ${esc(a.name)} y el horario quedó libre para otra persona.${e.paid ? ` La seña (${money(e.paid)}) queda para el profesional.` : ""}</p>
    <button class="btn btn-pri btn-block" data-go="perfil" data-id="${a.id}">Sacar otro turno</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  if (e.status === "done" || e.status === "noshow") {
    return `<div class="narrow stack" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px">${e.status === "done" ? "✔" : "✕"}</div><h1 class="h1">${e.status === "done" ? "Fuiste a tu turno" : "No fuiste a este turno"}</h1>
    <p class="lead">${esc(e.svc)} · ${esc(dayLabel(e.date))} ${e.time} en ${esc(a.name)}.${e.status === "done" && e.stamped ? " 🎟️ Sumaste 1 sello." : ""}</p>
    <button class="btn btn-pri btn-block" data-go="perfil" data-id="${a.id}">Volver a reservar</button><button class="btn btn-ghost btn-block" style="margin-top:8px" data-go="misturnos">Ver mis turnos</button></div></div>`;
  }
  const o = e.series
    ? store.BOOK.filter((l) => l.series === e.series && l.id !== e.id && l.status === "confirmed")
    : [];
  const i = e.status === "confirmed" && hoursUntil(e) > 0;
  return `<div class="narrow stack" style="margin-top:20px">
   ${
     S.justBooked
       ? `<div class="booked"><div class="bk-ic">✓</div><b class="bk-h">¡Listo! Tenés turno</b>
     <p class="bk-when">${esc(longLabel(e.date))}<br><span>${e.time} h</span></p>
     <p class="bk-svc">${esc(e.svc)}${(e.addons || []).length ? " + " + (e.addons || []).map((l) => esc(l[0])).join(" + ") : ""} · ${e.dur} min</p>
     <p style="margin:0">en <b>${esc(a.name)}</b> · ${esc(a.addr)}</p>
     <p class="bk-must">${e.pay === "reward" ? "🎁 Canjeaste tu premio: este turno es gratis" : e.pay === "cash" ? `Pagaste la seña de ${money(e.paid)}${e.fee ? ` + ${money(e.fee)} de comisión` : ""} de tu ${esc(e.svc)}${e.price > e.paid ? ` · el resto (${money(e.price - e.paid)}) en efectivo en el local` : ""}` : `Pagaste ${money(e.paid)}${e.fee ? ` + ${money(e.fee)} de comisión` : ""} de tu ${esc(e.svc)} con Mercado Pago${e.price > e.paid ? ` · en el local: ${money(e.price - e.paid)}` : ""}`}</p>
     ${S.seriesMsg ? `<p class="note" style="margin:6px 0 0">${esc(S.seriesMsg)}</p>` : ""}
</div>`
       : '<h1 class="h1">Tu turno</h1>'
   }
   ${(() => {
     const l = a.svcs.find((d) => d[0] === e.svc);
     const c = e.note ?? PREP(a, l);
     if (c) {
       return `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(c)}</p></div>`;
     } else {
       return "";
     }
   })()}
   ${
     S.justBooked
       ? ""
       : `<div class="panel turnocard"><div class="tdate"><span>${esc(dayLabel(e.date, true))}</span><b>${e.time}</b></div>
    <div><b>${esc(e.svc)}</b>${(e.addons || []).length ? `<div class="hint">+ ${(e.addons || []).map((l) => esc(l[0])).join(" · ")}</div>` : ""}<div class="hint">${e.dur} min · ${esc(a.name)}</div><div class="hint">📍 ${esc(a.addr)}</div>
    <div style="margin-top:6px"><span class="chip ok">✓ Confirmado</span>${e.pay === "reward" ? '<span class="chip ok">🎁 Premio</span>' : e.pay === "cash" ? '<span class="chip">Seña pagada · resto en efectivo</span>' : '<span class="chip">Seña pagada · resto con Mercado Pago</span>'}</div></div></div>`
   }
   ${S.justBooked || e.pay === "reward" ? "" : `<div class="panel"><div class="sum">${e.disc ? `<div style="color:var(--ok)"><span>Happy hour</span><span>−${e.disc}%</span></div>` : ""}${e.fee ? `<div><span>Comisión TuTiempo (pagada)</span><span>${money(e.fee)}</span></div>` : ""}${e.pay === "cash" ? `<div><span>Seña pagada (Mercado Pago)</span><span>${money(e.paid)}</span></div>${e.price > e.paid ? `<div class="tot"><span>Resto en el local, en efectivo</span><span>${money(e.price - e.paid)}</span></div>` : ""}` : `<div><span>Pagado con Mercado Pago</span><span>${money(e.paid)}</span></div>${e.price > e.paid ? `<div class="tot"><span>Pagás en el local</span><span>${money(e.price - e.paid)}</span></div>` : ""}`}</div></div>`}
   ${o.length ? `<div class="panel"><p class="lbl">Se repite</p><div class="chips" style="justify-content:flex-start">${o.map((l) => `<button class="chip" data-act="verTurno" data-id="${l.id}">${esc(dayLabel(l.date))} ${l.time}</button>`).join("")}</div></div>` : ""}
   ${
     S.cancelAsk && i
       ? `<div class="panel" style="border-color:var(--bad-line)"><b>¿Avisar que no vas?</b><p style="margin:6px 0 12px;font-size:14px">${e.paid ? `La seña (${money(e.paid)})${e.fee ? " y la comisión" : ""} no se devuelve${e.fee ? "n" : ""}. ` : ""}El horario se libera para otra persona.</p>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ghost" data-act="cancelNo">Volver</button><button class="btn btn-bad" data-act="cancelYes">Sí, avisar</button></div></div>`
       : ""
   }
   <div class="tacts"><a class="btn btn-ghost" href="${n}" target="_blank" rel="noopener">🗺️ Cómo llegar</a><a class="btn btn-ghost" href="${s}" target="_blank" rel="noopener">📅 Al calendario</a>
    ${i ? `<button class="btn btn-bad" data-act="cancelAsk" ${S.cancelAsk ? "disabled" : ""}>🙅 No voy a poder ir</button>` : ""}<button class="btn btn-ghost" data-go="misturnos">📋 Mis turnos</button></div>
  </div>`;
}

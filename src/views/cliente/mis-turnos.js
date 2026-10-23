import { api } from "../../api/index.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { myCards, stampCard } from "../../ui/sellos.js";
import { myUpcoming } from "./home.js";
import { rateForm } from "./perfil.js";

// Mis turnos: próximos, avisos de los profesionales (se marcan leídos a los 1,5 s), tarjetas de sellos y anteriores
function vMisTurnosBase() {
  const upcoming = myUpcoming();
  const past = store.BOOK.filter((booking) => booking.mine && !upcoming.includes(booking)).sort((one, other) =>
    (other.date + other.time).localeCompare(one.date + one.time),
  );
  const cardOf = (booking) => {
    const prov = pr(booking.pid);
    return `<button class="tcard seg-${booking.cat || prov.cats[0]}" data-act="verTurno" data-id="${booking.id}"><div class="tdate"><span>${esc(dayLabel(booking.date, true))}</span><b>${booking.time}</b></div><div class="tc-m"><b>${esc(prov.name)}</b><span>${esc(booking.svc)}</span><span>📍 ${esc(prov.addr)}</span><span class="chip ok">✓ Confirmado</span>${booking.pay === "cash" ? '<span class="chip">💵 Resto en efectivo</span>' : booking.pay === "reward" ? '<span class="chip ok">🎁 Premio</span>' : ""}</div><span class="tc-go">›</span></button>`;
  };
  const chipOf = (booking) =>
    booking.status === "done"
      ? '<span class="chip ok">✔ Fuiste</span>'
      : booking.status === "noshow"
        ? '<span class="chip bad">No fuiste</span>'
        : booking.status === "cancelled"
          ? booking.byProv
            ? '<span class="chip bad">Lo canceló el profesional</span>'
            : '<span class="chip gray">Avisaste que no ibas</span>'
          : '<span class="chip gray">Pasado</span>';
  const inbox = S.inbox || [];
  const unread = inbox.filter((msg) => !msg.read).length;
  if (unread && !S.inboxSeen) {
    S.inboxSeen = true;
    setTimeout(() => {
      inbox.forEach((msg) => (msg.read = true));
      api.m.readMessages();
    }, 1500);
  }
  return `<div class="narrow stack" style="margin-top:20px"><h1 class="h1">Mis turnos</h1>
   ${(() => {
     // turnos que canceló el profesional y el cliente todavía no volvió a sacar
     const cancelled = store.BOOK.filter(
       (booking) =>
         booking.mine &&
         booking.status === "cancelled" &&
         booking.byProv &&
         booking.date >= TODAY() &&
         !booking.rebooked &&
         !store.BOOK.some(
           (other) =>
             other.mine &&
             other.pid == booking.pid &&
             other.status === "confirmed" &&
             other.svc === booking.svc &&
             other.id > booking.id &&
             (!booking.series || other.series !== booking.series) &&
             other.date + other.time >= TODAY() + nowHM(),
         ),
     );
     if (cancelled.length) {
       return `<div class="panel delpanel"><p class="lbl" style="margin:0 0 6px">⚠ Turnos que canceló el profesional</p><ul class="ag">${cancelled.map((booking) => `<li><span class="ag-t">${booking.time}</span><div><b>${esc(pr(booking.pid).name)}</b><span>${esc(booking.svc)} · ${esc(dayLabel(booking.date))}${booking.self ? " · te va a llamar para devolverte la seña o darte otro turno" : booking.paid ? ` · te devolvemos ${money(booking.paid + (booking.fee || 0))}` : ""}</span></div>${booking.self ? "<span></span>" : `<button class="btn btn-pri btn-sm" data-act="rebook" data-id="${booking.id}">Reprogramar</button>`}</li>`).join("")}</ul></div>`;
     } else {
       return "";
     }
   })()}
   <p class="lbl" style="margin:4px 0 0">Próximos</p>
   ${upcoming.length ? upcoming.map(cardOf).join("") : '<div class="panel" style="text-align:center"><p class="note" style="margin:0 0 10px">No tenés turnos reservados.</p><button class="btn btn-pri btn-block" data-act="goLocal">Reservar un turno</button></div>'}
   ${
     inbox.length
       ? `<div class="panel inbox"><p class="lbl">🔔 Avisos y mensajes de tus profesionales${unread ? ` <span class="cnt">${unread}</span>` : ""}</p><ul class="ag">${inbox
           .slice(0, S.inboxAll ? 50 : 3)
           .map(
             (msg) =>
               `<li class="${msg.read ? "" : "unread"}">${avatar({
                 photo: msg.photo,
                 name: msg.name,
                 hue: msg.hue,
               })}<div><b>${esc(msg.name)}</b><span class="msgb">${esc(msg.body)}</span><span class="hint">${esc(msg.d)}</span></div><button class="btn btn-ghost btn-sm" data-go="perfil" data-id="${msg.pid}">Reservar</button></li>`,
           )
           .join(
             "",
           )}</ul>${inbox.length > 3 && !S.inboxAll ? `<button class="lnk" data-act="inboxAll">Ver todos (${inbox.length})</button>` : ""}</div>`
       : ""
   }
   <!--SELLOS-->
   ${past.length ? `<p class="lbl" style="margin:8px 0 0">Anteriores</p><div class="panel"><ul class="ag">${past.map((booking) => `<li><span class="ag-t">${esc(dayLabel(booking.date))}</span><div><b>${esc(pr(booking.pid).name)} · ${booking.time}</b><span>${esc(booking.svc)} · ${money(booking.price)}</span>${booking.stamped ? '<span class="hint">🎟️ +1 sello</span>' : ""}${booking.status === "done" && !booking.reviewed ? (S.rateFor === booking.id ? rateForm(booking) : `<button class="lnk" data-act="rateOpen" data-id="${booking.id}">★ Calificar</button>`) : booking.reviewed ? '<span class="hint">✓ Calificaste</span>' : ""}</div>${chipOf(booking)}</li>`).join("")}</ul></div>` : ""}
  </div>`;
}
function vMisTurnosCards() {
  const cards = myCards();
  if (cards.length) {
    return `<p class="lbl" style="margin:4px 0 0">🎟️ Mis sellos</p><div class="stampgrid">${cards
      .sort((one, other) => other.n / other.goal - one.n / one.goal)
      .map(stampCard)
      .join("")}</div>`;
  } else {
    return "";
  }
}
export function vMisTurnos() {
  return vMisTurnosBase().replace("<!--SELLOS-->", vMisTurnosCards());
}

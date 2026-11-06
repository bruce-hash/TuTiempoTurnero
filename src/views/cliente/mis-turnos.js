import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { notByProvider, refundText } from "../../lib/devoluciones.js";
import { pr } from "../../lib/prestadores.js";
import { store } from "../../store.js";
import { myCards, stampCard } from "../../ui/sellos.js";
import { myUpcoming } from "./home.js";
import { ic } from "../../ui/iconos.js";

// 4/11: los avisos (y la acción de cada uno, msgAction) pasaron a la campanita de la cabecera (src/ui/campanita.js)
// Mis turnos: cancelados por el profesional, próximos y tarjetas de sellos (los avisos, en la campanita)
function vMisTurnosBase() {
  const upcoming = myUpcoming();
  const cardOf = (booking) => {
    const prov = pr(booking.pid);
    return `<button class="tcard seg-${booking.cat || prov.cats[0]}" data-act="verTurno" data-id="${booking.id}"><div class="tdate"><span>${esc(dayLabel(booking.date, true))}</span><b>${booking.time}</b></div><div class="tc-m"><b>${esc(prov.name)}</b><span>${esc(booking.svc)}</span><span>${ic("ubicacion")} ${esc(prov.addr)}</span><span class="chip ok">✓ Confirmado</span>${booking.pay === "cash" ? `<span class="chip">${ic("efectivo")} Resto en efectivo</span>` : booking.pay === "reward" ? `<span class="chip ok">${ic("premio")} Premio</span>` : ""}</div><span class="tc-go">›</span></button>`;
  };
  // 7/11 · Bloque 5: sin la lista de «Anteriores» (los turnos quedan en la base; el pedido de reseña llega por la
  // campanita y se deja en el perfil del profesional). En la compu: próximos a la izquierda y los sellos a la derecha
  // (mt-a, mt-b); en el celular, en el orden de siempre
  return `<div class="narrow stack cols2 mt" style="margin-top:20px"><h1 class="h1 c-all">Mis turnos</h1>
   <div class="mt-a">
   ${(() => {
     // turnos que canceló el profesional y el cliente todavía no volvió a sacar
     const cancelled = store.BOOK.filter(
       (booking) =>
         booking.mine &&
         ((booking.status === "cancelled" && (booking.byProv || booking.byRefund)) || (booking.status === "expired" && booking.refund)) &&
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
       const byProvOnly = cancelled.every((booking) => booking.status === "cancelled" && booking.byProv && !notByProvider(booking));
       // qué pasa con la plata: lo devuelve el profesional (bloqueo de días), Mercado Pago o la app
       const refundNote = (booking) =>
         booking.self
           ? " · te va a llamar para devolverte la seña o darte otro turno"
           : booking.byRefund
             ? " · Mercado Pago te devolvió el pago"
             : booking.refund
               ? " · " + refundText(booking)
               : booking.paid
                 ? ` · te devolvemos ${money(booking.paid + (booking.fee || 0) + (booking.mpFee || 0))}`
                 : "";
       return `<div class="panel delpanel"><p class="lbl" style="margin:0 0 6px">${ic("aviso")} ${byProvOnly ? "Turnos que canceló el profesional" : "Turnos cancelados"}</p><ul class="ag">${cancelled.map((booking) => `<li><span class="ag-t">${booking.time}</span><div><b>${esc(pr(booking.pid).name)}</b><span>${esc(booking.svc)} · ${esc(dayLabel(booking.date))}${esc(refundNote(booking))}</span></div>${booking.self ? "<span></span>" : `<button class="btn btn-pri btn-sm" data-act="rebook" data-id="${booking.id}">${booking.byRefund || booking.status === "expired" ? "Reservar de nuevo" : "Reprogramar"}</button>`}</li>`).join("")}</ul></div>`;
     } else {
       return "";
     }
   })()}
   <p class="lbl" style="margin:4px 0 0">Próximos</p>
   ${upcoming.length ? upcoming.map(cardOf).join("") : '<div class="panel" style="text-align:center"><p class="note" style="margin:0 0 10px">No tenés turnos reservados.</p><button class="btn btn-pri btn-block" data-act="goLocal">Reservar un turno</button></div>'}
   </div>
   <div class="mt-b"><!--SELLOS--></div>
  </div>`;
}
function vMisTurnosCards() {
  const cards = myCards();
  if (cards.length) {
    return `<p class="lbl" style="margin:4px 0 0">${ic("sellos")} Mis sellos</p><div class="stampgrid">${cards
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

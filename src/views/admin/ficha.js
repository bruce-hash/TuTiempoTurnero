import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dmy, isoToLocal, nowHM } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { ic } from "../../ui/iconos.js";

// ficha privada del prestador para el admin: notas, suspender (con motivo opcional) / reactivar y eliminar.
// upcoming = turnos futuros a cancelar (en vivo no se cuentan: null)
// 10/11 · punto 11 (D43): antes de suspender, un motivo opcional que ve el profesional (en el aviso fijo de su panel, en
// la campanita y en el email; el push no lo lleva). Las notas privadas de arriba las sigue viendo solo el admin.
const suspBox = (prov) =>
  `<div class="panel admsusp" role="group" aria-label="Suspender a ${esc(prov.name)}"><b>¿Suspender a ${esc(prov.name)}?</b>
   <p class="note" style="text-align:left;margin:4px 0 8px">Deja de aparecer en TuTiempo, nadie puede reservarle turnos nuevos y no puede escribirles a sus seguidores. Le llega un aviso en su panel, una notificación y un email.</p>
   <label class="hint" for="admSuspWhy">Motivo (lo ve el profesional) · opcional</label>
   <textarea id="admSuspWhy" maxlength="280" rows="3" placeholder="Ej: recibimos reclamos de clientes por turnos que no se cumplieron.">${esc(S.admSuspWhy || "")}</textarea>
   <div class="err" id="admSuspErr"></div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px"><button type="button" class="btn btn-ghost btn-sm" data-act="admSuspNo">Volver</button><button type="button" class="btn btn-bad btn-sm" data-act="admSet" data-id="${prov.id}" data-s="suspended">Suspender</button></div></div>`;
export function admFile(prov) {
  const asking = S.admDel === prov.id;
  const suspAsking = S.admSuspAsk === prov.id;
  const upcoming = LIVE
    ? null
    : store.BOOK.filter(
        (booking) =>
          booking.pid == prov.id &&
          booking.status === "confirmed" &&
          booking.type !== "block" &&
          booking.date + booking.time >= TODAY() + nowHM(),
      ).length;
  return `<div class="admfile">
   ${LIVE ? `<p class="note" style="text-align:left;margin:0 0 8px">${prov.verified ? `${ic("dni")} DNI verificado${prov.verifiedAt ? ` el ${esc(dmy(isoToLocal(prov.verifiedAt).date))}` : ""}${prov.verifiedBy ? ` por ${esc(prov.verifiedBy)}` : ""}` : `${ic("dni")} DNI sin verificar`}</p>` : ""}
   <p class="lbl" style="margin:0">${ic("candado")} Notas privadas · solo las ves vos</p>
   ${(prov.notes || []).length ? `<ul class="notes">${prov.notes.map((note) => `<li><div><span>${esc(dmy(note.d))}${note.t ? " · " + esc(note.t) : ""}</span><p>${esc(note.body)}</p></div><button class="xbtn" data-act="admNoteDel" data-id="${note.id}" data-p="${prov.id}" aria-label="Borrar nota">✕</button></li>`).join("")}</ul>` : '<p class="note" style="text-align:left;margin:0">Todavía no hay notas.</p>'}
   <form id="fNote" data-p="${prov.id}" novalidate><textarea id="admNote" maxlength="1000" rows="2" placeholder="Ej: pagó tarde, pidió cambiar de rubro, llamarlo el lunes…" aria-label="Nueva nota"></textarea><div class="err" id="noteerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar nota</button></form>
   ${prov.status === "suspended" ? `<p class="note admsusp-now"><b>Suspendido.</b> ${prov.suspReason ? `Motivo que ve el profesional: «${esc(prov.suspReason)}»` : "Sin motivo para el profesional."}</p>` : ""}
   <div class="admfa">${prov.status === "active" ? `<button class="btn btn-ghost" data-act="admSusp" data-id="${prov.id}" ${suspAsking ? "disabled" : ""}>${ic("pausa")} Suspender</button>` : `<button class="btn btn-ok" data-act="admSet" data-id="${prov.id}" data-s="active">▶ Reactivar</button>`}
    <button class="btn btn-bad" data-act="admDel" data-id="${prov.id}" ${asking ? "disabled" : ""}>${ic("borrar")} Eliminar profesional</button></div>
   ${suspAsking ? suspBox(prov) : ""}
   ${
     asking
       ? `<div class="panel admdel"><b>¿Eliminar a ${esc(prov.name)}?</b><p>${upcoming == null ? "Se cancelan todos sus turnos futuros y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar." : upcoming ? `Se cancelan sus ${upcoming} turno${upcoming > 1 ? "s" : ""} futuro${upcoming > 1 ? "s" : ""} y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar.` : "No tiene turnos futuros."} Deja de aparecer en TuTiempo y su cuenta queda sin panel. <b>No se puede deshacer.</b></p>
     <label class="mini"><input type="checkbox" id="admDelOk"> Entiendo que no se puede deshacer</label>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn btn-ghost" data-act="admDelNo">Volver</button><button class="btn btn-bad" data-act="admDelYes" data-id="${prov.id}">Sí, eliminar</button></div></div>`
       : ""
   }
  </div>`;
}

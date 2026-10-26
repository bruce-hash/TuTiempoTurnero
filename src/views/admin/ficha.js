import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dmy, isoToLocal, nowHM } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { store } from "../../store.js";

// ficha privada del prestador para el admin: notas, suspender/reactivar y eliminar.
// upcoming = turnos futuros a cancelar (en vivo no se cuentan: null)
export function admFile(prov) {
  const asking = S.admDel === prov.id;
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
   ${LIVE ? `<p class="note" style="text-align:left;margin:0 0 8px">${prov.verified ? `🪪 DNI verificado${prov.verifiedAt ? ` el ${esc(dmy(isoToLocal(prov.verifiedAt).date))}` : ""}${prov.verifiedBy ? ` por ${esc(prov.verifiedBy)}` : ""}` : "🪪 DNI sin verificar"}</p>` : ""}
   <p class="lbl" style="margin:0">🔒 Notas privadas · solo las ves vos</p>
   ${(prov.notes || []).length ? `<ul class="notes">${prov.notes.map((note) => `<li><div><span>${esc(dmy(note.d))}${note.t ? " · " + esc(note.t) : ""}</span><p>${esc(note.body)}</p></div><button class="xbtn" data-act="admNoteDel" data-id="${note.id}" data-p="${prov.id}" aria-label="Borrar nota">✕</button></li>`).join("")}</ul>` : '<p class="note" style="text-align:left;margin:0">Todavía no hay notas.</p>'}
   <form id="fNote" data-p="${prov.id}" novalidate><textarea id="admNote" maxlength="1000" rows="2" placeholder="Ej: pagó tarde, pidió cambiar de rubro, llamarlo el lunes…" aria-label="Nueva nota"></textarea><div class="err" id="noteerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar nota</button></form>
   <div class="admfa">${prov.status === "active" ? `<button class="btn btn-ghost" data-act="admSet" data-id="${prov.id}" data-s="suspended">⏸ Suspender</button>` : `<button class="btn btn-ok" data-act="admSet" data-id="${prov.id}" data-s="active">▶ Reactivar</button>`}
    <button class="btn btn-bad" data-act="admDel" data-id="${prov.id}" ${asking ? "disabled" : ""}>🗑 Eliminar prestador</button></div>
   ${
     asking
       ? `<div class="panel admdel"><b>¿Eliminar a ${esc(prov.name)}?</b><p>${upcoming == null ? "Se cancelan todos sus turnos futuros y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar." : upcoming ? `Se cancelan sus ${upcoming} turno${upcoming > 1 ? "s" : ""} futuro${upcoming > 1 ? "s" : ""} y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar.` : "No tiene turnos futuros."} Deja de aparecer en TuTiempo y su cuenta queda sin panel. <b>No se puede deshacer.</b></p>
     <label class="mini"><input type="checkbox" id="admDelOk"> Entiendo que no se puede deshacer</label>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn btn-ghost" data-act="admDelNo">Volver</button><button class="btn btn-bad" data-act="admDelYes" data-id="${prov.id}">Sí, eliminar</button></div></div>`
       : ""
   }
  </div>`;
}

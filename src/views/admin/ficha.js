import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dmy, nowHM } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { store } from "../../store.js";

export function admFile(e) {
  const a = S.admDel === e.id;
  const t = LIVE
    ? null
    : store.BOOK.filter(
        (s) =>
          s.pid == e.id &&
          s.status === "confirmed" &&
          s.type !== "block" &&
          s.date + s.time >= TODAY() + nowHM(),
      ).length;
  return `<div class="admfile">
   <p class="lbl" style="margin:0">🔒 Notas privadas · solo las ves vos</p>
   ${(e.notes || []).length ? `<ul class="notes">${e.notes.map((s) => `<li><div><span>${esc(dmy(s.d))}${s.t ? " · " + esc(s.t) : ""}</span><p>${esc(s.body)}</p></div><button class="xbtn" data-act="admNoteDel" data-id="${s.id}" data-p="${e.id}" aria-label="Borrar nota">✕</button></li>`).join("")}</ul>` : '<p class="note" style="text-align:left;margin:0">Todavía no hay notas.</p>'}
   <form id="fNote" data-p="${e.id}" novalidate><textarea id="admNote" maxlength="1000" rows="2" placeholder="Ej: pagó tarde, pidió cambiar de rubro, llamarlo el lunes…" aria-label="Nueva nota"></textarea><div class="err" id="noteerr"></div><button class="btn btn-pri btn-block" type="submit">Guardar nota</button></form>
   <div class="admfa">${e.status === "active" ? `<button class="btn btn-ghost" data-act="admSet" data-id="${e.id}" data-s="suspended">⏸ Suspender</button>` : `<button class="btn btn-ok" data-act="admSet" data-id="${e.id}" data-s="active">▶ Reactivar</button>`}
    <button class="btn btn-bad" data-act="admDel" data-id="${e.id}" ${a ? "disabled" : ""}>🗑 Eliminar prestador</button></div>
   ${
     a
       ? `<div class="panel admdel"><b>¿Eliminar a ${esc(e.name)}?</b><p>${t == null ? "Se cancelan todos sus turnos futuros y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar." : t ? `Se cancelan sus ${t} turno${t > 1 ? "s" : ""} futuro${t > 1 ? "s" : ""} y a los clientes se les devuelve todo lo que pagaron (seña y comisión), con aviso para reprogramar.` : "No tiene turnos futuros."} Deja de aparecer en TuTiempo y su cuenta queda sin panel. <b>No se puede deshacer.</b></p>
     <label class="mini"><input type="checkbox" id="admDelOk"> Entiendo que no se puede deshacer</label>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button class="btn btn-ghost" data-act="admDelNo">Volver</button><button class="btn btn-bad" data-act="admDelYes" data-id="${e.id}">Sí, eliminar</button></div></div>`
       : ""
   }
  </div>`;
}

// V4b · C25 "Cargar diferencia": cómo te pagó el resto de un turno, en uno o dos medios. Lo mismo en la Agenda (al
// marcar "Asistió") y en la Caja del día de Finanzas. closeAct: la acción del botón "Listo" (o nada).
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { MEDIOS, medioIcon } from "../../lib/medios.js";
import { restOf, restSplit } from "../../lib/resto.js";
import { S } from "../../state.js";

// resumen: "$3.000 en Efectivo + $2.000 en Transferencia" (y lo que falta, si quedó algo sin cobrar)
export function restSummary(booking) {
  const { parts, missing } = restSplit(booking);
  return (
    parts.map((part) => `${medioIcon(part.medio)} ${money(part.m)} en ${esc(part.medio)}`).join(" + ") +
    (missing ? ` · <span class="rs-miss">${money(missing)} sin cobrar</span>` : "")
  );
}

const options = (selected) => MEDIOS.map((medio) => `<option ${medio === selected ? "selected" : ""}>${medio}</option>`).join("");

export function restEditor(booking, closeAct) {
  const rest = restOf(booking);
  const split = booking.restParts && booking.restParts.length ? booking.restParts : null;
  const close = closeAct ? `<button type="button" class="btn btn-ghost btn-sm" data-act="${closeAct}">Listo</button>` : "";
  if (S.restSplit === booking.id) {
    const { parts } = restSplit(booking);
    const first = parts[0] ? parts[0].medio : MEDIOS[0];
    const second = (split && split[1] && split[1][0]) || MEDIOS.find((medio) => medio !== first);
    const one = split ? split[0][1] : "";
    const two = split && split[1] ? split[1][1] : "";
    return `<form id="fRest" class="restsplit" data-id="${booking.id}" novalidate>
     <p class="lbl">Cobrar el resto (${money(rest)}) en dos medios</p>
     <div class="rs-row"><select id="rs_m1" aria-label="Primer medio">${options(first)}</select><input id="rs_a1" inputmode="numeric" autocomplete="off" placeholder="Monto" aria-label="Monto en el primer medio" value="${one}"></div>
     <div class="rs-row"><select id="rs_m2" aria-label="Segundo medio">${options(second)}</select><input id="rs_a2" inputmode="numeric" autocomplete="off" placeholder="Monto" aria-label="Monto en el segundo medio" value="${two}"></div>
     <p class="hint" id="rs_left" data-rest="${rest}">Si suman menos que el resto, lo que falta queda sin cobrar.</p>
     <div class="err" id="rserr"></div>
     <div class="rs-btns"><button type="button" class="btn btn-ghost" data-act="restSplitOff" data-id="${booking.id}">Un solo medio</button><button class="btn btn-pri" type="submit">Guardar</button></div>
    </form>`;
  }
  const current = split ? null : restSplit(booking).parts[0];
  return `<div class="restask"><div><b>¿Cómo te pagó el resto? · ${money(rest)}</b><span>${split ? "Ahora: " + restSummary(booking) : "Tocá el medio. Si te pagó con dos, dividilo."}</span></div>
   <span class="medios">${MEDIOS.map((medio) => `<button type="button" class="btn btn-sm ${current && current.medio === medio ? "btn-pri" : "btn-ghost"}" data-act="restMedio" data-id="${booking.id}" data-m="${medio}" aria-pressed="${!!current && current.medio === medio}">${medio}</button>`).join("")}<button type="button" class="btn btn-sm ${split ? "btn-pri" : "btn-ghost"}" data-act="restSplitOn" data-id="${booking.id}" aria-pressed="${!!split}">En dos medios</button>${close}</span></div>`;
}

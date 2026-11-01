import { esc } from "../lib/dom.js";
import { DOW, dm } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { catInfo } from "../lib/rubros.js";
import { svcByKey } from "./sellos.js";

// Ingreso y registro: el ticket de la acción que pidió ingresar (S.pending), arriba de la ventana. Talón a la izquierda
// (día, fecha y hora) separado por una línea punteada, como un ticket de turno; a la derecha, qué, dónde y lo que pasa al
// ingresar. Usa el color suave del rubro del prestador: no suma colores.
export function ticket(pending) {
  if (!pending || pending.a === "negocio") {
    return "";
  }
  const prov = pr(pending.pid);
  if (!prov) {
    return "";
  }
  const where = esc(prov.name) + (prov.addr ? " · " + esc(prov.addr) : "");
  const seg = (prov.cats && prov.cats[0]) || "n";
  const day = (key) => DOW[new Date(key + "T12:00:00").getDay()];
  if (pending.a === "reservar") {
    const svc = svcByKey(prov, pending.svc);
    return `<div class="tk" data-ticket="reservar"><div class="tk-stub"><small>${day(pending.day)}</small><b>${dm(pending.day)}</b><span>${esc(pending.time)}</span></div>
     <div class="tk-info"><b>${svc ? `${esc(svc[0])} · ${svc[1]} min` : "Tu turno"}</b><span>${where}</span><em>Al ingresar seguís directo al pago</em></div></div>`;
  }
  if (pending.a === "lista") {
    return `<div class="tk" data-ticket="lista"><div class="tk-stub"><small>${day(pending.day)}</small><b>${dm(pending.day)}</b><span>🔔</span></div>
     <div class="tk-info"><b>Avisarme si se libera un turno</b><span>${where}</span><em>Al ingresar queda anotado</em></div></div>`;
  }
  return `<div class="tk slim" data-ticket="seguir"><div class="tk-stub"><b>＋</b></div>
   <div class="tk-info"><b>Seguir a ${esc(prov.name)}</b><span>${esc(catInfo(seg).one)}${prov.addr ? " · " + esc(prov.addr) : ""}</span><em>Al ingresar queda hecho</em></div></div>`;
}

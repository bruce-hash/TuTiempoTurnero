import { esc } from "../../lib/dom.js";
import { dmyIso } from "../../lib/fechas.js";
import { suspension } from "../../lib/alta.js";
import { ic } from "../../ui/iconos.js";

// 10/11 · punto 11 (D43): aviso fijo arriba de todo el panel mientras TuTiempo tiene la cuenta suspendida: qué significa,
// el motivo que escribió el admin (si escribió uno; no son sus notas privadas) y cómo resolverlo.

// contacto de TuTiempo (el mismo del email: supabase/functions/_shared/email.ts)
export const SUPPORT_WHATSAPP = "https://wa.me/5492284722825";
export const SUPPORT_EMAIL = "contacto@tutiempo.com.ar";

// qué significa estar suspendido, una línea por cosa: para sumar otra (por ejemplo, sobre los turnos ya reservados),
// agregala acá
export const SUSPENDED_MEANS = [
  "No aparecés en el listado de TuTiempo.",
  "No recibís reservas nuevas.",
  "No podés mandar avisos ni ofertas a tus seguidores.",
  // 10/11 (Bruno, D43)
  "Tus turnos ya reservados siguen en pie: atendelos como siempre (o cancelalos desde la Agenda, con devolución al cliente).",
];

export function suspendedBanner() {
  const susp = suspension();
  if (!susp) {
    return "";
  }
  const since = dmyIso(susp.since);
  return `<div class="panel suspbox c-all" role="status" aria-labelledby="suspT">
   <p class="susp-h" id="suspT">${ic("pausa")} <b>Tu cuenta está suspendida</b>${since ? `<span class="hint"> · desde el ${esc(since)}</span>` : ""}</p>
   ${susp.reason ? `<p class="susp-why"><b>Motivo:</b> ${esc(susp.reason)}</p>` : ""}
   <p class="susp-l">Mientras esté suspendida:</p>
   <ul class="susp-list">${SUSPENDED_MEANS.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
   <p class="susp-l">Para resolverlo, escribinos:</p>
   <div class="susp-ct"><a class="btn btn-pri btn-sm" href="${SUPPORT_WHATSAPP}" target="_blank" rel="noopener">${ic("whatsapp")} WhatsApp</a><a class="btn btn-ghost btn-sm" href="mailto:${SUPPORT_EMAIL}">${ic("email")} ${SUPPORT_EMAIL}</a></div>
  </div>`;
}

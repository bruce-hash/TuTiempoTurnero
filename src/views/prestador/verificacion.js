import { approved, dniMissing, dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";

// H10: formatos de las fotos del DNI (los mismos que acepta el bucket dni)
const DNI_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

// H10: lo que falta para verificar la identidad (número, frente y dorso). El número no se muestra: solo si está cargado.
export function dniForm(st) {
  const done = (ok) => (ok ? ' <span style="color:var(--ok)">✓ cargado</span>' : "");
  return `<p class="note" style="text-align:left;margin:10px 0">Necesitamos tu número de DNI y las fotos del frente y del dorso. Solo los ve el equipo de TuTiempo. Guardamos las fotos hasta 30 días después de verificarte.</p>
   <form id="fDni" novalidate><div class="f"><label for="dniN">Número de DNI${done(st.number)}</label><div class="pw"><input id="dniN" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="Sin puntos, 7 u 8 números"><button class="btn btn-ghost btn-sm" type="submit">Guardar</button></div></div></form>
   <div class="f"><label for="dniFront">Foto del frente${done(st.front)}</label><input id="dniFront" type="file" accept="${DNI_ACCEPT}"></div>
   <div class="f"><label for="dniBack">Foto del dorso${done(st.back)}</label><input id="dniBack" type="file" accept="${DNI_ACCEPT}"></div>`;
}

// Bloque D: los 3 pasos para empezar a recibir reservas (datos, DNI o aprobación de TuTiempo, Mercado Pago), arriba de
// Perfil (con el formulario del DNI adentro) y de la Agenda (con un link a Perfil) mientras falte el paso 2.
// where: "perfil" | "agenda"
export function setupSteps(prov, where) {
  if (approved(prov)) {
    return "";
  }
  const inPerfil = where === "perfil";
  const missing = dniMissing(S.dniSt);
  const step2 = dniRequired()
    ? `<li class="now"><span class="dot">2</span><div><b>Verificación de DNI</b><span>${missing.length ? `Falta ${missing.join(", ").replace(/, ([^,]*)$/, " y $1")}.` : "En revisión: ya tenemos todo, lo revisa el equipo de TuTiempo."}</span>${
        inPerfil ? (missing.length ? dniForm(S.dniSt || {}) : "") : missing.length ? '<button class="btn btn-pri btn-sm" style="margin-top:8px" data-btab="perfil">Cargar mi DNI</button>' : ""
      }</div></li>`
    : `<li class="now"><span class="dot">2</span><div><b>Aprobación de TuTiempo</b><span>En revisión: el equipo de TuTiempo revisa tu perfil.</span></div></li>`;
  const mpOk = S.mp === "ok";
  const step3 = `<li class="${mpOk ? "done" : ""}"><span class="dot">${mpOk ? "✓" : "3"}</span><div><b>Conectar Mercado Pago</b><span>${mpOk ? "Conectado" : inPerfil ? "Desde Cobros, acá abajo" : "Desde tu perfil"}</span>${
    !mpOk && !inPerfil ? '<button class="lnk" data-btab="perfil">Ir a Perfil →</button>' : ""
  }</div></li>`;
  return `<div class="panel setup"><p class="lbl">Activá tu perfil</p><ol class="steps"><li class="done"><span class="dot">✓</span><div><b>Datos cargados</b></div></li>${step2}${step3}</ol></div>`;
}

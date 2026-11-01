import { approved, dniMissing, dniRequired } from "../../lib/verificacion.js";
import { nextStep, setupTodo } from "../../lib/alta.js";
import { esc } from "../../lib/dom.js";
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

// Registrá tu negocio (aprobado el 1/11): arriba de la Agenda, lo que falta para recibir reservas con una barra de
// avance y "Seguir con el alta" (lleva al primer paso sin guardar). Desaparece con el perfil aprobado y Mercado Pago
// conectado. Reemplaza la tarjeta "Activá tu perfil" de la Agenda (en Perfil siguen los pasos con el formulario del DNI).
export function setupCard() {
  const items = setupTodo();
  if (!items.length || items.every((item) => item[1])) {
    return "";
  }
  const done = items.filter((item) => item[1]).length;
  const next = nextStep();
  const mpMissing = !items.find((item) => item[2] === "mp")[1];
  const action = next
    ? '<button class="btn btn-pri btn-sm" data-act="bizStart">Seguir con el alta</button>'
    : mpMissing
      ? '<button class="btn btn-pri btn-sm" data-act="mpConnect">Conectar Mercado Pago</button>'
      : "";
  return `<div class="panel todo"><b class="todo-h">Te falta poco para recibir reservas</b><p>Tu perfil todavía no aparece en TuTiempo. Completá lo que falta:</p>
   <div class="todo-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${done}" aria-label="Avance del alta"><i style="width:${Math.round((done / items.length) * 100)}%"></i></div>
   <ul>${items.map(([label, ok]) => `<li class="${ok ? "ok" : ""}">${ok ? "✓" : "○"} ${esc(label)}</li>`).join("")}</ul>${action}</div>`;
}

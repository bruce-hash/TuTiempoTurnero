import { chargeFor } from "../../lib/cobro.js";
import { money, pctTxt } from "../../lib/dinero.js";
import { store } from "../../store.js";
import { DEPOSIT_PCT } from "../prestador/plazo.js";
import { LEGAL_VERSION, legalDraft } from "./privacidad.js";

const sec = (title, body) => `<section><h2>${title}</h2>${body}</section>`;

// 7/11 · Punto 5: Términos y condiciones completos (antes, un resumen para la demo). La comisión y la seña son las
// vigentes (store.FEES, DEPOSIT_PCT); el ejemplo usa la misma cuenta que la base (chargeFor ↔ charge_parts).
// Borrador: pendiente de revisión legal (docs/11-legales.md).
export function vTerminos() {
  const price = 2e4;
  const deposit = Math.round((price * DEPOSIT_PCT) / 100);
  const ex = chargeFor(deposit, store.FEES.commission, 0, price);
  return `<div class="narrow stack legalpage" style="margin-top:20px"><article class="panel legal-doc">
   ${legalDraft()}
   <p class="hint legal-ver">${LEGAL_VERSION}</p>
   <h1 class="h1">Términos y condiciones</h1>
   ${sec("Qué es TuTiempo", `<p>TuTiempo es una plataforma que conecta a clientes con barberías, peluquerías, masajistas, lashistas, manicuras y centros de depilación de Olavarría para reservar turnos online. TuTiempo no presta los servicios: los presta cada profesional, que es responsable de su trabajo, sus precios y su atención.</p>`)}
   ${sec("Cuentas", `<p>Para reservar necesitás una cuenta, con datos verdaderos. Una cuenta es de cliente o de negocio: con la de negocio no se reserva, no se sigue a otros profesionales ni se dejan reseñas. Sos responsable de cuidar tu contraseña.</p>`)}
   ${sec("Reservas y pagos", `<p>Reservás en los horarios que el profesional habilitó. Al reservar pagás con <b>Mercado Pago</b>:</p>
    <ul><li><b>La seña:</b> el ${DEPOSIT_PCT}% del precio del servicio, que se acredita completa al profesional. El resto se lo pagás en el local.</li>
    <li><b>La comisión de TuTiempo:</b> el ${pctTxt()}% del precio del turno (con descuentos y adicionales). La pagás vos, aparte de la seña.</li>
    <li>Si corresponde, el <b>costo de Mercado Pago</b> por la acreditación, según el plazo que eligió el profesional.</li></ul>
    <p>Antes de pagar ves el detalle. Ejemplo: un corte de ${money(price)} → seña ${money(ex.deposit)} + comisión ${money(ex.fee)} = ${money(ex.total)} al reservar; en el local pagás ${money(price - ex.deposit)}.</p>
    <p>El turno queda confirmado cuando Mercado Pago aprueba el pago. Si el pago llega cuando el horario ya no está disponible o después de la hora del turno, te devolvemos todo lo que pagaste.</p>`)}
   ${sec("Si cancelás vos", `<p>Podés cancelar tu turno desde Mis turnos. <b>Lo pagado no se devuelve:</b> la seña queda para el profesional, que te guardó el horario, y la comisión para TuTiempo. Si no vas al turno, pasa lo mismo.</p>`)}
   ${sec("Si cancela el profesional", `<ul><li><b>Un turno:</b> si el profesional cancela tu turno, te devolvemos automáticamente todo lo que pagaste (la seña y la comisión).</li>
    <li><b>Días bloqueados (vacaciones, feriados):</b> si el profesional bloquea un día en el que tenías turno, el turno se cancela y te avisamos. En ese caso <b>TuTiempo no devuelve la seña</b>: el profesional se comunica con vos para devolvértela o darte otro turno.</li>
    <li>Si el profesional elimina su negocio, a los clientes con turnos futuros se les devuelve lo pagado.</li></ul>
    <p>Las devoluciones las hace Mercado Pago al mismo medio con el que pagaste; el tiempo en que se ven depende de Mercado Pago y de tu banco.</p>`)}
   ${sec("Profesionales", `<p>Para publicar tu negocio tenés que cargar datos verdaderos y, si TuTiempo lo pide, verificar tu identidad con tu DNI. TuTiempo revisa cada perfil antes de que aparezca en el listado y puede suspender a quien no cumpla estos términos. Para cobrar señas tenés que conectar tu cuenta de Mercado Pago: la seña se acredita en tu cuenta según el plazo que elegiste. Sos responsable de cumplir los turnos que aceptás, de tus precios y de tus obligaciones fiscales.</p>`)}
   ${sec("Reseñas y comunidad", `<p>Solo puede dejar una reseña quien fue a un turno con ese profesional. Las reseñas tienen que ser respetuosas y sobre la atención recibida. El profesional puede responderlas.</p>`)}
   ${sec("Eliminar la cuenta", `<p>Clientes y profesionales pueden eliminar su cuenta desde Ajustes. Se borran sus datos personales como dice la <button type="button" class="lnk" data-go="privacidad">Política de privacidad</button>.</p>`)}
   ${sec("Responsabilidad", `<p>TuTiempo hace lo posible para que la plataforma funcione sin interrupciones, pero puede haber cortes o errores. TuTiempo no es responsable por el servicio que presta cada profesional.</p>`)}
   ${sec("Contacto y cambios", `<p>Por cualquier consulta o reclamo, escribinos a <a class="lnk" href="mailto:contacto@tutiempo.com.ar">contacto@tutiempo.com.ar</a>. Podemos actualizar estos términos; la versión vigente está siempre en esta página, con su fecha arriba. Se aplican las leyes de la República Argentina.</p>`)}
  </article><button class="btn btn-ghost btn-block" data-act="volver">← Volver</button></div>`;
}

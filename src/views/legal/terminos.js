import { chargeFor } from "../../lib/cobro.js";
import { money, pctTxt } from "../../lib/dinero.js";
import { store } from "../../store.js";

// términos y condiciones en versión resumida (la pantalla misma dice “Resumen para la demo”); el porcentaje de
// comisión es el vigente
export function vTerminos() {
  return `<div class="narrow stack" style="margin-top:20px"><div class="panel">
   <h1 class="h1">Términos y condiciones</h1><p class="lead">Resumen para la demo</p>
   <div class="sum" style="text-align:left;gap:12px">
    <p style="margin:0"><b>Qué es TuTiempo.</b> Una plataforma que conecta clientes con barberías, peluquerías, masajistas, lashistas, manicuras y centros de depilación de Olavarría para reservar turnos online.</p>
    <p style="margin:0"><b>Pagos.</b> El cliente paga por Mercado Pago, al reservar, la seña (o el total) que eligió el profesional más la comisión de TuTiempo. La seña se acredita completa al profesional.</p>
    <p style="margin:0"><b>Comisión.</b> Es el ${pctTxt()}% de la seña de cada turno reservado por la plataforma. La paga el cliente aparte, junto con la seña (por ejemplo: corte de $20.000 con seña de $10.000 → el cliente paga $10.000 + ${money(chargeFor(1e4, store.FEES.commission, 0).fee)}). Si corresponde, también se suma el costo de Mercado Pago por la acreditación, según el plazo que eligió el profesional; el detalle se ve antes de pagar.</p>
    <p style="margin:0"><b>Turnos en el local.</b> El cliente reserva solo en los horarios que el profesional habilitó y paga la seña (o el total) por Mercado Pago. Lo pagado no se devuelve: el horario queda reservado y, si el cliente no va, el profesional se queda con lo pagado. Si cancela el profesional, se devuelve todo.</p>
    <p style="margin:0"><b>Eliminar la cuenta.</b> Cliente y profesional pueden eliminar su cuenta desde su perfil. Se borran sus datos personales (Ley 25.326). Si un profesional elimina su perfil, a sus clientes con turnos futuros se les devuelve lo pagado.</p>
   </div></div><button class="btn btn-ghost btn-block" data-act="volver">← Volver</button></div>`;
}

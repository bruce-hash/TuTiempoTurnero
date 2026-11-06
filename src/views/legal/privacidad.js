import { ic } from "../../ui/iconos.js";

// 7/11 · Punto 5: Política de privacidad. Base: el texto que mandó TuTiempo (versión 1.0, noviembre de 2026), completado
// con lo que la app hace de verdad (datos que guarda, DNI, CAPTCHA, emails, notificaciones, Mercado Pago, plazos de
// borrado). Borrador: pendiente de revisión legal (docs/11-legales.md lista lo que hay que revisar).
export const LEGAL_VERSION = "Versión 1.0 · noviembre de 2026";
export const legalDraft = () =>
  `<div class="legal-draft" role="note">${ic("aviso")} <span><b>Borrador pendiente de revisión legal.</b> Este texto todavía no fue revisado por un abogado y puede cambiar.</span></div>`;
const sec = (title, body) => `<section><h2>${title}</h2>${body}</section>`;

export function vPrivacidad() {
  return `<div class="narrow stack legalpage" style="margin-top:20px"><article class="panel legal-doc">
   ${legalDraft()}
   <p class="hint legal-ver">${LEGAL_VERSION}</p>
   <h1 class="h1">Política de privacidad</h1>
   <p>En TuTiempo nos comprometemos con la protección y la seguridad de los datos de quienes usan la plataforma, de acuerdo con la Ley N° 25.326 de Protección de Datos Personales y sus normas reglamentarias. Los datos que te pedimos para registrarte y usar TuTiempo se usan solo como dice este documento.</p>
   ${sec("Qué datos guardamos", `<ul>
    <li><b>Tu cuenta:</b> nombre, apellido, correo electrónico y, si lo cargás, tu celular y tu foto. Si entrás con tu cuenta de Google, recibimos de Google tu nombre, tu correo y tu foto para identificarte.</li>
    <li><b>Tus turnos:</b> con quién reservaste, qué servicio, el día y la hora, lo que pagaste y el estado del turno (confirmado, cancelado, si fuiste). También las reseñas que dejás (se publican con el nombre que muestra tu cuenta), los profesionales que seguís y tus tarjetas de sellos.</li>
    <li><b>Si tenés un negocio:</b> los datos del negocio (nombre, dirección, celular, rubros, servicios, precios, horarios, fotos de trabajos), tu número de DNI y las fotos del frente y del dorso para verificar tu identidad (ver «DNI de los profesionales»), los datos de tus clientes que cargás vos (nombre, celular, notas, cumpleaños) y lo que anotás en tu caja.</li>
    <li><b>Datos técnicos:</b> para que puedas seguir con tu sesión iniciada, la app guarda en tu navegador la sesión y algunas preferencias (por ejemplo, la reserva que estabas haciendo antes de ingresar o el cobro que quedó abierto en Mercado Pago). No usamos cookies de publicidad ni de seguimiento.</li>
   </ul>`)}
   ${sec("Para qué los usamos", `<p>Para crear y administrar tu cuenta, mostrarte los profesionales y sus horarios, gestionar tus turnos y sus pagos, mandarte los avisos de tus turnos y atender consultas y reclamos.</p>
    <p><b>Qué ve el profesional:</b> cuando reservás, el profesional ve tu nombre, tu celular, el turno y tu historial de turnos con él (cuántas veces fuiste, si faltaste). No ve tu correo ni tus turnos con otros profesionales. En las notificaciones que le llegan al celular va solo tu nombre de pila. Si lo seguís, ve tu nombre de pila y la inicial de tu apellido.</p>
    <p>TuTiempo no vende tus datos ni los comunica a terceros para fines ajenos a los de este documento, salvo que la ley lo exija. Siempre tratamos de usar solo lo necesario para cada fin.</p>`)}
   ${sec("DNI de los profesionales", `<p>Para aprobar a un profesional, TuTiempo puede pedirle su número de DNI y fotos del frente y del dorso. Las fotos se guardan en un espacio privado que solo puede ver el equipo de TuTiempo, y <b>se borran en el momento en que lo verificamos</b>: queda solo el número, la fecha y quién lo verificó. Si el alta no se aprueba, las fotos se borran a los 90 días de la última que subió; si el profesional da de baja su negocio, se borran en el momento.</p>`)}
   ${sec("Protección contra abusos (CAPTCHA)", `<p>Para evitar cuentas falsas y ataques automáticos, al registrarte, ingresar o recuperar tu contraseña usamos <b>Cloudflare Turnstile</b>. Turnstile analiza datos técnicos de tu navegador (por ejemplo, la dirección IP y características del dispositivo) para distinguir a una persona de un programa automático. Esos datos los trata Cloudflare según su propia política de privacidad.</p>`)}
   ${sec("Emails", `<p>Te mandamos por email la confirmación de cada turno y las cancelaciones, siempre. El recordatorio del día anterior, el pedido de reseña y las novedades de tus profesionales los podés apagar en <b>Mi perfil → Avisos por email</b>. Los emails salen de <i>avisos@tutiempo.com.ar</i> a través de un proveedor de envío de correo (Resend); guardamos el registro de cada envío hasta 90 días.</p>`)}
   ${sec("Notificaciones", `<p>Si las activás, te mandamos notificaciones al celular o a la computadora (por ejemplo, la confirmación de un turno o el recordatorio). Para eso guardamos la dirección que nos da tu navegador para ese dispositivo; las notificaciones pasan por el servicio de tu navegador (Google, Apple o Mozilla). En la notificación no va nada privado: el detalle lo ves al abrir la app. Las podés apagar en <b>Mi perfil → Notificaciones</b> o desde los permisos de tu navegador; si un dispositivo deja de recibirlas, lo borramos a los 30 días.</p>`)}
   ${sec("Pagos con Mercado Pago", `<p>La seña de cada turno se paga con <b>Mercado Pago</b>. El tratamiento de tus datos en ese caso se rige por las políticas de privacidad y los términos de Mercado Pago, que te recomendamos leer. TuTiempo <b>no accede, no recopila ni guarda</b> los datos de tu tarjeta ni de otros medios de pago que cargás en Mercado Pago: solo recibimos el número de operación, el monto y su estado para confirmar o devolver tu turno.</p>`)}
   ${sec("Dónde se guardan", `<p>Los datos se guardan en servidores de proveedores de infraestructura (la base de datos y los archivos, en Supabase; el sitio, en Hostinger), con acceso restringido y conexiones cifradas. Algunos de estos proveedores pueden estar fuera de Argentina.</p>`)}
   ${sec("Cuánto tiempo los guardamos", `<ul>
    <li>Mientras tengas tu cuenta. Si la eliminás (Ajustes → Eliminar la cuenta), se borran tu perfil, los profesionales que seguís y tu historial personal; en los turnos que quedan en la agenda de los profesionales tu nombre pasa a «Cliente eliminado» y se borra tu celular. Los turnos futuros se cancelan.</li>
    <li>Las fotos del DNI, como dice «DNI de los profesionales».</li>
    <li>El registro de emails, 90 días; el de notificaciones, 30 días.</li>
    <li>Los registros de pagos, el tiempo que exijan las normas contables y fiscales.</li>
   </ul>`)}
   ${sec("Tus derechos", `<p>Podés pedir <b>ver, corregir, actualizar o borrar</b> tus datos personales (Ley 25.326). Muchas cosas las podés hacer vos mismo desde Mi perfil y Ajustes. Para todo lo demás, escribinos a <a class="lnk" href="mailto:contacto@tutiempo.com.ar">contacto@tutiempo.com.ar</a> contando qué necesitás y con los datos que nos permitan verificar que sos el titular (por ejemplo, desde el correo de tu cuenta). Te respondemos en los plazos de la ley: 10 días corridos para el acceso y 5 días hábiles para corregir o borrar.</p>
    <p>La <b>Agencia de Acceso a la Información Pública (AAIP)</b>, como autoridad de control de la Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las normas de protección de datos personales.</p>`)}
   ${sec("Cambios", `<p>Podemos actualizar esta política por cambios en la ley, en la app o en la tecnología que usamos. La versión vigente está siempre en esta página, con su fecha arriba.</p>`)}
  </article><button class="btn btn-ghost btn-block" data-act="volver">← Volver</button></div>`;
}

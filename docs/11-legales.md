# Legales: /privacidad y /terminos (7/11 · punto 5)

Las dos páginas están en la app (`src/views/legal/privacidad.js` y `src/views/legal/terminos.js`), con la versión
(«Versión 1.0 · noviembre de 2026»).

**12/11 (paso a producción):**
- **/privacidad** es el texto del abogado (el PDF «Política de Privacidad», versión 1.0), **tal cual y sin la marca de
  borrador**. Las únicas diferencias con el PDF son de formato: «TuTiempo» en vez de «TUTIEMPO», los títulos en
  minúscula («Datos que recopilamos» en vez de «DATOS QUE RECOPILAMOS») y el correo de contacto como link.
- La versión ampliada que tenía la app (lo que la app hace y el PDF no dice) quedó abajo, en **«Propuesta v1.1»**, para
  revisarla con el abogado. Hasta que la apruebe, la app no la muestra.
- **/terminos** sigue con la marca **«Borrador pendiente de revisión legal»** hasta que el abogado entregue el texto. Se llega desde:

- el pie de todas las páginas: «Términos y condiciones · Política de privacidad»;
- el registro: el texto debajo de «Continuar con Google» y la casilla «Acepto los términos y condiciones y la política de
  privacidad» de Crear cuenta;
- el alta del negocio: el paso 5, «Al enviar tu negocio aceptás los Términos y condiciones (incluyen las reglas para
  profesionales) y la Política de privacidad».

## De dónde sale cada texto

- **Política de privacidad:** el PDF que mandó TuTiempo (versión 1.0, noviembre de 2026), con su estructura y sus
  frases. Se completó con lo que la app hace de verdad:
  - los datos que guarda (cuenta, turnos, reseñas, seguidos, sellos, negocio, clientes del profesional y datos técnicos);
  - qué ve el profesional del cliente;
  - el DNI y su borrado al verificar (D24, Bloque 6);
  - Cloudflare Turnstile (H30);
  - los emails y cómo apagarlos (D25), y las notificaciones y cómo apagarlas (D27);
  - Mercado Pago;
  - dónde se guardan los datos y cuánto tiempo;
  - cómo pedir ver, corregir o borrar los datos (Ley 25.326, con sus plazos) y la AAIP.
- **Términos y condiciones:** reemplazan el «Resumen para la demo». Cubren:
  - qué es TuTiempo y las cuentas (D33);
  - las reservas y los pagos: la seña fija del 30% (D06), la comisión sobre el precio del turno (D34) y el costo de
    Mercado Pago (D30). El ejemplo usa la misma cuenta que la base;
  - las cancelaciones: del cliente (D07), del profesional turno por turno (D08) y por días bloqueados (D09); la baja del
    profesional;
  - los profesionales (D23, D26), las reseñas, eliminar la cuenta, la responsabilidad y el contacto.

## Contradicciones y cosas a revisar (para el abogado y para Bruno)

| # | Dónde | Qué pasa | Cómo quedó en el borrador |
| --- | --- | --- | --- |
| L1 | PDF, «Datos que recopilamos» | Nombra solo nombre, apellido, email y teléfono. La app guarda más: foto, turnos y pagos, reseñas, seguidos, sellos; del profesional, el DNI (número y fotos), su negocio y los datos de sus clientes (celular, notas, cumpleaños). | Se listan todos. |
| L2 | PDF, «Pagos electrónicos» | Habla de «el pago de su pedido». En la app es la seña de un turno, siempre por Mercado Pago (no es opcional). | «La seña de cada turno se paga con Mercado Pago». |
| L3 | PDF, «Uso de la información» | «La comunicación de datos podrá efectuarse … para facilitar el contacto entre usuarios y prestadores», sin decir qué. | Se aclara qué ve el profesional: nombre, celular, el turno y el historial con él; no el email. |
| L4 | PDF (no lo menciona) | La app usa proveedores que tratan datos: Supabase (base y archivos), Hostinger (sitio), Resend (emails), Cloudflare (CAPTCHA), Google (ingreso), los servicios de push del navegador y Mercado Pago. Algunos están fuera de Argentina. **Transferencia internacional (art. 12, Ley 25.326): revisar con el abogado** si hace falta consentimiento expreso o alcanza con informarla. | Se nombran y se dice «pueden estar fuera de Argentina». |
| L5 | PDF (no lo menciona) | La app guarda la sesión y algunas preferencias en el navegador (almacenamiento local), sin cookies de publicidad. | Se explica en «Datos técnicos». |
| L6 | PDF, «Tus derechos» | Bien. Le faltaban los plazos de respuesta de la ley. | Se agregan: 10 días corridos para el acceso (art. 14) y 5 días hábiles para corregir o borrar (art. 16). **Revisar.** |
| L7 | Contacto | El PDF usa `contacto@tutiempo.com.ar`; los emails de la app salen de `avisos@` y las respuestas van a `soporte@`. | Para derechos y reclamos, `contacto@` (como el PDF). Confirmar que esa casilla se lee. |
| L8 | Eliminar la cuenta | El resumen viejo decía «se borran sus datos personales». En la base: se borra la cuenta (perfil, seguidos, billetera); en los turnos que quedan en la agenda del profesional, el nombre pasa a «Cliente eliminado» y se borra el celular; los turnos futuros se cancelan (sin devolución, como D07). Los registros de pagos quedan. | Se describe tal cual, también lo que queda: las reseñas con su nombre y, en la lista de clientes de cada profesional, el nombre, las notas y el cumpleaños (sin celular ni cuenta). Es el hallazgo S15 de la auditoría de seguridad: si se decide borrarlos, cambia el texto. **Revisar** que los registros de pagos se guarden por obligación contable o fiscal y por cuánto tiempo. |
| L9 | Términos viejos | Decían «la seña (o el total) que eligió el profesional» y un ejemplo con seña del 50%. Desde D06 (4/11) la seña es fija del 30% para todos. | Corregido: 30% y el ejemplo con un corte de $20.000. |
| L10 | D07 (cancelación del cliente) | «Pierde lo pagado», marcada «validar con abogado» en docs/01. **Ley 24.240 (Defensa del Consumidor):** revisar la revocación en contratos a distancia (art. 34) y si una seña que no se devuelve nunca puede considerarse cláusula abusiva (art. 37). | Escrita como está decidida, con la marca de borrador. |
| L11 | D09 (días bloqueados) | Si el profesional bloquea un día, TuTiempo no devuelve la seña y el profesional arregla con el cliente. Es distinto de D08 (un turno cancelado se devuelve automático). Para el cliente, en los dos casos canceló el profesional. **Revisar** si se puede sostener frente al cliente. Desde el 10/11 no vale para los feriados: el cierre por feriado no cancela turnos y, si el profesional cancela uno de ese día, es un turno cancelado (D08, devolución automática; D39). Los términos lo dicen aparte («Feriados»). | Escrita como está decidida. |
| L12 | Reseñas | El borrador no dice que TuTiempo pueda borrar reseñas: no hay una regla ni una función para hacerlo. | Si se quiere, hay que decidirlo (y programar cómo). |
| L13 | Responsabilidad | El párrafo de responsabilidad (TuTiempo no responde por el servicio del profesional) es genérico. | **Revisar** con el abogado el alcance frente a la Ley 24.240 (TuTiempo cobra una comisión: podría considerarse parte de la cadena de comercialización). |
| L14 | Menores de edad | Ni el PDF ni la app dicen nada sobre la edad mínima para tener cuenta o pagar. | Sin texto: **decidir.** |
| L15 | Bloquear clientes (D45) | Un profesional puede bloquear a un cliente: no puede reservarle ni seguirlo y no le llegan sus mensajes, **sin que se le avise** (ve «No hay turnos disponibles con este profesional»). Los turnos que se le cancelan al bloquearlo se devuelven como D08. Los Términos no lo mencionan; la Política de privacidad no dice que el profesional guarda una lista de bloqueados. | Sin texto (decidido que no sea evidente para el bloqueado). **Revisar** con el abogado si hay que mencionarlo en los Términos (derecho de admisión del profesional) o en la Política de privacidad. |

## Lo que no cambia la app

Las páginas solo muestran texto. No cambian ninguna regla: la seña, la comisión, las devoluciones y los plazos de borrado
los sigue haciendo la base. Si una regla cambia en `docs/01-decisiones.md`, hay que cambiar también estos textos.

## Propuesta v1.1 de la Política de privacidad (para el abogado)

Lo que la app hace y el PDF v1.0 no informa. Era el texto de /privacidad hasta el 12/11; las diferencias con el PDF son
L1 a L8 de la tabla de arriba. Lo más importante para revisar:
- **Datos que no están en el PDF:** DNI y fotos del DNI de los profesionales (y su borrado), foto de perfil, turnos,
  pagos, reseñas, seguidos, sellos, y los datos de sus clientes que carga cada profesional (celular, notas, cumpleaños).
- **Proveedores que tratan datos**, algunos fuera de Argentina (transferencia internacional, art. 12): Supabase,
  Hostinger, Resend (emails), Cloudflare Turnstile (CAPTCHA), Google, los servicios de notificaciones del navegador
  (Google, Apple, Mozilla) y Mercado Pago.
- **Emails y notificaciones** y cómo apagarlos; **plazos de guarda**; **qué queda al eliminar la cuenta** (S15).

El texto completo, como estaba en la app:

> En TuTiempo nos comprometemos con la protección y la seguridad de los datos de quienes usan la plataforma, de acuerdo con la Ley N° 25.326 de Protección de Datos Personales y sus normas reglamentarias. Los datos que te pedimos para registrarte y usar TuTiempo se usan solo como dice este documento.
> #### Qué datos guardamos
> - **Tu cuenta:** nombre, apellido, correo electrónico y, si lo cargás, tu celular y tu foto. Si entrás con tu cuenta de Google, recibimos de Google tu nombre, tu correo y tu foto para identificarte.
> - **Tus turnos:** con quién reservaste, qué servicio, el día y la hora, lo que pagaste y el estado del turno (confirmado, cancelado, si fuiste). También las reseñas que dejás (se publican con el nombre que muestra tu cuenta), los profesionales que seguís y tus tarjetas de sellos.
> - **Si tenés un negocio:** los datos del negocio (nombre, dirección, celular, rubros, servicios, precios, horarios, fotos de trabajos), tu número de DNI y las fotos del frente y del dorso para verificar tu identidad (ver «DNI de los profesionales»), los datos de tus clientes que cargás vos (nombre, celular, notas, cumpleaños) y lo que anotás en tu caja.
> - **Datos técnicos:** para que puedas seguir con tu sesión iniciada, la app guarda en tu navegador la sesión y algunas preferencias (por ejemplo, la reserva que estabas haciendo antes de ingresar o el cobro que quedó abierto en Mercado Pago). No usamos cookies de publicidad ni de seguimiento.
> #### Para qué los usamos
> Para crear y administrar tu cuenta, mostrarte los profesionales y sus horarios, gestionar tus turnos y sus pagos, mandarte los avisos de tus turnos y atender consultas y reclamos.
> **Qué ve el profesional:** cuando reservás, el profesional ve tu nombre, tu celular, el turno y tu historial de turnos con él (cuántas veces fuiste, si faltaste). No ve tu correo ni tus turnos con otros profesionales. En las notificaciones que le llegan al celular va solo tu nombre de pila. Si lo seguís, ve tu nombre de pila y la inicial de tu apellido.
> TuTiempo no vende tus datos ni los comunica a terceros para fines ajenos a los de este documento, salvo que la ley lo exija. Siempre tratamos de usar solo lo necesario para cada fin.
> #### DNI de los profesionales
> Para aprobar a un profesional, TuTiempo puede pedirle su número de DNI y fotos del frente y del dorso. Las fotos se guardan en un espacio privado que solo puede ver el equipo de TuTiempo, y **se borran en el momento en que lo verificamos**: queda solo el número, la fecha y quién lo verificó. Si el alta no se aprueba, las fotos se borran a los 90 días de la última que subió; si el profesional da de baja su negocio, se borran en el momento.
> #### Protección contra abusos (CAPTCHA)
> Para evitar cuentas falsas y ataques automáticos, al registrarte, ingresar o recuperar tu contraseña usamos **Cloudflare Turnstile**. Turnstile analiza datos técnicos de tu navegador (por ejemplo, la dirección IP y características del dispositivo) para distinguir a una persona de un programa automático. Esos datos los trata Cloudflare según su propia política de privacidad.
> #### Emails
> Te mandamos por email la confirmación de cada turno y las cancelaciones, siempre. Si tenés un negocio en TuTiempo, te mandamos un email por cada reserva nueva y cada cancelación de un cliente (lo apagás en tu panel, **Perfil → Notificaciones**). El recordatorio del día anterior, el pedido de reseña y las novedades de tus profesionales los podés apagar en **Mi perfil → Avisos por email**. Los emails salen de *avisos@tutiempo.com.ar* a través de un proveedor de envío de correo (Resend); guardamos el registro de cada envío hasta 90 días.
> #### Notificaciones
> Si las activás, te mandamos notificaciones al celular o a la computadora (por ejemplo, la confirmación de un turno, el recordatorio o un mensaje de tu profesional). Para eso guardamos la dirección que nos da tu navegador para ese dispositivo; las notificaciones pasan por el servicio de tu navegador (Google, Apple o Mozilla). En la notificación no va nada privado: el detalle lo ves al abrir la app. Si ya diste el permiso en un dispositivo, al volver a ingresar se activan solas; si las desactivás ahí, quedan apagadas en ese dispositivo hasta que las vuelvas a activar, y al cerrar sesión ese dispositivo deja de recibir las de tu cuenta. Las podés apagar en **Mi perfil → Notificaciones** o desde los permisos de tu navegador; si un dispositivo deja de recibirlas, lo borramos a los 30 días.
> #### Pagos con Mercado Pago
> La seña de cada turno se paga con **Mercado Pago**. El tratamiento de tus datos en ese caso se rige por las políticas de privacidad y los términos de Mercado Pago, que te recomendamos leer. TuTiempo **no accede, no recopila ni guarda** los datos de tu tarjeta ni de otros medios de pago que cargás en Mercado Pago: solo recibimos el número de operación, el monto y su estado para confirmar o devolver tu turno.
> #### Dónde se guardan
> Los datos se guardan en servidores de proveedores de infraestructura (la base de datos y los archivos, en Supabase; el sitio, en Hostinger), con acceso restringido y conexiones cifradas. Algunos de estos proveedores pueden estar fuera de Argentina.
> #### Cuánto tiempo los guardamos
> - Mientras tengas tu cuenta. Si la eliminás (Ajustes → Eliminar la cuenta), se borran tu cuenta, tu perfil, los profesionales que seguís y tus avisos, y los turnos futuros se cancelan. En los turnos que quedan en la agenda de los profesionales tu nombre pasa a «Cliente eliminado» y se borra tu celular. **Quedan**: las reseñas que publicaste, con el nombre que mostraban, y, en la lista de clientes de cada profesional, tu nombre y lo que él anotó (por ejemplo, notas o tu cumpleaños), sin tu celular ni el vínculo con tu cuenta. Si querés que se borren también, escribinos.
> - Las fotos del DNI, como dice «DNI de los profesionales».
> - El registro de emails, 90 días; el de notificaciones, 30 días.
> - Los registros de pagos, el tiempo que exijan las normas contables y fiscales.
> #### Tus derechos
> Podés pedir **ver, corregir, actualizar o borrar** tus datos personales (Ley 25.326). Muchas cosas las podés hacer vos mismo desde Mi perfil y Ajustes. Para todo lo demás, escribinos a contacto@tutiempo.com.ar contando qué necesitás y con los datos que nos permitan verificar que sos el titular (por ejemplo, desde el correo de tu cuenta). Te respondemos en los plazos de la ley: 10 días corridos para el acceso y 5 días hábiles para corregir o borrar.
> La **Agencia de Acceso a la Información Pública (AAIP)**, como autoridad de control de la Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las normas de protección de datos personales.
> #### Cambios
> Podemos actualizar esta política por cambios en la ley, en la app o en la tecnología que usamos. La versión vigente está siempre en esta página, con su fecha arriba.

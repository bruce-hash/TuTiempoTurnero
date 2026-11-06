# Legales: /privacidad y /terminos (7/11 · punto 5)

Las dos páginas están en la app (`src/views/legal/privacidad.js` y `src/views/legal/terminos.js`), con la marca
**«Borrador pendiente de revisión legal»** arriba de todo y la versión («Versión 1.0 · noviembre de 2026»). Se llega desde:

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
| L11 | D09 (días bloqueados) | Si el profesional bloquea un día, TuTiempo no devuelve la seña y el profesional arregla con el cliente. Es distinto de D08 (un turno cancelado se devuelve automático). Para el cliente, en los dos casos canceló el profesional. **Revisar** si se puede sostener frente al cliente. Hoy también vale para «Cierro» de un feriado (D39). | Escrita como está decidida. |
| L12 | Reseñas | El borrador no dice que TuTiempo pueda borrar reseñas: no hay una regla ni una función para hacerlo. | Si se quiere, hay que decidirlo (y programar cómo). |
| L13 | Responsabilidad | El párrafo de responsabilidad (TuTiempo no responde por el servicio del profesional) es genérico. | **Revisar** con el abogado el alcance frente a la Ley 24.240 (TuTiempo cobra una comisión: podría considerarse parte de la cadena de comercialización). |
| L14 | Menores de edad | Ni el PDF ni la app dicen nada sobre la edad mínima para tener cuenta o pagar. | Sin texto: **decidir.** |

## Lo que no cambia la app

Las páginas solo muestran texto. No cambian ninguna regla: la seña, la comisión, las devoluciones y los plazos de borrado
los sigue haciendo la base. Si una regla cambia en `docs/01-decisiones.md`, hay que cambiar también estos textos.

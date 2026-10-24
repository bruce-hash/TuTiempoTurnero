# Decisiones de negocio

Lo marcado **Tomada** se implementa así. Lo marcado **Abierta** no se programa como regla fija hasta que Bruno lo confirme.

| # | Tema | Estado | Regla |
| --- | --- | --- | --- |
| D01 | Plataforma | Tomada | Versión 31 del cliente: Supabase + frontend estático en Hostinger. Reemplaza el sitio Laravel actual. |
| D02 | Comisión | Tomada | % del precio, configurable desde el panel admin (0 a 30). Valor de arranque: **4%** (se carga en el panel, no en código). |
| D03 | Quién paga la comisión | Abierta | Hoy la paga el cliente aparte, junto con la seña (v30). Confirmar con el cliente. |
| D04 | Fidelidad | Tomada | Tarjetas de sellos por servicio y por prestador (v28), las paga el prestador. No hay saldo, cashback ni "segundos". |
| D05 | Sellos necesarios | Abierta | Hoy 15 a 20 por servicio. Evaluar bajar el mínimo (15 visitas para un premio es mucho). |
| D06 | Seña | Tomada | Obligatoria en toda reserva por Mercado Pago (o el total si el prestador lo pide). Resto en efectivo o MP. |
| D07 | Cancelación del cliente | Tomada (validar con abogado) | Pierde lo pagado; la seña queda para el prestador y la comisión para TuTiempo. |
| D08 | Cancelación de un turno suelto por el prestador | Tomada | Devolución total automática (seña + comisión). |
| D09 | Bloqueo de días por el prestador | Tomada (v31) | Los turnos se cancelan; TuTiempo **no** devuelve: el prestador llama y arregla. Revisar con el cliente si es lo que quiere. |
| D10 | Recordatorios | Tomada | Dentro de la app + **por email** (H07). Sin WhatsApp. |
| D11 | Datos del sitio Laravel actual | Abierta | ¿Se migran usuarios y prestadores existentes o se arranca de cero y se los invita? |
| D12 | Dominio | Abierta | Primero en subdominio de prueba. Cuándo y cómo reemplazar tutiempo.com.ar (hoy corre Laravel con usuarios reales). |
| D13 | Textos legales | Abierta | Términos, privacidad (Ley 25.326), política de cancelación: los redacta o revisa un abogado. |
| D14 | Proveedor de email | Abierta | Recomendado: Resend o Brevo (SMTP para Supabase Auth y para recordatorios). |
| D15 | Turnos que se repiten | Tomada | Una serie puede pasar los 31 días del turnero, pero ningún turno de la serie puede quedar a más de 90 días desde hoy: los que se pasen se saltean, como hoy los ocupados. Se implementa en el Bloque 1 (`book_slot`), con su prueba. |
| D16 | Pago con monto distinto | Tomada (Bloque 1) | Si llega **menos** de lo que se debe, no se confirma ningún turno y se devuelve todo lo cobrado. Si llega **más**, se confirman los turnos y la diferencia queda en "Para revisar" (no se devuelve sola). |
| D17 | Devolución hecha desde Mercado Pago (fuera de la app) | Tomada (Bloque 1) | Los turnos futuros de ese pago se cancelan con un estado propio (`cancelled_refunded`, distinto de "canceló el prestador") y sin otra devolución; los que ya pasaron no cambian. Se avisa al cliente y al prestador. Una devolución parcial que no coincide con las de la app queda en "Para revisar". |
| D18 | Contracargo y reclamo | Tomada (Bloque 1) | Contracargo (`charged_back`): el pago queda marcado, los turnos futuros se cancelan (`cancelled_refunded`), se avisa al cliente y al prestador, y queda en "Para revisar". Reclamo abierto (`in_mediation`): solo se marca, se avisa al prestador y queda en "Para revisar". Sin penalizaciones automáticas. |
| D19 | Reintentos de devolución | Tomada (Bloque 1) | Backoff creciente: 10 min, 30 min, 1 h, 3 h, 6 h, 12 h y después cada 24 h, hasta unos 3 días desde el primer intento; recién ahí pasa a fallida. Desde el primer fallo aparece en "Para revisar" como "reintentando", con el último error. |
| D20 | "Para revisar" del admin | Tomada (Bloque 1) | Botones "Reintentar" y "Resuelto a mano". "Resuelto a mano" exige una nota, registra quién y cuándo, y no dispara ninguna devolución. |
| D21 | Tabla `provider_secrets` | Tomada (Bloque 1) | Queda intacta y sin uso desde el Bloque 1 (las llaves pasan a `mp_accounts`). Se borra en el Bloque 2, junto con H13. |
| D22 | Premio de sellos con el prestador sin Mercado Pago | Tomada (Bloque 2) | Si el prestador no tiene cuenta de Mercado Pago activa, sus clientes igual pueden canjear el premio de sellos desde su perfil (el canje no lleva pago). El perfil muestra "Solo podés canjear tu premio" en lugar de "Todavía no toma turnos online". Ver H25. |

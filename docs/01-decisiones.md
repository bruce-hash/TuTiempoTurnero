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

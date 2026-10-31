# Correcciones del cliente · v4 (30/10/2026)

Lista del cliente (`TUTIEMPO_Correcciones_de_la_pagina_v4`), numerada C01…C55 en el mismo orden que el original.
Paso 2: solo organizada, sin programar. Cada bloque se programa recién con el OK de Bruno.

**Estado:**
- **Hecho (Paso 1):** lo resuelve el PR del Paso 1 (pagos que no se registraban).
- **WIP:** está en la rama frenada `feature/ajustes-finales`, sin probar; se retoma en su bloque.
- **Pendiente:** se puede programar tal cual.
- **Decisión:** hace falta una decisión de negocio antes de programar.
- **Contradice Dnn:** choca con una decisión tomada en `docs/01-decisiones.md`.
- **Verificar:** ya debería funcionar, o no se entiende qué falla: hace falta un ejemplo.

## Lista

| C | Sección | Pedido | Bloque | Estado | Dudas / notas |
| --- | --- | --- | --- | --- | --- |
| C01 | General | Pasar del subdominio a un dominio propio | Producción | Decisión (D11, D12) | No es código: es el paso de Etapa B. Hoy en tutiempo.com.ar corre el Laravel con usuarios reales. ¿Cuándo? ¿Se migran los usuarios (D11)? |
| C02 | General | Al actualizar el navegador, quedarse en la misma pantalla | V8 | Verificar | Anda desde el Bloque B (cada pantalla tiene su dirección; lo prueba `test:rutas`). Si en prueba vuelve al inicio, lo más probable es que falte el `.htaccess` en Hostinger. ¿En qué pantalla les pasó? |
| C03 | General | El logo lleva al inicio general | V8 | Propuesta | Hoy lleva al inicio. Choca con C13: si el prestador no ve el inicio, ¿adónde lo lleva el logo a él: a su Agenda? **Propuesta (31/10):** al prestador el logo lo lleva a su Agenda; al cliente, al inicio. |
| C04 | General | Poner el logo original en todas las páginas | V8 | Pendiente | Necesito el archivo del logo original (SVG o PNG grande). |
| C05 | General | Revisar las notificaciones de pago | Paso 1 | Hecho (Paso 1) | Eran los pagos sin registrar (C55). Push y email del turno salen cuando el pago queda registrado. |
| C06 | General | Avisarle al prestador cuando alguien lo sigue | V8 | Decisión | ¿Por qué canal: aviso en la app, push, email? ¿Con el nombre de pila del cliente, como "Nueva reserva" (D27)? ¿Uno por seguidor o un resumen diario? |
| C07 | Pagos | Sumar la comisión de Mercado Pago (7,61%) en el detalle del pago | V1 | Decidido (D30) → V1 | **Decidido (31/10):** ver "D30 · Comisión de TuTiempo y de Mercado Pago", más abajo; falta tu OK a la propuesta. |
| C08 | Pagos | El resumen muestra la comisión de MP sobre la seña (30%, 50% o total) | V1 | Decidido (D30) → V1 | La comisión de MP se calcula sobre todo lo que paga el cliente (seña + comisión de TuTiempo), no solo sobre la seña. **Decidido (31/10):** ver "D30 · Comisión de TuTiempo y de Mercado Pago", más abajo; falta tu OK a la propuesta. |
| C09 | Pagos | El banner dice el porcentaje que se suma (7,61%) | V1 | Decidido (D30) → V1 | Igual que C07. El cargo real equivale a un 8,24% sobre seña + comisión (ver el ejemplo); el banner debería decir "7,61% del total". **Decidido (31/10):** ver "D30 · Comisión de TuTiempo y de Mercado Pago", más abajo; falta tu OK a la propuesta. |
| C10 | Pagos | Volver a la misma página después de pagar | Paso 1 | Hecho (Paso 1) | La vuelta va a la pantalla del turno (`/turno/<id>`), también sin sesión. |
| C11 | Pagos | Revisar el dinero a liquidar de Mercado Pago | V1 | Verificar | ¿En qué pantalla? ¿Es "cuándo se acredita cada seña" en Finanzas del prestador? Mercado Pago informa la fecha de liberación de cada pago (`money_release_date`); el saldo de la cuenta no lo vemos. |
| C12 | Pagos | Liquidar la seña al prestador apenas se paga (liquidación instantánea) | V1 | Decisión | El plazo de acreditación se elige en la cuenta de Mercado Pago de cada prestador, no desde la app. La app puede explicarle cómo elegir "al instante" al conectar. Es lo que justifica el 7,61%. |
| C13 | Prestador | Sin pantalla principal para el prestador: entra directo a su panel | V2 | Propuesta | ¿Una misma persona puede ser cliente y prestador con la misma cuenta? Si sí, ¿cómo pasa a "modo cliente"? **Propuesta (31/10):** una misma cuenta puede ser cliente y prestador; el prestador entra a su panel y desde el menú de cuenta pasa al lado cliente ("Reservar como cliente"). |
| C14 | Prestador | Sacar la solapa "Mis turnos" al prestador | V2 | Propuesta | Igual que C13: si el prestador también reserva como cliente, pierde dónde ver sus turnos. **Propuesta (31/10):** igual que C13: "Mis turnos" sale del menú del panel y queda en el lado cliente. |
| C15 | Prestador | "Mi perfil" pasa a "Ajustes": nombre y celular, notificaciones, profesionales que seguís, seguridad, ir al panel, cerrar sesión y eliminar la cuenta | V2 | Pendiente | Entra el control de notificaciones push y emails de hoy (D25, D27). |
| C16 | Prestador | Mover la ubicación del perfil a la sección del prestador | V2 | Verificar | ¿"Ubicación" es la dirección del local, o dónde está el acceso al perfil en el menú? |
| C17 | Prestador | Orden del menú: Agenda, Horarios, Finanzas, Productos, Estadísticas, Clientes, Trabajos y Perfil, con scroll; Caja pasa a Finanzas | V2 | Pendiente | ¿Qué significa que "Ver mi perfil" se desplace hacia la izquierda? ¿Que el botón quede al principio del menú? |
| C18 | Prestador | Después de agendar un turno o cargar un servicio sin turno, volver a la Agenda | V2 | Pendiente | |
| C19 | Prestador | El ingreso del prestador igual al del usuario | V7 | Pendiente | Mismo formulario (código por email, contraseña y Google), con C46 a C48. |
| C20 | Prestador | Después de crear la cuenta (también con Google), completar los pasos de verificación | V2 | Pendiente | Ya existe desde el Bloque D (pasos de Perfil y D26); falta el alta con Google. ¿El alta con Google pide igual nombre del local, rubro y teléfono antes de entrar? |
| C21 | Agenda | Sacar "Cargar servicio sin turno" de la Agenda | V3 | Pendiente | Queda en Finanzas → Caja del día (C34). |
| C22 | Agenda | Los turnos eliminados desaparecen de la Agenda, todo en tiempo real | V3 | Decisión | Hay dos caminos: Realtime de Supabase (cada cambio llega solo; hay que habilitarlo por tabla, con RLS) o volver a pedir la agenda cada 30 s y al volver a la pestaña (más simple). Recomiendo el segundo. Además hay que ver por qué el turno borrado sigue: ¿lo borró el mismo prestador? |
| C23 | Agenda | Los horarios se calculan según la duración del servicio, no en bloques fijos | V3 | Propuesta (D31) | Hoy los turnos empiezan cada 10/15/20/30/45/60 min (paso del prestador) y solo se ofrecen los que entran enteros. Opciones: (a) empezar cada "duración del servicio" desde la apertura (corte de 45 min: 9:00, 9:45, 10:30…); (b) empezar a la hora que termina el turno anterior, pegados (sin huecos). ¿Cuál? ¿Qué pasa con dos servicios de duración distinta el mismo día? **Propuesta con ejemplos:** sección "C23 · Turnos según la duración del servicio", más abajo. |
| C24 | Recordatorios | Quitar "¿Venís? Confirmá acá" del recordatorio automático | V3 | Pendiente | Se cambia el texto de fábrica del recordatorio de 24 h. Los prestadores que ya lo editaron conservan el suyo; a los que tienen el de fábrica se les actualiza. |
| C25 | Finanzas | Botones de editar y borrar en cada movimiento; "Cargar diferencia" con transferencia y/o efectivo | V4 | Pendiente | Hoy los medios son Efectivo y Mercado Pago: se suma "Transferencia". |
| C26 | Trabajos | Borrar fotos de trabajos y ponerles nombre | V5 | Pendiente | |
| C27 | Reseñas | El cliente deja la reseña y el prestador la responde desde Trabajos | V5 | Verificar | Las reseñas y las respuestas ya existen; falta que la respuesta esté en Trabajos. ¿Algo de esto no les funcionó? |
| C28 | Reseñas | Sacar del panel el pedido de reseña al cliente | V5 | Propuesta | El aviso "dejanos tu reseña" sale solo, en la app, por email (D25) y por push (D27). ¿Hay que sacar solo el botón manual del prestador, o también el aviso automático? **Propuesta (31/10):** sacar solo el botón manual de pedir reseña; el aviso automático queda como está (D25). |
| C29 | Sellos | Eliminar la tarjeta de sellos | V5 | Contradice D04, D05, D22 | Propuesta (Bruno): ocultarla con una opción del admin, como D26, sin borrar nada. ¿Qué pasa con los clientes que tienen sellos o un premio sin canjear: lo pueden canjear igual? |
| C30 | Finanzas | Aviso de lo que falta para cerrar el día | V4 | Pendiente | ¿Qué cuenta como pendiente? Propongo: turnos de hoy sin marcar (vino / no vino) y cobros sin medio de pago. |
| C31 | Finanzas | Gastos del mes, fijos y variables, "Pagado" o "Debo", con "Cargar fijos" y "Cargar variables" preseteados y editables | V4 | Decisión | ¿Cuáles vienen preseteados? (alquiler, luz, gas, internet, monotributo…). ¿Los fijos se repiten solos cada mes? |
| C32 | Finanzas | Balance en verde o rojo; meses en mayúscula | V4 | Pendiente | |
| C33 | Finanzas | Dashboard mensual (balance, gastos e ingresos), además del anual | V4 | Pendiente | |
| C34 | Finanzas | Caja pasa a Finanzas como "Caja del día"; la sección Caja se elimina | V4 | Pendiente | Junto con C17 y C21. |
| C35 | Productos | Eliminar un producto, con aviso antes de borrar | V4 | Pendiente | Hoy no se puede borrar. Las ventas ya cargadas no se tocan. |
| C36 | Productos | Precio de compra y de venta; al vender, se carga solo en servicios y productos | V4 | Pendiente | ¿"Servicios y productos" es la Caja del día? La ganancia por producto (venta menos compra) iría al balance. |
| C37 | Horarios | Guardado automático en toda la sección (sin botón Guardar) | V3 | Pendiente | Con un aviso chico de "Guardado". |
| C38 | Horarios | Mostrar el "Happy hour" en los horarios del propio prestador | V3 | Pendiente | |
| C39 | Horarios | Reglas de reserva: quitar el descanso entre turnos | V3 | Decisión | ¿Se saca la opción y todos pasan a "Sin descanso", o se deja para los que ya lo usan? (Hoy cada prestador elige de 0 a 60 min.) |
| C40 | Horarios | QR del prestador descargable en PDF | V3 | Pendiente | Propongo una hoja lista para imprimir ("Guardar como PDF" del navegador), sin librerías nuevas. |
| C41 | Admin | Resaltar en negrita a quien no está conectado a Mercado Pago, con un enlace | V6 | WIP + propuesta | La rama frenada ya lo muestra con nombres en negrita y "Ver quiénes". "Conectarlos" lo puede hacer solo el prestador (es su cuenta): propongo un botón "Avisarle", que le manda un aviso (app, push, email) con el link a Cobros. **Propuesta (31/10):** botón "Avisarle", que le manda al prestador el link para conectar Mercado Pago. |
| C42 | Admin | "No conectados de MP" en Prestadores, con un botón para vincularlos | V6 | WIP + propuesta | El filtro "Sin Mercado Pago" ya está en la rama frenada. El botón: igual que C41 ("Avisarle"). **Propuesta (31/10):** el mismo botón "Avisarle". |
| C43 | Admin | Corregir el flujo que se corta: el admin no toma los registros de turnos | V6 | Verificar | Probablemente sean los pagos sin registrar del 30/10 (turnos `expired`, que no cuentan). Después del Paso 1, ¿sigue pasando? ¿Con qué turno? |
| C44 | Admin | Renombrar "Clientes" como "Turnos" | V6 | Verificar | El indicador "Clientes" del Resumen cuenta personas registradas, no turnos. ¿Es otra pantalla? Si es esa, propongo que queden los dos: "Clientes" y "Turnos". |
| C45 | Admin | Editar el porcentaje de la comisión de la API (Mercado Pago) y que se refleje en el detalle y el precio | V1 | Decidido (D30) → V1 | Con C07: una opción en Comisión, como la de TuTiempo (D02). **Decidido (31/10):** ver "D30 · Comisión de TuTiempo y de Mercado Pago", más abajo; falta tu OK a la propuesta. |
| C46 | Ingreso | Botón "Ingresar con Google" | V7 | Verificar | Ya está para el cliente ("Continuar con Google") y para el prestador ("Entrar con Google"). Si no se ve o no anda, falta configurar Google en Supabase para el entorno de prueba (LEEME, PASO 2). ¿Se refieren al alta del prestador con Google (C20)? |
| C47 | Ingreso | Dejar solo "Ingreso" en el header | V7 | Pendiente | Un solo botón; adentro se elige cliente o prestador. |
| C48 | Ingreso | El ingreso en una segunda capa (modal), para usuario y prestador | V7 | Pendiente | Las direcciones `/ingresar` y `/crear-cuenta` siguen (links de emails); se abren como modal sobre la página. |
| C49 | Footer | "Iniciar sesión" abre el modal | V7 | Pendiente | Con C48. |
| C50 | Footer | Mostrar el celular de contacto: 2284722825 | V7 | Pendiente | Hoy dice "2284 201181". |
| C51 | Footer | Sacar la palabra "prototipo" del footer | V7 | WIP | Hecho en la rama frenada, junto con los links de Instagram, Facebook, YouTube y TikTok. |
| C52 | Errores | Los precios no se actualizan si el usuario no cambia de página | V8 | Pendiente (importante) | El monto que cobra Mercado Pago siempre lo calcula la base: el cliente no paga un precio viejo, pero **puede ver uno y pagar otro**. Arreglo: volver a pedir los precios al abrir la confirmación y, si cambió, mostrarlo antes de pagar. |
| C53 | Errores | Se cierra la sesión después de pagar y en "Mis turnos" no aparece el turno | Paso 1 | Hecho (Paso 1) | Era la app instalada: Mercado Pago vuelve al navegador, que no tiene la sesión. Ahora esa vuelta muestra el estado sin sesión y ofrece ingresar. El turno no aparecía porque el pago no se registraba (C55). |
| C54 | Errores | Revisar a dónde lleva cada paso de la reserva y el pago | V8 | Pendiente | La vuelta de Mercado Pago ya está (Paso 1). Falta repasar el resto (ingreso a mitad de reserva, pago fallido, reintento) con una prueba que recorra todos. |
| C55 | Errores | El flujo se corta después del pago | Paso 1 | Hecho (Paso 1) | El pago se registra aunque el aviso de Mercado Pago no llegue; queda pendiente encontrar por qué no llegó (docs/02, "Si los pagos no se registran"). |

## Bloques propuestos (chicos, uno por PR)

| Bloque | Qué | Puntos | Necesita antes |
| --- | --- | --- | --- |
| Paso 1 | Pagos que no se registraban | C05, C10, C53, C55 | (en el PR) |
| V1 | Comisión de Mercado Pago y acreditación | C07, C08, C09, C11, C12, C45 | D30 (cómo se calcula y si es configurable), C11 |
| V2 | Panel del prestador y roles | C13, C14, C15, C16, C17, C18, C20 | C13/C14 (cuenta cliente y prestador), C16, C17 |
| V3 | Agenda, recordatorios y horarios | C21, C22, C23, C24, C37, C38, C39, C40 | D31 (C23), C22, C39 |
| V4 | Finanzas y productos | C25, C30, C31, C32, C33, C34, C35, C36 | C30, C31, C36 |
| V5 | Trabajos, reseñas y sellos | C26, C27, C28, C29 | C28 (D25), C29 (D04) |
| V6 | Admin | C41, C42, C43, C44 | "Avisarle" (C41/C42), C43, C44 |
| V7 | Ingreso, modales y footer | C19, C46, C47, C48, C49, C50, C51 | nada (se puede empezar) |
| V8 | General | C02, C03, C04, C06, C52, C54 | C03, C04 (logo), C06 |
| Producción | Dominio propio | C01 | D11, D12 |

Orden sugerido: **V7** (no espera decisiones y retoma lo frenado del footer) → **V8**, con C52 primero porque es de
plata → **V1**, apenas esté D30 → **V3** → **V4** → **V2** → **V5** → **V6**.

## Contradicen una decisión tomada o necesitan una nueva

- **C01 · dominio propio**: D11 (migrar o no los usuarios del Laravel) y D12 (cuándo reemplazar tutiempo.com.ar), las dos abiertas.
- **C07–C09, C12, C45 · comisión de Mercado Pago al cliente**: **D30 tomada (31/10)**, cambia D02 (la comisión de TuTiempo
  pasa a % de la seña). Falta tu OK a la propuesta de V1 y decidir las devoluciones si Mercado Pago no reintegra su comisión.
- **C23 · turnos según la duración del servicio**: hace falta definir la regla (D31).
- **C28 · sacar el pedido de reseña**: choca con D25, donde la reseña es uno de los avisos automáticos por email, en la app y por push (D27).
- **C29 · eliminar la tarjeta de sellos**: choca con D04 (fidelidad con sellos), D05 y D22. Propuesta: ocultarla con una
  opción del admin, sin borrar datos; definir qué pasa con los sellos y premios pendientes.
- **C03 contra C13**: si el prestador no tiene pantalla principal, el logo no puede llevarlo "al inicio general".
- **C13 y C14 · roles**: no hay decisión sobre si una misma cuenta puede ser cliente y prestador.
- **C39 · descanso entre turnos**: no está en docs/01, pero cambia turnos que ya están configurados.
- **C06 · aviso de seguidor nuevo**: un aviso nuevo para el prestador. Entra en D27 (contenido mínimo), pero hay que elegir los canales.
- **D29 · tomada (31/10)**: un pago que llega cuando la hora del turno ya pasó se devuelve (`booking_past`).

## C23 · Turnos según la duración del servicio (propuesta de regla, D31)

**Regla propuesta.** Los horarios de un servicio empiezan en la apertura y se suceden cada "duración del servicio" (más
el descanso, si el prestador lo usa). Cuando un turno ya tomado corta la secuencia, la secuencia vuelve a arrancar donde
termina ese turno. Se calcula para el servicio que el cliente elige, contra todos los turnos del día, de cualquier
servicio. Así no quedan huecos más chicos que el servicio entre un turno y otro, y el "paso" de hoy (cada 10, 15, 20, 30,
45 o 60 min) deja de usarse para la reserva online.

**Ejemplo:** el prestador atiende de 9:00 a 13:00 y ya hay un turno tomado de 10:30 a 11:00.

| Servicio | Hoy (paso de 30 min) | Con la regla propuesta |
| --- | --- | --- |
| 45 min | 9:00, 9:30, 11:00, 11:30, 12:00 | 9:00, 9:45 · 11:00, 11:45 |
| 30 min | 9:00, 9:30, 10:00, 11:00, 11:30, 12:00, 12:30 | 9:00, 9:30, 10:00 · 11:00, 11:30, 12:00, 12:30 |

- **El servicio de 45 min, hoy:**
  - Si alguien toma 9:30, quedan libres 9:00–9:30 y 10:15–10:30: dos huecos (de 30 y de 15 min) que no se pueden vender juntos.
  - 9:45 no se ofrece, aunque es justo el horario que termina cuando empieza el turno tomado (10:30).
- **El servicio de 45 min, con la regla:** 9:00 y 9:45 llenan la mañana hasta el turno tomado sin dejar huecos. Después
  del turno, la secuencia vuelve a arrancar a las 11:00 (11:00 y 11:45). 12:30 no entra, porque terminaría a las 13:15.
- **Si mezclan servicios:** con un 45 min a las 9:00, el de 30 min ofrece 9:45 (y la secuencia sigue) y otra vez desde
  las 11:00. El hueco de 10:15 a 10:30 (15 min) queda igual: ningún servicio entra ahí. Se puede ofrecer también el
  horario que *termina* justo cuando empieza el turno tomado (10:00 para el de 30 min), pero entonces el hueco de 15 min
  queda antes (9:45–10:00). Propongo no ofrecerlo, para que la lista no tenga horarios que se pisan.

**Lo que no cambia.**
- **Turnos de la agenda:** los que carga el prestador a mano y los bloqueos van donde él quiere.
- **Turnos que se repiten (D15):** usan la misma regla en cada fecha.
- **Happy hour:** sigue por franja horaria.

**Para decidir:**
- ¿La regla vale para todos los prestadores o es una opción ("Horarios según la duración del servicio") y el resto
  sigue con el paso de hoy?
- ¿El descanso entre turnos (C39) se saca del todo?

## D30 · Comisión de TuTiempo y de Mercado Pago (bloque V1): propuesta

**Modelo decidido (31/10).**
- **Comisión de TuTiempo:** un % de la **seña**, editable desde el admin (previsto 7%).
- **Seña:** la elige el prestador: 30, 40, 50% o el total.
- **Comisión de Mercado Pago:** depende del plazo que el prestador elige en su cuenta. Referencias con IVA: al instante
  7,61%, 10 días 5,31%, 18 días 4,10% y 35 días 1,80%. Varían por provincia y Mercado Pago los cambia.
- **Total que paga el cliente:** `total = (seña + comisión TuTiempo) / (1 − % MP)`, redondeado para arriba, en pesos
  enteros. Así el prestador recibe la seña completa y TuTiempo su comisión completa.
- **Redondeo de la comisión de TuTiempo:** propongo redondearla al peso más cercano, como hoy.

**Ejemplos (servicio de $10.000, comisión de TuTiempo 7% de la seña).** "MP se queda" es el % de MP sobre el total;
"el prestador recibe" es total − MP − TuTiempo. El último es el que pusiste vos: $5.791.

| Seña | Plazo (% MP con IVA) | Seña | TuTiempo (7%) | Se suma por MP | **Paga el cliente** | MP se queda | El prestador recibe |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 30% | Al instante (7,61%) | $3.000 | $210 | $265 | **$3.475** | $264,45 | $3.000,55 |
| 30% | 10 días (5,31%) | $3.000 | $210 | $181 | **$3.391** | $180,06 | $3.000,94 |
| 30% | 18 días (4,10%) | $3.000 | $210 | $138 | **$3.348** | $137,27 | $3.000,73 |
| 30% | 35 días (1,80%) | $3.000 | $210 | $59 | **$3.269** | $58,84 | $3.000,16 |
| 40% | Al instante (7,61%) | $4.000 | $280 | $353 | **$4.633** | $352,57 | $4.000,43 |
| 40% | 10 días (5,31%) | $4.000 | $280 | $241 | **$4.521** | $240,07 | $4.000,93 |
| 40% | 18 días (4,10%) | $4.000 | $280 | $183 | **$4.463** | $182,98 | $4.000,02 |
| 40% | 35 días (1,80%) | $4.000 | $280 | $79 | **$4.359** | $78,46 | $4.000,54 |
| 50% | Al instante (7,61%) | $5.000 | $350 | $441 | **$5.791** | $440,70 | $5.000,30 |
| 50% | 10 días (5,31%) | $5.000 | $350 | $301 | **$5.651** | $300,07 | $5.000,93 |
| 50% | 18 días (4,10%) | $5.000 | $350 | $229 | **$5.579** | $228,74 | $5.000,26 |
| 50% | 35 días (1,80%) | $5.000 | $350 | $99 | **$5.449** | $98,08 | $5.000,92 |

Con Mercado Pago en 0% (el valor por defecto hasta la aprobación legal), el cliente paga seña + TuTiempo, como hoy pero
con la comisión sobre la seña. Ejemplo: seña 50% = $5.000 + $350 = $5.350.

**Qué propongo programar en V1**
1. **Admin → Comisión:**
   - "Comisión de TuTiempo (% de la seña)", de 0 a 30, con 7 como valor previsto. Reemplaza la de hoy (% del precio).
   - Una tabla "Comisión de Mercado Pago por plazo" con los cuatro plazos, editables de 0 a 15, todos en 0 hasta la
     aprobación legal y con la referencia al lado.
   - Cada cambio vale para las reservas nuevas, nunca para las ya hechas.
2. **Perfil del prestador → Cobros:**
   - Elige la seña (30, 40, 50% o el total; hoy ya la elige) y el plazo de acreditación (al instante, 10, 18 o 35 días).
   - Aviso: "Tiene que ser el mismo plazo que elegiste en tu cuenta de Mercado Pago (Tu negocio → Costos y plazos). Si no
     coincide, vas a recibir un poco más o un poco menos que la seña."
   - Por defecto "al instante": es el más caro para el cliente, pero nunca deja al prestador cobrando menos que la seña.
3. **La base calcula todo en `book_slot`:**
   - seña, comisión de TuTiempo, % y monto de MP, y el total;
   - lo guarda en cada turno (`client_fee`, más `mp_fee` y `mp_fee_pct`, nuevos);
   - `mp-create-preference` cobra ese total, con `marketplace_fee` = la comisión de TuTiempo;
   - `confirm_payment` verifica el total como hoy (D16).
4. **Después de cada pago:** la base compara la comisión de MP que informa Mercado Pago (`fee_details`, tipo
   `mercadopago_fee`) con la esperada (% del plazo sobre el total), con un margen de $2. Si no coincide:
   - el turno igual se confirma;
   - el pago queda en "Para revisar" con el motivo "La comisión de Mercado Pago no es la del plazo elegido";
   - el prestador recibe un aviso: "Mercado Pago te cobró X% en vez de Y%: revisá que el plazo de tu perfil sea el de tu cuenta".
5. **Resumen del pago y banner (C07, C08, C09):** tres líneas, "Seña", "Comisión TuTiempo" y "Costo de Mercado Pago
   (acreditación en N días)", y el total. El banner dice "Se suma la comisión de TuTiempo y el costo de Mercado Pago por
   la acreditación". El % que se muestra es el del plazo del prestador (7,61% del total al instante, etc.).
6. **Migración:**
   - Los turnos ya reservados mantienen lo que pagaron (`client_fee` como está, `mp_fee` = 0).
   - Los prestadores arrancan con plazo "al instante".
   - La comisión del admin pasa a % de la seña con el valor que cargues.

**Devoluciones (punto 5): propuesta**

| Caso | Al cliente se le devuelve | Comisión de TuTiempo | Comisión de Mercado Pago |
| --- | --- | --- | --- |
| Cancela el prestador (D08) | **Todo lo que pagó** (seña + TuTiempo + MP) | Se devuelve: en un cobro de marketplace, Mercado Pago se la descuenta a TuTiempo en proporción | Si Mercado Pago la reintegra en la devolución total, nadie pierde. Si no la reintegra, la pierde el prestador (canceló él) |
| La app no pudo confirmar: horario tomado, pago tardío o turno que ya pasó (`slot_taken`, `booking_past`, D29) | Todo lo que pagó | Se devuelve | Igual que arriba, salvo que decidas otra cosa: no es culpa del prestador |
| Cancela el cliente o no viene (D07) | Nada | Queda para TuTiempo | Queda pagada |
| Bloqueo de días (D09) | Lo arregla el prestador, como hoy | Igual que hoy | Igual que hoy |

- **Lo que hay que confirmar con una devolución real en prueba:** si Mercado Pago le devuelve al prestador su comisión
  cuando se devuelve el total. Se ve comparando el pago antes y después en Mercado Pago (`fee_details`, `refunds`) y el
  saldo del prestador.
- **Hasta saberlo, la app no cambia nada:** devuelve el total que pagó el cliente, como hoy.
- **Si Mercado Pago no la reintegra, hay que decidir el caso de la segunda fila:** que la pierda el prestador, o que
  TuTiempo se la compense (habría que llevar la cuenta aparte, porque la devolución sale de la cuenta del prestador).

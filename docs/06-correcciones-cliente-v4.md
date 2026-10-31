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
| C03 | General | El logo lleva al inicio general | V8 | Decisión | Hoy lleva al inicio. Choca con C13: si el prestador no ve el inicio, ¿adónde lo lleva el logo a él: a su Agenda? |
| C04 | General | Poner el logo original en todas las páginas | V8 | Pendiente | Necesito el archivo del logo original (SVG o PNG grande). |
| C05 | General | Revisar las notificaciones de pago | Paso 1 | Hecho (Paso 1) | Eran los pagos sin registrar (C55). Push y email del turno salen cuando el pago queda registrado. |
| C06 | General | Avisarle al prestador cuando alguien lo sigue | V8 | Decisión | ¿Por qué canal: aviso en la app, push, email? ¿Con el nombre de pila del cliente, como "Nueva reserva" (D27)? ¿Uno por seguidor o un resumen diario? |
| C07 | Pagos | Sumar la comisión de Mercado Pago (7,61%) en el detalle del pago | V1 | Decisión (D03, nueva D30) | Ver "La comisión de Mercado Pago (7,61%)" más abajo. |
| C08 | Pagos | El resumen muestra la comisión de MP sobre la seña (30%, 50% o total) | V1 | Decisión | Igual que C07: la comisión de MP se calcula sobre todo lo que paga el cliente (seña + comisión de TuTiempo), no solo sobre la seña. |
| C09 | Pagos | El banner dice el porcentaje que se suma (7,61%) | V1 | Decisión | Igual que C07. El cargo real equivale a un 8,24% sobre seña + comisión (ver el ejemplo); el banner debería decir "7,61% del total". |
| C10 | Pagos | Volver a la misma página después de pagar | Paso 1 | Hecho (Paso 1) | La vuelta va a la pantalla del turno (`/turno/<id>`), también sin sesión. |
| C11 | Pagos | Revisar el dinero a liquidar de Mercado Pago | V1 | Verificar | ¿En qué pantalla? ¿Es "cuándo se acredita cada seña" en Finanzas del prestador? Mercado Pago informa la fecha de liberación de cada pago (`money_release_date`); el saldo de la cuenta no lo vemos. |
| C12 | Pagos | Liquidar la seña al prestador apenas se paga (liquidación instantánea) | V1 | Decisión | El plazo de acreditación se elige en la cuenta de Mercado Pago de cada prestador, no desde la app. La app puede explicarle cómo elegir "al instante" al conectar. Es lo que justifica el 7,61%. |
| C13 | Prestador | Sin pantalla principal para el prestador: entra directo a su panel | V2 | Decisión | ¿Una misma persona puede ser cliente y prestador con la misma cuenta? Si sí, ¿cómo pasa a "modo cliente"? |
| C14 | Prestador | Sacar la solapa "Mis turnos" al prestador | V2 | Decisión | Igual que C13: si el prestador también reserva como cliente, pierde dónde ver sus turnos. |
| C15 | Prestador | "Mi perfil" pasa a "Ajustes": nombre y celular, notificaciones, profesionales que seguís, seguridad, ir al panel, cerrar sesión y eliminar la cuenta | V2 | Pendiente | Entra el control de notificaciones push y emails de hoy (D25, D27). |
| C16 | Prestador | Mover la ubicación del perfil a la sección del prestador | V2 | Verificar | ¿"Ubicación" es la dirección del local, o dónde está el acceso al perfil en el menú? |
| C17 | Prestador | Orden del menú: Agenda, Horarios, Finanzas, Productos, Estadísticas, Clientes, Trabajos y Perfil, con scroll; Caja pasa a Finanzas | V2 | Pendiente | ¿Qué significa que "Ver mi perfil" se desplace hacia la izquierda? ¿Que el botón quede al principio del menú? |
| C18 | Prestador | Después de agendar un turno o cargar un servicio sin turno, volver a la Agenda | V2 | Pendiente | |
| C19 | Prestador | El ingreso del prestador igual al del usuario | V7 | Pendiente | Mismo formulario (código por email, contraseña y Google), con C46 a C48. |
| C20 | Prestador | Después de crear la cuenta (también con Google), completar los pasos de verificación | V2 | Pendiente | Ya existe desde el Bloque D (pasos de Perfil y D26); falta el alta con Google. ¿El alta con Google pide igual nombre del local, rubro y teléfono antes de entrar? |
| C21 | Agenda | Sacar "Cargar servicio sin turno" de la Agenda | V3 | Pendiente | Queda en Finanzas → Caja del día (C34). |
| C22 | Agenda | Los turnos eliminados desaparecen de la Agenda, todo en tiempo real | V3 | Decisión | Hay dos caminos: Realtime de Supabase (cada cambio llega solo; hay que habilitarlo por tabla, con RLS) o volver a pedir la agenda cada 30 s y al volver a la pestaña (más simple). Recomiendo el segundo. Además hay que ver por qué el turno borrado sigue: ¿lo borró el mismo prestador? |
| C23 | Agenda | Los horarios se calculan según la duración del servicio, no en bloques fijos | V3 | Decisión (nueva D31) | Hoy los turnos empiezan cada 10/15/20/30/45/60 min (paso del prestador) y solo se ofrecen los que entran enteros. Opciones: (a) empezar cada "duración del servicio" desde la apertura (corte de 45 min: 9:00, 9:45, 10:30…); (b) empezar a la hora que termina el turno anterior, pegados (sin huecos). ¿Cuál? ¿Qué pasa con dos servicios de duración distinta el mismo día? |
| C24 | Recordatorios | Quitar "¿Venís? Confirmá acá" del recordatorio automático | V3 | Pendiente | Se cambia el texto de fábrica del recordatorio de 24 h. Los prestadores que ya lo editaron conservan el suyo; a los que tienen el de fábrica se les actualiza. |
| C25 | Finanzas | Botones de editar y borrar en cada movimiento; "Cargar diferencia" con transferencia y/o efectivo | V4 | Pendiente | Hoy los medios son Efectivo y Mercado Pago: se suma "Transferencia". |
| C26 | Trabajos | Borrar fotos de trabajos y ponerles nombre | V5 | Pendiente | |
| C27 | Reseñas | El cliente deja la reseña y el prestador la responde desde Trabajos | V5 | Verificar | Las reseñas y las respuestas ya existen; falta que la respuesta esté en Trabajos. ¿Algo de esto no les funcionó? |
| C28 | Reseñas | Sacar del panel el pedido de reseña al cliente | V5 | Contradice D25 | El aviso "dejanos tu reseña" sale solo, en la app, por email (D25) y por push (D27). ¿Hay que sacar solo el botón manual del prestador, o también el aviso automático? |
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
| C41 | Admin | Resaltar en negrita a quien no está conectado a Mercado Pago, con un enlace | V6 | WIP | La rama frenada ya lo muestra con nombres en negrita y "Ver quiénes". "Conectarlos" lo puede hacer solo el prestador (es su cuenta): propongo un botón "Avisarle", que le manda un aviso (app, push, email) con el link a Cobros. |
| C42 | Admin | "No conectados de MP" en Prestadores, con un botón para vincularlos | V6 | WIP | El filtro "Sin Mercado Pago" ya está en la rama frenada. El botón: igual que C41 ("Avisarle"). |
| C43 | Admin | Corregir el flujo que se corta: el admin no toma los registros de turnos | V6 | Verificar | Probablemente sean los pagos sin registrar del 30/10 (turnos `expired`, que no cuentan). Después del Paso 1, ¿sigue pasando? ¿Con qué turno? |
| C44 | Admin | Renombrar "Clientes" como "Turnos" | V6 | Verificar | El indicador "Clientes" del Resumen cuenta personas registradas, no turnos. ¿Es otra pantalla? Si es esa, propongo que queden los dos: "Clientes" y "Turnos". |
| C45 | Admin | Editar el porcentaje de la comisión de la API (Mercado Pago) y que se refleje en el detalle y el precio | V1 | Decisión | Con C07: una opción en Comisión, como la de TuTiempo (D02). |
| C46 | Ingreso | Botón "Ingresar con Google" | V7 | Verificar | Ya está para el cliente ("Continuar con Google") y para el prestador ("Entrar con Google"). Si no se ve o no anda, falta configurar Google en Supabase para el entorno de prueba (LEEME, PASO 2). ¿Se refieren al alta del prestador con Google (C20)? |
| C47 | Ingreso | Dejar solo "Ingreso" en el header | V7 | Pendiente | Un solo botón; adentro se elige cliente o prestador. |
| C48 | Ingreso | El ingreso en una segunda capa (modal), para usuario y prestador | V7 | Pendiente | Las direcciones `/ingresar` y `/crear-cuenta` siguen (links de emails); se abren como modal sobre la página. |
| C49 | Footer | "Iniciar sesión" abre el modal | V7 | Pendiente | Con C48. |
| C50 | Footer | Mostrar el celular de contacto: 2284722825 | V7 | Pendiente | Hoy dice "2284 201181". |
| C51 | Footer | Sacar la palabra "prototipo" del footer | V7 | WIP | Hecho en la rama frenada, junto con los links de Instagram, Facebook, YouTube y TikTok. |
| C52 | Errores | Los precios no se actualizan si el usuario no cambia de página | V8 | Hecho (V8) | El monto que cobra Mercado Pago siempre lo calcula la base: el cliente no paga un precio viejo, pero **puede ver uno y pagar otro**. Arreglo: volver a pedir los precios al abrir la confirmación y, si cambió, mostrarlo antes de pagar. **V8:** antes de cobrar, la confirmación vuelve a pedir los precios; si el total cambió, lo muestra (con el de antes) y pide confirmar de nuevo. El perfil y la confirmación se actualizan solos al volver a la pestaña y cada minuto. |
| C53 | Errores | Se cierra la sesión después de pagar y en "Mis turnos" no aparece el turno | Paso 1 | Hecho (Paso 1) | Era la app instalada: Mercado Pago vuelve al navegador, que no tiene la sesión. Ahora esa vuelta muestra el estado sin sesión y ofrece ingresar. El turno no aparecía porque el pago no se registraba (C55). |
| C54 | Errores | Revisar a dónde lleva cada paso de la reserva y el pago | V8 | Hecho en parte (V8) | La vuelta de Mercado Pago ya está (Paso 1). Falta repasar el resto (ingreso a mitad de reserva, pago fallido, reintento) con una prueba que recorra todos. **V8:** si Mercado Pago vuelve sin el pago (`mp=failure`), la pantalla del turno dice "El pago no se completó" con "Volver a intentar" (antes decía "Estamos confirmando tu pago"). El ingreso a mitad de reserva ya volvía al pago. |
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
- **C07–C09, C12, C45 · comisión de Mercado Pago al cliente**: no hay decisión. Necesita una nueva (D30): cómo se calcula,
  si es configurable y qué pasa en las devoluciones. Toca D03 (hoy el cliente paga aparte la comisión de TuTiempo).
- **C23 · turnos según la duración del servicio**: hace falta definir la regla (D31).
- **C28 · sacar el pedido de reseña**: choca con D25, donde la reseña es uno de los avisos automáticos por email, en la app y por push (D27).
- **C29 · eliminar la tarjeta de sellos**: choca con D04 (fidelidad con sellos), D05 y D22. Propuesta: ocultarla con una
  opción del admin, sin borrar datos; definir qué pasa con los sellos y premios pendientes.
- **C03 contra C13**: si el prestador no tiene pantalla principal, el logo no puede llevarlo "al inicio general".
- **C13 y C14 · roles**: no hay decisión sobre si una misma cuenta puede ser cliente y prestador.
- **C39 · descanso entre turnos**: no está en docs/01, pero cambia turnos que ya están configurados.
- **C06 · aviso de seguidor nuevo**: un aviso nuevo para el prestador. Entra en D27 (contenido mínimo), pero hay que elegir los canales.
- **D29 (nueva, del Paso 1)**: un pago que llega tarde para un turno cuya hora ya pasó hoy se confirmaría igual. Propuesta: devolverlo.

## La comisión de Mercado Pago (7,61%)

**De dónde sale.** El 7,61% es lo que cobra Mercado Pago por acreditar el dinero en el momento: 6,29% + IVA
(6,29 × 1,21 = 7,61). Lo cobra sobre **todo** lo que paga el cliente. En un cobro de marketplace eso incluye la comisión
de TuTiempo (`marketplace_fee`), y lo descuenta de la parte del prestador. La comisión de TuTiempo llega completa.

**Fórmula.** Para que el prestador reciba la seña completa:

`total = (seña + comisión de TuTiempo) / (1 − 0,0761)`, redondeado para arriba a pesos enteros.

El cargo de Mercado Pago que ve el cliente es `total − seña − comisión de TuTiempo`. Equivale a un 8,24% sobre seña +
comisión (0,0761 / 0,9239), aunque Mercado Pago cobre el 7,61% del total.

**Ejemplo 1: corte de $10.000, seña del 50% y comisión de TuTiempo del 4% (D02)**

| Concepto | Monto |
| --- | --- |
| Seña (para el prestador) | $5.000 |
| Comisión de TuTiempo (4% del precio) | $400 |
| Subtotal | $5.400 |
| Total que paga el cliente: 5.400 / 0,9239 = 5.844,79, redondeado para arriba | **$5.845** |
| Cargo de Mercado Pago que se muestra (5.845 − 5.400) | $445 |
| Mercado Pago se queda con el 7,61% de $5.845 | $444,80 |
| TuTiempo recibe | $400 |
| El prestador recibe (5.845 − 444,80 − 400) | **$5.000,20** (la seña completa) |

**Ejemplo 2: el mismo corte con el total como seña**

Seña $10.000 + comisión $400 = $10.400. El total es 10.400 / 0,9239 = **$11.257**, con un cargo de MP de $857. Mercado
Pago se queda con $856,66 y el prestador recibe $10.000,34.

**¿Configurable desde el admin? Sí.** Propongo una opción "Costo de Mercado Pago (%)" en Comisión, como la de TuTiempo:
- Valor inicial 7,61, de 0 a 15.
- Con 0 no se suma nada, como hoy.
- La calcula la base en `book_slot`, junto a la seña y la comisión (el navegador solo muestra).
- El webhook verifica el monto total como hoy.

**Límites y dudas**
- **El porcentaje depende de cada prestador.** Es el del plazo que elija en su cuenta: al instante 7,61%, a 10 o 30
  días menos.
  - Con un único porcentaje para todos, un prestador con plazo largo recibe un poco más que la seña.
  - La alternativa es que cada prestador elija su plazo en la app. Es más preciso, pero depende de que lo configure igual en Mercado Pago.
- **Devoluciones.** Si el prestador cancela (D08), hoy se devuelve todo lo cobrado, cargo de MP incluido. Hay que
  confirmar con un pago real si Mercado Pago le devuelve al prestador su comisión cuando se hace una devolución total.
  Si no, cada devolución le costaría el 7,61% al prestador.
- **Faltas del cliente (D07).** El cargo de MP no se devuelve: queda pagado, como la comisión de TuTiempo.
- **Mostrar.** En el detalle del pago, una línea "Costo de Mercado Pago (acreditación inmediata)". En el banner, "Se
  suma el 7,61% del total por la acreditación inmediata de Mercado Pago".

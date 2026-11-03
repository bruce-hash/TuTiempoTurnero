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
| C02 | General | Al actualizar el navegador, quedarse en la misma pantalla | V8 | Hecho (C02) | Anda desde el Bloque B (cada pantalla tiene su dirección; lo prueba `test:rutas`). Si en prueba vuelve al inicio, lo más probable es que falte el `.htaccess` en Hostinger. ¿En qué pantalla les pasó? **C02 (2/11):** no pude entrar a prueba desde el entorno de trabajo (la red lo bloquea). Reproducido: en vivo, con y sin service worker y con el build de producción, recargar mantiene la pantalla (la sesión se restaura antes de que el enrutador decida); con OpenLiteSpeed (el servidor de Hostinger, versión libre) el `.htaccess` devuelve la app en todas las direcciones. Lo único que lleva al inicio es un servidor que no devuelve la app en `/panel/…` (falta el `.htaccess`, otro que se mete o una redirección). Arreglo: la app guarda su dirección en la pestaña y, si una recarga cae en el inicio, vuelve a la pantalla (también con el service worker); el panel de TuTiempo avisa «El sitio no devuelve la app en sus direcciones»; docs/02 (sección 3, paso 6) dice cómo revisarlo con un `curl`. Pruebas: `test:rutas` (hosting roto simulado) y `test:litespeed` (OpenLiteSpeed real, también en el CI). **Parpadeo (visto en prueba, 2/11):** al recargar se veía un instante el inicio del cliente: el arranque dibujaba la pantalla antes de restaurar la sesión y leer la dirección. Ahora, hasta resolver las dos, solo se ve una barra de carga (también en el `index.html`, antes de que llegue el JS) y nunca el inicio; mientras carga un perfil la dirección se queda en `/<slug>` (antes pasaba un momento por `/p/<id>`). Prueba: `test:rutas` recarga `/panel/agenda`, `/mis-turnos`, `/turno/<id>` y un perfil con la red lenta simulada y anota cada pantalla que se dibuja desde el primer byte. |
| C03 | General | El logo lleva al inicio general | V8 | Propuesta | Hoy lleva al inicio. Choca con C13: si el prestador no ve el inicio, ¿adónde lo lleva el logo a él: a su Agenda? **Propuesta (31/10):** al prestador el logo lo lleva a su Agenda; al cliente, al inicio. |
| C04 | General | Poner el logo original en todas las páginas | V8 | Frenado (2/11) | Necesito el archivo del logo original (SVG o PNG grande). **Respuesta del cliente (2/11):** manual de marca (claim «TU TIEMPO. SU SOLUCIÓN. AL INSTANTE.», logotipo en Nunito ExtraBold, bajada en Montserrat Bold), fuentes autoalojadas con @fontsource, respetar las paletas por rubro, y antes de programar una propuesta con capturas (cabecera, PWA e íconos, emails, hoja del QR, tipografías). **Frenado:** llegó el PDF del manual, pero no los archivos del logo ni de la paleta, que iban aparte. Con esos archivos armo la propuesta. |
| C05 | General | Revisar las notificaciones de pago | Paso 1 | Hecho (Paso 1) | Eran los pagos sin registrar (C55). Push y email del turno salen cuando el pago queda registrado. |
| C06 | General | Avisarle al prestador cuando alguien lo sigue | V8 | Hecho (V8) | ¿Por qué canal: aviso en la app, push, email? ¿Con el nombre de pila del cliente, como "Nueva reserva" (D27)? ¿Uno por seguidor o un resumen diario? **Hecho (V8):** cuando alguien empieza a seguir a un prestador, le llega un aviso en el panel («🔔 Seguidores nuevos» / «Avisos») y un push «Nuevo seguidor · Ana empezó a seguirte.» que abre Trabajos. Solo el nombre de pila; una vez por persona (dejar de seguir y volver no lo repite). Interruptor propio, **«Nuevos seguidores»** (propuesta: aparte de «Nuevas reservas y cancelaciones», así apagar los seguidores no silencia las reservas); apaga el push, el aviso en el panel queda. Sin email. |
| C07 | Pagos | Sumar la comisión de Mercado Pago (7,61%) en el detalle del pago | V1 | Hecho (V1) | El detalle del pago muestra "Costo de Mercado Pago (acreditación al instante / en N días, X% del total)" con su monto, aparte de la seña y de la comisión de TuTiempo (D30). |
| C08 | Pagos | El resumen muestra la comisión de MP sobre la seña (30%, 50% o total) | V1 | Hecho (V1) | La comisión de Mercado Pago se calcula sobre todo lo que paga el cliente: `total = (seña + comisión) / (1 − % MP)`. Con seña del 30, 40, 50% o el total. |
| C09 | Pagos | El banner dice el porcentaje que se suma (7,61%) | V1 | Hecho (V1) | El resumen dice el % del plazo "del total" y el aviso, "Se suma la comisión de TuTiempo y el costo de Mercado Pago por la acreditación". Con Mercado Pago en 0% no se muestra. |
| C10 | Pagos | Volver a la misma página después de pagar | Paso 1 | Hecho (Paso 1) | La vuelta va a la pantalla del turno (`/turno/<id>`), también sin sesión. |
| C11 | Pagos | Revisar el dinero a liquidar de Mercado Pago | V1 | Cerrado (2/11) | ¿En qué pantalla? ¿Es "cuándo se acredita cada seña" en Finanzas del prestador? Mercado Pago informa la fecha de liberación de cada pago (`money_release_date`); el saldo de la cuenta no lo vemos. **Cerrado (2/11):** el cliente decidió que no va en la app: el prestador lo ve en Mercado Pago. |
| C12 | Pagos | Liquidar la seña al prestador apenas se paga (liquidación instantánea) | V1 | Hecho en parte (V1) | El prestador elige su plazo (al instante, 10, 18 o 35 días) en Horarios, junto a la seña, con el aviso de que tiene que ser el mismo que en su cuenta de Mercado Pago. Liquidar "al instante" lo decide cada prestador en Mercado Pago; la app no puede elegirlo por él. |
| C13 | Prestador | Sin pantalla principal para el prestador: entra directo a su panel | Ingreso | Hecho (D32, D33) | El prestador entra siempre a su Agenda (al ingresar, al tocar el logo y al abrir la app instalada). **D33:** una cuenta es de cliente o de negocio: la de negocio no reserva ni sigue (si lo intenta, aviso y "Cerrar sesión e ingresar con otra cuenta"). |
| C14 | Prestador | Sacar la solapa "Mis turnos" al prestador | Ingreso | Hecho (D33) | La cuenta de negocio no tiene "Mis turnos" ni "Reservar como cliente" (sus turnos como cliente van en su cuenta personal). |
| C15 | Prestador | "Mi perfil" pasa a "Ajustes": nombre y celular, notificaciones, profesionales que seguís, seguridad, ir al panel, cerrar sesión y eliminar la cuenta | V2 | Pendiente | Entra el control de notificaciones push y emails de hoy (D25, D27). |
| C16 | Prestador | Mover la ubicación del perfil a la sección del prestador | V2 | Verificar | ¿"Ubicación" es la dirección del local, o dónde está el acceso al perfil en el menú? |
| C17 | Prestador | Orden del menú: Agenda, Horarios, Finanzas, Productos, Estadísticas, Clientes, Trabajos y Perfil, con scroll; Caja pasa a Finanzas | V2 | Pendiente | ¿Qué significa que "Ver mi perfil" se desplace hacia la izquierda? ¿Que el botón quede al principio del menú? |
| C18 | Prestador | Después de agendar un turno o cargar un servicio sin turno, volver a la Agenda | V2 | Pendiente | |
| C19 | Prestador | El ingreso del prestador igual al del usuario | Ingreso | Hecho (D32) | Un solo ingreso para todos (sin "Soy cliente / Soy prestador"): email y contraseña, Google o código por email. La app lleva a cada uno a su lugar. El acceso aparte de prestadores salió; `/prestadores/ingresar` abre el mismo ingreso. |
| C20 | Prestador | Después de crear la cuenta (también con Google), completar los pasos de verificación | Ingreso | Hecho (D32) | "Registrá tu negocio": la cuenta (con email o Google) y después 5 pasos que se guardan uno por uno (Tu negocio, Servicios, Horarios, Seña y cobro, Verificación). La Agenda muestra lo que falta hasta que el perfil está aprobado y con Mercado Pago. **2/11:** Crear cuenta tiene la casilla «Tengo un negocio y quiero recibir reservas» (arriba de Google); marcada, al terminar la cuenta con email o con Google sigue a los 5 pasos (D32). |
| C21 | Agenda | Sacar "Cargar servicio sin turno" de la Agenda | V3 | Hecho (V3) | "Cargar servicio sin turno" salió de la Agenda; queda en Finanzas → Caja del día. |
| C22 | Agenda | Los turnos eliminados desaparecen de la Agenda, todo en tiempo real | V3 | Hecho (V3b) | Sin Realtime: la Agenda vuelve a pedir los turnos cada 30 s y al volver a la pestaña, y se dibuja de nuevo solo si cambió algo. No toca la pantalla mientras se guarda algo, con el formulario de turno manual o de bloqueo abierto, o con alguien escribiendo. Un turno que borra el mismo prestador ya desaparecía al instante; los que cancela el cliente o cambian desde otro dispositivo ahora aparecen o se van solos. |
| C23 | Agenda | Los horarios se calculan según la duración del servicio, no en bloques fijos | V3 | Hecho (V3, D31) | Para todos los prestadores: los horarios se suceden cada "duración del servicio" desde la apertura y, si un turno corta la secuencia, siguen desde que termina. La misma cuenta en la base (`slot_starts`) y en la app. "Cada cuánto empieza un turno" salió de Horarios. |
| C24 | Recordatorios | Quitar "¿Venís? Confirmá acá" del recordatorio automático | V3 | Hecho (V3) | El de fábrica ahora dice "{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. Te esperamos en {direccion}." Los que lo editaron conservan el suyo. |
| C25 | Finanzas | Botones de editar y borrar en cada movimiento; "Cargar diferencia" con transferencia y/o efectivo | V4 | Hecho (V4 y V4b) | Cada movimiento de la Caja del día se edita (qué, monto, hora, medio, cliente) y se borra con confirmación (una venta borrada devuelve la unidad al stock). En los turnos atendidos se edita el medio con que se cobró el resto (la seña entra por Mercado Pago; un turno atendido no se saca de la caja). "Transferencia" es un medio más, en lo cargado sin turno y en el resto de los turnos. **Falta definir** "Cargar diferencia" (¿cobrar el resto de un turno en dos medios?): no se programó. V4b: «Cargar diferencia»: el resto (precio menos la seña) se cobra en uno o dos medios, al marcar «Asistió» (en la Agenda) o después desde la Caja del día; la suma no puede pasar del resto (lo controla la base, `set_rest_parts`) y cada parte cuenta en su medio. Si suman menos, lo que falta queda «sin cobrar»: se ve en la caja pero no entra en el total ni en Finanzas (a confirmar con Bruno). |
| C26 | Trabajos | Borrar fotos de trabajos y ponerles nombre | V5 | Hecho (V5) | En Comunidad → Mis trabajos, ✎ en cada foto abre su editor: el nombre (hasta 80 letras; se ve sobre la foto en el perfil y en las historias) y «Borrar este trabajo» con confirmación (antes era un doble toque en ✕). Los trabajos nuevos se suben sin el nombre del archivo. En la base, `update (label)` solo de los trabajos propios. |
| C27 | Reseñas | El cliente deja la reseña y el prestador la responde desde Trabajos | V5 | Verificar | Las reseñas y las respuestas ya existen; falta que la respuesta esté en Trabajos. ¿Algo de esto no les funcionó? |
| C28 | Reseñas | Sacar del panel el pedido de reseña al cliente | V5 | Hecho (V5) | El aviso "dejanos tu reseña" sale solo, en la app, por email (D25) y por push (D27). ¿Hay que sacar solo el botón manual del prestador, o también el aviso automático? **Propuesta (31/10):** sacar solo el botón manual de pedir reseña; el aviso automático queda como está (D25). **Hecho (V5):** no había un botón manual aparte: lo que había en el panel era la fila «Pedido de reseña» de los avisos automáticos (un interruptor y su texto). Salió del panel y el aviso queda siempre encendido (la base no deja apagarlo; a los que lo tenían apagado se les volvió a encender). El cliente sigue pudiendo no recibirlo por email desde Mi perfil. |
| C29 | Sellos | Eliminar la tarjeta de sellos | V5 | Hecho (V5 resto) | Propuesta (Bruno): ocultarla con una opción del admin, como D26, sin borrar nada. ¿Qué pasa con los clientes que tienen sellos o un premio sin canjear: lo pueden canjear igual? **Hecho (V5 resto):** panel de TuTiempo → Comisión → «Tarjetas de sellos» (`app_settings.stamps_on`, `admin_set_stamps`). Apagadas: no se ven en ningún lado (perfil, Mis turnos, «Usar mi premio», la configuración del prestador) y la base no suma sellos ni deja canjear (`stamps_off`); el turno se marca igual. Los datos quedan y al encenderlas vuelven como estaban. **Premios ganados mientras está apagado:** se conservan y se pueden canjear al reactivar, como propuso el cliente. Si se cancela un turno pagado con el premio, los sellos vuelven igual. |
| C30 | Finanzas | Aviso de lo que falta para cerrar el día | V4 | Hecho (V4 resto) | ¿Qué cuenta como pendiente? Propongo: turnos de hoy sin marcar (vino / no vino) y cobros sin medio de pago. **Hecho (V4 resto):** la Caja del día muestra «Antes de cerrar · N pendientes»: los turnos de hoy que ya empezaron sin marcar (✓ Vino / No vino) y los cobros del resto sin medio de pago (un medio o «En dos medios»). Se puede cerrar igual (el botón dice «Cerrar igual» y explica que, si algo cambia después, la caja avisa). |
| C31 | Finanzas | Gastos del mes, fijos y variables, "Pagado" o "Debo", con "Cargar fijos" y "Cargar variables" preseteados y editables | V4 | Hecho (V4 resto) | ¿Cuáles vienen preseteados? (alquiler, luz, gas, internet, monotributo…). ¿Los fijos se repiten solos cada mes? **Hecho (V4 resto):** Finanzas → Mes tiene «Gastos fijos», con alquiler, luz, gas, internet y monotributo precargados y sin monto. Con ✎ se carga o se cambia el monto: vale desde ese mes en adelante y los meses cerrados quedan como estaban. Se repiten solos cada mes (la base los carga al abrir el panel: `fixed_expenses_sync`). También «+ Otro gasto fijo» y «Dejar de repetirlo desde este mes». Lo que no se repite va en «Otros gastos del mes»; salió el botón «Copiar los gastos del mes anterior». |
| C32 | Finanzas | Balance en verde o rojo; meses en mayúscula | V4 | Hecho (V4) | El balance va en verde si da positivo y en rojo si da negativo (mes, año y la tabla mes por mes); los meses van con mayúscula en todo Finanzas. |
| C33 | Finanzas | Dashboard mensual (balance, gastos e ingresos), además del anual | V4 | Hecho (V4) | "Resumen de <mes>" en Finanzas → Mes: ingresos por origen (turnos por TuTiempo, agendados, sin turno, productos) y gastos (fijos y compras de productos), con barras y el balance. Para meses anteriores lo trae la base (`provider_month_breakdown`). |
| C34 | Finanzas | Caja pasa a Finanzas como "Caja del día"; la sección Caja se elimina | V4 | Hecho (V4) | La pestaña Caja salió: cargar un servicio sin turno o una venta se hace en Finanzas → Caja del día, junto a los movimientos y el cierre. `/panel/caja` lleva ahí. |
| C35 | Productos | Eliminar un producto, con aviso antes de borrar | V4 | Hecho (V4) | 🗑 en cada producto, con confirmación. Las ventas y compras ya cargadas quedan en Finanzas (sin producto). |
| C36 | Productos | Precio de compra y de venta; al vender, se carga solo en servicios y productos | V4 | Hecho (V4 resto) | ¿"Servicios y productos" es la Caja del día? La ganancia por producto (venta menos compra) iría al balance. **Hecho (V4 resto):** cada producto tiene precio de venta y de compra (opcional); la lista muestra cuánto ganás por unidad y «Compré más» calcula el total con el precio de compra. «💵 Vendí uno», desde Productos, pide el medio y la venta entra sola en la Caja del día (y descuenta el stock). |
| C37 | Horarios | Guardado automático en toda la sección (sin botón Guardar) | V3 | Hecho (V3b) | Cada cambio se guarda solo (espera 0,7 s por si sigue tocando) y arriba dice "Guardando…" / "✓ Guardado". Si algo no cierra, lo marca en rojo al lado del campo y no guarda hasta corregirlo. Si toca otra pestaña con un cambio esperando, se guarda antes. |
| C38 | Horarios | Mostrar el "Happy hour" en los horarios del propio prestador | V3 | Hecho (V3b) | En Horarios, los días con happy hour llevan "⚡ Happy hour 15:00–17:00 · −15%"; en la Agenda de ese día, una franja verde en esas horas y el dato arriba. |
| C39 | Horarios | Reglas de reserva: quitar el descanso entre turnos | V3 | Hecho (V3, D31) | Se sacó del todo: todos los prestadores pasan a "sin descanso" y los turnos que vienen lo pierden (los pasados no cambian). |
| C40 | Horarios | QR del prestador descargable en PDF | V3 | Hecho (V3b) | En Trabajos ("Sumá seguidores"), "Imprimir o guardar el QR en PDF": una hoja A4 con el logo, el nombre, "Reservá tu turno online", el QR grande y el link. Desde la impresión del navegador se imprime o se elige "Guardar como PDF". Sin librerías nuevas. |
| C41 | Admin | Resaltar en negrita a quien no está conectado a Mercado Pago, con un enlace | V6 | Hecho (V6) | La rama frenada ya lo muestra con nombres en negrita y "Ver quiénes". "Conectarlos" lo puede hacer solo el prestador (es su cuenta): propongo un botón "Avisarle", que le manda un aviso (app, push, email) con el link a Cobros. **Propuesta (31/10):** botón "Avisarle", que le manda al prestador el link para conectar Mercado Pago. **Hecho (V6):** el resumen del admin nombra en negrita a los activos sin Mercado Pago (hasta 3 y «y N más») con «Ver quiénes», que abre Prestadores con el filtro «Sin Mercado Pago». En la lista, «sin Mercado Pago» en negrita y el botón «Avisarle»: le deja al prestador un aviso en la app (Avisos de cobros) y un push «Conectá Mercado Pago» que abre su Perfil; uno por día (`admin_nudge_mp`). El email no está incluido: los emails de hoy salen solo de los avisos al cliente; sumar avisos por email al prestador es un cambio aparte en `email_outbox` y `email-send`. |
| C42 | Admin | "No conectados de MP" en Prestadores, con un botón para vincularlos | V6 | Hecho (V6) | El filtro "Sin Mercado Pago" ya está en la rama frenada. El botón: igual que C41 ("Avisarle"). **Propuesta (31/10):** el mismo botón "Avisarle". **Hecho (V6):** el filtro «Sin Mercado Pago» en Prestadores y el mismo botón «Avisarle». |
| C43 | Admin | Corregir el flujo que se corta: el admin no toma los registros de turnos | V6 | Verificar | Probablemente sean los pagos sin registrar del 30/10 (turnos `expired`, que no cuentan). Después del Paso 1, ¿sigue pasando? ¿Con qué turno? |
| C44 | Admin | Renombrar "Clientes" como "Turnos" | V6 | Hecho (V6 resto) | El indicador "Clientes" del Resumen cuenta personas registradas, no turnos. ¿Es otra pantalla? Si es esa, propongo que queden los dos: "Clientes" y "Turnos". **Hecho (V6 resto, 2/11):** revisé todas las estadísticas del panel de TuTiempo: ninguna cuenta turnos con el nombre «Clientes». La única «Clientes» es la del Resumen y contaba todas las cuentas registradas (también las de negocio y las admin). Ahora cuenta solo las cuentas de cliente (`admin_client_counts`, D33) y dice «cuentas de cliente»; los turnos siguen en su indicador, «Turnos del mes». Quedan los dos. |
| C45 | Admin | Editar el porcentaje de la comisión de la API (Mercado Pago) y que se refleje en el detalle y el precio | V1 | Hecho (V1) | Admin → Comisión: "Comisión de TuTiempo (% de la seña)" y la tabla "Comisión de Mercado Pago por plazo" (0 a 15, en 0 hasta la aprobación legal), con un ejemplo que se actualiza al guardar. Vale para las reservas nuevas. |
| C46 | Ingreso | Botón "Ingresar con Google" | V7 | Verificar | Ya está para el cliente ("Continuar con Google") y para el prestador ("Entrar con Google"). Si no se ve o no anda, falta configurar Google en Supabase para el entorno de prueba (LEEME, PASO 2). ¿Se refieren al alta del prestador con Google (C20)? |
| C47 | Ingreso | Dejar solo "Ingreso" en el header | V7 | Hecho | Un solo botón "Ingresar"; adentro, pestañas "Soy cliente" y "Soy prestador". "Soy prestador" salió de la cabecera. |
| C48 | Ingreso | El ingreso en una segunda capa (modal), para usuario y prestador | V7 | Hecho | Abre encima de la página que se mira (la dirección no cambia); se cierra con la cruz, tocando afuera o con Escape, y al ingresar queda la misma página. Ingresar, Crear cuenta, código por email y Olvidé mi contraseña funcionan adentro. Las direcciones `/ingresar`, `/crear-cuenta` y el acceso de prestadores siguen como páginas (links de los emails y páginas que piden sesión, como Mis turnos). |
| C49 | Footer | "Iniciar sesión" abre el modal | V7 | Hecho | "Iniciar sesión" abre la capa del lado cliente y "Acceso prestadores", del lado prestador. Con la sesión abierta, "Iniciar sesión" lleva a Mi perfil. |
| C50 | Footer | Mostrar el celular de contacto: 2284722825 | V7 | Hecho | "2284 722825", con link para llamar desde el celular. |
| C51 | Footer | Sacar la palabra "prototipo" del footer | V7 | Hecho | Sin "Prototipo", con los links reales de Instagram, Facebook, YouTube y TikTok (pestaña nueva). |
| C52 | Errores | Los precios no se actualizan si el usuario no cambia de página | V8 | Hecho (V8) | El monto que cobra Mercado Pago siempre lo calcula la base: el cliente no paga un precio viejo, pero **puede ver uno y pagar otro**. Arreglo: volver a pedir los precios al abrir la confirmación y, si cambió, mostrarlo antes de pagar. **V8:** antes de cobrar, la confirmación vuelve a pedir los precios; si el total cambió, lo muestra (con el de antes) y pide confirmar de nuevo. El perfil y la confirmación se actualizan solos al volver a la pestaña y cada minuto. |
| C53 | Errores | Se cierra la sesión después de pagar y en "Mis turnos" no aparece el turno | Paso 1 | Hecho (Paso 1) | Era la app instalada: Mercado Pago vuelve al navegador, que no tiene la sesión. Ahora esa vuelta muestra el estado sin sesión y ofrece ingresar. El turno no aparecía porque el pago no se registraba (C55). |
| C54 | Errores | Revisar a dónde lleva cada paso de la reserva y el pago | V8 | Hecho en parte (V8) | La vuelta de Mercado Pago ya está (Paso 1). Falta repasar el resto (ingreso a mitad de reserva, pago fallido, reintento) con una prueba que recorra todos. **V8:** si Mercado Pago vuelve sin el pago (`mp=failure`), la pantalla del turno dice "El pago no se completó" con "Volver a intentar" (antes decía "Estamos confirmando tu pago"). El ingreso a mitad de reserva ya volvía al pago. |
| C55 | Errores | El flujo se corta después del pago | Paso 1 | Hecho (Paso 1) | El pago se registra aunque el aviso de Mercado Pago no llegue; queda pendiente encontrar por qué no llegó (docs/02, "Si los pagos no se registran"). |

## Bloques propuestos (chicos, uno por PR)

| Bloque | Qué | Puntos | Necesita antes |
| --- | --- | --- | --- |
| Paso 1 | Pagos que no se registraban | C05, C10, C53, C55 | (en el PR) |
| V1 | Comisión de Mercado Pago y acreditación | C07, C08, C09, C11, C12, C45 | D30 (cómo se calcula y si es configurable), C11 |
| V2 | Panel del prestador y roles | C13, C14, C15, C16, C17, C18, C20 | C13, C14 y C20 hechos con el ingreso (D32); faltan C16, C17 |
| V3 | Agenda, recordatorios y horarios | C21, C22, C23, C24, C37, C38, C39, C40 | Hecho: V3 (C21, C23, C24, C39) y V3b (C22, C37, C38, C40) |
| V4 | Finanzas y productos | C25, C30, C31, C32, C33, C34, C35, C36 | Hecho: C25 (con «Cargar diferencia», V4b), C30, C31, C32–C35 y C36 |
| V5 | Trabajos, reseñas y sellos | C26, C27, C28, C29 | Hechos C26, C28 (V5) y C29 (V5 resto) |
| V6 | Admin | C41, C42, C43, C44 | Hechos C41, C42 (V6) y C44 (V6 resto); C43 |
| V7 | Ingreso, modales y footer | C19, C46, C47, C48, C49, C50, C51 | nada (se puede empezar) |
| V8 | General | C02, C03, C04, C06, C52, C54 | C03, C04 (logo), C06 |
| Producción | Dominio propio | C01 | D11, D12 |

Orden sugerido: **V7** (no espera decisiones y retoma lo frenado del footer) → **V8**, con C52 primero porque es de
plata → **V1**, apenas esté D30 → **V3** → **V4** → **V2** → **V5** → **V6**.

## Contradicen una decisión tomada o necesitan una nueva

- **C01 · dominio propio**: D11 (migrar o no los usuarios del Laravel) y D12 (cuándo reemplazar tutiempo.com.ar), las dos abiertas.
- **C07–C09, C12, C45 · comisión de Mercado Pago al cliente**: **D30 tomada (31/10) y programada en V1**, reemplaza D02 (la
  comisión de TuTiempo es un % de la seña). Queda por decidir las devoluciones si Mercado Pago no reintegra su comisión.
- **C23 · turnos según la duración del servicio**: D31 tomada (1/11) y programada en V3.
- **C28 · sacar el pedido de reseña**: choca con D25, donde la reseña es uno de los avisos automáticos por email, en la app y por push (D27).
- **C29 · eliminar la tarjeta de sellos**: choca con D04 (fidelidad con sellos), D05 y D22. Propuesta: ocultarla con una
  opción del admin, sin borrar datos; definir qué pasa con los sellos y premios pendientes.
- **C03 contra C13**: si el prestador no tiene pantalla principal, el logo no puede llevarlo "al inicio general".
- **C13 y C14 · roles**: decidido con D33 (2/11): una cuenta es de cliente o de negocio, nunca las dos (reemplaza lo de D32).
- **C39 · descanso entre turnos**: decidido con D31 (se saca del todo), programado en V3.
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

**Decidido (1/11, D31):** la regla vale para todos los prestadores (no es una opción) y el descanso entre turnos (C39)
se saca del todo. Programado en V3.

## D30 · Comisión de TuTiempo y de Mercado Pago (bloque V1): propuesta

**Aprobada (1/11) y programada en V1** tal como está abajo, con dos notas: (1) el `mercadopago_fee` de `fee_details` puede
venir con o sin IVA: si en los pagos reales todos dan diferencia, se ajusta la comparación, no los montos, y el aviso muestra
los dos números; (2) devoluciones: no se cambia nada hasta confirmar con una devolución real si Mercado Pago reintegra su
comisión. Lo que cambia respecto de la propuesta: el plazo se elige en **Horarios**, junto a la seña (ahí estaba la seña), no en
Perfil → Cobros.

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

## Revisión v2 del cliente (3/11)

Reemplaza la lista "por rol" del 2/11. Un PR por bloque.

| Bloque | Punto | Estado | Qué se hizo |
| --- | --- | --- | --- |
| 1 · D34 | Comisión de TuTiempo sobre el precio del turno | Hecho (D34) | Ver D34 en docs/01 y la tabla de ejemplos de D30/D34 en esta página. |
| 2 · General | "prestador" → "profesional" y "usuario" → "cliente" | Hecho | Solo textos visibles de la app (código, tablas y rutas sin cambios). Los emails y push no decían "prestador". El crawl revisa en cada pantalla que no aparezcan las palabras viejas. |
| 2 · General | Footer: contacto como link y sin @tutiempo.arg | Hecho | `mailto:contacto@tutiempo.com.ar`. |
| 3 · Admin | Borrar avisos una vez leídos | Hecho | Los avisos del Resumen (profesionales sin Mercado Pago, pendientes, suspendidos, faltas, el sitio sin .htaccess) y los informativos de Para revisar (avisos de Mercado Pago descartados o recuperados) tienen ✕ y «Borrar los leídos». Cada aviso tiene una clave que cambia con lo que dice: uno borrado no vuelve, salvo que haya algo nuevo (por ejemplo, otro profesional sin Mercado Pago). Los pagos y devoluciones para resolver no se borran: salen solos al resolverlos. |
| 3 · Admin | «Avisarle»: cuadro antes de mandar | Hecho | Mensaje predeterminado y editable (10 a 500 letras), con el medio (aviso en su panel y push) y Enviar/Cancelar. |
| 3 · Admin | Header sin «Registrá tu negocio» para el admin | Hecho | |

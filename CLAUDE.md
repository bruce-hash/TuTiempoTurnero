# TuTiempo · reglas para Claude Code

Marketplace de turnos online en Olavarría (barberías, peluquerías, masajes, pestañas, uñas, depilación).
Base y lógica de negocio en **Supabase** (Postgres + RLS + funciones SQL + Edge Functions en Deno).
Frontend estático servido por **Hostinger** (sin servidor propio). Cobros con **Mercado Pago** marketplace.

Bruno es el responsable técnico: vos generás el código, él lo dirige, revisa y aprueba. No escribe código a mano.

## Fuente de verdad (en este orden)

1. `supabase/migrations/*.sql`: reglas de negocio, seguridad y dinero. Si algo contradice al SQL, manda el SQL.
2. `docs/01-decisiones.md`: decisiones de negocio tomadas y abiertas.
3. `docs/00-estado-y-hallazgos.md`: errores conocidos y cómo corregirlos.
4. `docs/LEEME-cliente-v31.txt`: manual del cliente. Útil, pero tiene contradicciones (ver hallazgos).
5. `docs/Auditoria-cliente.pdf`: **solo vale de la versión 25 a la 31.** Las secciones de la página 12 en adelante
   ("Hallazgos críticos del sitio actual", "Reglas de negocio", "Plan por etapas", etc.) describen versiones viejas:
   comisión 20%, WhatsApp, cashback, retoque, cobro total por faltas. **Ignoralas.**

## Estructura

- Frontend: `index.html` + `src/` en módulos ES, con **Vite** (Node 22, ver `.nvmrc`). Se edita en `src/`, nunca en `dist/`.
  - `src/main.js` arranque (`boot`); `src/config.js` (`CFG`, `LIVE`, `sb`); `src/state.js` (estado `S`);
    `src/store.js`: datos en memoria compartidos entre módulos (`store.BOOK`, `store.CLIENTS`…) y `P` (prestadores cargados).
  - `src/lib/` (fechas, dinero, rubros, turnero…), `src/api/` (`demo.js`, `live/`, `saved.js`), `src/ui/` (render, nav,
    piezas compartidas), `src/views/` (cliente, auth, prestador, admin, legal), `src/styles/` (el CSS, en orden de cascada).
  - `src/actions/`: `registro.js` (acción → función), `toques.js` / `formularios.js` / `cambios.js` (los listeners de
    `document`) y un módulo por pantalla que registra sus acciones con `registerClick("act", (ev, el, act) => …)`
    (evento, elemento tocado, nombre de la acción), `registerSubmit("idForm", (ev) => …)`, etc.
  - `src/router.js` + `src/router/` (Bloque B): cada pantalla tiene su dirección (History API, sin `#`). `render()` llama a
    `syncUrl()`; `router/direcciones.js` arma URL, título y descripción desde `S`, y `router/pantallas.js` arma `S` desde
    la URL (carga, recarga, atrás/adelante). Una pantalla nueva = su ruta en los dos archivos. Las palabras que no puede
    tomar un prestador como slug están en `src/lib/rutas.js` (`RESERVED_SLUGS`) y en la base (`reserved_slugs()`):
    `test_db.py` verifica que coincidan.
  - Bloque D: `src/styles/compu.css` (pantallas desde 1024 px; en el celular sus contenedores van con `display:contents`
    y nada cambia), `src/ui/menu-cuenta.js` (menú de cuenta de la cabecera, con teclado) y `src/lib/verificacion.js`
    (todo lo que depende de "Exigir DNI para aprobar prestadores", D26: si se deja de pedir el DNI, se apaga en el admin).
  - H30: `src/lib/captcha.js` (Cloudflare Turnstile para Supabase Auth, solo si `config.js` trae `turnstileSiteKey`):
    toda llamada nueva a `signUp`, `signInWithPassword`, `signInWithOtp`, `resetPasswordForEmail` o `resend` lleva
    `captchaToken: await captchaToken("<formulario>")` y su vista, `captchaBox("<formulario>")`.
  - Bloque C: `src/lib/pwa.js` (service worker, instalar la app, versiones nuevas, freno `serviceWorker: false`),
    `src/lib/push.js` (permiso y suscripción de este dispositivo; el permiso se pide solo con un toque; 12/11: con el permiso ya dado, `refreshPush` lo vuelve a suscribir solo al ingresar, al abrir y al renovarse la sesión, salvo "Desactivar" en ese dispositivo, `tt_push_off`; al cerrar sesión `forgetPushHere` borra solo la fila de la base; `push_gone` con la huella de la dirección vencida), `src/ui/avisos.js`
    (tarjetas, Mi perfil, guía de iPhone) y `src/pwa/sw.js` (plantilla del service worker: el build la escribe en `/sw.js`
    con la versión y los archivos; NUNCA guarda nada de otro origen ni `config.js`).
  - V1 (D30): `src/lib/cobro.js` (`chargeFor`) arma seña + comisión de TuTiempo (% de la seña) + costo de Mercado Pago
    del plazo del prestador con la misma cuenta entera que `charge_parts` en la base; la app solo la muestra.
  - V3 (D31): los horarios de un servicio se suceden cada "duración del servicio" desde la apertura y siguen donde termina
    un turno que corta la secuencia: `slotsFor` en `src/lib/turnero.js` y `slot_starts` en la base hacen la misma cuenta.
    Sin descanso entre turnos (C39).
  - V8 (C52): `src/lib/precios.js` vuelve a pedir los precios del prestador en el perfil y la confirmación (al volver a la
    pestaña, cada minuto y antes de cobrar): el cliente nunca ve un precio y paga otro.
  - V4: la Caja es "Caja del día" en Finanzas (C34; `src/views/prestador/caja.js` quedó con los formularios). Medios de
    lo que se cobra en el local en `src/lib/medios.js` (Efectivo, Transferencia, Mercado Pago ↔ cash, transfer, mp): en
    `walkins.method` y en `bookings.rest_method` (cómo se cobró el resto, `set_rest_method`); `pay_method` es lo que eligió
    el cliente y no cambia. Resumen del mes: `provider_month_breakdown` en la base.
  - V4b (C25 "Cargar diferencia"): el resto de un turno en uno o dos medios (`bookings.rest_parts`, `set_rest_parts`; la
    suma no pasa del resto y lo que falta queda sin cobrar, fuera de la caja y de `provider_finance`). `src/lib/resto.js`
    (cuentas puras) y `src/views/prestador/resto.js` (el editor, el mismo en la Agenda al marcar "Asistió" y en la Caja del día).
  - Ingreso y registro (D32): una sola ventana para todos (`src/ui/ingreso.js`, contenido en `src/views/auth/login.js`
    `authBody()`, lo mismo en `/ingresar`, `/crear-cuenta` y `/registrar-negocio`). La acción que pidió ingresar
    (`S.pending`, `src/lib/pendiente.js`: reservar, seguir, lista, negocio; solo ids, vence a las 2 h) se muestra como
    ticket (`src/ui/ticket.js`) y sigue sola después de ingresar (`src/actions/pendiente.js`, `goAfter` en
    `src/lib/sesion.js`); viaja en sessionStorage (Google) y en la cuenta nueva (`tt_pending`, para el link del email).
    El prestador va siempre a su Agenda. D33: una cuenta es de cliente o de negocio (`isBusiness()` en `src/lib/cuentas.js`;
    la de negocio no reserva, no sigue ni reseña: aviso en `src/actions/cuentas.js`; en la base, triggers `business_account`
    y `client_history`). Registrá tu negocio: `src/views/auth/negocio.js` + `src/actions/negocio.js`
    (5 pasos, `setup_step`/`my_setup` en la base, `src/lib/alta.js` dice qué falta). Desde el 4/11 no hay ingreso con código
    por email; «Crear cuenta» va siempre en la ventana (`S.authOnPage` encima de `/ingresar`) y empieza con dos opciones
    (8/11: «Quiero reservar turnos» / «Tengo un negocio», `S.login.kind` y la acción `authKind` en `src/actions/crear-cuenta.js`;
    «Tengo un negocio» = la acción pendiente `negocio`). Cambiar contraseña:
    la actual con `sbScratch()` (no toca la sesión) y el código de `reauthenticate()` como `nonce`.
  - V3b (C22): `src/lib/agenda-al-dia.js` vuelve a pedir los turnos de la Agenda cada 30 s y al volver a la pestaña (sin
    Realtime) y solo dibuja si cambió algo; no toca la pantalla con un guardado pendiente, un formulario abierto o alguien escribiendo.
  - 12/11: `src/lib/dibujar.js` (`drawSoon`): todo redibujo que llega solo (Agenda, avisos, volver a la app) espera a que
    termine el toque, si no el toque se pierde (la campanita no abría). La bandeja del cliente descarta una respuesta de
    `my_messages` que salió antes de un cambio local (`store.INBOX_EDIT`): «Borrar los leídos» no vuelve a aparecer.
  - V4 resto: C31 gastos fijos en `src/lib/fijos.js` (qué corre cada mes; en la demo, la misma regla) y en la base
    (`fixed_expenses`, `fixed_expenses_sync` al abrir el panel, `fixed_expense_save`/`_stop` solo desde el mes actual, D40; `fixed_id`/`fixed_month` solo las funciones, S16; un mes cerrado
    no cambia). C30: «Antes de cerrar» en la Caja del día (`dayPending`). C36: `products.cost`; las ventas, con «Vender producto» en la Caja del día (`saleForm`, 7/11).
    D46 (10/11): el stock lo lleva la base: sube con «Cargar compra» (`product_buy`, con su gasto), baja con la venta (trigger
    `walkins_stock`, `no_stock`) o «Ajustar stock» (`product_adjust`, `stock_adjustments`: roto, vencido, uso en el local; ni venta
    ni gasto); alta con `product_add`. La app no escribe `products.stock` (`products_stock_guard`): nada de `setStock`.
  - D44 (Balance del admin): gastos de TuTiempo fijos (`admin_fixed_expenses`, filas por mes en `admin_expenses` con
    `fixed_id`/`fixed_month`, `admin_fixed_sync` al abrir el balance y al cerrar; `admin_fixed_save`/`_stop` solo desde el
    mes actual) y variables (`admin_expenses` sin `fixed_id`, `admin_update_expense`); resultado = comisiones − fijos −
    variables (`admin_finance`, `admin_closings.expenses_fixed`). Vista en `src/views/admin/balance.js`; demo en `src/demo/admin.js`.
  - V5 resto (C29): interruptor global de sellos (`app_settings.stamps_on`, `stampsOn()` en `src/ui/sellos.js`; todo lo de
    sellos pregunta ahí). En la base, `stamp_add` no suma ni canjea con los sellos apagados (`stamps_off`); los datos quedan.
  - V8 (C06): seguidor nuevo → `provider_notices` `new_follower` (trigger `follows_notice`, nombre de pila, una vez por
    persona) y push «Nuevo seguidor» con su interruptor propio (`profiles.push_followers`, «Nuevos seguidores»).
  - 4/11 B1 (`docs/08-pago-app-instalada.md`): `src/lib/cobro-pendiente.js` guarda el cobro abierto antes de ir a Mercado
    Pago (turno y token, `tt_cobro`) y al abrir o volver a la app lo confirma sola (no depende de la vuelta, que en iPhone se
    abre en Safari; la vuelta lleva `app=1` y dice «Volvé a la app»). `src/lib/actualizar.js`: datos de la pantalla al
    volver a primer plano y, en la app instalada, deslizar para actualizar y «Actualizar» en el menú.
  - 4/11 B3 (D35): Clientes → Seguidores (`src/views/prestador/seguidores.js`, `provider_followers`); «Ofrecer» (solo con el negocio activo, `provActive()` en `src/lib/alta.js`, S19) de la
    Agenda y «Ofrecer turno» a un seguidor (`src/actions/ofrecer.js` → `offer_slot`, huecos de `src/lib/huecos.js`) y
    «Avisar a tus seguidores» (`notify_followers`): avisos del cliente `offer` («Reservar») y `news`, con push. El número
    de seguidores y los avisos del panel se ponen al día con la Agenda (`refreshCommunityNow` en `agenda-al-dia.js`).
  - D41 (10/11): «Editar cobro» y «Deshacer asistió» en la ficha del turno atendido (`src/views/prestador/deshacer.js`,
    `src/actions/deshacer.js`); en la base `undo_attendance` y `attendance_undo_check` (sello ya canjeado → `stamp_redeemed`;
    caja del día o mes cerrado → `day_closed`, también en `set_rest_method`/`set_rest_parts`).
  - 10/11 (punto 2): en el perfil, elegir un servicio pinta el perfil, el turnero, la confirmación y el pago con la paleta
    de su rubro (`pickSvc` en `src/lib/servicios.js`: `S.pctx` y `S.svcPickedFor`); sin elegir, el rubro principal o el
    de donde vino, con un servicio de ese rubro. El cambio se funde con `renderSmooth()` (View Transitions; sin soporte o
    con movimiento reducido, directo).
  - D42 (10/11): la Caja de los últimos 7 días se corrige (`dayState`, `walksOf` en `src/views/prestador/finanzas.js`); en la
    base, `cash_day_state` (open, day_closed, month_closed, day_too_old) con triggers en `walkins`, el resto de `bookings` y
    `cash_closings`; el registro de cambios de un día reabierto en `cash_day_log` (`my_cash_day`).
  - D45 (punto 10): Eliminar de la lista y Bloquear (`src/views/prestador/bloqueos.js`, `src/actions/prestador-bloqueos.js`;
    Clientes → Bloqueados en `?ver=bloqueados`). La base lo hace cumplir (`client_blocks`, `block_client`, `remove_client`,
    `provider_clients.hidden_at`); al bloqueado le llega solo `no_slots` (`noSlots()` en `src/lib/prestadores.js`), nunca «bloqueo».
  - 10/11 (`docs/12-avisos-seguidores.md`): `src/lib/avisos-al-dia.js` pide los avisos del cliente cada minuto con la app
    abierta y, al llegar un push, el service worker le avisa a la app (`tt-push`) y se ponen al día (cliente o panel).
    Dejar de seguir saltea lo que quedaba en la cola (`push_due`, `unfollowed`); una suscripción vencida (404/410) deja
    rastro en `push_gone` (solo el SQL Editor la lee).
  - D25 (11/11): el profesional recibe por email y en la campanita cada reserva nueva de la app y cada cancelación de un
    cliente (`provider_notices` `new_booking`/`client_cancel`, trigger `bookings_provider_notice`; el push sigue siendo el de
    `bookings_push`, `provider_notices_push` no manda otro). Interruptor «Emails de reservas y cancelaciones»
    (`profiles.email_bookings`, `bMailBk` en `src/ui/avisos.js`, que va aunque el navegador no tenga notificaciones).
  - D36: la campanita de avisos de la cabecera (`src/ui/campanita.js` + `src/actions/campanita.js`): `S.inbox` del
    cliente (con `msgAction`) y `S.notices` del profesional. Mis turnos y el panel ya no muestran avisos.
  - D37: íconos propios, sin emojis en la interfaz: `ic("nombre")` de `src/lib/iconos.js` (SVG en línea, trazo del color
    del texto y detalle verde en `--ic-a`; tamaños por lugar en `src/styles/iconos.css`; `src/ui/iconos.js` lo reexporta).
    Un ícono nuevo se agrega ahí. Los textos planos (toast, confirm, push, title, placeholder, `<option>`) van sin ícono.
    `pruebas/unidad.mjs` falla si vuelve a aparecer un emoji en `src/` (fuera de comentarios y de `src/demo/`), salvo
    los de los seis rubros en `src/lib/rubros.js` (10/11: vuelven a sus emojis).
  - 4/11 · Bloque 4 (D06, D30, D38): seña fija del 30% (`src/views/prestador/plazo.js`: `DEPOSIT_PCT`, `depositNote`,
    `termPicker`; en la base, el trigger `ps_fixed_deposit` la fuerza en todo pedido con sesión). El plazo de Mercado Pago
    lo elige el profesional (Perfil → Cobros con Mercado Pago, 9/11, y el alta); si un cobro trae la comisión de otro plazo, `confirm_payment_core` no
    lo cambia: `mp_term_mismatch` en Para revisar y aviso `mp_term` (lleva a Perfil). Caja del día de otra fecha
    (`S.cajaDay`, `store.WALKDAY`, `api.walkinsOn`), ventas con cantidad (`walkins.qty`), gastos variables aparte
    (`provider_month_summary`), Ajustes solo Seguridad (`vAjustes`, `/cuenta/ajustes`).
  - 7/11 · Feriados (D39): `holidays-sync` (Edge Function, ArgentinaDatos y, de respaldo, el `.ics` de feriados de Google; `HOLIDAYS_API_URL` y `HOLIDAYS_ICS_URL` solo pruebas) guarda la lista en
    `holidays` (`holidays_sync_save`); el admin la confirma por año (`holiday_years`, Comisión → Feriados). El profesional:
    `src/views/prestador/feriados.js` (Horarios → Próximos feriados), `src/actions/feriados.js` (`holiday_decide`), aviso `holiday` 7 días
    antes (`holiday_notices`, campanita y push). Cuentas puras en `src/lib/feriados.js`. 10/11 (punto 13): **cerrados por defecto**: un
    feriado de un año confirmado que no pasó está cerrado salvo que el profesional lo abra (`holiday_closed`; se calcula, no es un
    bloqueo y NUNCA cancela turnos). `slot_starts` no da horarios ese día (book_slot, next_free_slot), un trigger no deja ofrecerlo
    (`slot_offers`) y la app lo sabe por `holidayClosed` en `src/lib/turnero.js` (perfil: `provider_closed_days`; panel: `store.HOLIDAYS`).
    «Voy a trabajar este día» / «Cerrar el día de nuevo» (sin `block_days`); a quien ya tiene turnos ese día, aviso `holiday_bookings`
    (`holiday_bookings_notices`, al confirmar o agregar un feriado). El profesional puede agendar a mano igual (`slotsFor(…, ownAgenda)`).
  - 7/11 · Legales: `/privacidad` (`src/views/legal/privacidad.js`) y `/terminos` (`terminos.js`), con la marca «Borrador
    pendiente de revisión legal»; lo que falta revisar y las contradicciones con el PDF original, en `docs/11-legales.md`. Si
    cambia una regla de `docs/01-decisiones.md` (seña, comisión, devoluciones, borrado de datos), cambiá también estos textos.
  - 10/11 · Cuenta suspendida (D43): `src/views/prestador/suspendida.js` (aviso fijo arriba del panel; lo que significa en
    `SUSPENDED_MEANS`, una línea por cosa) y `suspension()` en `src/lib/alta.js` (de `my_setup`). El admin suspende con un motivo
    opcional (`admin_set_provider(..., p_reason)` → `provider_private.suspended_reason`, sin grant de lectura); el trigger
    `providers_status_notice` deja los avisos `suspended`/`reactivated` (campanita, push `account` y email: `email_outbox.notice_id`).
    Un pago que llega con el profesional no activo se devuelve (`provider_suspended` en `confirm_payment_core`) y `mp-create-preference` no cobra.
  - C02: `src/lib/recarga.js` guarda la dirección en la pestaña y, si una recarga cae en "/" (servidor sin `.htaccess`),
    vuelve a la pantalla; el admin avisa si el servidor no devuelve la app en `/panel/agenda` (`checkRoutes`).
  - C04 (marca): `src/marca/` tiene el logo del manual en SVG (isotipo, logotipo, imagotipo); `src/ui/iconos.js` los arma
    (`LOGO`, `ISO`, `IMAGO`) y `tools/iconos.mjs` saca de ahí los íconos de la app, el favicon y el logo de los emails
    (PNG en `public/icons/`). La paleta del manual está en el segmento TuTiempo de `src/styles/tokens.css`; el texto verde es #07774F.
  - 11/11 · División del código (`src/partes.js`): el arranque baja solo lo de todos; el panel del profesional
    (`src/partes/panel.js`), el de TuTiempo (`partes/admin.js`) y «Registrá tu negocio» (`partes/negocio.js`) se bajan con
    `import()` al abrirlos, con sus acciones. Desde fuera de una parte, nada de import estático a sus módulos: `part("panel")?.x()`
    (si ya está) o `loadPart("panel").then(...)`; lo que usan también otras pantallas va a `src/lib/` (`panel-nav.js`,
    `comunidad.js`, `finanzas-base.js`, `mensajes-def.js`, `sena.js`). El service worker guarda todas las partes (sin
    conexión siguen andando). Lo verifica `npm run test:partes` (build de producción con la base local).
  - `src/demo/`: modo demo (datos de ejemplo, barra "Ver como"). Solo en desarrollo y pruebas: **nada de `src/demo/`
    llega al build de producción** (lo verifica `npm run test:sin-demo`).
  - Viene del `app.cjs` minificado del cliente. Desde el Bloque A2 las variables locales tienen nombres claros (en
    inglés, como el resto del código) y los comentarios van en español; mantené ese estilo en lo que agregues.
- `public/`: archivos que se copian tal cual a Hostinger (`.htaccess`, fuentes, `vendor/supabase.js`, `config.example.js`).
  El `.htaccess` manda a `index.html` todo pedido sin extensión que no sea archivo ni carpeta (el sitio va siempre en la
  raíz de su dominio); `pruebas/fallback.cjs` imita esa regla en los servidores de prueba.
- `vite.config.mjs`: `npm run dev` (servidor local con demo), `npm run build` → `dist/` (lo que se sube a Hostinger: solo
  en vivo, archivos con hash), `npm run build:test` → `dist-test/` (con demo y ganchos de prueba). No se versionan.
- `supabase/migrations/`: migraciones idempotentes en orden, con el formato de la CLI de Supabase
  (`AAAAMMDDHHMMSS_nombre.sql`, por ejemplo `20261001000001_schema.sql`). `supabase/TODO_EN_UNO.sql` es su concatenación
  exacta: si cambiás o agregás una migración, regeneralo con `npm run sql:build` y verificá con `npm run sql:check`
  (el CI falla si no son idénticos).
- `supabase/functions/`: Edge Functions de Mercado Pago (desde el Paso 1, `mp-reconcile` le pregunta a Mercado Pago por los
  cobros sin pago registrado, cron `tt-mp-sync`; el webhook y la consulta registran el pago con `_shared/pago.ts`; H06 (11/11): cada rechazo guarda su `diag` (sin la clave ni la firma),
  cada firma válida queda en `mp_webhook_status` (el aviso de «Para revisar» se apaga solo) y el aviso del panel se procesa por su `user_id`; las preferencias piden solo Webhooks
  (`source_news=webhooks`) y un IPN (`?id=…&topic=…`) que no valida queda como `ipn_ignored`, 200; cada
  cobro queda en `mp_checkouts` con su token de regreso, D28), `dni-cleanup` (borra las fotos del DNI, D24), `holidays-sync` (feriados, D39), `push-send` (notificaciones
  push, Bloque C: cola `push_outbox`, cifrado y VAPID en `_shared/webpush.ts`, secretos `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y
  `VAPID_SUBJECT`; `PUSH_TEST_ORIGINS` solo en pruebas) y `email-send` (avisos por
  email con Resend, Bloque 3; el HTML sale de `_shared/email.ts`); `_shared/util.ts` compartido. Desde el Bloque 1 las llaves están
  en `mp_accounts` (una por prestador y cuenta de MP; solo la `active` cobra) y cada pago en `payments`, ligado a la
  cuenta que lo cobró: las devoluciones y consultas usan esa llave, no la actual. Desde el Bloque 2a las llaves se guardan
  cifradas (AES-256-GCM con `MP_TOKENS_KEY`, `encryptToken`/`decryptToken` en `_shared/util.ts`; la base rechaza texto
  plano) y `mp-refunds`, `dni-cleanup` y `email-send` solo aceptan `CRON_SECRET`, que el cron lee de Vault. `MP_API_URL` y
  `EMAIL_API_URL` (opcionales, solo pruebas) cambian la API de Mercado Pago y la de Resend; sin esos secretos, las reales.
  `email-send` usa `RESEND_API_KEY`, `EMAIL_FROM` y `EMAIL_REPLY_TO`; la cola es `email_outbox` (D25).
  Claves del proyecto: `projectKey()` usa las nuevas (`SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS`) si están, si no las
  viejas; `caller()` verifica la sesión ES256/RS256 con el JWKS del proyecto y la HS256 con Auth (H31). Ninguna función usa `verify_jwt`.
- `supabase/seed/ejemplos.NO-USAR-EN-PRODUCCION.sql`: prestadores ficticios. Solo para pruebas locales (pide `set tt.ejemplos = 'si'` antes).
- Producción (12/11, D12/D47): la app está en `https://tutiempo.com.ar`, en el mismo proyecto de Supabase que era de
  prueba. `tools/produccion/` tiene la limpieza de datos de prueba (`limpieza-1-listar.sql`, `limpieza-2-borrar.sql`; los
  emails que se conservan se completan a mano, nunca en el repo) y lo que va en `public_html/prueba` (redirección 301 y un
  `sw.js` que desinstala la app vieja). El paso a paso del día: `docs/12-dia-del-cambio.md`. `public/robots.txt` y
  `public/sitemap.xml` son los de producción.
- Despliegue a prueba (docs/10; **apagado desde el 12/11**, corre solo con la variable `PRUEBA_ACTIVA = si` y un proyecto de prueba aparte): `.github/workflows/desplegar-prueba.yml` (botón: `supabase db push`, Edge Functions que
  cambiaron, build con `tools/preparar_prueba.mjs`, FTPS con `tools/subir_prueba.sh`, etiqueta `prueba-desplegada`) y
  `verificar-prueba.yml` (botón y todas las noches: `pruebas/verificar_prueba.mjs`; en la base lee solo
  `verificacion_prueba()`, que nadie puede llamar salvo el usuario `tt_verificador`). En cada PR, `npm run test:verificar`
  corre el mismo recorrido contra el entorno local. Producción no tiene despliegue automático.
- `pruebas/`: pruebas del cliente; `unidad.mjs` (reglas de los formularios sin navegador); `ancho.mjs` (ninguna pantalla más
  ancha que la ventana en 390 y 1366 px y nada con `hidden` a la vista); `test_db.py`, `test_cobros.py` (base: pagos,
  devoluciones, cuentas de MP) y `test_emails.py` (avisos por email: cola, reintentos, opción del cliente);
  `test_mudanza.py` (una base de la versión 31 con llaves en texto plano, migrada hasta la última; base limpia aparte);
  `funciones/` (las Edge Functions reales con Deno contra un Mercado Pago falso, `npm run test:funciones`).

## Arquitectura del frontend (respetarla)

Capas: (1) estado `S` (`state.js`) y datos (`store.js`); (2) `demoApi` y `liveApi` con las mismas funciones, toda
escritura pasa por `api.m.*` → `saved()`; (3) vistas `v*()` que solo arman HTML, con `esc()` para todo texto de usuario;
(4) un listener de toques por `data-act` / `data-go` / `data-btab` y uno de formularios por id, que buscan la acción en
el registro. Una función nueva = vista + `data-act` + `registerClick(...)` en el módulo de acciones de su pantalla +
`api.m.*` en demo y en vivo. Lo que sea solo de la demo va en `src/demo/` o detrás de `if (!LIVE)`.

## Reglas no negociables

- **Dinero:** montos enteros en pesos. Precios, señas, comisión y descuentos los calcula la base; el navegador solo muestra.
  Un pago aprobado por Mercado Pago **nunca** puede quedar sin turno ni sin devolución registrada.
- **Seguridad:** RLS en toda tabla nueva; permisos cerrados por defecto y abiertos explícitamente (los proyectos nuevos de
  Supabase no dan ninguno: cada tabla nueva lleva sus `grant` a `anon`/`authenticated` y a `service_role` si una función la
  lee directo, H32); funciones
  `security definer` siempre con `set search_path`. Nada de `service_role` en el frontend.
- **Hora:** todo "hoy/ahora" en `America/Argentina/Buenos_Aires`, calculado en el servidor o con `NOW()` de la app.
- **Migraciones nuevas:** archivo nuevo con fecha y hora actuales (`supabase migration new <nombre>` o a mano, por
  ejemplo `20261022150000_payments.sql`; siempre posterior a la última), idempotente, sin borrar datos. Después, `npm run sql:build`.
- **Producción:** nunca toques producción ni corras SQL contra un proyecto remoto. Bruno despliega.
- **Secretos:** nunca en el repo. `config.js` real, claves de Mercado Pago y de Supabase quedan fuera de git.

## Forma de trabajo

- Bloques numerados. Al terminar cada bloque **te detenés** y entregás: qué hiciste, archivos tocados, cómo probarlo,
  resultado de las pruebas y riesgos. No empezás el siguiente sin autorización.
- Ramas: `main` es producción (solo recibe lo que Bruno despliega); `developer` es la rama de trabajo y la rama por
  defecto del repo (ahí corre también la prueba nocturna). Cada bloque en `feature/<bloque>` desde `developer`, con PR a
  `developer`. Nunca commit directo a `main`. Commits chicos, en español.
- Si trabajás en un entorno aislado, hacé push de la rama al terminar y avisá el nombre.
- Ningún bloque termina con pruebas en rojo. Antes de cerrar cada bloque corré, según lo que tocaste:
  `npm run sql:check`, `pruebas/test_db.py`, `pruebas/test_cobros.py`, `pruebas/test_emails.py`, `pruebas/test_push.py` y `pruebas/test_mudanza.py` (base); `npm run test:funciones` y `npm run test:webpush` si tocás las
  Edge Functions o los cobros (Deno 2.1.4, Postgres y PostgREST); `npm run test:unidad`, `npm run test:crawl`,
  `npm run test:ancho`, `npm run test:clicks` y `npm run test:sin-demo` (frontend); `npm run test:e2e`, `npm run test:rutas`, `npm run test:captcha`, `npm run test:verificar`, `npm run test:pwa`, `npm run test:partes` y `npm run test:comparar` (navegador
  real, necesitan Postgres y PostgREST: ver abajo); `npm run test:htaccess` y `npm run test:litespeed` si tocás el
  `.htaccess` (Apache local y OpenLiteSpeed en docker; en el CI, contenedores `httpd:2.4` y `openlitespeed`). El workflow `.github/workflows/pruebas.yml` corre todo en cada PR y en cada push a `developer`/`main`.
- El crawl corre con el reloj fijo (`TT_AHORA`, por defecto 2026-10-21 15:00): la cantidad de toques depende de la
  fecha (la agenda de la demo sale de "hoy"). Lo que importa es 0 errores y 0 destinos equivocados.
- Las pruebas usan el mismo "hoy" que la base: el de Buenos Aires (`(now() at time zone 'America/Argentina/Buenos_Aires')::date`
  en SQL, `dt.datetime.now(TZ)` en Python), nunca `current_date` ni `date.today()`: el CI corre en UTC y de 21 a 24 h de
  Argentina ya es mañana (y a fin de mes, otro mes). El workflow corre todas las noches a las 23:30 de Argentina sobre
  `developer` (la rama por defecto) para cazarlas: si una falla ahí, se arregla igual (mismo "hoy" que la base). Para
  simular una hora localmente: un Postgres aparte levantado con `FAKETIME="+<segundos>s" LD_PRELOAD=…/libfaketimeMT.so.1`
  y las pruebas con `faketime -f "+<segundos>s"` (el mismo desplazamiento para todos los procesos; con `@fecha` cada
  proceso arranca su propio reloj y se desfasan).
- No inventes reglas de negocio: si algo no está en el SQL ni en `docs/01-decisiones.md`, preguntá.
- Textos de interfaz en español rioplatense (voseo), con el tono actual de la app.

## Cómo correr las pruebas de base localmente

```bash
# Postgres 16 local (las pruebas usan btree_gist, pg_trgm, unaccent) y el driver: pip install "psycopg[binary]"
npm run sql:check                                # TODO_EN_UNO.sql idéntico a supabase/migrations/
createdb tt
psql -v ON_ERROR_STOP=1 -d tt -f pruebas/supabase_emulation.sql     # imita lo que Supabase ya trae (roles, auth, storage)
psql -v ON_ERROR_STOP=1 -d tt -f supabase/TODO_EN_UNO.sql
python3 pruebas/test_db.py "host=... port=... dbname=tt user=postgres"
python3 pruebas/test_cobros.py "host=... dbname=OTRA_BASE_LIMPIA user=postgres"   # cobros (Bloque 1), base limpia aparte
python3 pruebas/test_emails.py "host=... dbname=OTRA_BASE_LIMPIA user=postgres"   # avisos por email (Bloque 3), base limpia aparte
```

## Cómo correr las pruebas de las Edge Functions

```bash
# Deno 2.1.4 (https://github.com/denoland/deno/releases) en el PATH, más Postgres y PostgREST como en el navegador
npm run test:funciones  # mp-oauth, mp-create-preference, mp-webhook, mp-refunds, dni-cleanup y email-send reales (MP y Resend falsos)
deno check --config pruebas/funciones/deno.json supabase/functions/*/index.ts   # tipos
npm run test:webpush    # cifrado aes128gcm y VAPID contra los vectores de RFC 8291 y RFC 8292 (sin base)
```

## Cómo correr las pruebas en navegador

```bash
npx playwright install chromium                  # una sola vez
# PostgREST 12: https://github.com/PostgREST/postgrest/releases (binario en el PATH o en POSTGREST=/ruta/postgrest)
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=...
npm run test:e2e        # recorrido completo en vivo (base nueva + PostgREST + pruebas/e2e_server.js)
npm run test:rutas      # direcciones: cada ruta, recarga, atrás/adelante, sesión, reservadas, QR (mismo entorno)
npm run test:captcha    # H30: Turnstile (falso) en cada llamada a Auth, sin clave no carga nada (mismo entorno)
npm run test:partes     # división del código: cada pantalla baja lo suyo, nada pasa de 500 kB, partes sin conexión
npm run test:pwa        # Bloque C: manifest, service worker (sin Supabase en la caché), sin conexión, versión nueva, push (mismo entorno)
npm run test:htaccess   # el .htaccess real con el apache2 local (apt install apache2): fallback, 404, HTTPS, CSP
npm run test:litespeed  # C02: el mismo .htaccess con OpenLiteSpeed en docker (el servidor de Hostinger): direcciones, 404, HTTPS
npm run test:comparar   # versión anterior al Bloque A vs. la actual: demo y en vivo, texto y capturas
```

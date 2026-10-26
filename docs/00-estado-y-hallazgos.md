# Estado de la versión 31 y hallazgos

Auditoría de Bruno (con Claude) sobre el paquete del cliente, octubre 2026.

## Qué se verificó

| Qué | Resultado |
| --- | --- |
| Migraciones `0001`–`0006` (hoy `20261001000001`–`20261001000006`) vs `TODO_EN_UNO.sql` | Idénticas |
| Carga del SQL en Postgres 16 | Sin errores: 34 tablas, 45 políticas, 76 funciones |
| `pruebas/test_db.py` | 243 de 244. La que falla es la prueba (ver H09), no la app |
| RLS | Activa en todas las tablas. Funciones `security definer` con `search_path`. Nada interno ejecutable por `anon` |
| `vendor/supabase.js` | Idéntico byte a byte al oficial `@supabase/supabase-js` 2.45.4 |
| `src/prototipo.html` (reconstruido) | Mismo comportamiento que el `app.cjs` del cliente: crawl (465 toques, 0 errores), audit_clicks y recorrido en navegador idénticos |
| `tools/build.mjs` → `dist/` | Mismo comportamiento que el paquete del cliente en navegador real |
| Edge Functions de Mercado Pago | Bien diseñadas, con los errores de abajo |
| Bloque A1: `src/prototipo.html` → módulos de `src/` con Vite (`1368349` → merge `9899126`) | Mudanza pura: cada declaración de la referencia, idéntica en su módulo (`tools/mudanza/`, borrado al aprobar A1). Crawl idéntico toque por toque, e2e 107/107, comparación en navegador 36/36 |
| Bloque 1: cobros (`payments`, `refunds`, `mp_accounts`) | H01–H05 y H23 resueltos. `pruebas/test_cobros.py` (base) y `pruebas/funciones/` (Edge Functions reales con Deno contra un Mercado Pago falso) en el CI |
| Bloque A2: nombres claros y comentarios (merge `9899126` → merge `6d7b5a0`) | Código idéntico módulo por módulo: árbol de sintaxis con las variables locales en nombres canónicos y sin comentarios (`tools/legibilidad/`, borrado al aprobar A2). Variables locales de una letra: 2834 → 0. Crawl idéntico toque por toque, e2e 107/107, comparación 36/36 |
| Bloque 2a: seguridad y datos | H12, H13, H14, H18, H26 y H29 resueltos. Llaves de Mercado Pago cifradas (AES-256-GCM), cron de devoluciones con Vault y `CRON_SECRET`, limpieza diaria, demo y seed ficticios. Despliegue en `docs/02` |
| Bloque 2b: correcciones de la app | H08, H10, H11, H15, H17, H21, H22, H24, H25 (D22), H27 y H28 resueltos. Además: cuentas de Mercado Pago con error en Para revisar y cuentas de demo en `@tutiempo.demo`. Despliegue en `docs/02` |
| Bloque 3: avisos por email | H07 resuelto (D10, D14, D25): Resend, cola `email_outbox`, Edge Function `email-send` cada 5 minutos, opción en Mi perfil. `pruebas/test_emails.py` y la función real contra un Resend falso en el CI. Despliegue en `docs/02` |

## Hallazgos

### H01 · Alta · Devolución que nunca se ejecuta (verificado · resuelto en el Bloque 1)
**Caso:** el cliente paga después de que venció su reserva temporal (10 min) y otro ya tomó ese horario.
`confirm_payment` marca el turno `cancelled_provider` con `refund_pending`, pero **no guarda `mp_payment_id`**
(solo lo guarda en el primer turno *confirmado*: `case when ok + failed = 0`). `mp-refunds` busca el pago por
`mp_payment_id` (o por la serie) y no lo encuentra: la devolución queda pendiente para siempre.
Lo mismo pasa en una serie si el primer turno es el que falla.
**Reproducción (hasta el Bloque 1):** `pruebas/reproducir_errores_cobro.py` (caso 1). Hoy es una prueba que pasa en
`pruebas/test_cobros.py`: el turno queda para devolver, ligado al pago (`refunds.payment_id`) y a la cuenta que cobró.

### H02 · Alta · Pago aprobado sin turno ni devolución (verificado · resuelto en el Bloque 1)
**Caso:** el prestador cancela un turno en estado `hold` (o bloquea ese día, o el admin lo elimina) y el cliente
termina de pagar igual. `confirm_payment` solo acepta turnos `hold`/`expired` → `bookings_not_found` → el webhook
responde 409 y Mercado Pago reintenta indefinidamente. La plata queda en la cuenta del prestador, sin turno ni devolución.
**Reproducción (hasta el Bloque 1):** `pruebas/reproducir_errores_cobro.py` (caso 2). Hoy, en `test_cobros.py`: el pago se
registra y se devuelve todo; el webhook responde 200.

### H03 · Media · Monto distinto deja el pago en el limbo (resuelto en el Bloque 1, D16)
`confirm_payment` lanza `amount_mismatch` → mismo efecto que H02.

**Arreglo de H01–H03 (uno solo):** tabla `payments` (id de pago de MP único, ids de turnos, monto, comisión,
estado, fecha) como fuente de verdad del cobro. `confirm_payment` **nunca falla** para un pago aprobado:
registra el pago y, si un turno ya no está disponible, fue cancelado o el monto no coincide, lo marca para
devolver (o para revisión manual) en lugar de lanzar error. `mp-refunds` toma el id de pago de `payments`.
Idempotencia por id de pago.
**Hecho en el Bloque 1** (migración `20261023215124_cobros.sql`): `payments` + `payment_bookings` (lo cobrado por cada
turno) + `refunds`, con topes en la base para no devolver nunca más de lo cobrado (por pago y por turno).

### H04 · Media · Contracargos y devoluciones hechas en Mercado Pago se ignoran (resuelto en el Bloque 1, D17 y D18)
`mp-webhook` solo procesa `status = approved`. Si el pago pasa a `refunded`, `cancelled` o `charged_back`,
el turno sigue confirmado y pagado. Hay que reflejarlo en el turno y en `payments`.
**Hecho:** `payment_mp_update` (estado propio `cancelled_refunded`, avisos al cliente y al prestador, "Para revisar").

### H05 · Media · Devoluciones fallidas sin aviso ni registro (resuelto en el Bloque 1, D19 y D20)
`mp-refunds` reintenta cada 10 minutos sin límite y sin avisar (por ejemplo, prestador sin saldo). Tampoco guarda
el id ni la fecha de la devolución hecha. Registrar cada intento y resultado, y mostrar las fallidas en el panel admin
("Para revisar").
**Hecho:** cada intento queda en `refunds` (intentos, último error, id de la devolución de MP); backoff de ~3 días y
"Para revisar · cobros" en el panel admin con "Reintentar" y "Resuelto a mano".

### H06 · Media · A verificar en la primera prueba real
`mp-webhook` exige la firma `x-signature` con `MP_WEBHOOK_SECRET`. Confirmar con un pago de prueba que Mercado Pago
firma con la clave de la aplicación de TuTiempo los avisos de pagos cobrados con la llave del prestador
(`notification_url` de la preferencia). Si no, ningún turno se confirmaría.

### H07 · Media · Recordatorios solo dentro de la app (resuelto en el Bloque 3)
`send_scheduled_notices` crea avisos en `client_messages`: quien no abre la app no se entera del recordatorio de
24 h / 2 h. Agregar envío por email (y opcionalmente Web Push). Afecta directamente las faltas.
**Bloque 3:** cada aviso de confirmación, recordatorio (24 h y 2 h), reseña, cumpleaños y cancelación entra a
`email_outbox` (trigger en `client_messages`, una sola vez por turno y tipo) y la Edge Function `email-send` lo manda
con Resend cada 5 minutos, con el mismo texto, reintentos y clave de idempotencia. Solo a emails confirmados; un
recordatorio no sale si el turno ya empezó o se canceló; en Mi perfil el cliente apaga los recordatorios, la reseña y el
cumpleaños (la confirmación y las cancelaciones salen siempre). El HTML escapa todo el texto del prestador y solo enlaza
al sitio. La limpieza diaria borra lo enviado, descartado o fallido con más de 90 días. El turno que el sistema no pudo
confirmar (expired con devolución) ahora también deja su aviso en la app. Web Push sigue afuera (prompt original).

### H08 · Media · Precios ×100 con coma decimal (heredado del prototipo · resuelto en el Bloque 2b)
Los campos de precio usan `parseInt(valor.replace(/\D/g, ""))`: "12500,50" se guarda como 1.250.050.
Validar enteros en pesos y rechazar decimales con mensaje claro (editor de servicios, productos, gastos, caja, admin).
**Bloque 2b:** `parsePesos` (`src/lib/montos.js`, lo reexporta `dinero.js`): acepta `12500`, `12.500` o `$ 12.500` y
rechaza un monto con centavos con "Escribí el monto en pesos enteros, sin centavos". Servicios y adicionales, productos,
gastos, caja (servicio sin turno y efectivo contado), gastos del admin y la devolución de Para revisar (que aceptaba
solo `12500`); las cantidades (stock, minutos, %) con `parseWhole`. Pruebas: `test:unidad` ("1.500", "12.000" y "$
2.000" se aceptan; "1500,50", "1,5", "1.50" y "1.5000" no; y cada campo de montos pasa por `parsePesos`) y el e2e.

### H09 · Baja · Prueba que depende de la fecha (resuelto en el Bloque 0)
`test_db.py` línea ~259 ("repetición cada 6 semanas permitida") reserva un horario que otra prueba anterior ya
ocupó según el día en que se corre. Usar un horario libre garantizado.

### H10 · Media · DNI en los metadatos de la cuenta (resuelto en el Bloque 2b)
El registro de prestador manda `provider_reg` (con el DNI) en `user_metadata` de Supabase Auth. Queda en
`auth.users` y en el token de sesión hasta que se crea el perfil. El DNI tiene que ir directo a
`provider_private` por función del servidor, nunca por metadatos.
**Bloque 2b (opción A):** el DNI no viaja en los metadatos. Con sesión se guarda con `set_my_dni()`; si hay que confirmar el
email, se carga en Perfil → Verificación (número, foto del frente y del dorso). Número de 7 u 8 dígitos y único entre
prestadores no eliminados (`dni_taken`). `admin_set_provider(…, 'active')` exige número y las dos fotos y marca
`dni_verified` con quién y cuándo (`provider_private.dni_verified_by/at`). Bucket `dni`: sube solo el dueño, en su carpeta
(`frente-…`/`dorso-…`) y solo si es dueño de un prestador no eliminado; lo ve solo el admin, con URL firmada de 2
minutos. El dueño ya no lee su fila entera de
`provider_private`. La migración `20261025194744_dni.sql` borra el DNI de `raw_user_meta_data` (prueba: `test_mudanza.py`).
Retención de las fotos (D24, `20261026025356_dni_retencion.sql`): la Edge Function `dni-cleanup` las borra con la API de
Storage a los 30 días de verificar, a los 90 de la última foto de un alta sin aprobar y en el momento de una baja (cron
diario y la baja, con `CRON_SECRET`; si la llamada de la baja falla, la corrida diaria). Activar pide las fotos o una
verificación anterior con fecha. Pruebas: `test_db.py` (qué se borra y cuándo) y `test:funciones` (la función real
contra el Storage del server del e2e: el archivo ya no existe y `dni_paths` queda vacío).

### H11 · Baja · "Identidad verificada" siempre visible (resuelto en el Bloque 2b)
En el perfil público la insignia no depende de `dni_verified`. Riesgo bajo (solo se ven perfiles activados por un
admin), pero debe mostrarse según el dato.
**Bloque 2b:** la insignia sale de `dni_verified` (y activar = verificar, H10).

### H12 · Baja · Se puede conectar la cuenta de Mercado Pago de TuTiempo como prestador (resuelto en el Bloque 2a)
El LEEME dice que no se puede, pero `mp-oauth` no lo controla. Comparar `tok.user_id` con el id de usuario de
Mercado Pago de TuTiempo (variable `MP_OWNER_USER_ID`) y rechazar.
**Bloque 2a:** `mp-oauth` rechaza esa cuenta (vuelve con `?mp_connected=0` y lo deja en el log) y, si falta
`MP_OWNER_USER_ID`, no conecta ninguna. Pruebas en `pruebas/funciones/`.

### H13 · Baja · Llaves y secretos (resuelto en el Bloque 2a)
- Las llaves de Mercado Pago se guardan sin cifrar: `provider_secrets` (sin uso desde el Bloque 1, se borra en el
  Bloque 2, D21) y **`mp_accounts`** (desde el Bloque 1, una por prestador y cuenta; las desconectadas se guardan hasta
  180 días después del último pago). Evaluar Supabase Vault o `pgsodium` para `access_token` y `refresh_token`.
- La tarea programada de devoluciones lleva la `service_role` key escrita en el SQL del cron: guardarla en Vault.
- `mp_oauth_states` no se limpia si el prestador abandona la conexión: borrar estados de más de 1 día.

**Bloque 2a** (`20261025171952_seguridad.sql`, `supabase/functions/_shared/util.ts`):
- Las Edge Functions cifran `access_token` y `refresh_token` con AES-256-GCM (Web Crypto, IV aleatorio de 12 bytes,
  formato `v<n>:<iv>:<cifrado>` en base64, datos asociados: prestador + cuenta de MP + campo). Clave `MP_TOKENS_KEY`
  (y `MP_TOKENS_KEY_V2`… para rotar: se lee con cualquiera, se escribe con la última). La base rechaza llaves sin
  cifrar. Las viejas copiadas de `provider_secrets` las borra la migración `20261025181645_llaves_sin_cifrar.sql`
  (null, con el motivo en `last_error`; si cobraba, "solo devoluciones" y aviso para reconectar; lo prueba
  `pruebas/test_mudanza.py` desde una base de la versión 31). Si aun así una función lee una sin el prefijo, hace lo mismo.
- `provider_secrets` se borró (D21).
- El cron `tt-refunds` llama a `mp-refunds` con `pg_net`, leyendo la dirección del proyecto y `CRON_SECRET` de
  `vault.decrypted_secrets`. `mp-refunds` acepta solo `CRON_SECRET` (comparada con `safeEqual`), ya no la `service_role`.
- El cron `tt-cleanup` (diario) borra `mp_oauth_states` de más de 1 día (y `mp_webhook_events`, ver H29).
- Cómo generar y rotar las claves: `docs/02`.

### H14 · Alta (antes de abrir) · Negocios reales en datos de ejemplo (resuelto en el Bloque 2a)
`ejemplos.sql` y el array `P` de la demo usan nombres, direcciones y hasta un teléfono de negocios reales de
Olavarría. Esos perfiles se pueden reservar y fallan (no tienen Mercado Pago). Reemplazar por datos ficticios y
no cargar ejemplos en producción.

**Ampliado en el Bloque A2:** además de `src/demo/`, hay datos de ejemplo en funciones de producción que mezclan demo y
vivo, y llegan a `dist/`:
- `seedStore` y `demoClosings` (`src/views/prestador/panel.js`): clientes, fichas ("Koleston 7.1 + oxidante 20 vol",
  "Trabajar cervicales; evitar lumbar"…), teléfonos "2284 4…", finanzas de 29 días, gastos ("Alquiler", "Insumos de …")
  y cierres de caja. Viajan enteros en el build de producción. Solo se ejecutan desde `useProvider`, que en vivo solo
  llama la acción `demoLogin` (su botón solo aparece en la demo), pero el código y los textos están.
- `seedComm` (`src/views/prestador/comunidad.js`): en vivo devuelve una comunidad vacía. Sus reseñas y trabajos
  inventados **no** llegan a `dist/` (el minificador los saca porque `LIVE` vale `true`); conviene moverlo igual.

**En el Bloque 2:** mover todo eso a `src/demo/` (en vivo el panel arranca vacío y lo llena la base) y ampliar
`test:sin-demo` para que lo detecte: buscar en `dist/` textos de esos datos (por ejemplo "Koleston 7.1") y que ninguna
función de siembra (`seedStore`, `demoClosings`, `seedComm`) sobreviva en el build de producción.

**Bloque 2a:** los 13 prestadores de la demo y del seed son ficticios (nombres, direcciones, teléfonos que empiezan
con 0 después de la característica, Instagram `*.demo`). `seedStore` y `demoClosings` están en `src/demo/panel.js` y
`seedComm` en `src/demo/comunidad.js`: en vivo el panel y la comunidad arrancan vacíos y los llena la base. El seed
no carga sin `set tt.ejemplos = 'si'` antes (`test_db.py` lo prueba). `test:sin-demo` verifica que no lleguen a
`dist/` las funciones de siembra ni sus datos ("Koleston 7.1", "Trabajar cervicales", "Insumos de …") y que ni
`src/` ni el seed tengan los datos de los negocios reales.

### H15 · Baja · Contradicciones del LEEME (resuelto en el Bloque 2b)
- Clientes: "si el profesional bloquea el día se devuelve la seña y hay botón Reprogramar". Prestadores y pruebas
  (v31): TuTiempo **no** devuelve la seña en bloqueos de días; el prestador la arregla. Vale la segunda.
- "No puede ser la misma cuenta de TuTiempo": no está implementado (H12).
**Bloque 2b:** el LEEME ya dice que en un bloqueo de días TuTiempo no devuelve la seña, que la cuenta de TuTiempo no se
puede conectar (H12, Bloque 2a) y remite a `docs/02` para el cron de devoluciones.

### H16 · Baja · Mantenimiento
- `vendor/supabase.js` 2.45.4 es viejo: actualizar en un bloque propio, con todas las pruebas.
- Variables internas con letras sueltas: resuelto en el Bloque A2 (ver la tabla de arriba).

### H17 · Baja · Código muerto de saldo y cashback (Bloque A1 · resuelto en el Bloque 2b)
TuTiempo ya no maneja saldo ni cashback (v25), pero el código sigue: `src/lib/saldo.js` (`CASHBACK = 0`, `cbOf`, `wMove`,
`walletPay`, `applyPay`, `refundPay`, `walletBox`, `walletPanel`) y sus usos (`S.wallet`, `S.wmov`, `paid_wallet`, `cashback`
en las vistas y en `liveApi`). En el Bloque A1 se mudó tal cual. **Borrarlo en el Bloque 2**, con sus pruebas (la base
conserva las columnas por compatibilidad).
**Bloque 2b:** borrado `src/lib/saldo.js` con `S.wallet`, `S.wmov` y `useWallet`. Lo pagado de turnos viejos con saldo
(`paid_wallet`) se sigue sumando en lo que se muestra como pagado. También salieron las reglas de CSS que solo usaba
el saldo (`.walletbox`, `.walletcard`, `.wc-top`, `.tgl`, `.cbline`, `.bk-cb`).

### H18 · Media · Credenciales de demo precargadas en vivo (Bloque A1 · resuelto en el Bloque 2a)
El estado inicial (`fresh()` en `src/state.js`) trae `S.blogin = { email: "hidro.style@tutiempo.demo", pass: "barbero123" }`
y el formulario "Acceso prestadores" los muestra **también en vivo** (versión 31). Además, `vBPerfil` usa
`sofia@tutiempo.demo` / `hidro.style@tutiempo.demo` como email de respaldo si no hay usuario. En A1 no se tocó (cero cambios
visibles); `pruebas/sin_demo.mjs` los tolera con un tope exacto y avisa "PEND". **Corregir en el Bloque 2** (con H14) y
bajar el tope a 0.
**Bloque 2a:** el formulario arranca vacío (también en la demo: tiene los botones de cada prestador de ejemplo) y el
email del perfil sale solo de la sesión en vivo. `test:sin-demo` no tolera ninguna cuenta de demo en `dist/`.

### H19 · Baja · Texto de prototipo visible en producción (Bloque A1)
El pie dice "… Olavarría, Buenos Aires, Argentina · Prototipo" (`index.html`). Revisar en el Bloque 2.

### H20 · Baja · Prueba e2e que dependía de la hora (resuelto en el Bloque A1)
`pruebas/e2e.js` bloqueaba de 20:00 a 21:00 el día de la reserva de la clienta, que es su primer turno libre: corrida de
tarde, la reserva caía a las 20:00 y el bloqueo chocaba ("bloqueo guardado en la base" fallaba también con la versión 31).
Ahora bloquea un día hábil sin turnos. 107/107 con la versión 31 y con la nueva.

### H21 · Media · Lógica de demo en código de producción (Bloque A2 · resuelto en el Bloque 2b)
- `realClients` (`src/views/prestador/clientes.js`) descarta con una expresión regular los nombres de relleno de la demo
  (`Lucas|Matías|Bruno|Iván|Leo|Nahuel|Franco` + inicial A–G + punto) y el nombre "R". **Corre en vivo:** un cliente
  real que se llame, por ejemplo, "Bruno F." no aparece en la lista de clientes ni en los mensajes del prestador.
- `vBPerfil` (`src/views/prestador/perfil.js`): con Mercado Pago conectado, **en vivo** muestra la cuenta
  "hidro.style.mp" (la de la demo). (El botón "Desconectar" de esa misma tarjeta es H23, Bloque 1.)
- `occAt` (`estadisticas.js`) y `monthTotals` (`finanzas.js`) inventan ocupación e ingresos de días y meses pasados con
  fórmulas cuando no es `LIVE`. En el build de producción esas ramas no quedan (el minificador las saca), así que hoy
  solo afectan a la demo, pero mezclan demo y vivo en la misma función.

**En el Bloque 2:** que `realClients` no filtre por nombre en vivo; mostrar la cuenta de Mercado Pago real (o ninguna);
pasar las ramas de demo a `src/demo/`.
**Bloque 2b:** en vivo `realClients` muestra a todos los clientes con nombre (prueba en el e2e con "Bruno F."); el armado de
clientes de la demo está en `src/demo/clientes.js` y la ocupación e ingresos inventados en `src/demo/estadisticas.js`.
La cuenta de Mercado Pago real ya se mostraba desde el Bloque 1.

### H22 · Baja · Código muerto y texto viejo (Bloque A2 · resuelto en el Bloque 2b)
- `misTurnosHtml` (`src/ui/bookbar.js`) no se usa (el build ya la descarta).
- `const hours = hoursUntil(booking)` en `src/views/cliente/turno.js` no se usa.
- La barra de la demo dice "completá config.cjs": el archivo ahora es `config.js`. Solo se ve en la demo (desarrollo y
  pruebas); el build de producción no la incluye.

**En el Bloque 2:** borrar lo muerto y corregir el texto.
**Bloque 2b:** borrados `misTurnosHtml` y la variable sin uso; la barra de la demo dice `config.js`.

### H23 · Media · "Desconectar" Mercado Pago no desconecta (Bloque A2 → resuelto en el Bloque 1)
En el perfil del prestador, el botón "Desconectar" (`mpDesc`, `src/actions/prestador-perfil.js`) solo pone
`S.mp = "none"` y vuelve a dibujar: en la base `provider_private.mp_connected` sigue en `true` y las llaves siguen en
`provider_secrets`, así que se sigue cobrando con esa cuenta. Al recargar vuelve a aparecer "conectado".
**En el Bloque 1 (toca cobros):** una función del servidor que desconecte de verdad (borre las llaves de
`provider_secrets` y ponga `mp_connected = false`), y que el prestador vea claramente si puede cobrar o no.
**Hecho (con el cambio que pidió Bruno):** las llaves no se borran al desconectar: pasan a `mp_accounts` (una por cuenta
de Mercado Pago) y la desconectada queda "solo devoluciones y consultas" hasta que no haga falta (`purge_mp_accounts`).
`mp_disconnect()` deja de cobrar en el acto; `book_slot` rechaza reservas con seña sin cuenta activa; el perfil público
dice "Todavía no toma turnos online". En vivo ya no se muestra "hidro.style.mp" (parte de H21): se ve el número de cuenta.

### H24 · Baja · Links armados en la base con el dominio escrito a mano (Bloque B → resuelto en el Bloque 2b)
Los avisos que arma la base (`notify_booking` y `send_scheduled_notices`, al reemplazar `{link}`) usan
`'tutiempo.com.ar/' || slug`. En el subdominio de prueba (o si el dominio cambia, D12) esos links llevan a otro sitio.
Desde el Bloque B el frontend usa el dominio en el que corre (`location.origin`).
**En el Bloque 2:** agregar `app_settings.site_url` (texto, por ejemplo `https://prueba.tutiempo.com.ar`, editable solo
por el admin) y armar los links con `site_url || '/' || slug` (o `/p/<id>` si el slug es reservado).
**Bloque 2b:** `app_settings.site_url` (por defecto `https://tutiempo.com.ar`; el admin la cambia en Comisión → Dirección del
sitio) y `provider_link()` arman `{link}` en `notify_booking` y `send_scheduled_notices`. La dirección es solo `https://` y el
dominio, sin puerto, carpeta, parámetros ni barra al final: lo valida el frontend (`src/lib/sitio.js`) y la base
(`site_url_ok()`, en `admin_set_site_url` y en la tabla; `20261026025232_site_url_https.sql`). Pruebas: `test:unidad`,
`test_db.py` y el e2e.

### H25 · Baja · Premio de sellos sin Mercado Pago (Bloque 1 → resuelto en el Bloque 2b, D22)
Desde el Bloque 1, si el prestador no tiene cuenta de Mercado Pago activa, su perfil público dice "Todavía no toma turnos
online" y no deja elegir horario. La base sí permite reservar el premio de sellos sin cuenta (no lleva pago), pero desde
el perfil no se llega.
**En el Bloque 2 (D22):** con la cuenta desconectada, el perfil deja canjear el premio (solo los servicios con la tarjeta
llena del cliente) y muestra "Solo podés canjear tu premio" en lugar de "Todavía no toma turnos online".
**Bloque 2b:** hecho (D22). Prueba en el e2e.

### H26 · Baja · Cuentas activas sin `mp_user_id` y `provider_secrets` (Bloque 1 → resuelto en el Bloque 2a)
Desde el Bloque 1, una cuenta sin `mp_user_id` no puede confirmar pagos (el webhook la trata como cobrador equivocado).
`mp_connect` ya lo exige; solo pueden quedar sin id las llaves viejas copiadas de `provider_secrets`.
**En el Bloque 2:** `check (status <> 'active' or mp_user_id is not null)` en `mp_accounts` (antes, pasar a
`refunds_only` las activas sin id y avisar al prestador que reconecte) y borrar `provider_secrets` (D21, junto con H13).
**Bloque 2a:** hecho así, con el aviso `mp_reconnect` y la restricción `mp_accounts_active_user`.

### H27 · Baja · "Reprocesar" pagos en revisión por un error inesperado (Bloque 1 → resuelto en el Bloque 2b)
Si `confirm_payment` falla por un error inesperado, el pago queda en "Para revisar" (no se pierde) y hoy el admin solo
puede devolverlo o marcarlo resuelto a mano.
**En el Bloque 2:** botón "Reprocesar" que vuelva a correr `confirm_payment_core` sobre ese pago, solo para motivos
`error: …`, solo si sus turnos siguen en `hold`/`expired` sin pago, y en la misma transacción que borra el registro de
revisión (con nota de quién y cuándo).
**Bloque 2b:** `admin_reprocess()` y el botón "Reprocesar" en Para revisar, con esas condiciones; queda en
`payments.reprocessed` (quién, cuándo, nota y el error anterior). El error inesperado ahora guarda la comisión que informó
Mercado Pago, para poder reprocesar.

### H28 · Baja · El prestador no se entera de un pago tardío que se devuelve (Bloque 1 → resuelto en el Bloque 2b)
Cuando un pago llega tarde y se devuelve (horario ocupado, monto de menos, turno ya cancelado), el prestador ve en su
Mercado Pago un cobro y una devolución sin ninguna explicación en la app.
**En el Bloque 2:** un aviso en `provider_notices` ("El pago de X llegó cuando el horario ya no estaba libre: se le
devuelve $Y desde tu cuenta"), una vez por pago.
**Bloque 2b:** aviso de pago devuelto (`mp_refunded`, ref `tarde-<pago>`, trigger en `refunds`), uno por pago con el total, para horario ocupado, turno ya no
disponible, monto de menos y pago sin turno.

### H29 · Baja · Retención de `mp_webhook_events` y `mp_oauth_states` (Bloque 1 → resuelto en el Bloque 2a)
`mp_webhook_events` crece con cada aviso descartado y no se limpia.
**En el Bloque 2:** borrar los de más de 180 días que no estén ligados a un pago en revisión sin resolver, en la misma
tarea programada que limpia `mp_oauth_states` (H13).
**Bloque 2a:** `daily_cleanup()`, en la tarea `tt-cleanup` de todos los días.

### H30 · Media · CAPTCHA (Turnstile) no soportado (pendiente antes de producción)
docs/02 (Etapa B) pedía activar el CAPTCHA de Supabase Auth (Turnstile), pero la app no lo soporta: `signUp`,
`signInWithPassword`, `signInWithOtp` y `resetPasswordForEmail` no mandan `captchaToken`, y la CSP del `.htaccess` no deja
cargar `https://challenges.cloudflare.com` (script-src y frame-src). Con el CAPTCHA activado, nadie podría crear cuenta,
ingresar ni recuperar la contraseña. **No activarlo** hasta resolverlo. Para hacerlo: el widget de Turnstile en crear
cuenta, ingresar (contraseña y código) y recuperar contraseña, `options.captchaToken` en esas llamadas, la CSP con
`challenges.cloudflare.com`, la clave del sitio en `config.js` y prueba en el e2e (el server del e2e tendría que
validar el token como Supabase).

## Mejoras futuras (no son hallazgos; después del lanzamiento)

### F01 · Vista previa de los links de prestadores (WhatsApp, Instagram)
El título y la descripción de cada pantalla los pone JavaScript (Bloque B). WhatsApp, Instagram y Facebook no ejecutan
JavaScript: al compartir `/<slug>` se ve el título genérico del sitio. Hostinger Business ejecuta PHP, así que un
`index.php` chico podría atender `/<slug>`: consultar el prestador en Supabase con la clave `anon` (solo datos públicos),
escribir en el HTML el título, la descripción y la imagen (`og:title`, `og:description`, `og:image`) y devolver el mismo
`index.html` de siempre. Requiere cambiar el fallback del `.htaccess` para esas rutas y una prueba propia.


### F02 · Cambiar turno (mover un turno confirmado conservando la seña)
Hoy no existe: en vivo, "otro horario" es siempre una reserva nueva con su pago. El modo "Cambiar" de la v31 solo movía el
turno en la demo; en vivo reservaba y cobraba otro turno y dejaba el original (desde el Bloque 1, `?reprogramar=<id>`
en vivo lleva al detalle del turno, `/turno/<id>`, sin ese modo; lo prueba `pruebas/rutas.js`). Para hacerlo bien:
- una función SQL (`move_booking`) que mueva el mismo turno en una transacción (horario libre, misma duración y precio
  recalculado por la base) y conserve `payment_id`, seña y comisión;
- reglas de negocio a decidir: hasta cuánto antes del turno se puede cambiar, cuántas veces, y qué pasa con la seña si
  el horario nuevo tiene otro precio (happy hour, adicionales).

### F03 · Aviso "Ya te toca tu próximo turno"
La plantilla `back` ("{nombre}, ya te toca tu próximo turno. ¿Te reservo?…") existe en `message_templates` (se crea con
cada prestador y se puede editar y apagar), pero nada la manda: ni dentro de la app ni por email. Queda afuera del
Bloque 3 (D25). Para hacerlo: decidir cuándo "ya le toca" a un cliente (por ejemplo, la frecuencia de sus últimos turnos
con ese prestador o un intervalo por servicio), armarlo en `send_scheduled_notices` con su `ref` (una vez por ciclo) y
sumarlo a los tipos de `email_outbox`.

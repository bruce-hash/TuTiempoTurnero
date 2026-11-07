# Auditoría de seguridad integral

Fecha: 27/10/2026. Base: `developer` en 6883d12 (Merge del PR #9). Rama: `audit/seguridad`.

Es una auditoría **de solo lectura**: no cambia código de la app ni migraciones. Agrega dos pruebas que reproducen los
hallazgos y verifican lo que está bien:

- `pruebas/auditoria_seguridad.py`: base de datos. Corre contra una base limpia, igual que `test_cobros.py`.
  - `OK` / `FAIL`: un control que se tiene que cumplir. Un `FAIL` es un problema nuevo.
  - `HALLAZGO Sxx`: el hallazgo se reproduce hoy. Cuando se arregle, pasa a `ARREGLADO Sxx`.
  - Con `--estricto`, también falla si queda algún hallazgo abierto (sirve para el bloque que los arregle).
- `pruebas/auditoria_xss.js`: navegador real, en vivo. Siembra textos con HTML en todo lo que escribe un usuario y
  recorre 26 pantallas de visitante, clienta, admin y prestadora.

```bash
createdb tt_audit
psql -d tt_audit -f pruebas/supabase_emulation.sql
psql -d tt_audit -f supabase/TODO_EN_UNO.sql
python3 pruebas/auditoria_seguridad.py "host=... dbname=tt_audit user=postgres"
vite build --mode test && node pruebas/entorno_e2e.mjs dist-test -- node pruebas/auditoria_xss.js {url} {pg}
```

Resultado de hoy:
- `auditoria_seguridad.py`: 55 controles OK, 0 FAIL; 13 líneas `HALLAZGO`, que reproducen S01, S04, S05, S06, S11, S12 y S15.
- `auditoria_xss.js`: 28 OK, 0 FAIL.
- `npm audit`: 0 vulnerabilidades, con y sin las dependencias de desarrollo.

Lo que no se puede probar localmente va marcado **"a verificar en el proyecto de prueba"**. Son configuraciones de
Supabase Auth, Resend y DNS, que viven fuera del repo. Para esas, el informe dice cómo verificarlas a mano.

## Resumen

| # | Gravedad | Hallazgo | Prueba |
|---|---|---|---|
| S01 | **Alta** | Un prestador (incluso uno pendiente) liga a su lista de clientes a cualquier usuario y le manda mensajes; si está activo, también emails de cumpleaños con su propio texto desde `avisos@` | `auditoria_seguridad.py` §4 |
| S02 | Media | Cambiar la contraseña no pide la actual ni reautenticar: con una sesión robada, la cuenta se pierde para siempre | a verificar en el proyecto de prueba |
| S03 | Media | Cualquiera con la anon key puede gastar el cupo de emails de Auth de todo el proyecto: nadie más recibe la activación, el código ni la recuperación | a verificar en el proyecto de prueba |
| S04 | Media | Acaparar horarios: el límite de 5 reservas sin pagar es por cuenta, y crear cuentas es gratis | `auditoria_seguridad.py` §6 |
| S05 | Baja | `reviews.client_id` es público: el id de usuario de cada persona que dejó una reseña (habilita S01) | §2 |
| S06 | Media | El error `dni_taken` revela si un DNI es de un prestador, sin límite de intentos; y un alta pendiente con un DNI ajeno bloquea al dueño real | §5 |
| S07 | Baja | docs/02 manda a cargar `MP_WEBHOOK_SECRET=pendiente`, un valor conocido, hasta el paso 9 | lectura |
| S08 | Baja | Logs con respuestas completas de Mercado Pago y de Resend | lectura |
| S09 | Baja | Un link con `token_hash` inicia sesión con la cuenta de otro, sin avisar (login CSRF) | lectura |
| S10 | Baja | La CSP permite conectarse a cualquier `*.supabase.co`: si hubiera una XSS, es un canal para sacar la sesión | lectura |
| S11 | Baja | Un prestador verificado se cambia el nombre sin revisión ("Soporte TuTiempo") | §8 |
| S12 | Baja | 9 funciones *invoker* sin `search_path` fijo | §1 |
| S13 | Baja | `vendor/supabase.js` 2.45.4 (agosto 2024), sin actualizar | lectura |
| S14 | Baja | El código de 6 dígitos (OTP) vale el tiempo por defecto de Supabase; nadie lo fija | a verificar en el proyecto de prueba |
| S15 | Media (legal) | La pantalla de Términos dice "se borran sus datos personales", pero al eliminar la cuenta quedan el nombre, las notas y el cumpleaños en la ficha del prestador, y el nombre en la reseña | §9 |

No hay ninguna **crítica**:
- nadie lee datos de otro;
- nadie mueve plata que no le corresponde;
- nadie toma una cuenta sin antes robar la sesión;
- ninguna pantalla interpreta HTML de un usuario.

Lo más urgente es S01 (el arreglo es chico) y, antes de abrir al público, S03 y S04 (CAPTCHA).

## Modelo de amenazas

| Actor | Qué tiene | Qué querría | Dónde lo frena hoy | Qué le queda |
|---|---|---|---|---|
| Visitante anónimo | El sitio y la anon key | Leer datos ajenos, reservar sin pagar | RLS y grants por columna; `book_slot` pide sesión | S03 y S05 |
| Atacante externo con la anon key | Igual que el anterior, con scripts | Datos en masa, abuso de emails y de horarios | La matriz de §2 (20 tablas cerradas; 9 funciones definer abiertas, todas de lectura pública) | S03, S04 y S05 |
| Cliente registrado | Sesión propia | Ver o tocar turnos ajenos, montos, saldo, sellos | `bookings_read`, `cancel_by_client` con `client_id = auth.uid()`, montos calculados por la base | S04 |
| Prestador malicioso | Sesión de prestador (aunque esté pendiente) | Contactar gente que no es su cliente, falsear reseñas, saltarse la comisión, averiguar DNI | `my_provider()` en todas las políticas; reseñas solo de turnos atendidos; webhook con monto y comisión verificados | S01, S06 y S11 |
| Prestador con la cuenta robada | La sesión de un prestador real | Cobrar a su cuenta de MP, devolver plata, ver clientes | Las llaves de MP no se leen (`mp_accounts` sin políticas); el OAuth de MP exige un login nuevo en MP | Ve los datos de sus clientes (es su panel); cancela turnos (se devuelve todo al cliente) |
| Admin con la cuenta robada | Sesión admin | Todo el panel: DNI, devoluciones, comisión | — | Es el riesgo mayor del sistema. Ver [Operación](#9-operación-secretos-accesos-y-rotación) (2FA en Google y en la cuenta) |
| Falsificador de avisos de MP | Puede hacer POST a `mp-webhook` | Confirmar turnos sin pagar | Firma HMAC en tiempo constante, ventana de 10 minutos, y el pago **siempre se vuelve a pedir a MP** con la llave del prestador (`mp-webhook/index.ts:32-60`) | S07: con el secreto conocido, solo hace que se vuelva a consultar un pago real |
| Alguien con un backup | Copia de la base | DNI, teléfonos, llaves de MP | Llaves cifradas con AES-256-GCM (la clave no está en la base); fotos del DNI en Storage, no en la base | Números de DNI, teléfonos, emails y notas en claro (ver §10) |

---

## Hallazgos

### S01 · Alta · El prestador liga cualquier usuario a su lista de clientes

**Evidencia**
- `supabase/migrations/20261001000003_security.sql:152-156` hace `grant select, insert, update, delete` sobre
  `provider_clients` a `authenticated`, en todas las columnas, `user_id` incluida. La política `provider_clients_owner`
  solo controla `provider_id = my_provider()`. Ningún trigger controla `user_id`.
- `send_client_messages` (`20261001000004_functions.sql:640`) inserta en `client_messages` para cada `c.user_id` de la
  lista propia del prestador: hasta 300 por envío y 600 por día.
- `send_scheduled_notices` (`20261025201554_site_url.sql:71`) manda el aviso `bday` a todo `provider_clients.user_id`
  cuyo `birthday` es hoy, con el texto de la plantilla del prestador.
  - Desde el Bloque 3, `bday` sale también por email desde `TuTiempo <avisos@tutiempo.com.ar>`
    (`20261026033854_emails.sql:81,137`).
- `my_provider()` devuelve también a los prestadores **pendientes**: crear un perfil de prestador no pide aprobación.
- De dónde sale el `user_id`: S05.

**Escenario de ataque**
1. Alguien crea una cuenta y se da de alta como prestador (queda pendiente).
2. Lee los `client_id` de las reseñas con la anon key.
3. Inserta una fila en `provider_clients` con cada uno.
4. Manda "Tu cuenta tiene un problema, escribinos al 11-5555-0000" a 600 personas por día. Les aparece en Mis turnos.
5. Con un prestador activo, pone `birthday` = hoy y edita la plantilla de cumpleaños: la base le encola a cada víctima
   un email desde el dominio de TuTiempo.
   - Los links de afuera no son clickeables (Bloque 3), pero sí el teléfono y el texto.
6. Además, con el UPDATE cambia el `user_id` de un cliente ya cargado, le da o le quita sellos (`give_stamp`,
   `redeem_stamps`) y altera `visits`, `total_spent` y `no_shows`.
   - Son estadísticas propias: no afectan a otros prestadores.

**Cómo se arregla** (una migración chica)
- Grants por columna: `insert (provider_id, name, phone, notes, birthday, profile)` y
  `update (name, phone, notes, birthday, profile)`.
  - `user_id`, `visits`, `no_shows`, `total_spent`, `last_visit`, `contacted_at` y `created_at` los escriben solo las
    funciones definer (`link_client`, `mark_booking`, `send_client_messages`), que ya lo hacen.
- `send_client_messages`:
  - mandar solo a clientes con al menos un turno con ese prestador: `exists (select 1 from bookings where
    provider_id = pid and client_id = c.user_id)`;
  - exigir prestador `active`.
- `send_scheduled_notices` (bday): la misma condición del turno.

**Prueba:** `auditoria_seguridad.py` §4 (5 líneas `HALLAZGO S01`). Después del arreglo pasan a `ARREGLADO`.

### S02 · Media · Cambiar la contraseña no pide la actual

**Evidencia**
- `src/actions/contrasena-nueva.js:35-38` llama a `sb.auth.updateUser({ password })` sin contraseña actual ni
  `nonce`. El mismo formulario sirve para "Cambiar contraseña" en Mi perfil (`S.npMode === "change"`).
- `docs/LEEME-cliente-v31.txt` PASO 2 B pide activar "Secure password change". Según la documentación de Supabase, esa
  opción exige reautenticar (`reauthenticate()` + `nonce`) solo si la sesión **no** es reciente; la app no tiene ese
  paso.

**Escenario:** con una sesión robada (por ejemplo, una computadora compartida sin cerrar sesión), el atacante cambia la
contraseña y el dueño queda afuera. Recuperarla por email sigue funcionando, así que es reversible si el dueño se da
cuenta.

**A verificar en el proyecto de prueba:** con "Secure password change" activado y una sesión de más de 24 h, Mi perfil →
Cambiar contraseña.
- Si da error ("reauthentication required"), además de S02 hay un error funcional: la opción no anda para sesiones
  viejas.
- Si no da error, la opción no está activada.

**Cómo se arregla:** pedir la contraseña actual (verificarla con `signInWithPassword` antes de `updateUser`), o el flujo
`sb.auth.reauthenticate()` → código por email → `updateUser({ password, nonce })`. Las cuentas de Google no tienen
contraseña actual: para ellas, el código por email.

**Prueba que lo cubriría:** en `e2e.js`, Mi perfil → Cambiar contraseña sin la actual tiene que fallar. `e2e_server.js`
tendría que imitar la exigencia de `nonce`.

### S03 · Media · El cupo de emails de Auth se agota desde afuera

**Evidencia**
- `src/actions/auth.js:246-249`: `signInWithOtp({ shouldCreateUser: true })`. Cualquier email recibe un código, y la
  cuenta se crea.
- `resetPasswordForEmail` y `signUp` también mandan emails, sin sesión.
- docs/02:290: con SMTP propio, Supabase arranca en **30 emails de Auth por hora para todo el proyecto**.
- H30: la app no soporta CAPTCHA, así que hoy no se puede activar.

**Escenario:** un script con la anon key pide 30 códigos por hora a direcciones al azar. Ningún usuario real recibe el
email de activación, el código ni la recuperación mientras dure. Además, cada pedido crea una fila en `auth.users`
(basura) y manda emails a terceros desde el dominio de TuTiempo, cosa que daña la reputación del dominio en Resend.

**Cómo se arregla**
1. Soporte de Turnstile en la app (H30): `captchaToken` en `signUp`, `signInWithPassword`, `signInWithOtp` y
   `resetPasswordForEmail`. Después, activarlo en Supabase.
2. `shouldCreateUser: false` en el ingreso con código: la cuenta se crea solo con "Crear cuenta". Hay que avisar
   "no hay cuenta con ese email" sin revelarlo; la app ya muestra el mismo mensaje para todos en la recuperación.
3. Subir el límite de emails por hora a lo que dé el plan de Resend.

**A verificar en el proyecto de prueba:** Authentication → Rate Limits, el valor de "emails per hour". Pedir códigos
hasta el límite y ver que otro usuario no recibe la activación.

### S04 · Media · Acaparar horarios con varias cuentas

**Evidencia**
- `book_slot` (`20261023215124_cobros.sql:659-662`) limita **por cuenta**: 5 reservas sin pagar a la vez y 20 intentos
  en 24 h. Cada reserva bloquea el horario 10 minutos.
- Crear cuentas es gratis (S03).

**Escenario:** un competidor con 10 cuentas bloquea 50 horarios del prestador cada 10 minutos, sin pagar nada. Con 20
intentos por cuenta y por día, son unas 33 horas de agenda bloqueada por día. La prueba muestra 3 cuentas nuevas
bloqueando 15 horarios.

**Cómo se arregla** (combinables)
- CAPTCHA en el checkout (S03).
- Tope por prestador y día de reservas sin pagar de cuentas creadas hace menos de 24 h.
- Bajar el `hold` a 5 minutos.
- Que el prestador vea los horarios "en pago".

Es regla de negocio: la decide Bruno (D-nueva).

**Prueba:** `auditoria_seguridad.py` §6. También controla que una sola cuenta no pase de 5.

### S05 · Baja · `reviews.client_id` es público

**Evidencia**
- `20261001000003_security.sql:160-162`: `grant select on public.reviews … to anon` en todas las columnas, y la política
  `reviews_read` es `using (true)`.
- La app no usa `client_id` en la vitrina pública.

**Escenario:** se arma la lista de ids de usuario de quienes reseñaron y se cruza entre prestadores ("esta persona fue a
estos 4 lugares"). Es la materia prima de S01.

**Cómo se arregla:** `revoke select on reviews from anon, authenticated` y
`grant select (id, provider_id, booking_id, author, stars, body, reply, created_at)`. Si la app necesita saber "esta
reseña es mía", que la lea con una función.

**Prueba:** §2, `HALLAZGO S05`.

### S06 · Media · `dni_taken` responde si un DNI está registrado

**Evidencia**
- `set_my_dni` (`20261025194744_dni.sql:110-120`) y `register_provider` (`:103`, `:119`) devuelven `dni_taken` si el
  número es de otro prestador no eliminado. No hay límite de intentos.
- Cualquier usuario puede tener un perfil pendiente (S01).

**Escenario**
- (a) Oráculo: con una lista de DNI (son semipúblicos en Argentina), se averigua cuáles trabajan en TuTiempo. La prueba
  hace 4 consultas en milisegundos.
- (b) Ocupación: alguien carga el DNI de otra persona en un alta que nunca se aprueba. El dueño real no se puede
  registrar (`dni_taken`) hasta que el admin intervenga, y hoy no hay pantalla para eso.

**Cómo se arregla**
- Contar los intentos: más de 3 DNI distintos por cuenta y por día → `too_many_attempts`.
- Que el DNI de un alta **pendiente** no bloquee a otra: unicidad solo entre verificados. El admin ve el duplicado al
  aprobar ("este DNI ya está en otra alta pendiente").
- Aviso al admin cuando un alta choca con un DNI existente.

**Prueba:** §5 (dos `HALLAZGO S06`). También controla que el número no se lea directo.

### S07 · Baja · `MP_WEBHOOK_SECRET=pendiente` en docs/02

**Evidencia**
- docs/02:41 (Instalación desde cero, paso 4) carga `MP_WEBHOOK_SECRET=pendiente` hasta el paso 9.
- Ese valor está en el repo: si el repo es público, o llega a serlo, cualquiera firma avisos válidos mientras tanto.

**Impacto acotado:** el webhook nunca cree el contenido del aviso, porque vuelve a pedir el pago a MP con la llave del
prestador (`mp-webhook/index.ts:52-58`). Con la firma falsificada, solo se logra que la función consulte pagos reales,
que es ruido y consumo de la API de MP.

**Cómo se arregla:** en docs/02, no cargar `MP_WEBHOOK_SECRET` hasta tenerlo. Sin el secreto, `env()` falla y el webhook
rechaza todo, que es lo correcto. O cargar uno al azar (`openssl rand -hex 32`) y reemplazarlo en el paso 9.

### S08 · Baja · Logs con respuestas completas de terceros

**Evidencia**
- `mp-oauth/index.ts:52`: `console.error("MP oauth", r.status, tok)` loguea la respuesta entera del canje del código.
  Si MP devolviera un 200 sin `access_token` pero con otros campos (por ejemplo, `refresh_token`), irían al log.
- `mp-create-preference/index.ts:66` loguea el error completo de MP, que puede traer datos de la preferencia.
- `email-send/index.ts:51` loguea `result.error` de Resend, que puede incluir la dirección del destinatario.

**Por qué importa:** los logs de las Edge Functions los ve cualquiera con acceso al proyecto de Supabase, y se guardan
fuera del control de la base (sin retención propia).

**Cómo se arregla:** loguear `status` y el `error`/`message` de la respuesta, nunca el cuerpo entero. En email-send, el
id del aviso alcanza para buscar el resto en `email_outbox`.

### S09 · Baja · Login CSRF con `token_hash`

**Evidencia:** `src/main.js:104-115` acepta `?token_hash=…&type=magiclink|signup|email|…`, llama a `verifyOtp` y
reemplaza la sesión que hubiera, sin preguntar.

**Escenario:**
1. El atacante pide un código para **su** email.
2. Calcula el `token_hash` (es un hash del email y el código).
3. Le manda a la víctima `https://tutiempo.com.ar/?token_hash=…&type=magiclink`.
4. La víctima queda dentro de la cuenta del atacante sin darse cuenta. Si reserva y deja su teléfono, ese dato queda en
   la cuenta del atacante.

Es de bajo impacto (no hay saldo que robar), pero es fácil de cerrar.

**Cómo se arregla:** si ya hay una sesión con otro email, no aplicar el link sin preguntar. Después de un `magiclink` o
un `signup`, mostrar "Entraste como <email>".

### S10 · Baja · CSP abierta a cualquier proyecto de Supabase

**Evidencia:** `public/.htaccess`, la línea de `Content-Security-Policy`:
`connect-src 'self' https://*.supabase.co wss://*.supabase.co` y lo mismo en `img-src`.

**Escenario:** sola no es un problema. Si alguna vez entra una XSS (hoy no hay: ver [Frontend](#6-frontend-y-hostinger)),
el script puede mandar la sesión, que está en `localStorage`, a un proyecto de Supabase del atacante: la CSP lo deja.

**Cómo se arregla:** poner el host exacto (`https://<proyecto>.supabase.co`). Ya está el comentario que lo pide para un
dominio propio. Como cada entorno tiene su proyecto, el `.htaccess` de prueba y el de producción tendrían que diferir:
docs/02 lo puede explicar como un paso del despliegue.

### S11 · Baja · El prestador verificado se renombra sin revisión

**Evidencia:** `20261001000003_security.sql:48`, `grant update (name, bio, address, …) on providers`. Ningún trigger
avisa ni vuelve el prestador a "pendiente".

**Escenario:** un prestador aprobado se pone "Soporte TuTiempo" o "Mercado Pago Pagos". Ese nombre aparece:
- en el asunto de los emails ("¡Feliz cumpleaños de parte de Soporte TuTiempo!");
- en los mensajes y en el perfil.

Combinado con S01, es phishing con la marca.

**Cómo se arregla**
- Rechazar nombres con "tutiempo", "mercado pago" o "soporte" (lista en la base).
- Avisar al admin en "Para revisar" cada cambio de nombre de un verificado.

**Prueba:** §8.

### S12 · Baja · Funciones invoker sin `search_path`

**Evidencia:** §1 de la prueba lista `avatar_owner_check`, `booking_fee`, `cashback_rate`, `money_txt`, `mp_clean`,
`photo_owner_check`, `providers_biu`, `providers_set_owner` y `reviews_set_client`.
- La regla de CLAUDE.md es para las `security definer`, y esas están todas bien.
- Estas corren con los permisos de quien las llama, así que el riesgo es chico. Pero son triggers sobre tablas sensibles
  (`providers_set_owner`, `reviews_set_client`), y el linter de Supabase ("Function Search Path Mutable") las va a
  marcar.

**Cómo se arregla:** `alter function … set search_path = public` en una migración (no cambia datos).

### S13 · Baja · supabase-js 2.45.4

**Evidencia:** `public/vendor/supabase.js` es 2.45.4 (gotrue-js 2.65.0), de agosto de 2024. docs/00:175 ya lo anota.
- `npm audit` no lo ve, porque no está en `package.json`.
- No conozco una vulnerabilidad publicada que afecte a esta versión. No lo pude verificar contra una base de avisos
  desde este entorno.

**Cómo se arregla:** el bloque propio que ya está previsto, con la batería completa. Agregar al CI un aviso cuando la
versión del archivo quede más de 6 meses atrás.

### S14 · Baja · Vencimiento del código de 6 dígitos

**Evidencia:** el LEEME (PASO 2 B y C) no fija "Email OTP Expiration".
- El código tiene un millón de combinaciones.
- El límite de verificaciones por IP de Supabase frena la fuerza bruta desde una IP, pero no desde muchas.

**A verificar en el proyecto de prueba:** Authentication → Providers → Email → "Email OTP Expiration".

**Cómo se arregla:** en el LEEME, 600 segundos (10 minutos). El email del código ya dice "tu código".

### S15 · Media (legal) · "Se borran sus datos personales" no es del todo cierto

**Evidencia**
- `src/views/legal/terminos.js:13` promete "Se borran sus datos personales (Ley 25.326)".
- `delete_my_account` borra el usuario, el perfil, la billetera, los mensajes, la lista de espera, los seguidos y los
  sellos (cascada), y deja los turnos como "Cliente eliminado". Pero quedan:
  - en `provider_clients`: el nombre, el teléfono (si lo cargó el prestador), las notas, el cumpleaños y la ficha
    (`profile`) que el prestador cargó;
  - en `reviews.author`: el nombre que puso en la reseña;
  - en `payments`: el pago, con `client_id` en null (correcto: es contable).

**Cómo se arregla** (decisión, D13)
- O el texto dice qué queda y por qué: el prestador es responsable de su propia ficha de clientes, y la reseña queda
  como "Cliente".
- O `delete_my_account` también anonimiza `reviews.author` y borra las notas y el cumpleaños de las fichas ligadas.

Lo tiene que mirar el abogado (ver §10).

**Prueba:** §9.

---

## Lo que está bien (con evidencia)

### 1. Auth y Google
- **Redirecciones:** `redirectTo` y `emailRedirectTo` son siempre `location.origin + "/"` (`auth.js:18`, `auth.js:217`,
  `acceso-prestadores.js:35,89`, `alta-prestador.js:40`). El "volver a" de la app pasa por `safePath`
  (`src/router/pantallas.js:18`): solo rutas internas (`/^\/(?!\/)/`, sin `\` ni espacios). `test:rutas` prueba el `?volver=` de las rutas
  protegidas; no hay una prueba con `?volver=//otro.com` (conviene sumarla al arreglar los hallazgos).
- **Destinos externos:** `safeRedirect` (`src/lib/dom.js:24`) solo deja ir al sitio y a mercadopago o mercadolibre por
  https.
- **token_hash:** se valida el formato (`^[A-Za-z0-9_-]{10,200}$`) y el `type` contra una lista (`main.js:104-108`). El
  link de recuperación sirve una sola vez (`e2e.js`: "el link de recuperación sirve una sola vez").
- **PKCE:** `flowType: "pkce"` (`src/config.js:17`).
- **Enumeración**
  - La recuperación muestra el mismo mensaje para todos los emails (lo prueba el e2e).
  - Con "Confirm email" activado (LEEME PASO 2 B), Supabase no dice si el email ya existe al crear cuenta.
  - El ingreso con contraseña da "Email o contraseña incorrectos" en los dos casos.
- **Contraseñas:** la regla de la app (`PWRULE`, 8 caracteres con letras y números) es la misma que pide el LEEME del
  lado del servidor.
- **Metadatos:** el DNI no viaja en los metadatos de la cuenta (H10, `alta-prestador.js:15-31`). `provider_reg` se borra
  en el primer ingreso (`api/live/cuenta.js:52-56`). Admin, prestador y estado no se toman de `user_metadata`, que el
  usuario puede escribir: salen de `app_admins` y `providers` (`is_admin()`, `my_provider()`).
- **Google con un email existente: a verificar en el proyecto de prueba.**
  - Supabase vincula identidades con el mismo email verificado.
  - Con "Confirm email" activado, alguien que crea una cuenta con contraseña y el email de otro no la puede activar.
  - Probar: crear una cuenta con contraseña sin activarla, después entrar con Google con ese email, y ver que la
    contraseña vieja ya no sirve.

### 2. RLS y permisos
- **RLS:** las 40 tablas de `public` tienen RLS (§1).
  - Las que no tienen ninguna política quedan cerradas: `admin_closings`, `admin_expenses`, `admin_notes`,
    `app_admins`, `email_outbox`, `mp_accounts` y `mp_oauth_states`.
  - Solo las leen las funciones definer.
- **Funciones definer**
  - Todas fijan `search_path` (§1).
  - anon ejecuta solo 9, todas de lectura pública: `category_counts`, `commission`, `get_provider`, `is_admin`,
    `list_providers`, `my_provider`, `next_free_slot`, `owns_provider` y `provider_busy`.
  - `provider_busy` devuelve solo inicio, fin y bloqueo del día, sin clientes.
  - `get_provider` no trae el teléfono (§2).
- **Anon:** no lee ninguna de las 20 tablas privadas de §2, ni `providers.owner_id`, ni el bucket `dni`. No reserva y no
  escribe la vitrina.
- **Cliente contra cliente** (§3): no ve turnos, billetera ni perfil de otro, ni cancela el turno de otro
  (`cancel_by_client` filtra por `client_id = auth.uid()`).
- **Prestador contra prestador** (§3): no ve turnos, clientes, teléfono ni DNI de otro, ni cancela, marca o responde
  reseñas de otro (`owns_provider()` en `cancel_by_provider` y `mark_booking`).
- **Lo que el prestador no se da solo:** no se activa, no marca el DNI como verificado (no tiene grant sobre `status` ni
  `dni_verified`), no se hace admin, no cambia la comisión (`admin_set_commission` → `forbidden`).
- **Turnos a mano:** la política `bookings_manual` exige `source manual/block`, `confirmed`, sin plata y sin cliente de
  la app.
- **Reseñas:** solo de un turno propio atendido (`reviews_insert`). El prestador no las borra (sin grant de DELETE): solo
  responde (`update (reply)`).
- **Largos:** todos los textos tienen un CHECK de largo en la base (ver el catálogo), así que nadie carga 1 MB en un
  nombre.

### 3. DNI
- **Las fotos**
  - El bucket `dni` es privado (8 MB; jpeg, png, webp y pdf).
  - Subir exige ser dueño de un prestador y el nombre `<uid>/(frente|dorso)-n.ext`
    (`20261026031955_dni_subida_prestador.sql:12-14`).
  - Leer es solo para el admin (`dni_admin`), con URLs firmadas de 120 segundos (`api/live/m-admin.js`).
- **El número:** está en `provider_private`, sin grant para nadie salvo las funciones. El dueño lo cambia solo hasta que
  lo verifican (`dni_locked`). Formato validado (`^[0-9]{7,8}$`) y único.
- **Retención (D24):** las fotos se borran con la API de Storage (no un DELETE suelto) a los 30 días de verificar, a los
  90 de un alta sin aprobar, y en el momento de una baja (`20261026025356_dni_retencion.sql`).
- **Logs:** `dni-cleanup` loguea carpeta (el uuid) y motivo, nunca el número.
- **Activar:** exige número y fotos, o una verificación anterior con fecha, y deja quién y cuándo
  (`admin_set_provider`).
- Lo que queda abierto: S06.

### 4. Mercado Pago
- **OAuth** (`mp-oauth/index.ts`)
  - `state` de un solo uso: se borra al leerlo, vence a los 15 minutos y lo limpia `daily_cleanup`.
  - PKCE S256.
  - Rechaza conectar la cuenta de TuTiempo (`MP_OWNER_USER_ID`, H12).
  - El `state` liga la conexión al prestador que la pidió con su sesión.
- **Llaves**
  - AES-256-GCM con IV al azar y AAD (prestador + cuenta de MP + campo), con versión de clave para rotar
    (`_shared/util.ts:94-132`).
  - La base rechaza una llave nueva en texto plano: trigger con `^v[0-9]+:…:…$`
    (`20261025171952_seguridad.sql:82-92`).
  - `mp_accounts` no se lee desde ningún rol de la app.
- **Webhook** (`mp-webhook/index.ts:32-60`)
  - HMAC sobre `id;request-id;ts` comparado en tiempo constante (`safeEqual`), ventana de 10 minutos.
  - El pago se vuelve a pedir a MP con la llave de la cuenta, así que el contenido del aviso nunca se cree.
  - Una repetición del aviso es idempotente (`already_registered`).
  - Los parámetros sin firmar (`provider`, `account`) solo eligen con qué llave preguntar: con otro prestador, MP
    responde 404.
- **Montos**
  - El monto sale de las reservas de la base: holds del que llama, vigentes, como mucho 4, del mismo prestador
    (`mp-create-preference/index.ts:14-30`).
  - `confirm_payment` compara monto y comisión (`fee_expected`) con lo que MP dice que cobró. Si no coinciden, a
    "Para revisar", nunca confirma de más (`test_cobros.py`).
  - `external_reference` solo lo arma la función; uno inventado choca con el control de monto y prestador.
  - Moneda: solo ARS.
  - Cobrador equivocado → `wrong_collector`.
- **Devoluciones**
  - Las disparan `cancel_by_provider` (todo al cliente), la baja del prestador y el admin (`admin_refund_create`, solo
    admin).
  - Ningún cliente las pide a mano (§7).
  - Las ejecuta `mp-refunds`, que solo acepta `CRON_SECRET` (comparado en tiempo constante, `cronOnly`), con la llave de
    la cuenta que cobró.
- **`MP_API_URL` / `EMAIL_API_URL`:** solo los usan las pruebas. Sin el secreto, la API real. docs/02 dice
  explícitamente que no se carguen.

### 5. Edge Functions
- **CORS:** solo `SITE_URL` (`cors()` en `_shared/util.ts`). El webhook y las del cron no responden a navegadores.
- **Errores:** al navegador van códigos (`login_required`, `hold_expired`, `mp_error`, `server_error`), no mensajes
  internos. Las del cron devuelven `error.message` solo a quien tiene `CRON_SECRET`.
- **`verify_jwt`:** solo `mp-create-preference` lo pide (`supabase/config.toml`). Las demás validan por su cuenta: firma
  de MP, `state` o `CRON_SECRET`.
- **mp-create-preference:** pide sesión y reservas propias en hold, como mucho 4 por pedido, con clave de idempotencia
  `pref-<ids>`. El abuso queda limitado por los topes de `book_slot` (S04).
- **Datos de MP guardados:** `mpClean` / `mp_clean` guardan solo id, estado, montos, fechas, cobrador, referencia y
  devoluciones. Nada del comprador ni de la tarjeta (`util.ts:210-222`).
- Lo que queda abierto: S08.

### 6. Frontend y Hostinger
- **XSS**
  - `auditoria_xss.js` siembra `"><b class=ttxss>`, `'><i class=ttxss>` y texto entre etiquetas en los campos que
    escribe un usuario:
    - nombre, bio, dirección e Instagram del prestador;
    - servicios, adicionales e indicaciones;
    - reseñas y respuestas, publicaciones, mensajes y plantillas;
    - clientes, notas y teléfono;
    - productos;
    - turnos (cliente y servicio), y nombre y teléfono del perfil.
  - Recorre visitante (inicio, perfil, reseñas, trabajos, búsqueda con HTML en la URL), clienta (mis turnos, perfil,
    reservar), admin (resumen, prestadores, ficha, balance, comisión) y prestadora (las 9 pestañas, ficha del cliente,
    mensajes).
  - Resultado: 0 elementos inyectados, el texto se ve como texto, y no se abrió ningún diálogo.
- **Escape:** `esc()` (`src/lib/dom.js`) cubre `& < > "`. No hay atributos con comillas simples que lleven datos (la
  prueba lo intenta con `'>`).
  - `toast()` usa `textContent`.
  - `notif()` recibe HTML, y sus dos llamadas escapan el nombre (`reserva.js:317`, `turnero.js:229`).
  - Las URLs firmadas del DNI van con `esc()` en `href` y `rel="noopener"`.
- **CSP** (`.htaccess`): `script-src 'self'` sin `unsafe-inline` ni `eval`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'` y `frame-ancestors 'none'`, más `X-Frame-Options DENY` (clickjacking). También HSTS de 1 año,
  `nosniff`, `Referrer-Policy` y `Permissions-Policy`. `test:htaccess` lo prueba con Apache real.
- **Archivos:** el `.htaccess` bloquea los ocultos y `.bak`, `.sql`, `.log`, `.sh`, `.md` y `.zip`, y no lista
  carpetas.
- **`dist/` sin secretos**
  - Revisado: `config.js` es el de ejemplo si no hay uno real (`vite.config.mjs:76`) y no se versiona.
  - No hay `service_role`, JWT, `APP_USR-`, claves de Resend ni `CRON_SECRET` en `dist/` (grep sobre el build de
    producción).
  - La demo no entra (`test:sin-demo`), y los ganchos de prueba (`ganchos-prueba.js`) tampoco.
- **Dependencias:** `npm audit` da 0. `supabase.js` va propio (no CDN), así que no hace falta SRI. Lo que queda: S13.

### 7. Emails
- **Remitente:** sale solo desde `avisos@tutiempo.com.ar` (`EMAIL_FROM`), con respuestas a soporte.
- **Plantillas** (`_shared/email.ts`, Bloque 3)
  - Escapan el HTML del prestador.
  - Solo hacen clickeables los links del sitio: un `<a href="https://otro.com">` o un `<script>` del prestador salen
    como texto (`funciones.ts`).
- **Asunto:** lo arma la base. El prestador pone solo su nombre, y por eso importa S11.
- **Opción del cliente:** Mi perfil apaga r24, r2, rev y bday, y el pie lo dice.
- **`email_outbox`:** sin políticas (nadie lo lee desde la app), retención de 90 días (D25).
- **SPF, DKIM y DMARC:** docs/02:258-270 manda cargar DKIM (`resend._domainkey`), el MX y el SPF del subdominio de envío
  (`send`), y un DMARC `p=none` con reportes a soporte.
  - **Recomendado:** después de 2-4 semanas de reportes limpios, pasar a `p=quarantine`. Con `p=none`, cualquiera puede
    mandar emails "de" `@tutiempo.com.ar` y el que los recibe no los rechaza.
  - **A verificar:** `dig TXT _dmarc.tutiempo.com.ar` y `dig TXT resend._domainkey.tutiempo.com.ar`.

### 8. Abuso del negocio
- **Acaparar horarios:** el tope por cuenta (5 a la vez, 20 por día) funciona (§6). El abuso con varias cuentas es S04.
- **Devoluciones fraudulentas**
  - El cliente que cancela no recupera nada (`cancel_by_client`: `kept_by_provider`). Es la regla de D07.
  - Si cancela el prestador, se devuelve todo al cliente, comisión incluida (D08), así que un prestador y un cliente
    compinchados no sacan plata.
  - Los contracargos de MP (`in_mediation`, `charged_back`) llegan al prestador como aviso (Bloque 1).
- **Sellos**
  - El cliente no se los da (§7).
  - El prestador da uno manual por servicio cada 20 horas (`give_stamp: stamp_today`).
  - El premio va sin comisión (D22): un prestador podría usarlo para cobrar en efectivo por fuera, pero llega a un
    premio cada `stamp_goal` visitas como mucho. Es bajo, y es una regla de negocio.
- **Reseñas falsas:** exigen un turno de la app atendido, y para eso hay que pagar seña y comisión. Cada reseña falsa
  le cuesta la comisión al prestador. El prestador no borra reseñas.
- **Spam de mensajes:** como mucho 600 por día y por prestador, de 2 a 500 letras, sin caracteres de control. Lo que
  queda abierto es a quién (S01).
- **Prestadores falsos:** para aparecer al público hay que estar activo, y activar pide número y fotos del DNI y la
  aprobación del admin. Lo que queda: S06 y S11.
- **Saltarse la comisión**
  - El monto lo calcula la base, y el webhook compara la comisión cobrada (`marketplace_fee`) con la esperada.
  - Un prestador que cobra por fuera de la app (turno "manual") no paga comisión: es inherente al modelo, no a la app.

---

## 9. Operación: secretos, accesos y rotación

| Secreto | Dónde vive | Quién lo ve | Si se filtra | Cómo se rota |
|---|---|---|---|---|
| anon key | `config.js` en Hostinger (pública por diseño) | Todos | Nada que no permita RLS (§2). Habilita S03 y S04 | No hace falta. Si se rota la JWT secret, cambiar `config.js` |
| service_role | Supabase (la inyecta en las Edge Functions como `SUPABASE_SERVICE_ROLE_KEY`). No está en el repo ni en `dist/` | Quien tiene acceso al proyecto | **Todo**: lee y escribe cualquier tabla sin RLS, incluidas las fotos del DNI, los números, los teléfonos y las llaves de MP **cifradas** (sin `MP_TOKENS_KEY` no se descifran) | Supabase → Settings → API: rotar la JWT secret o pasar a las API keys nuevas (`sb_secret_…`) y revocar la vieja. Rotar la JWT secret cierra todas las sesiones |
| `CRON_SECRET` | Secreto de las funciones + Vault (`tt_cron_secret`) | Proyecto de Supabase | Correr `mp-refunds` (solo ejecuta devoluciones **ya pedidas** por la base), `dni-cleanup` (borra solo lo que `dni_photos_due` dice) y `email-send` (manda la cola). Molestia, no robo | docs/02 "Rotar la CRON_SECRET" |
| `MP_TOKENS_KEY` (`_V2`…) | Secreto de las funciones | Proyecto de Supabase | Sola, nada. **Con un backup o con service_role**: las llaves de MP de todos los prestadores, es decir, sus cuentas de MP (cobrar, devolver, ver movimientos) | docs/02 "Rotar…". Agregar: si se filtró **junto** con la base, reconectar no alcanza. Hay que pedirle a cada prestador que revoque el acceso de TuTiempo en su cuenta de MP (Seguridad → Aplicaciones conectadas) antes de reconectar |
| `MP_CLIENT_SECRET` | Secreto de las funciones | Proyecto | Hacerse pasar por la aplicación de TuTiempo en el OAuth; sin el código de un prestador no obtiene llaves | Panel de desarrolladores de MP → renovar, y `supabase secrets set` |
| `MP_WEBHOOK_SECRET` | Secreto de las funciones | Proyecto | Firmar avisos falsos, que no logran nada (S07) | Panel de MP → Webhooks → renovar la clave |
| Llaves de MP de cada prestador | `mp_accounts`, cifradas | Nadie desde la app | Ver `MP_TOKENS_KEY` | El prestador desconecta y reconecta |
| `RESEND_API_KEY` (función) y la clave SMTP de Auth | Secreto de las funciones / Supabase Auth → SMTP | Proyecto | Mandar emails desde `@tutiempo.com.ar` (phishing con la marca) | Resend → API Keys: borrar y crear otra (son 4, por entorno y uso: docs/02) |
| Google OAuth client secret | Supabase Auth → Google | Proyecto | Hacerse pasar por la app de TuTiempo ante Google | Google Cloud → Credenciales → restablecer |
| Contraseñas de Hostinger, Supabase, Google, MP, Resend y el registrador del dominio | Bruno | Bruno | Según la cuenta: el registrador permite cambiar el DNS y con eso los emails y el sitio | **2FA en todas** |

**Accesos recomendados**
- 2FA en Supabase, Hostinger, Google, MP, Resend, GitHub y el registrador.
- La cuenta admin de la app: email con 2FA y entrar con Google, no con contraseña. Hoy la app no tiene 2FA propio. Un
  admin robado ve los DNI y crea devoluciones: es el riesgo mayor del modelo, y vale considerar MFA de Supabase (TOTP)
  solo para admins en un bloque.
- Que nadie más que Bruno tenga acceso al proyecto de producción de Supabase.
- Los backups de Supabase guardan la base, no las fotos (Storage). Un backup tiene DNI, teléfonos, emails, notas y las
  llaves cifradas.

---

## 10. Ley 25.326 (protección de datos personales)

**Qué datos hay, para qué y cuánto tiempo**

| Dato | Dónde | Para qué | Cuánto tiempo |
|---|---|---|---|
| Email, contraseña (hash), nombre, foto de Google | `auth.users`, `profiles` | Cuenta y avisos | Hasta que la persona elimina la cuenta |
| Teléfono del cliente | `profiles`, `bookings.client_phone` | Contacto del prestador por el turno | Ídem; en los turnos se borra al eliminar la cuenta |
| Turnos, pagos y devoluciones | `bookings`, `payments`, `refunds` | Servicio y contabilidad | Indefinido; sin cliente después de la baja |
| Ficha del cliente en el prestador (nombre, teléfono, notas, cumpleaños, `profile`) | `provider_clients` | CRM del prestador | Indefinido; **queda después de la baja** (S15) |
| Respuestas al reservar (`intake`), si el prestador pregunta algo | `bookings.intake` | Preguntas del prestador ("¿alergias?") | Indefinido |
| Reseñas (nombre y texto) | `reviews` | Público | Indefinido; queda el nombre (S15) |
| Mensajes y emails | `client_messages`, `email_outbox` | Avisos | Mensajes: hasta la baja. Cola de emails: 90 días (D25) |
| DNI (número), teléfono y fotos del prestador | `provider_private`, Storage `dni` | Verificar identidad | Número: indefinido. Fotos: 30/90 días (D24) |
| Datos de MP del prestador | `mp_accounts` (cifradas), `provider_private.mp_user_id` | Cobrar | Hasta 180 días después del último pago (Bloque 1) |

**Lo que tiene que revisar un abogado** (D13 sigue abierta)
1. **Inscripción de la base ante la AAIP** (Registro Nacional de Bases de Datos). TuTiempo es responsable de una base
   con datos de clientes y de prestadores, DNI incluidos.
2. **Política de privacidad.** Hoy no existe: hay un resumen de Términos "para la demo" (`terminos.js`). Tiene que
   decir:
   - qué datos, para qué y cuánto tiempo;
   - quiénes los reciben: el prestador, Mercado Pago, Supabase (fuera del país), Resend (fuera del país) y Google;
   - cómo ejercer los derechos.
3. **Transferencia internacional.** Supabase y Resend guardan y procesan en el exterior: hay que ver si el país o la
   cláusula contractual alcanza (art. 12).
4. **Datos sensibles** (art. 7). `intake` y las notas del prestador pueden tener datos de salud ("alergias",
   "embarazada", "problemas de piel" en masajes y depilación). ¿Se pide consentimiento expreso? ¿Se limita lo que el
   prestador puede preguntar?
5. **Derechos de acceso, rectificación y supresión** (arts. 14-16)
   - Hoy hay supresión (Eliminar cuenta) y rectificación (Mi perfil).
   - No hay "descargar mis datos". El plazo legal de acceso es de 10 días corridos: alcanza con un procedimiento
     manual por soporte@, pero hay que escribirlo.
6. **Roles con los prestadores.** El prestador ve y guarda datos de sus clientes en su ficha. ¿Es responsable o
   encargado de tratamiento? Hace falta un contrato o una cláusula en los términos del prestador. Esto define qué
   pasa con su ficha cuando el cliente se da de baja (S15).
7. **DNI de los prestadores.** Finalidad (verificar), plazo (D24) y quién los ve (solo el admin), escritos en la
   política. Y el uso del número después de verificar: hoy se guarda indefinidamente para evitar duplicados (S06).
8. **Emails de cumpleaños.** El cumpleaños lo carga el prestador, no el cliente. ¿Hay base legal para mandar un email
   en nombre del prestador con un dato que el cliente no dio a TuTiempo? (S01 lo agrava.)

---

## Qué no cubre esta auditoría

- Configuración real de los proyectos de Supabase, Resend, MP, Google y DNS. No tengo acceso: van como "a verificar".
- Pruebas de carga o de denegación de servicio contra servicios reales.
- Revisión de la infraestructura de Hostinger y Supabase (son proveedores).
- Código de terceros (supabase-js, Deno std) más allá de la versión.

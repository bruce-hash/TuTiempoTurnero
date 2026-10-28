# Puesta en marcha (lo que hace Bruno a mano)

Dos entornos: **prueba** (subdominio, Mercado Pago de prueba) y **producción**. Nada se sube a producción hasta que
Claude Code termine los bloques 1 y 2 y la prueba con Mercado Pago salga bien.

> Ojo: hoy `tutiempo.com.ar` (raíz de `public_html` en Hostinger) es el sitio Laravel con usuarios reales.
> **No subas nada ahí.** Todo va a un subdominio hasta decidir el reemplazo (D12).

Las instrucciones del `LEEME-cliente-v31.txt` sirven, con las correcciones marcadas acá.

## Instalación desde cero (entorno nuevo)
Un solo orden, de principio a fin, para armar un entorno vacío (prueba o producción). Los detalles de cada paso están
más abajo (Etapa A); las secciones "Bloque 2a / 2b / 3" sirven solo para **actualizar un entorno que ya existía**.

**0. Antes de empezar (una vez por entorno)**
- Cuenta de Mercado Pago con la aplicación Marketplace creada (Etapa A, paso 2.1 y 2.2): `MP_CLIENT_ID`,
  `MP_CLIENT_SECRET` y `MP_OWNER_USER_ID`. El `MP_WEBHOOK_SECRET` sale en el paso 9.
- Resend con el dominio `tutiempo.com.ar` **verificado** (registros DNS en Hostinger), la casilla
  `soporte@tutiempo.com.ar` y las dos claves del entorno: `<entorno>-funcion` y `<entorno>-auth` (sección 2b, pasos 1 a 4).
- Hostinger: el subdominio (o dominio) del sitio creado, con SSL (sección 3, paso 1).
- Las claves propias de TuTiempo, nuevas para este entorno, generadas en tu compu (nunca en el repo ni en un chat):
  ```bash
  openssl rand -base64 48   # CRON_SECRET
  openssl rand -base64 32   # MP_TOKENS_KEY
  ```

**1. Proyecto de Supabase.** supabase.com → New project, región São Paulo (prueba: plan gratis; producción: Pro).

**2. Extensiones.** Database → Extensions: `pg_cron` y `pg_net`.

**3. Vault** (SQL Editor). Antes de la base, así las tareas programadas y las bajas encuentran la dirección y la clave:
```sql
select vault.create_secret('https://<proyecto>.supabase.co', 'tt_project_url');
select vault.create_secret('<CRON_SECRET>', 'tt_cron_secret');
```

**4. Secretos de las funciones** (desde la carpeta del repo):
```bash
supabase login
supabase link --project-ref <proyecto>
supabase secrets set SITE_URL=https://<sitio> MP_CLIENT_ID=... MP_CLIENT_SECRET=... MP_WEBHOOK_SECRET=pendiente \
  MP_OWNER_USER_ID=... CRON_SECRET=<CRON_SECRET> MP_TOKENS_KEY=<MP_TOKENS_KEY> \
  RESEND_API_KEY=<entorno>-funcion EMAIL_FROM="TuTiempo <avisos@tutiempo.com.ar>" EMAIL_REPLY_TO=soporte@tutiempo.com.ar
```
`CRON_SECRET` es la **misma** que cargaste en Vault. **Nunca** cargues `MP_API_URL`, `EMAIL_API_URL` ni `EMAIL_GAP_MS`:
existen solo para las pruebas.
Las claves del proyecto **no** se cargan: Supabase las inyecta en las funciones. Un proyecto nuevo trae las claves
publishable/secret (`SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`) y firma las sesiones con claves asimétricas
(ECC/RSA); uno viejo, `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` y HS256. Las funciones usan las nuevas si están
(H31). En `config.js`, `supabaseAnonKey` es la clave **publishable** (`sb_publishable_…`) o, en un proyecto viejo, la anon.
Si "Conectar Mercado Pago" da `login_required`, el motivo exacto está en Edge Functions → mp-oauth → Logs
(`caller: rechazado (…)`).
Si una función responde 500, el log dice qué consulta falló y por qué (`db: falló …`, por ejemplo `42501 permission
denied`: falta una migración, H32).

**5. Deploy de las 6 funciones:**
```bash
supabase functions deploy mp-create-preference --no-verify-jwt
supabase functions deploy mp-webhook --no-verify-jwt
supabase functions deploy mp-oauth --no-verify-jwt
supabase functions deploy mp-refunds --no-verify-jwt
supabase functions deploy dni-cleanup --no-verify-jwt
supabase functions deploy email-send --no-verify-jwt
```

**6. Base:** `supabase db push` (aplica `supabase/migrations/` en orden; o pegar `supabase/TODO_EN_UNO.sql` en el SQL
Editor). **No** cargues `ejemplos.NO-USAR-EN-PRODUCCION.sql`.

**7. Auth** (Authentication):
- URL Configuration: Site URL = la dirección del sitio; Redirect URLs = la raíz del sitio (`https://<sitio>/`).
- Sign In / Providers → Email y las plantillas: PASO 2 B y C del LEEME.
- SMTP propio de Resend (sección 2b, paso 6), **también en prueba**: el SMTP que trae Supabase solo manda a los
  miembros del equipo del proyecto, así que cualquier otro usuario no recibe el email para activar la cuenta.
- Google: PASO 2 del LEEME, con la dirección de este entorno.
- CAPTCHA (Turnstile): opcional en prueba, **obligatorio en producción**. Seguí "CAPTCHA (Turnstile)" más abajo, en ese
  orden: primero la clave del sitio en `config.js`, después activarlo en Supabase.

**8. Mercado Pago** (la aplicación, Etapa A paso 2.3): Redirect URL `https://<proyecto>.supabase.co/functions/v1/mp-oauth`
y webhook `https://<proyecto>.supabase.co/functions/v1/mp-webhook` (evento Pagos).

**9. Clave del webhook:** copiá la clave secreta del webhook de Mercado Pago y cargala:
`supabase secrets set MP_WEBHOOK_SECRET=<clave>` (las funciones la toman sin volver a hacer el deploy).

**10. Frontend:** `npm ci`, `npm run build`, completar `dist/config.js` (URL y clave `anon`, nunca la `service_role`) y
subir el contenido de `dist/` (con `.htaccess`) a la raíz del sitio (sección 3, pasos 2 a 5).

**11. Admin:** creá tu cuenta desde el sitio y activala con el email (ya llega por Resend). Después, en el SQL Editor:
`insert into app_admins (user_id) select id from auth.users where email = 'TU-EMAIL';`. En el panel admin →
Comisión: **4** y la **Dirección del sitio** (`https://<sitio>`).

**12. Verificaciones** (SQL Editor):
```sql
select jobname, schedule from cron.job order by jobname;
-- 7 tareas: tt-cleanup, tt-dni-cleanup, tt-emails, tt-expire-holds, tt-notices, tt-refunds, tt-reshuffle
select public.run_refunds(); select public.run_dni_cleanup(); select public.run_email_send();
select status_code, content from net._http_response order by created desc limit 3;   -- tres 200
select site_url, commission_pct from app_settings;
```
Un 403 en `net._http_response`: la `CRON_SECRET` de Vault no es igual a la de las funciones. Un 500 con "config": falta
un secreto de esa función. Después, la prueba de punta a punta (sección 4).

## Actualizar un entorno existente
Lo que sigue (Etapa A con sus secciones por bloque, y Etapa B) es el detalle de cada paso y lo que cambia al pasar de un
bloque al siguiente en un entorno que ya estaba armado.

## Etapa A · Entorno de prueba

### 1. Supabase (proyecto de prueba)
1. supabase.com → New project → nombre `tutiempo-prueba`, región São Paulo. El plan gratuito alcanza para probar
   (se pausa tras una semana sin uso; se reactiva desde el panel).
2. Database → Extensions: activar `pg_cron` y `pg_net`.
3. Cargar la base con la CLI (recomendado: `supabase link --project-ref <proyecto-prueba>` y `supabase db push`, que aplica
   `supabase/migrations/` en orden) o pegando `supabase/TODO_EN_UNO.sql` en el SQL Editor.
   Usá siempre la versión del repo **después** de los arreglos de Claude Code.
4. **No** cargues `ejemplos.NO-USAR-EN-PRODUCCION.sql` (es solo para una base local; sin `set tt.ejemplos = 'si'` no
   carga nada): creá 1 o 2 prestadores de prueba propios desde la app.
5. Auth: seguir el PASO 2 del LEEME (URL del subdominio, plantillas de email, Google). El SMTP de Resend (sección 2b) es
   obligatorio también en prueba: el de Supabase solo manda a los miembros del equipo del proyecto.
   En **Redirect URLs** alcanza con la raíz del sitio (`https://prueba.tutiempo.com.ar/`): desde el Bloque B la app siempre
   pide volver a la raíz y recuerda aparte a qué pantalla iba.
6. Admin: `insert into app_admins (user_id) select id from auth.users where email = 'TU-EMAIL';`
7. Panel admin → Comisión → **4**.

### 2. Mercado Pago (modo prueba)
1. developers.mercadopago.com con la cuenta de TuTiempo → crear aplicación Marketplace (Checkout Pro), activar PKCE.
2. Crear **usuarios de prueba**: uno vendedor (hace de prestador) y uno comprador (hace de cliente).
3. Redirect URL: `https://<proyecto-prueba>.supabase.co/functions/v1/mp-oauth`.
   Webhook: `https://<proyecto-prueba>.supabase.co/functions/v1/mp-webhook`, evento Pagos. Copiar la clave secreta.
4. Generar las claves propias de TuTiempo (en tu compu, una vez por entorno; prueba y producción con claves distintas).
   No las guardes en el repo ni en un chat: van directo a `supabase secrets set` y a Vault.
   ```bash
   openssl rand -base64 48   # CRON_SECRET: la clave con la que el cron llama a mp-refunds y dni-cleanup (mínimo 32 caracteres)
   openssl rand -base64 32   # MP_TOKENS_KEY: cifra las llaves de Mercado Pago de cada prestador (exactamente 32 bytes)
   ```
   `MP_OWNER_USER_ID` es el id de usuario de Mercado Pago de la cuenta de TuTiempo (developers.mercadopago.com → Tus
   integraciones → la aplicación → Credenciales, "User ID"; en modo prueba, el de la cuenta dueña de la aplicación).
   `mp-oauth` rechaza conectar esa cuenta como prestador (H12) y, si falta la variable, no conecta ninguna.
5. Desde la carpeta del repo:
   ```bash
   supabase login
   supabase link --project-ref <proyecto-prueba>
   supabase secrets set SITE_URL=https://prueba.tutiempo.com.ar MP_CLIENT_ID=... MP_CLIENT_SECRET=... MP_WEBHOOK_SECRET=... \
     MP_OWNER_USER_ID=... CRON_SECRET=... MP_TOKENS_KEY=...
   supabase functions deploy mp-create-preference --no-verify-jwt
   supabase functions deploy mp-webhook --no-verify-jwt
   supabase functions deploy mp-oauth --no-verify-jwt
   supabase functions deploy mp-refunds --no-verify-jwt
   supabase functions deploy dni-cleanup --no-verify-jwt
   ```
   **Nunca** cargues `MP_API_URL` en Supabase: existe solo para las pruebas (un Mercado Pago falso). Sin ese secreto las
   funciones usan la API real. Si alguna vez aparece en `supabase secrets list`, borralo (`supabase secrets unset MP_API_URL`).
6. Vault (Supabase → SQL Editor). La tarea de devoluciones automáticas lee de acá la dirección del proyecto y la
   `CRON_SECRET` (la **misma** que cargaste en el paso 5). Nada de eso queda escrito en el SQL ni en el repo, y el cron
   ya no usa la `service_role` key: `mp-refunds` solo acepta `CRON_SECRET`.
   ```sql
   select vault.create_secret('https://<proyecto-prueba>.supabase.co', 'tt_project_url');
   select vault.create_secret('<la CRON_SECRET del paso 5>', 'tt_cron_secret');
   ```
   Conviene hacerlo **antes** de la migración `20261025171952_seguridad.sql` (si va después, el cron corre igual pero
   cada 10 minutos deja un aviso "faltan tt_project_url o tt_cron_secret" hasta que los cargues).

#### Orden del despliegue del Bloque 2a (entorno de prueba)
1. Extensiones `pg_cron` y `pg_net` activas (paso 2 de Supabase).
2. Secretos de las funciones (paso 5) y deploy de las 4 funciones. Las funciones nuevas cifran las llaves y funcionan
   con la base anterior; las viejas no funcionan con la base nueva (la base rechaza llaves sin cifrar).
3. Vault (paso 6).
4. Migraciones: `supabase db push` (o `TODO_EN_UNO.sql`). La del Bloque 2a (`20261025171952_seguridad.sql`):
   - arma las tareas programadas `tt-refunds` (cada 10 minutos) y `tt-cleanup` (todos los días a las 3:17 UTC: borra
     intentos de conexión con Mercado Pago de más de 1 día y avisos descartados de más de 180 días);
   - borra `provider_secrets` (sin uso desde el Bloque 1);
   - pasa a "solo devoluciones" las cuentas activas sin id de Mercado Pago (con aviso al prestador) y desde ahí lo exige;
   - rechaza llaves de Mercado Pago sin cifrar.
   La siguiente (`20261025181645_llaves_sin_cifrar.sql`) borra las llaves viejas sin cifrar (las copiadas de
   `provider_secrets` en el Bloque 1; no debería haber, no hay cuentas reales conectadas): quedan en null con
   "Llave sin cifrar: hay que reconectar" en `last_error`, y si la cuenta cobraba pasa a "solo devoluciones" con aviso
   al prestador para que vuelva a conectar. Comprobación: `select count(*) from mp_accounts where access_token !~ '^v[0-9]+:'
   or refresh_token !~ '^v[0-9]+:';` tiene que dar 0.
   Si `pg_cron` o `pg_net` no estaban activos, activalos y volvé a correr la migración (es idempotente).
5. Verificar en el SQL Editor:
   ```sql
   select jobname, schedule, command from cron.job;                                   -- tt-refunds y tt-cleanup
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   select status_code, content from net._http_response order by created desc limit 5;  -- 200 y {"done":…,"failed":…}
   ```
   Un 403 en `net._http_response` es que la `CRON_SECRET` de Vault no es igual a la de las funciones; un 500 con
   "config", que a la función le falta `CRON_SECRET` o tiene menos de 32 caracteres.

#### Bloque 2b (después del 2a)
Una Edge Function nueva (`dni-cleanup`), ningún secreto nuevo (usa la misma `CRON_SECRET` y la `tt_project_url` de
Vault que `mp-refunds`), cinco migraciones y el frontend:
1. Deploy de las funciones (la nueva y `mp-refunds`, que pasa a compartir el control de la clave del cron):
   ```bash
   supabase functions deploy dni-cleanup --no-verify-jwt
   supabase functions deploy mp-refunds --no-verify-jwt
   ```
   Conviene antes de las migraciones: la de retención (`…_dni_retencion.sql`) llama a `dni-cleanup` en cada baja.
2. `supabase db push` (o `TODO_EN_UNO.sql`): `20261025194744_dni.sql`, `20261025200359_cobros_revision.sql`,
   `20261025201554_site_url.sql`, `20261026021720_gastos_fecha_argentina.sql`, `20261026025232_site_url_https.sql` y
   `20261026025356_dni_retencion.sql` y `20261026031955_dni_subida_prestador.sql` (las fotos del DNI las sube solo
   el dueño de un prestador).
   - La de DNI se frena con el error `dni_duplicado` si dos prestadores no eliminados tienen el mismo DNI (no debería
     pasar en el entorno de prueba). Muestra los últimos 3 dígitos y los ids: resolvelo a mano y volvé a correrla.
   - Borra el DNI que haya quedado en los metadatos de las cuentas (`auth.users.raw_user_meta_data`). Una sesión ya
     abierta lo puede tener en su token hasta que se renueve (1 hora).
   - Desde esta migración, **activar a un prestador exige el número de DNI y las dos fotos** (frente y dorso, que el
     prestador sube en su panel, en Perfil; desde el Bloque D, solo con "Exigir DNI para aprobar prestadores" activada, D26). Los prestadores de prueba que crees los tenés que cargar así. Uno ya
     verificado con fecha (suspendido y vuelto a activar) no las necesita.
   - La de la dirección del sitio (`…_site_url_https.sql`) solo acepta `https://` y el dominio. Si la guardada no
     cumple (por ejemplo, con `http://`), la migración sigue y deja el aviso `site_url: …`: cambiala en el paso 3.
   - La de retención (`…_dni_retencion.sql`, D24) arma la tarea `tt-dni-cleanup` (todos los días a las 3:37 UTC) y
     pide el borrado en el momento en cada baja de prestador. La función borra con la API de Storage las fotos de los
     verificados hace 30 días o más, de las altas sin aprobar con la última foto de hace 90 días o más y de las bajas
     (los verificados antes del 2b no tienen fecha de verificación: conservan las fotos hasta que los vuelvas a
     verificar). Si la llamada de una baja falla, la corrida diaria borra esas fotos.
3. Panel admin → Comisión → **Dirección del sitio**: en el entorno de prueba, `https://prueba.tutiempo.com.ar` (con
   ella se arman los links de los avisos; por defecto es `https://tutiempo.com.ar`).
4. Frontend: `npm run build` y subir `dist/` como siempre.
5. Verificar en el SQL Editor:
   ```sql
   select jobname, schedule from cron.job where jobname = 'tt-dni-cleanup';             -- 37 3 * * *
   select public.run_dni_cleanup();                                                     -- la corre ahora
   select status_code, content from net._http_response order by created desc limit 3;  -- 200 y {"files":…,"failed":0}
   ```
   `failed` mayor a 0: el detalle está en los logs de la función (Edge Functions → dni-cleanup → Logs).

#### Rotar la CRON_SECRET
Si se filtró, o una vez por año. Generá una nueva (`openssl rand -base64 48`) y cambiala en los dos lados, uno atrás del
otro:
```bash
supabase secrets set CRON_SECRET=<nueva>
```
```sql
select vault.update_secret((select id from vault.secrets where name = 'tt_cron_secret'), '<nueva>');
```
Entre un paso y el otro, una corrida del cron puede dar 403: no se pierde nada, las devoluciones pendientes salen en la
corrida siguiente (10 minutos).

#### Rotar la clave de las llaves de Mercado Pago (MP_TOKENS_KEY)
Las funciones leen las llaves con cualquier versión cargada y escriben siempre con la más nueva. Cada llave guardada
dice con qué versión se cifró (`v1:…`, `v2:…`).
1. Generá la nueva (`openssl rand -base64 32`) y cargala **sin borrar la anterior**:
   `supabase secrets set MP_TOKENS_KEY_V2=<nueva>` (la siguiente vez, `MP_TOKENS_KEY_V3`, y así hasta la 9).
   Desde ese momento las llaves nuevas o renovadas se guardan con v2; las otras se siguen leyendo con v1.
2. La anterior se puede borrar recién cuando ninguna llave la usa (incluye las cuentas desconectadas, que se guardan
   hasta 180 días después del último pago para poder devolver):
   ```sql
   select count(*) from mp_accounts where access_token like 'v1:%' or refresh_token like 'v1:%';   -- tiene que dar 0
   ```
   Con 0, `supabase secrets unset MP_TOKENS_KEY`. Si borrás una clave que todavía se usa, esas cuentas no se pueden
   descifrar: no cobran ni devuelven y queda el error en el log y en la cuenta (`last_error`), pero no se desactivan;
   volver a cargar la clave las arregla.
3. Si la clave se filtró: cargá la nueva como en el paso 1, borrá la vieja enseguida y pedile a cada prestador con
   cuentas cifradas con ella que vuelva a conectar Mercado Pago (Perfil → Cobros). Las devoluciones de esas cuentas
   quedan pendientes hasta que reconecten la misma cuenta.

### 2b. Emails con Resend (Bloque 3, D14)
Resend manda los avisos de los turnos por email (la Edge Function `email-send`) y hace de SMTP de Supabase Auth (activar
la cuenta, recuperar la contraseña). Un solo dominio para los dos entornos; claves distintas por entorno y por uso.
1. **Cuenta.** resend.com → crear la cuenta con un email de TuTiempo (no uno personal). El plan gratis alcanza para la
   prueba (3.000 emails por mes, 100 por día); para producción, el plan Pro (sin tope diario). Verificá los precios
   en resend.com/pricing.
2. **Dominio.** Domains → Add Domain → `tutiempo.com.ar`, región **São Paulo (sa-east-1)**. Resend muestra los
   registros DNS que hay que cargar.
3. **Registros DNS en Hostinger.** hPanel → Dominios → `tutiempo.com.ar` → DNS / Nameservers → Administrar registros
   DNS. Antes, fijate que los nameservers sean los de Hostinger (si apuntan a otro lado, como Cloudflare, los registros
   van ahí). Copiá los valores **exactos** que muestra Resend; quedan así:

   | Tipo | Nombre (en Hostinger) | Valor | Prioridad |
   |---|---|---|---|
   | TXT | `resend._domainkey` | `p=MIGf…` (la clave DKIM que da Resend) | |
   | MX | `send` | `feedback-smtp.sa-east-1.amazonses.com` (el de la región elegida) | 10 |
   | TXT | `send` | `v=spf1 include:amazonses.com ~all` | |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:soporte@tutiempo.com.ar` (solo si no hay uno) | |

   - Hostinger completa el dominio: en Nombre va `send`, no `send.tutiempo.com.ar`.
   - **No toques** los MX ni el SPF de la raíz (`@`): son del correo actual y del sitio Laravel. Los de Resend van en
     el subdominio `send` y no los pisan.
   - Si ya existe un `_dmarc`, no agregues otro.
   - Después: Resend → Domains → Verify. Suele tardar minutos (hasta 48 h). Si dice "region-mismatch", el MX no es el
     de la región del dominio.
   - `soporte@tutiempo.com.ar` tiene que existir (casilla o reenvío en Hostinger → Emails): ahí llegan las respuestas.
4. **Dos claves por entorno.** API Keys → Create API Key, con permiso **Sending access** y solo el dominio
   `tutiempo.com.ar`. Cada una se ve una sola vez: pegala directo donde va (nunca en el repo ni en un chat).
   - `prueba-funcion` → secreto `RESEND_API_KEY` de la función (paso 5).
   - `prueba-auth` → contraseña del SMTP de Auth (paso 6).
   Separadas, se revoca una sin cortar la otra. Para producción, otras dos (`prod-funcion`, `prod-auth`).
5. **La función.** Desde la carpeta del repo:
   ```bash
   supabase secrets set RESEND_API_KEY=<prueba-funcion> EMAIL_FROM="TuTiempo <avisos@tutiempo.com.ar>" \
     EMAIL_REPLY_TO=soporte@tutiempo.com.ar
   supabase functions deploy email-send --no-verify-jwt
   ```
   Usa la misma `CRON_SECRET` y la misma `tt_project_url` de Vault que `mp-refunds` (paso 6 de Mercado Pago): no hay
   que cargar nada más en Vault. **Nunca** cargues `EMAIL_API_URL` ni `EMAIL_GAP_MS`: son solo para las pruebas.
6. **SMTP de Auth.** Supabase → Authentication → Emails → SMTP Settings → Enable Custom SMTP:
   - Sender email `avisos@tutiempo.com.ar`, Sender name `TuTiempo`.
   - Host `smtp.resend.com`, Port `465`, Username `resend`, Password: la clave `prueba-auth`.
   - Authentication → Rate Limits: con SMTP propio, Supabase arranca en 30 emails de Auth por hora; subilo si hace falta.
   Las plantillas de los emails de Auth (PASO 2 del LEEME) siguen igual.
7. **Verificar.**
   - Crear una cuenta: el email de activación llega desde `avisos@tutiempo.com.ar`.
   - Reservar un turno con esa cuenta: en 5 minutos como mucho llega la confirmación por email.
   - En el SQL Editor:
     ```sql
     select kind, status, skip_reason, attempts, last_error from email_outbox order by id desc limit 10;
     select status_code, content from net._http_response order by created desc limit 3;  -- 200 y {"sent":…,"failed":0}
     ```
   - `skip_reason`: `opt_out` (un recordatorio, reseña o cumpleaños de un cliente que apagó "Recordatorios y novedades
     por email"), `no_email` (email sin confirmar), `stale` (el turno ya empezó o ya no está confirmado).
   - `last_error` con 403 de Resend: la clave no sirve o el dominio no está verificado. Un 403 en `net._http_response`:
     la `CRON_SECRET` de Vault no es igual a la de las funciones. Un 500 con "config": falta `RESEND_API_KEY` o `EMAIL_FROM`.
   - En Resend → Emails se ve cada envío, entrega o rebote.

#### Bloque 3 (después del 2b)
1. Resend: pasos 1 a 6 de arriba (la función, con sus secretos, antes de la migración).
2. `supabase db push` (o `TODO_EN_UNO.sql`): `20261026033854_emails.sql`. Arma la tarea `tt-emails` (cada 5 minutos).
   Los avisos que ya existían no se mandan: solo los nuevos.
3. Frontend: `npm run build` y subir `dist/` (Mi perfil → Avisos por email).
4. Verificar (paso 7) y `select jobname, schedule from cron.job where jobname = 'tt-emails';` → `*/5 * * * *`.

#### Bloque D (después del Bloque 3)
1. `supabase db push` (o `TODO_EN_UNO.sql`): `20261028120000_exigir_dni.sql` (D26). Agrega la opción "Exigir DNI para
   aprobar prestadores", activada: todo sigue como hasta ahora. No cambia datos ni las Edge Functions (no hay que volver
   a desplegar ninguna).
2. Frontend: `npm run build` y subir `dist/` (pantallas de la compu, menú de cuenta, registro e ingreso, alta sin DNI).
3. Verificar: panel admin → Comisión → **Verificación**, con "Exigir DNI para aprobar prestadores" activada. Si TuTiempo
   decide no pedir más el DNI, se apaga ahí: el alta y el panel dejan de pedirlo y el admin aprueba solo con los datos.

#### Bloque C (después del Bloque D): app instalable y notificaciones push (D27)
Claves VAPID **distintas** para prueba y para producción. No se rotan salvo que se filtren: cambiarlas anula todas las
suscripciones y cada persona tiene que volver a tocar "Activar avisos".
1. **Claves VAPID.** En tu compu, en la carpeta del repo: `npm run vapid`. Muestra la clave pública, la privada y el
   comando de Supabase ya armado. No guarda nada en disco; copiá la privada directo al paso 2 y no la pegues en ningún
   otro lado.
2. **Secretos de Supabase** (con el proyecto vinculado):
   `supabase secrets set VAPID_PUBLIC_KEY=<pública> VAPID_PRIVATE_KEY=<privada> VAPID_SUBJECT=mailto:contacto@tutiempo.com.ar`
   (`VAPID_SUBJECT` es el contacto que ven Google, Apple y Mozilla si hay un problema con los envíos).
3. **Migración:** `supabase db push` (o `TODO_EN_UNO.sql`): `20261028160000_push.sql`. Crea `push_subscriptions` y
   `push_outbox`, las opciones de Mi perfil y del panel, los triggers y la tarea `tt-push` (cada minuto). Usa los mismos
   `tt_project_url` y `tt_cron_secret` de Vault que los emails (Bloque 2a): no hay que crear nada nuevo en Vault.
4. **Función:** `supabase functions deploy push-send --no-verify-jwt` (como `email-send`: solo acepta `CRON_SECRET`).
5. **`config.js`** del sitio: `vapidPublicKey: "<pública>"`. Sin esa clave la app se instala igual pero no ofrece avisos.
6. **Frontend:** `npm run build` y subir `dist/`, que ahora incluye `sw.js`, `manifest.webmanifest`, `offline.html`,
   `offline.js` e `icons/`. Todo en la raíz del sitio, como siempre (el `.htaccess` ya trae los encabezados).
7. **Verificar en Supabase:** `select jobname, schedule from cron.job where jobname = 'tt-push';` → `* * * * *`. En
   Edge Functions → push-send → Logs, cada corrida dice cuántas salieron. Si el log dice "rechazó la firma VAPID (401 o
   403)", `VAPID_PUBLIC_KEY` (secreto) y `vapidPublicKey` (`config.js`) son de pares distintos.
8. **Probar en celulares reales** (abajo, "Notificaciones en un celular real").

**Freno de emergencia:** si el service worker diera problemas, `serviceWorker: false` en `config.js` lo desinstala en
todos los navegadores la próxima vez que abran la app (y borra su caché), sin publicar código. Para volver, sacás esa línea.

#### Notificaciones en un celular real (entorno de prueba)
Hace falta el sitio en HTTPS (el subdominio de prueba ya lo tiene), los pasos de arriba hechos y dos cuentas: una de
cliente y la del prestador de prueba (con Mercado Pago de prueba conectado).

Los avisos le llegan a un dispositivo desde que activa las notificaciones: lo que pasó antes (por ejemplo, la confirmación
del turno que acabás de reservar) no se manda de nuevo. Los recordatorios salen cada 10 minutos (`tt-notices`): el de 2 h,
si el turno se reservó más de 2 h antes; el de 24 h, si se reservó más de 24 h antes.

**Android (Chrome):**
1. Abrí `https://prueba.tutiempo.com.ar` en Chrome, ingresá como cliente y reservá un turno (pagá con el comprador de prueba).
2. En "¡Listo! Tenés turno" aparece "¿Te avisamos antes del turno?": tocá **Activar avisos** y aceptá el permiso de
   Chrome. Mi perfil → Notificaciones tiene que decir "Activadas".
3. Reservá otro turno para dentro de unas **2 h 30 min** (con más de 2 h de anticipación): enseguida llega **"Turno confirmado"** (probalo también con el
   celular bloqueado). Tocala: abre la app en ese turno.
4. Dejá pasar el tiempo hasta que falten menos de 2 h: en los 10 minutos siguientes llega el **recordatorio de 2 h**.
5. Mi perfil → apagá "Recordatorios y novedades por notificación" y repetí los pasos 3 y 4 con otro turno: la
   confirmación llega, el recordatorio no. Volvé a prenderla.
6. Menú de cuenta → **Instalar la app** (o la tarjeta "Instalá TuTiempo para tener tus turnos a mano", que sale una sola vez): queda el ícono en la pantalla de inicio. Abrila
   desde ahí: se abre sin la barra del navegador.
7. Con el prestador de prueba (otro celular, o el mismo en otro navegador): Panel → Agenda → tarjeta "Enterate al toque
   de cada reserva" → **Activar avisos**. Desde la cuenta de cliente, reservá para mañana o más adelante: le llega **"Nueva reserva"** con el nombre
   de pila del cliente; cancelá ese turno desde Mis turnos: le llega **"Se canceló una reserva"**. Mi perfil del
   prestador → apagá "Nuevas reservas y cancelaciones de clientes" y repetí: no llega nada.
8. Modo avión y abrí la app instalada: tiene que aparecer **"Sin conexión"**. Sacá el modo avión: se recarga sola.
9. Cerrá sesión en el celular y, desde la compu con la misma cuenta, reservá: al celular ya no le llega nada.

**iPhone (Safari, iOS 16.4 o más nuevo):**
1. Abrí el sitio en **Safari** (no en el navegador de Instagram ni de WhatsApp) e ingresá como cliente.
2. Mi perfil → Notificaciones: dice que en el iPhone funcionan con la app agregada a inicio, con los 3 pasos.
3. Tocá **Compartir** (el cuadrado con la flecha) → **Agregar a inicio** → **Agregar**.
4. Abrí TuTiempo **desde el ícono** (no desde Safari) e ingresá de nuevo (la app instalada tiene su propia sesión).
5. Mi perfil → **Activar avisos** → **Permitir**.
6. Seguí desde el paso 3 de Android (confirmación, recordatorio, opción, prestador, modo avión, cerrar sesión). El paso 6
   no hace falta: ya está agregada a inicio.

Si en algún celular no llega nada: Edge Functions → push-send → Logs (el código de cada envío y el servicio) y la tabla
`push_outbox` (`last_status`, `last_error`). 410 o 404 quiere decir que ese dispositivo se dio de baja: se borra solo.

### 3. Hostinger (subdominio de prueba)
1. hPanel → Dominios → Subdominios → crear `prueba.tutiempo.com.ar`. Activar SSL.
2. En tu compu (Node 22, ver `.nvmrc`): `npm ci` y `npm run build` → carpeta `dist/`.
3. Editar `dist/config.js` con la URL y la clave `anon` del proyecto de prueba (nunca la `service_role`).
   El build no lo pisa: solo lo crea (desde `config.example.js`) si no existe. Sin `config.js` completo, el sitio
   muestra "Falta configurar el sitio" (la demo no viaja en el build de producción).
4. Subir **el contenido** de `dist/` a la carpeta del subdominio, incluido `.htaccess` (archivo oculto) y la carpeta `assets/`.
   **El sitio va siempre en la raíz de su dominio o subdominio** (`https://prueba.tutiempo.com.ar/`), nunca en una
   subcarpeta: desde el Bloque B cada pantalla tiene su dirección (`/panel/agenda`, `/<slug>`…) y el `.htaccess` manda a
   `index.html` todo pedido sin extensión que no sea un archivo. Los archivos con extensión que no existen dan 404.
5. Para que Google no indexe la prueba: en ese subdominio, `robots.txt` con `Disallow: /`.

### 4. Prueba de punta a punta (checklist)
- [ ] Direcciones en Hostinger (LiteSpeed lee el `.htaccess`, pero el CI lo prueba con Apache): abrir
      `https://prueba.tutiempo.com.ar/panel/agenda` directo (pide ingresar y vuelve a la agenda), recargar el perfil de
      un prestador (`/<slug>`), abrir un `.js` que no existe (`/assets/no-existe.js` tiene que dar 404, no la app) y
      verificar que en Supabase → Auth → URL Configuration → Redirect URLs esté la raíz del subdominio
      (`https://prueba.tutiempo.com.ar/`).
- [ ] Crear cuenta, activar por email, ingresar, recuperar contraseña, entrar con Google.
- [ ] Alta de prestador (sin DNI), confirmar el email: la app abre Panel → Perfil con los 3 pasos. Cargar el número de
      DNI y las fotos del frente y del dorso, aprobarlo desde el panel admin (sin el número o sin una foto no deja: H10),
      conectar Mercado Pago (vendedor de prueba).
- [ ] Un recordatorio o aviso de cancelación trae el link del subdominio de prueba (Comisión → Dirección del sitio, H24).
- [ ] Reservar y pagar con el comprador de prueba: el turno se confirma solo (verifica H06: firma del webhook).
- [ ] La seña llega al vendedor de prueba y el 4% a la cuenta de TuTiempo.
- [ ] Pago rechazado: el horario se libera.
- [ ] Abandonar el pago: a los 10 minutos el horario se libera.
- [ ] El prestador cancela un turno pagado: devolución total en Mercado Pago.
- [ ] Casos de los errores H01 y H02 (Bloque 1): pagar una reserva vencida cuyo horario ya tomó otro, y pagar una
      reserva que el prestador canceló mientras el cliente estaba en Mercado Pago. Las dos terminan en devolución
      (ver `refunds` y el panel admin), no en limbo.
- [ ] Desconectar Mercado Pago desde el panel: el perfil público dice "Todavía no toma turnos online", una cancelación
      de un turno ya pagado se devuelve igual, y reconectar la misma cuenta vuelve a cobrar.
- [ ] Devolver un pago desde el panel de Mercado Pago del vendedor de prueba: el turno queda cancelado
      ("Pago devuelto por Mercado Pago") y al prestador le llega el aviso.
- [ ] Emails (Bloque 3): llegan la confirmación, el recordatorio de 24 h y una cancelación, con el mismo texto que en Mis
      turnos y desde `avisos@tutiempo.com.ar`; responder llega a `soporte@`; el pie lleva a Mi perfil ("Dejar de recibir
      estos emails" en el recordatorio; "Recordatorios y novedades: Mi perfil" en la confirmación y la cancelación). Con "Recordatorios y novedades por email" apagada no llegan los recordatorios, la reseña ni el
      cumpleaños, pero la confirmación y las cancelaciones sí (y todos los avisos siguen en Mis turnos).
- [ ] Sellos: marcar "Asistió" suma sello; canjear el premio.

### CAPTCHA (Turnstile, H30)
Protege crear cuenta, ingresar, pedir código, reenviar y recuperar contraseña (el ingreso con Google no lo usa). Un
widget por entorno: uno para el de prueba y otro para producción.
1. Cloudflare (cuenta gratuita) → **Turnstile** → **Add widget**: nombre (por ejemplo `TuTiempo prueba`), hostname del
   sitio (`prueba.tutiempo.com.ar`; en producción `tutiempo.com.ar`), modo **Managed**. Te da una **Site Key** (pública)
   y una **Secret Key** (privada).
2. `config.js` del sitio (en Hostinger): `turnstileSiteKey: "<Site Key>"`. Subilo y abrí `/ingresar`: tiene que andar
   igual que siempre. Mientras Supabase no lo exija, el token viaja y nadie lo mira.
3. Supabase → Authentication → **Attack Protection** → **Enable Captcha protection** → proveedor **Turnstile** → pegá la
   **Secret Key** → Save. La Secret Key va solo ahí: nunca en `config.js` ni en el repo.
4. Verificá crear cuenta, ingresar con contraseña y con código, recuperar contraseña y el ingreso de prestadores. Si
   algo falla, primero apagá el CAPTCHA en Supabase (paso 3, al instante) y después revisá.
Para sacarlo, el orden inverso: primero apagarlo en Supabase, después borrar la clave de `config.js`. Con el CAPTCHA
prendido en Supabase y sin la clave en `config.js`, nadie puede ingresar.

## Etapa B · Producción
1. Supabase: proyecto nuevo `tutiempo` en plan **Pro** (backups diarios). Mismos pasos 1 a 7.
2. Auth: SMTP propio (Resend, D14: paso 2b con las claves `prod-funcion` y `prod-auth`) y Google con el dominio
   definitivo. CAPTCHA (Turnstile): **activalo**, con un widget propio de producción (hostname
   `tutiempo.com.ar`), siguiendo "CAPTCHA (Turnstile)" en orden.
3. Mercado Pago: credenciales de producción de la misma aplicación; nueva clave de webhook; `MP_OWNER_USER_ID` de la
   cuenta real de TuTiempo; `CRON_SECRET` y `MP_TOKENS_KEY` **nuevas** (no las del entorno de prueba);
   `supabase secrets set` en el proyecto de producción (con los de Resend), deploy de las 6 funciones y Vault. Para un
   proyecto nuevo, seguí "Instalación desde cero".
   Notificaciones push: claves VAPID **nuevas** de producción (`npm run vapid`), los tres secretos `VAPID_*`, deploy de
   `push-send` y `vapidPublicKey` en el `config.js` de producción (Bloque C, pasos 1 a 7).
4. Textos legales revisados por abogado (D13).
5. Hostinger: subdominio definitivo o reemplazo de la raíz según D12. Antes de tocar la raíz: backup completo del Laravel.
6. Primera compra real chica con tu propia tarjeta y devolución desde el panel.

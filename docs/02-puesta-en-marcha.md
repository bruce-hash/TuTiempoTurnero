# Puesta en marcha (lo que hace Bruno a mano)

Dos entornos: **prueba** (subdominio, Mercado Pago de prueba) y **producción**. Nada se sube a producción hasta que
Claude Code termine los bloques 1 y 2 y la prueba con Mercado Pago salga bien.

> Ojo: hoy `tutiempo.com.ar` (raíz de `public_html` en Hostinger) es el sitio Laravel con usuarios reales.
> **No subas nada ahí.** Todo va a un subdominio hasta decidir el reemplazo (D12).

Las instrucciones del `LEEME-cliente-v31.txt` sirven, con las correcciones marcadas acá.

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
5. Auth: seguir el PASO 2 del LEEME (URL del subdominio, plantillas de email, Google). Para prueba alcanza el email de Supabase.
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
   supabase functions deploy mp-create-preference
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
   `20261026025356_dni_retencion.sql`.
   - La de DNI se frena con el error `dni_duplicado` si dos prestadores no eliminados tienen el mismo DNI (no debería
     pasar en el entorno de prueba). Muestra los últimos 3 dígitos y los ids: resolvelo a mano y volvé a correrla.
   - Borra el DNI que haya quedado en los metadatos de las cuentas (`auth.users.raw_user_meta_data`). Una sesión ya
     abierta lo puede tener en su token hasta que se renueve (1 hora).
   - Desde esta migración, **activar a un prestador exige el número de DNI y las dos fotos** (frente y dorso, que el
     prestador sube en Perfil → Verificación). Los prestadores de prueba que crees los tenés que cargar así. Uno ya
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
- [ ] Alta de prestador, cargar el número de DNI y las fotos del frente y del dorso (Perfil → Verificación), aprobarlo
      desde el panel admin (sin el número o sin una foto no deja: H10), conectar Mercado Pago (vendedor de prueba).
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
- [ ] Recordatorio por email 24 h antes (bloque 3).
- [ ] Sellos: marcar "Asistió" suma sello; canjear el premio.

## Etapa B · Producción
1. Supabase: proyecto nuevo `tutiempo` en plan **Pro** (backups diarios). Mismos pasos 1 a 7.
2. Auth: SMTP propio (Resend o Brevo, D14) y Google con el dominio definitivo. CAPTCHA (Turnstile) activado.
3. Mercado Pago: credenciales de producción de la misma aplicación; nueva clave de webhook; `MP_OWNER_USER_ID` de la
   cuenta real de TuTiempo; `CRON_SECRET` y `MP_TOKENS_KEY` **nuevas** (no las del entorno de prueba);
   `supabase secrets set` en el proyecto de producción, deploy de las 4 funciones y Vault (pasos 4 a 6 de Mercado Pago).
4. Textos legales revisados por abogado (D13).
5. Hostinger: subdominio definitivo o reemplazo de la raíz según D12. Antes de tocar la raíz: backup completo del Laravel.
6. Primera compra real chica con tu propia tarjeta y devolución desde el panel.

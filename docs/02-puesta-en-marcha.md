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
4. **No** cargues `ejemplos.NO-USAR-EN-PRODUCCION.sql`: creá 1 o 2 prestadores de prueba propios desde la app.
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
4. Desde la carpeta del repo:
   ```bash
   supabase login
   supabase link --project-ref <proyecto-prueba>
   supabase secrets set SITE_URL=https://prueba.tutiempo.com.ar MP_CLIENT_ID=... MP_CLIENT_SECRET=... MP_WEBHOOK_SECRET=... MP_OWNER_USER_ID=...
   supabase functions deploy mp-create-preference
   supabase functions deploy mp-webhook --no-verify-jwt
   supabase functions deploy mp-oauth --no-verify-jwt
   supabase functions deploy mp-refunds --no-verify-jwt
   ```
   (`MP_OWNER_USER_ID` lo agrega Claude Code en el bloque 2: id de usuario de Mercado Pago de TuTiempo.)
   **Nunca** cargues `MP_API_URL` en Supabase: existe solo para las pruebas (un Mercado Pago falso). Sin ese secreto las
   funciones usan la API real. Si alguna vez aparece en `supabase secrets list`, borralo (`supabase secrets unset MP_API_URL`).
   Bloque 1: las 4 funciones cambian juntas con las migraciones `20261023215124_cobros.sql`,
   `20261024043027_cobros_ajustes.sql` y `20261024142729_cancelar_con_pago_bloqueado.sql` (llaves en `mp_accounts`,
   pagos en `payments`): primero las migraciones, después
   el deploy de las 4. **Hasta terminar el Bloque 2 esto va solo al entorno de prueba:** las devoluciones automáticas
   dependen del cron de `mp-refunds` con la clave en Vault (H13). Las llaves que ya estuvieran en
   `provider_secrets` se copian solas a `mp_accounts`; `provider_secrets` queda sin uso hasta el Bloque 2 (D21).
5. Tarea de devoluciones: la deja armada Claude Code usando Vault (no pegues la `service_role` key en el cron).

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
- [ ] Alta de prestador, subir DNI, aprobarlo desde el panel admin, conectar Mercado Pago (vendedor de prueba).
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
3. Mercado Pago: credenciales de producción de la misma aplicación; nueva clave de webhook; `supabase secrets set` en el proyecto de producción y deploy de las 4 funciones.
4. Textos legales revisados por abogado (D13).
5. Hostinger: subdominio definitivo o reemplazo de la raíz según D12. Antes de tocar la raíz: backup completo del Laravel.
6. Primera compra real chica con tu propia tarjeta y devolución desde el panel.

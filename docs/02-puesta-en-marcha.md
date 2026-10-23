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
5. Tarea de devoluciones: la deja armada Claude Code usando Vault (no pegues la `service_role` key en el cron).

### 3. Hostinger (subdominio de prueba)
1. hPanel → Dominios → Subdominios → crear `prueba.tutiempo.com.ar`. Activar SSL.
2. En tu compu (Node 22, ver `.nvmrc`): `npm ci` y `npm run build` → carpeta `dist/`.
3. Editar `dist/config.js` con la URL y la clave `anon` del proyecto de prueba (nunca la `service_role`).
   El build no lo pisa: solo lo crea (desde `config.example.js`) si no existe. Sin `config.js` completo, el sitio
   muestra "Falta configurar el sitio" (la demo no viaja en el build de producción).
4. Subir **el contenido** de `dist/` a la carpeta del subdominio, incluido `.htaccess` (archivo oculto) y la carpeta `assets/`.
5. Para que Google no indexe la prueba: en ese subdominio, `robots.txt` con `Disallow: /`.

### 4. Prueba de punta a punta (checklist)
- [ ] Crear cuenta, activar por email, ingresar, recuperar contraseña, entrar con Google.
- [ ] Alta de prestador, subir DNI, aprobarlo desde el panel admin, conectar Mercado Pago (vendedor de prueba).
- [ ] Reservar y pagar con el comprador de prueba: el turno se confirma solo (verifica H06: firma del webhook).
- [ ] La seña llega al vendedor de prueba y el 4% a la cuenta de TuTiempo.
- [ ] Pago rechazado: el horario se libera.
- [ ] Abandonar el pago: a los 10 minutos el horario se libera.
- [ ] El prestador cancela un turno pagado: devolución total en Mercado Pago.
- [ ] Casos de los errores H01 y H02 (los arma Claude Code en el bloque 1): termina en devolución, no en limbo.
- [ ] Recordatorio por email 24 h antes (bloque 3).
- [ ] Sellos: marcar "Asistió" suma sello; canjear el premio.

## Etapa B · Producción
1. Supabase: proyecto nuevo `tutiempo` en plan **Pro** (backups diarios). Mismos pasos 1 a 7.
2. Auth: SMTP propio (Resend o Brevo, D14) y Google con el dominio definitivo. CAPTCHA (Turnstile) activado.
3. Mercado Pago: credenciales de producción de la misma aplicación; nueva clave de webhook; `supabase secrets set` en el proyecto de producción y deploy de las 4 funciones.
4. Textos legales revisados por abogado (D13).
5. Hostinger: subdominio definitivo o reemplazo de la raíz según D12. Antes de tocar la raíz: backup completo del Laravel.
6. Primera compra real chica con tu propia tarjeta y devolución desde el panel.

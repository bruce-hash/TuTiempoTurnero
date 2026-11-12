# Día del cambio: de prueba.tutiempo.com.ar a tutiempo.com.ar

La app pasa a la raíz de `tutiempo.com.ar` (reemplaza al Laravel) con el **mismo proyecto de Supabase** que se usaba
para prueba. Decisiones: D11, D12, D13 y D47 en `docs/01-decisiones.md`.

Los comandos son de **PowerShell** en Windows, desde la carpeta del repo. Se usa `curl.exe` y no `curl`: en PowerShell
`curl` es otro comando. Donde dice `<ref>` va el ref del proyecto de Supabase: el `xxxx` de `https://xxxx.supabase.co`.

**No pegues ninguna clave en un chat.** Las claves nuevas se generan en tu compu, se copian al portapapeles y se pegan
directo en el panel que corresponde.

Orden del día (cada paso, más abajo):

| # | Qué | Dónde | Se puede volver atrás |
| --- | --- | --- | --- |
| 0 | Mergear los PR y pasar `developer` a `main` | GitHub | sí |
| 1 | **Backup de la base** | PowerShell | — |
| 2 | Migraciones y Edge Functions al día | PowerShell | sí (backup) |
| 3 | Rotar claves | PowerShell, Supabase, Mercado Pago | sí |
| 4 | Limpieza de datos de prueba | SQL Editor | solo con el backup |
| 5 | Supabase: Auth, `SITE_URL`, plantillas, CAPTCHA | Supabase | sí |
| 6 | Armar `dist/` con el `config.js` de producción | PowerShell | sí |
| 7 | Hostinger: backup del Laravel, subir la app, redirigir prueba | hPanel | **sí, en minutos** (plan de vuelta atrás) |
| 8 | En la app (admin): Dirección del sitio y comisión 4% | la app | sí |
| 9 | Google, Mercado Pago, Resend, apagar lo de prueba en GitHub | cada panel | sí |
| 10 | Verificación | la app y PowerShell | — |
| 11 | Avisar a los usuarios de prueba | WhatsApp o email | — |

---

## 0. Antes de empezar

1. GitHub: mergeá en `developer` el PR de producción (este) y el de las pruebas de avisos (#100). Esperá el CI en verde.
2. GitHub → Pull requests → New → base `main` ← compare `developer` → Create → Merge. `main` es lo que va a producción.
3. En tu compu:
   ```powershell
   cd C:\ruta\al\repo\TuTiempoTurnero
   git checkout main
   git pull
   node --version   # tiene que decir v22.x (ver .nvmrc)
   npm ci
   npx supabase --version   # la CLI de Supabase; si no la tenés instalada, npx la baja sola
   ```
   Más abajo dice `supabase …`: si no la instalaste aparte, escribí `npx supabase …`.
4. Tené a mano:
   - la contraseña **actual** de la base (Supabase → Project Settings → Database);
   - acceso a hPanel (Hostinger), Mercado Pago Developers, Google Cloud, Cloudflare y Resend.

---

## 1. PRIMERO: backup de la base

Hasta que el proyecto pase a **Pro** no hay backups automáticos. Este backup es el que permite deshacer la limpieza.

1. Supabase → botón **Connect** (arriba) → **Session pooler** → copiá la cadena (`postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`).
   Reemplazá `[YOUR-PASSWORD]` por la contraseña. Si la contraseña tiene caracteres como `@ : / ? # %`, escribilos codificados
   (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `?` → `%3F`, `#` → `%23`, `%` → `%25`).
2. La CLI hace el backup con Docker: abrí **Docker Desktop** y esperá a que diga «Engine running».
3. En PowerShell:
   ```powershell
   $db = Read-Host "Cadena del Session pooler (con la contraseña)"
   $fecha = Get-Date -Format "yyyyMMdd-HHmm"
   $dir = "C:\TuTiempo\backups\$fecha"
   New-Item -ItemType Directory -Force $dir | Out-Null
   supabase db dump --db-url "$db" -f "$dir\roles.sql" --role-only
   supabase db dump --db-url "$db" -f "$dir\schema.sql"
   supabase db dump --db-url "$db" -f "$dir\data.sql" --use-copy --data-only
   Get-ChildItem $dir | Format-Table Name, Length
   ```
   Los tres archivos tienen que pesar más de 0. `data.sql` tiene también las cuentas (`auth.users`).
4. **Si no tenés Docker**, hacé lo mismo con `pg_dump`: instalá *PostgreSQL 17 → Command Line Tools* desde
   postgresql.org/download/windows (solo esa parte) y corré:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" --dbname="$db" -Fc --no-owner -f "$dir\tutiempo-$fecha.dump"
   ```
5. Copiá la carpeta `C:\TuTiempo\backups\$fecha` a un lugar fuera de la compu (Drive o un pendrive). No la subas al repo.
6. Las **fotos** (Storage) no van en el backup de la base. Las de las cuentas que se conservan no se tocan hoy.

**Hasta que pasen a Pro**, repetí los pasos 3 y 5 todos los días y antes de cualquier cambio en la base (abrís
PowerShell, pegás el bloque del paso 3 y listo: cada vez crea una carpeta con la fecha y la hora). Con Pro, Supabase hace
uno por día solo (Database → Backups), y este paso deja de hacer falta.

**Cómo se vuelve a cargar** (solo si hiciera falta, por ejemplo si la limpieza borró algo que no tenía que borrar):
pedime el paso a paso con el nombre de la carpeta. Se carga con `psql` en un proyecto nuevo, o en el mismo después de
vaciarlo. No lo hagas sin revisarlo antes.

---

## 2. Migraciones y Edge Functions al día

Desde el 12/11 «Desplegar prueba» está apagado: esto se hace a mano.

```powershell
supabase login
supabase link --project-ref <ref>        # pide la contraseña de la base (la actual)
supabase migration list                   # columnas Local y Remote: las que tienen Local y no Remote son las que faltan
supabase db push                          # aplica solo las que faltan (son idempotentes); confirmá con "y"
```

Edge Functions, todas, desde `main`:

```powershell
foreach ($f in "mp-oauth","mp-create-preference","mp-webhook","mp-refunds","mp-reconcile","dni-cleanup","email-send","push-send","holidays-sync") {
  supabase functions deploy $f --no-verify-jwt
}
supabase secrets list   # NO tienen que aparecer MP_API_URL, EMAIL_API_URL, EMAIL_GAP_MS, HOLIDAYS_API_URL, HOLIDAYS_ICS_URL ni PUSH_TEST_ORIGINS
```

Si aparece alguno de esos (son solo para pruebas): `supabase secrets unset NOMBRE`.

---

## 3. Rotar claves

Todas se generan en tu compu. El bloque de abajo crea una clave al azar y la copia al portapapeles sin mostrarla.
Funciona en Windows PowerShell 5 y en PowerShell 7.

```powershell
function Nueva-Clave([int]$bytes) {
  $b = New-Object byte[] $bytes
  (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b)
  [Convert]::ToBase64String($b)
}
```

### 3.1 CRON_SECRET (secreto de las funciones + Vault)

Va en los dos lados, uno atrás del otro. Entre uno y otro, una corrida del cron puede dar 403: no se pierde nada.

```powershell
$cron = Nueva-Clave 48
supabase secrets set "CRON_SECRET=$cron"
$cron | Set-Clipboard
```

Enseguida, en Supabase → SQL Editor, pegá esto y reemplazá `PEGAR` con Ctrl+V:

```sql
select vault.update_secret((select id from vault.secrets where name = 'tt_cron_secret'), 'PEGAR');
```

Borrá el portapapeles (`Set-Clipboard -Value " "`) y la consulta del SQL Editor (no la guardes). Control, a los 10 minutos:

```sql
select status_code, created from net._http_response order by created desc limit 5;   -- 200, no 403
```

### 3.2 MP_TOKENS_KEY (las cuentas que se conservan reconectan Mercado Pago)

La clave vieja se borra enseguida. Las conexiones de Mercado Pago guardadas con ella dejan de servir: después del cambio,
cada cuenta que se conserva entra a su panel → **Perfil → Cobros con Mercado Pago → Conectar** (paso 10).

```powershell
$k = Nueva-Clave 32
supabase secrets set "MP_TOKENS_KEY_V2=$k"
supabase secrets unset MP_TOKENS_KEY
Remove-Variable k, cron
```

Hasta que reconecte, ese negocio no puede cobrar señas (la reserva da error al ir a pagar): que reconecte
apenas termine el paso 7.

Si alguna vez hay que volver a rotarla: `MP_TOKENS_KEY_V3`, y así (docs/02 → «Rotar la clave de las llaves de Mercado Pago»).

### 3.3 Contraseña de la base

Supabase → Project Settings → Database → **Reset database password** → «Generate a password» → copiala a tu gestor de
contraseñas → Reset. Desde ahí, la cadena del Session pooler del paso 1 cambia (usá la nueva en los backups siguientes) y
`supabase link` la vuelve a pedir. La app y las funciones no la usan: no hay que tocar nada más.

### 3.4 Credenciales productivas de Mercado Pago de TuTiempo

developers.mercadopago.com → Tus integraciones → la aplicación de TuTiempo → **Credenciales de producción**.

1. **Access Token** → Renovar. La app no lo usa (cobra con la llave de cada profesional y conecta con OAuth), pero se
   renueva porque estuvo a la vista durante la prueba.
2. Si también renovás el **Client Secret**, cargalo enseguida (si no, nadie puede conectar Mercado Pago):
   ```powershell
   supabase secrets set "MP_CLIENT_SECRET=$(Read-Host 'Client Secret nuevo')"
   ```
3. Revisá que `MP_CLIENT_ID` sea el Client ID de producción y que `MP_OWNER_USER_ID` sea el **User ID** que muestra esa
   pantalla (la cuenta dueña de la aplicación). Si hay que cambiarlo: `supabase secrets set MP_OWNER_USER_ID=<User ID>`.
   Con `supabase secrets list` ves que existen, no los valores: si no estás seguro, volvé a cargarlos.

### 3.5 Lo que queda de prueba

- **Supabase:** si creaste el usuario `ci@…` para GitHub (docs/10), en su cuenta → Account → Access Tokens → borrá
  `github-prueba`. En el SQL Editor, el usuario de la verificación:
  ```sql
  revoke all on function public.verificacion_prueba(bigint) from tt_verificador;
  revoke usage on schema public from tt_verificador;
  drop role if exists tt_verificador;
  ```
- **Hostinger:** hPanel → Archivos → Cuentas FTP → borrá `deploy-prueba`.
- **GitHub:** Settings → Environments → `prueba` → borrá todos sus secretos. Los dos workflows de prueba ya no corren
  (el PR de producción los apagó).

---

## 4. Limpieza de los datos de prueba

Scripts en `tools/produccion/`. **En los dos**, completá arriba el mismo email: el de la cuenta vinculada al Mercado Pago de la
empresa. Los admins (tabla `app_admins`) se conservan solos, sin escribirlos.

1. **Listar:** SQL Editor → pegá `limpieza-1-listar.sql` completo → Run. Una tabla con:
   - **SE CONSERVA**: la configuración (comisión, dirección del sitio, feriados) y una fila por cuenta. Revisá que estén
     las 3 cuentas (la que se conserva + 2 admins) y que ninguna diga «NO EXISTE».
   - **CUENTAS QUE SE CONSERVAN · datos**: lo que tienen y qué se borra de eso.
   - **SE BORRA**: una fila por cuenta, por profesional y por pago. Buscá «¡APROBADO SIN DEVOLVER!»: si aparece en un
     pago con dinero de verdad, **pará** y avisame. El borrado se frena solo si hay alguno.
   - **ARCHIVOS**: las carpetas de fotos de lo que se borra. Se borran a mano (punto 4).
   Descargá el resultado (botón Export → CSV) y guardalo con el backup.
2. **Borrar:** SQL Editor → pegá `limpieza-2-borrar.sql` completo → Run. Es todo o nada: si algo no cuadra, no borra nada
   y dice por qué. Al terminar muestra lo que borró cada paso y lo que queda.
3. **Listar otra vez:** la sección SE BORRA tiene que salir vacía o en 0.
4. **Fotos:** Supabase → Storage → `media` y `avatars` → borrá las carpetas que listó la sección ARCHIVOS (cada carpeta
   es un id). Las de `dni` las borra sola la tarea de las 03:37.

Por defecto se borran **también los turnos, los pagos y la caja de prueba de las cuentas que se conservan**: son de
prueba y ensuciarían Finanzas, el Balance y las estadísticas. Se conservan su cuenta, su negocio, servicios, horarios,
fotos, productos (con el stock en 0), gastos fijos y la conexión de Mercado Pago. Si querés conservar esos movimientos,
en `limpieza-2-borrar.sql`: `conservar_movimientos := true`.

---

## 5. Supabase

### 5.1 Auth → URL Configuration
- **Site URL:** `https://tutiempo.com.ar`
- **Redirect URLs:** agregá `https://tutiempo.com.ar/**` y **borrá** las de `prueba.tutiempo.com.ar`.

### 5.2 Secreto SITE_URL de las funciones
```powershell
supabase secrets set SITE_URL=https://tutiempo.com.ar
```
Es adonde vuelve el navegador después de conectar Mercado Pago.

### 5.3 Plantillas de email
Authentication → Emails → Templates: abrí **Confirm signup**, **Reset Password**, **Change Email Address** y
**Reauthentication**. Los links tienen que usar `{{ .RedirectTo }}` (como en `docs/LEEME-cliente-v31.txt`, PASO 2 C),
nunca `prueba.tutiempo.com.ar` escrito a mano. Si alguna lo tiene, cambialo por `{{ .RedirectTo }}`.
Authentication → Emails → **SMTP Settings**: tiene que seguir con Resend (host `smtp.resend.com`).

### 5.4 CAPTCHA (Cloudflare Turnstile) para tutiempo.com.ar
En prueba se usaban las claves de prueba de Cloudflare (`1x000…`), que **aprueban siempre**. En producción van las de
verdad:
1. dash.cloudflare.com → Turnstile → **Add widget** → nombre `TuTiempo`, hostname `tutiempo.com.ar`, modo Managed →
   Create. Anotá la **Site Key** (va en `config.js`, paso 6) y copiá la **Secret Key**.
   Si ya tenías un widget de producción, abrilo → Hostname Management → que esté `tutiempo.com.ar`.
2. **Después** de subir la app con la Site Key nueva (paso 7): Supabase → Authentication → Attack Protection → CAPTCHA →
   Turnstile → pegá la **Secret Key** → Save. En ese orden: con el CAPTCHA activo en Supabase y la Site Key vieja en
   `config.js`, nadie puede ingresar. Si algo falla, primero apagá el CAPTCHA en Supabase (es al instante).

---

## 6. Armar la app (dist/) con el config.js de producción

1. Antes de tocar la carpeta de prueba, descargá **`public_html/prueba/config.js`** desde el Administrador de archivos de
   Hostinger: tiene la URL del proyecto, la clave pública (`anon`) y la clave VAPID, que siguen siendo las mismas.
2. En la compu:
   ```powershell
   npm run build
   Copy-Item C:\ruta\donde\bajaste\config.js dist\config.js
   notepad dist\config.js
   ```
   Que quede así (cambia solo `turnstileSiteKey`, por la Site Key del paso 5.4):
   ```js
   window.TT_CONFIG = {
     "supabaseUrl": "https://<ref>.supabase.co",
     "supabaseAnonKey": "<la misma de prueba: anon o publishable, NUNCA la service_role ni la secret>",
     "city": "olavarria",
     "turnstileSiteKey": "<Site Key de producción>",
     "vapidPublicKey": "<la misma de prueba>"
   };
   ```
3. Revisá que esté todo:
   ```powershell
   Get-ChildItem dist -Force | Format-Table Name, Length   # .htaccess, config.js, index.html, sw.js, robots.txt, sitemap.xml, manifest.webmanifest, assets, fonts, icons, vendor…
   Select-String -Path dist\robots.txt -Pattern "Sitemap: https://tutiempo.com.ar/sitemap.xml"
   Compress-Archive -Path dist\* -DestinationPath C:\TuTiempo\tutiempo-app.zip -Force
   ```

---

## 7. Hostinger

Estructura de Hostinger: `/home/<usuario>/domains/tutiempo.com.ar/public_html` es el sitio, y `public_html/prueba` es
el subdominio de prueba. En el Administrador de archivos, activá **Mostrar archivos ocultos** (los que empiezan con punto).

### 7.1 Backup completo del Laravel (antes de tocar nada)
1. hPanel → Archivos → **Copias de seguridad** → «Generar nueva copia» → cuando termine, descargá **Archivos** y la
   **Base de datos** del Laravel a tu compu. Guardalas con el backup de Supabase.
2. Administrador de archivos → subí un nivel desde `public_html` (a `domains/tutiempo.com.ar/`) → **Nueva carpeta**
   `laravel-respaldo-20261112`. Tiene que quedar **al lado** de `public_html`, nunca adentro: ahí el `.env` del Laravel no
   se puede abrir desde la web.
3. Entrá a `public_html` → seleccioná **todo menos la carpeta `prueba`** (incluido `.htaccess` y los ocultos) → **Mover**
   → `domains/tutiempo.com.ar/laravel-respaldo-20261112`. `public_html` queda solo con `prueba`.
4. **No borres ni toques la base MySQL del Laravel**: el plan de vuelta atrás la usa tal cual.

### 7.2 Subir la app a la raíz
1. `public_html` → Subir → `tutiempo-app.zip` → clic derecho → **Extraer** (en `public_html`, no en una subcarpeta) →
   borrá el zip.
2. Revisá que en `public_html` estén `.htaccess`, `config.js`, `index.html`, `sw.js`, `robots.txt`, `sitemap.xml` y la
   carpeta `assets`. Si no está `.htaccess`, subilo aparte desde `dist\.htaccess`.

### 7.3 Prueba redirige a tutiempo.com.ar
1. `public_html/prueba` → seleccioná todo (con los ocultos) → **Eliminar**. Ya bajaste el `config.js` en el paso 6.
2. Subí los dos archivos de `tools/produccion/prueba/` del repo: **`.htaccess`** y **`sw.js`**.
   El `.htaccess` manda todo a la misma dirección en `https://tutiempo.com.ar` (301). El `sw.js` desinstala la app de
   prueba en los celulares que la tenían, para que no sigan viendo la versión guardada.

### 7.4 Vaciar la caché
hPanel → **Rendimiento** → CDN → «Purgar toda la caché» (si el CDN está activo) y Rendimiento → Caché (LiteSpeed) →
«Vaciar caché». Si el dominio pasa por Cloudflare (DNS con la nube naranja): Caching → Purge Everything.

### 7.5 Control desde PowerShell
```powershell
curl.exe -sI https://tutiempo.com.ar/panel/agenda | Select-String "HTTP/|content-type|location"     # 200, text/html, SIN location
curl.exe -sI https://tutiempo.com.ar/assets/no-existe.js | Select-String "HTTP/"                       # 404
curl.exe -s  https://tutiempo.com.ar/robots.txt                                                        # Allow, Disallow de /panel… y Sitemap
curl.exe -sI https://tutiempo.com.ar/.env | Select-String "HTTP/"                                      # 403 o 404, nunca 200
curl.exe -sI "https://prueba.tutiempo.com.ar/mis-turnos?x=1" | Select-String "HTTP/|location"          # 301 → https://tutiempo.com.ar/mis-turnos?x=1
curl.exe -sI https://prueba.tutiempo.com.ar/sw.js | Select-String "HTTP/|content-type"                 # 200, application/javascript
curl.exe -sI https://tutiempo.com.ar/ | Select-String "content-security-policy|strict-transport"       # las dos líneas
```

---

## 8. En la app (admin)

Entrá a `https://tutiempo.com.ar` con tu cuenta de admin → menú de cuenta → **Panel de TuTiempo** → **Comisión**:
- **Dirección del sitio:** `https://tutiempo.com.ar` → Guardar. Es la que va en los links de los emails y en la vuelta de
  Mercado Pago.
- **Comisión de TuTiempo:** `4` → Guardar. Se cobra sobre el total del servicio (D34). El ejemplo de abajo se actualiza
  solo; revisalo.
- **Feriados:** que el año en curso y el siguiente estén confirmados.
- En **Resumen**, «Para revisar» no tiene que mostrar «El sitio no devuelve la app en sus direcciones».

---

## 9. Paneles externos

### 9.1 Google (ingresar con Google)
console.cloud.google.com → el proyecto de TuTiempo:
1. APIs y servicios → **Credenciales** → el ID de cliente OAuth (Aplicación web):
   - Orígenes de JavaScript autorizados: agregá `https://tutiempo.com.ar` (y borrá el de prueba).
   - URI de redireccionamiento autorizados: **no cambia** (`https://<ref>.supabase.co/auth/v1/callback`).
2. **Google Auth Platform → Branding** (o «Pantalla de consentimiento OAuth»):
   - Página principal: `https://tutiempo.com.ar`
   - Política de privacidad: `https://tutiempo.com.ar/privacidad`
   - Condiciones del servicio: `https://tutiempo.com.ar/terminos`
   - Dominios autorizados: `tutiempo.com.ar` y `<ref>.supabase.co`
   - **Sin logo por ahora:** si subís un logo, Google pide una verificación que tarda días.
3. **Audience** (Público) → **Publish app** (Publicar la app) → Confirmar. Queda «En producción». Con los permisos básicos
   (email y perfil) no hace falta verificación, y cualquier cuenta de Google puede ingresar, no solo las de prueba.

### 9.2 Mercado Pago: webhook productivo de Pagos
developers.mercadopago.com → Tus integraciones → la aplicación → **Webhooks** → Configurar notificaciones → pestaña
**Modo productivo**:
- URL: `https://<ref>.supabase.co/functions/v1/mp-webhook`
- Evento: **Pagos** (solo ese).
- La **clave secreta** de esa pantalla tiene que ser la de `MP_WEBHOOK_SECRET`. Si no estás seguro, copiala y:
  `supabase secrets set "MP_WEBHOOK_SECRET=$(Read-Host 'Clave del webhook')"`.
- **Simular notificación** → tiene que responder 200. El pago real del paso 10 confirma que la firma es válida: en el
  admin, Resumen → «Para revisar», no tiene que aparecer «la firma no es válida».
- Redirect URL de la aplicación (OAuth): sigue siendo `https://<ref>.supabase.co/functions/v1/mp-oauth`.

### 9.3 Resend: SPF, DKIM y DMARC
resend.com → **Domains** → `tutiempo.com.ar`: los registros tienen que estar todos en **Verified** (MX y TXT de `send`, y
TXT `resend._domainkey`). Desde PowerShell:
```powershell
Resolve-DnsName -Type TXT resend._domainkey.tutiempo.com.ar   # DKIM: "p=MIGf…"
Resolve-DnsName -Type TXT send.tutiempo.com.ar                # SPF: "v=spf1 include:amazonses.com ~all"
Resolve-DnsName -Type MX  send.tutiempo.com.ar                # feedback-smtp.…amazonses.com
Resolve-DnsName -Type TXT _dmarc.tutiempo.com.ar              # DMARC: "v=DMARC1; …"
```
Si falta **DMARC**: hPanel → Dominios → `tutiempo.com.ar` → **DNS** → agregar registro TXT, nombre `_dmarc`, valor
`v=DMARC1; p=none; rua=mailto:contacto@tutiempo.com.ar`. Con `p=none` no se rechaza nada: solo empieza a informar.
Si el DNS está en Cloudflare, el mismo registro va ahí.

---

## 10. Verificación después del cambio

Con el celular **y** con la compu, en `https://tutiempo.com.ar`:

- [ ] **Crear cuenta** con un email nuevo (de cliente): pasa el CAPTCHA, llega el email de activación (desde Resend),
      el link abre `https://tutiempo.com.ar/…` y activa la cuenta.
- [ ] **Ingresar con Google** con otra cuenta: vuelve a `tutiempo.com.ar` con la sesión iniciada.
- [ ] **Cuentas que se conservan:** ingresan, ven su negocio y **reconectan Mercado Pago** (Perfil → Cobros con
      Mercado Pago → Conectar). Si dice «es la cuenta de TuTiempo», ver H12 al final.
- [ ] **Pago real chico:** con la cuenta de cliente nueva, reservá el servicio más barato del negocio que se conserva y
      pagá con tu tarjeta. El turno queda confirmado, al cliente le llega el email «quedó confirmado» y al profesional
      «Nueva reserva» (email y campanita).
- [ ] **Su devolución:** el profesional cancela ese turno desde la Agenda. A los minutos, la devolución aparece hecha en
      Mercado Pago y el turno dice «Cancelado» con «te devolvemos todo».
- [ ] **«Mandarme una de prueba»** (Mi perfil → Notificaciones): activá las notificaciones y tocá el botón. Llega la
      notificación y la pantalla dice «Listo».
- [ ] **Que llegue un email:** el de activación y los de la reserva de arriba.
- [ ] **Recargar** (F5 o deslizar) en el inicio, un rubro, el perfil del negocio, `/mis-turnos`, `/panel/agenda`,
      `/privacidad` y `/terminos`: cada uno vuelve a la misma pantalla.
- [ ] `/privacidad` **sin** la franja «Borrador»; `/terminos` **con** la franja.
- [ ] Abrir `https://prueba.tutiempo.com.ar/panel/agenda`: termina en `https://tutiempo.com.ar/panel/agenda`.
- [ ] Admin → Resumen → «Para revisar» vacío (o solo lo esperable).
- [ ] SQL Editor, a los 15 minutos:
      ```sql
      select jobname, status, return_message, start_time from cron.job_run_details where start_time > now() - interval '20 minutes' order by start_time desc;   -- todo succeeded
      select status_code, count(*) from net._http_response where created > now() - interval '20 minutes' group by 1;           -- 200
      ```

Al terminar, hacé otro backup (paso 1) con la contraseña nueva.

---

## PLAN DE VUELTA ATRÁS (si algo grave falla)

Volver al Laravel lleva unos minutos y no depende de Supabase. La base MySQL del Laravel no se tocó en ningún paso.

1. hPanel → Administrador de archivos → `domains/tutiempo.com.ar/` → **Nueva carpeta** `app-tutiempo-20261112`.
2. `public_html` → seleccioná todo **menos `prueba`** (con los ocultos) → **Mover** → `app-tutiempo-20261112`.
3. `laravel-respaldo-20261112` → seleccioná todo (con los ocultos) → **Mover** → `public_html`.
4. Vaciá la caché (paso 7.4).
5. Control: `curl.exe -sI https://tutiempo.com.ar/ | Select-String "HTTP/"` responde como antes del cambio y el sitio
   viejo funciona.
6. Si querés que la app siga accesible mientras se arregla: en `public_html/prueba` borrá `.htaccess` y `sw.js` y subí ahí
   el contenido de `dist/` (con el `config.js` de producción). Para eso, en Supabase → Auth → Redirect URLs, volvé a
   agregar `https://prueba.tutiempo.com.ar/**`.

Para volver a intentar el cambio: el mismo movimiento al revés (pasos 7.1.3 y 7.2 con lo que quedó en
`app-tutiempo-20261112`).

La limpieza de la base no se deshace con esto. Si hiciera falta recuperar datos borrados, está el backup del paso 1.

---

## Mensaje para los que usaban la app de prueba

> ¡Hola! TuTiempo ya está en su dirección definitiva: **https://tutiempo.com.ar**. La versión de prueba
> (prueba.tutiempo.com.ar) dejó de funcionar y te lleva sola a la nueva.
>
> Lo que tenés que hacer, una sola vez:
> 1. **Volvé a ingresar** en https://tutiempo.com.ar. Si probaste con una cuenta de prueba, creá una nueva: los datos de
>    la prueba se borraron.
> 2. Si tenías la app instalada en el celular, **borrala y volvé a instalarla** desde https://tutiempo.com.ar
>    (Android: menú ⋮ → «Instalar app»; iPhone: Compartir → «Agregar a inicio»).
> 3. **Activá de nuevo las notificaciones** en Mi perfil → Notificaciones, para que te lleguen los avisos de tus turnos.
>
> ¡Gracias por ayudarnos a probarla!

Para los profesionales que se conservan, sumá: «Entrá a tu panel → Perfil → Cobros con Mercado Pago → **Conectar**, para
volver a recibir señas».

---

## H12: la cuenta de Mercado Pago de la empresa

`mp-oauth` no deja conectar como profesional a la cuenta dueña de la aplicación de Mercado Pago (`MP_OWNER_USER_ID`,
H12): el cobro y la comisión irían a la misma cuenta. Para saber si la cuenta de la empresa es esa, compará:
- el **User ID** de developers.mercadopago.com → la aplicación → Credenciales de producción, con
- la cuenta de Mercado Pago que conectó ese negocio. En el SQL Editor (cambiá el email):
  ```sql
  select u.email, p.name, a.mp_user_id, a.status
    from auth.users u join public.providers p on p.owner_id = u.id join public.mp_accounts a on a.provider_id = p.id
   where lower(u.email) = lower('EMAIL-DE-LA-CUENTA');
  ```
El mismo número aparece en `limpieza-1-listar.sql`, en la fila de la cuenta («Mercado Pago: cuenta …»).
Si son el mismo número, esa cuenta no va a poder reconectar Mercado Pago en producción. Avisame antes del cambio.

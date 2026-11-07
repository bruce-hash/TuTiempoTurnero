# Despliegue automático a prueba y verificación

Dos botones en GitHub → Actions:

- **Desplegar prueba**: aplica las migraciones al Supabase de prueba (`supabase db push`), despliega las Edge Functions
  que cambiaron, arma el build con el `config.js` de prueba (desde secretos), lo sube por FTP a la carpeta de
  `prueba.tutiempo.com.ar` (borrando la versión anterior, con `robots.txt` → `Disallow: /`) y al final corre la verificación.
- **Verificar prueba**: también corre sola todas las noches. Revisa que el sitio y el Supabase de prueba funcionen de verdad.

Producción no se toca: no hay ningún secreto de producción en GitHub.

## Lo que tenés que crear y cargar (una sola vez)

### 1. Supabase: un acceso que solo vea el proyecto de prueba

El token de la CLI de Supabase da acceso a **todos** los proyectos de la persona que lo crea. Si lo creás con tu
usuario, desde GitHub se podría tocar producción. Para que no pase:

1. supabase.com → **New organization** → `TuTiempo Prueba` (plan gratis).
2. Proyecto `tutiempo-prueba` → Settings → General → **Transfer project** → a `TuTiempo Prueba`.
3. Creá un usuario de Supabase aparte (por ejemplo `ci@tutiempo.com.ar`) e invitalo **solo** a `TuTiempo Prueba`.
   Si ese usuario no está en la organización de producción, su token no puede tocar producción.
4. Con ese usuario: Account → **Access Tokens** → Generate new token (`github-prueba`). Va a `SUPABASE_ACCESS_TOKEN`.

### 2. Supabase de prueba: un usuario que solo puede pedir el informe de la verificación

La verificación necesita leer de la base los montos de la reserva que hace, el estado de las tareas programadas y lo
que respondieron las Edge Functions. No escribe nada. En vez de darle acceso a las tablas, la migración de este PR trae
una sola función, `verificacion_prueba`, que devuelve eso. Nadie la puede llamar (ni la app ni un usuario), salvo el
usuario que crees acá.

**Después** del primer despliegue (que crea la función), en el SQL Editor del proyecto de **prueba**. Elegí una
contraseña larga y no la pegues en ningún chat:

```sql
create role tt_verificador login password 'CONTRASEÑA-LARGA' nosuperuser nocreatedb nocreaterole;
grant usage on schema public to tt_verificador;
grant execute on function public.verificacion_prueba(bigint) to tt_verificador;
```

La conexión sale de Project Settings → Database → Connection string → **Session pooler** (puerto 5432). Reemplazá el
usuario por `tt_verificador.<ref-del-proyecto>` y la contraseña por la de arriba. Va a `PRUEBA_DB_URL_LECTURA`. Hasta
que esté cargado, la verificación hace todo lo demás y avisa que salteó la parte de la base.

### 3. Supabase de prueba: el CAPTCHA en modo prueba

El robot de la verificación tiene que poder ingresar. En prueba usá las **claves de prueba de Cloudflare**, que siempre
aprueban:
- Authentication → Attack Protection → CAPTCHA: Turnstile, secret `1x0000000000000000000000000000000AA`.
- La site key `1x00000000000000000000AA` va al secreto `PRUEBA_TURNSTILE_SITE_KEY` (o dejalo vacío y apagá el CAPTCHA
  en prueba). En producción siguen las claves reales.

### 4. Dos cuentas fijas en https://prueba.tutiempo.com.ar

Creálas desde la app, como cualquier usuario:
- **Cliente**: cuenta de cliente común, con el email confirmado.
- **Profesional**: cuenta de negocio aprobada en el admin, con Mercado Pago conectado con el **vendedor de prueba**,
  al menos un servicio y horarios abiertos todos los días. Nombre sugerido: «Prueba Automática». Con «Exigir DNI»
  prendido, verificala a mano una vez.

La verificación reserva con el cliente hasta llegar a Mercado Pago, **no paga** y libera el horario enseguida.
No modifica nada más de las dos cuentas.

### 5. Hostinger: una cuenta FTP que solo vea la carpeta de prueba

hPanel → Archivos → **Cuentas FTP** → Crear cuenta FTP:
- Usuario: `deploy-prueba` (Hostinger le agrega un prefijo).
- Directorio: la carpeta del subdominio, **`public_html/prueba`** (si al crear el subdominio elegiste otra carpeta,
  esa). **Nunca** `public_html` sola: ahí está el sitio Laravel.
- Contraseña larga.

Para comprobarlo antes de cargarla: conectate con FileZilla con ese usuario. Tenés que ver **solo** el contenido de la
carpeta de prueba (el `index.html`, `assets/`…), sin `public_html` ni las carpetas de Laravel.

El workflow se conecta por FTP con TLS (FTPS explícito). Si Hostinger no lo acepta, el despliegue falla y no sube nada
sin cifrar.

### 6. Mercado Pago (opcional, recomendado)

El access token del **vendedor de prueba** (developers.mercadopago.com → Cuentas de prueba → vendedor → Credenciales de
producción de esa cuenta de prueba, `APP_USR-…`). Con él, la verificación le pregunta a Mercado Pago el monto y la
comisión de la preferencia que se creó y los compara con la base. Sin él, compara solo contra la base.

### 7. GitHub: el entorno `prueba` con sus secretos

Repo → Settings → Environments → **New environment** → `prueba`. En «Deployment branches», solo `developer`.
Secretos del entorno:

| Secreto | Qué es |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | El token del paso 1 (usuario que solo ve prueba) |
| `PRUEBA_PROJECT_REF` | El ref del proyecto de prueba (el `xxxx` de `https://xxxx.supabase.co`) |
| `PRUEBA_DB_PASSWORD` | La contraseña de la base de prueba (Project Settings → Database). La usa `supabase db push` |
| `PRUEBA_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `PRUEBA_SUPABASE_ANON_KEY` | La clave pública (`anon` o publishable). **Nunca** la `service_role` ni la secret |
| `PRUEBA_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` (paso 3) o vacío |
| `PRUEBA_VAPID_PUBLIC_KEY` | La clave pública VAPID de prueba (la que ya está en el `config.js` de prueba) o vacío |
| `PRUEBA_DB_URL_LECTURA` | La conexión del usuario `tt_verificador` (paso 2; se carga después del primer despliegue) |
| `FTP_HOST` | El servidor FTP que muestra Hostinger en Cuentas FTP |
| `FTP_USER` / `FTP_PASSWORD` | La cuenta del paso 5 |
| `PRUEBA_CLIENTE_EMAIL` / `PRUEBA_CLIENTE_PASSWORD` | La cuenta de cliente del paso 4 |
| `PRUEBA_PRO_EMAIL` / `PRUEBA_PRO_PASSWORD` | La cuenta del profesional del paso 4 |
| `PRUEBA_MP_VENDEDOR_TOKEN` | Opcional: el token del paso 6 |

### Cosas a tener en cuenta

- **Primer despliegue.** Si la base de prueba se cargó pegando `TODO_EN_UNO.sql`, la CLI no tiene registradas las
  migraciones y la primera vez las vuelve a correr todas. Son idempotentes (el CI lo prueba corriéndolas dos veces), así
  que no se pierde nada. A partir de ahí solo aplica las nuevas.
- **Las funciones que cambiaron.** El workflow compara con el último despliegue (la etiqueta `prueba-desplegada`, que
  mueve él mismo). Si cambió `_shared/`, despliega todas. La primera vez, todas.
- **Verificar prueba solo corre código de developer (S21).** Antes de usar los secretos, revisa que el commit de la
  etiqueta `prueba-desplegada` (o el que le pasa «Desplegar prueba») esté en `developer`; si no, falla sin correr nada.
  Así, mover la etiqueta a un commit de otra rama no sirve para leer los secretos del entorno `prueba`.
- **Supabase gratis.** El proyecto gratis se pausa tras una semana sin uso. La verificación de cada noche lo mantiene
  despierto. Si igual se pausa, la verificación falla y avisa.

## Cómo se usa

1. Cargá todo lo de arriba (pasos 1 a 7; el paso 2 va después del primer despliegue).
2. GitHub → Actions → **Desplegar prueba** → Run workflow → rama `developer`. Tarda unos minutos.
   - Si falta un secreto, frena al principio y dice cuál.
   - Si la cuenta FTP ve la raíz de Laravel, frena antes de subir nada.
   - Al terminar corre **Verificar prueba** y el resumen queda en la página de la corrida.
3. **Verificar prueba** también se puede correr sola (botón) y corre todas las noches a las 00:15 de Argentina. Verifica
   el commit que está desplegado (la etiqueta `prueba-desplegada`), aunque `developer` tenga cosas nuevas.

## Qué revisa la verificación

| Parte | Qué |
| --- | --- |
| Sitio | Hostinger sirve el build del commit desplegado (`version.json`); recargar `/panel/agenda`, `/mis-turnos`, `/turno/<id>` y el perfil del profesional devuelve la app (200, `text/html`, sin redirecciones); CSP y encabezados de seguridad; `robots.txt` con `Disallow: /`; un `.js` que no existe da 404; `http://` pasa a `https://` |
| Cuentas | El cliente y el profesional ingresan (también desde `/ingresar`, con el CAPTCHA de prueba); el negocio está aprobado y visible |
| Cliente | Mis turnos, el perfil del profesional con un horario libre y la reserva hasta Mercado Pago, sin errores en la consola |
| Cobro | En la base: turno en espera de pago con el cobro abierto; seña del 30%, comisión de TuTiempo y costo de Mercado Pago iguales a lo que tienen que dar; la app mostró el mismo total. Con el token del vendedor: la preferencia de Mercado Pago cobra ese total con la comisión aparte. **No se paga**: la página no sale a Mercado Pago y el horario se libera enseguida |
| Profesional | Ingresa a su Agenda y recorre Finanzas, Clientes, Productos, Horarios y Perfil sin errores en la consola. No cambia nada |
| Base | La última migración aplicada es la del commit desplegado; cada tarea programada (`tt-*`) corrió bien la última vez; las Edge Functions que llama el cron respondieron bien en las últimas 2 horas |
| Funciones | Cada Edge Function está desplegada y responde: las del navegador al preflight; `mp-webhook` a un GET; las del cron rechazan un pedido sin su clave (un 500 ahí es que les falta un secreto) |

El mismo recorrido (sin lo que es solo del servidor real) corre en cada PR con `npm run test:verificar`, contra la base
local y el build de producción: si un cambio de la app lo rompe, se ve antes de desplegar.

## Si falla

- **Hostinger sirve otro commit**: la subida no terminó o quedó la caché de LiteSpeed (hPanel → Rendimiento → Caché →
  Vaciar) y volvé a correr la verificación.
- **Recargar una dirección no devuelve la app**: el `.htaccess` (docs/02, Hostinger, paso 6).
- **Una tarea programada falló**: el mensaje está en el resumen. En el SQL Editor de prueba:
  `select * from cron.job_run_details order by runid desc limit 20`.
- **Una función del cron da 403**: la `CRON_SECRET` de Vault no es la de las funciones; **500**: le falta un secreto.
- **El proyecto de Supabase está pausado**: reactivalo desde el panel de Supabase y volvé a correr.

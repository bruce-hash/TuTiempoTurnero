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
    `document`) y un módulo por pantalla que registra sus acciones con `registerClick("act", (e, x, v) => …)`,
    `registerSubmit("idForm", (e) => …)`, etc.
  - `src/demo/`: modo demo (datos de ejemplo, barra "Ver como"). Solo en desarrollo y pruebas: **nada de `src/demo/`
    llega al build de producción** (lo verifica `npm run test:sin-demo`).
  - Viene del `app.cjs` minificado del cliente: las variables internas siguen con letras sueltas (`e`, `a`, `t`).
    Cuando toques una función, renombrá sus variables con nombres claros en ese mismo cambio.
- `public/`: archivos que se copian tal cual a Hostinger (`.htaccess`, fuentes, `vendor/supabase.js`, `config.example.js`).
- `vite.config.mjs`: `npm run dev` (servidor local con demo), `npm run build` → `dist/` (lo que se sube a Hostinger: solo
  en vivo, archivos con hash), `npm run build:test` → `dist-test/` (con demo y ganchos de prueba). No se versionan.
- `supabase/migrations/`: migraciones idempotentes en orden, con el formato de la CLI de Supabase
  (`AAAAMMDDHHMMSS_nombre.sql`, por ejemplo `20261001000001_schema.sql`). `supabase/TODO_EN_UNO.sql` es su concatenación
  exacta: si cambiás o agregás una migración, regeneralo con `npm run sql:build` y verificá con `npm run sql:check`
  (el CI falla si no son idénticos).
- `supabase/functions/`: Edge Functions de Mercado Pago (`_shared/util.ts` compartido).
- `supabase/seed/ejemplos.NO-USAR-EN-PRODUCCION.sql`: usa negocios reales de Olavarría. Solo para pruebas locales.
- `pruebas/`: pruebas del cliente + `reproducir_errores_cobro.py` (reproduce los 2 errores de cobro conocidos).

## Arquitectura del frontend (respetarla)

Capas: (1) estado `S` (`state.js`) y datos (`store.js`); (2) `demoApi` y `liveApi` con las mismas funciones, toda
escritura pasa por `api.m.*` → `saved()`; (3) vistas `v*()` que solo arman HTML, con `esc()` para todo texto de usuario;
(4) un listener de toques por `data-act` / `data-go` / `data-btab` y uno de formularios por id, que buscan la acción en
el registro. Una función nueva = vista + `data-act` + `registerClick(...)` en el módulo de acciones de su pantalla +
`api.m.*` en demo y en vivo. Lo que sea solo de la demo va en `src/demo/` o detrás de `if (!LIVE)`.

## Reglas no negociables

- **Dinero:** montos enteros en pesos. Precios, señas, comisión y descuentos los calcula la base; el navegador solo muestra.
  Un pago aprobado por Mercado Pago **nunca** puede quedar sin turno ni sin devolución registrada.
- **Seguridad:** RLS en toda tabla nueva; permisos cerrados por defecto y abiertos explícitamente; funciones
  `security definer` siempre con `set search_path`. Nada de `service_role` en el frontend.
- **Hora:** todo "hoy/ahora" en `America/Argentina/Buenos_Aires`, calculado en el servidor o con `NOW()` de la app.
- **Migraciones nuevas:** archivo nuevo con fecha y hora actuales (`supabase migration new <nombre>` o a mano, por
  ejemplo `20261022150000_payments.sql`; siempre posterior a la última), idempotente, sin borrar datos. Después, `npm run sql:build`.
- **Producción:** nunca toques producción ni corras SQL contra un proyecto remoto. Bruno despliega.
- **Secretos:** nunca en el repo. `config.js` real, claves de Mercado Pago y de Supabase quedan fuera de git.

## Forma de trabajo

- Bloques numerados. Al terminar cada bloque **te detenés** y entregás: qué hiciste, archivos tocados, cómo probarlo,
  resultado de las pruebas y riesgos. No empezás el siguiente sin autorización.
- Ramas: `main` (lo que está en producción) y `developer`. Cada bloque en `feature/<bloque>` desde `developer`, con PR.
  Nunca commit directo a `main`. Commits chicos, en español.
- Si trabajás en un entorno aislado, hacé push de la rama al terminar y avisá el nombre.
- Ningún bloque termina con pruebas en rojo. Antes de cerrar cada bloque corré, según lo que tocaste:
  `npm run sql:check` y `pruebas/test_db.py` (base); `npm run test:crawl`, `npm run test:clicks` y
  `npm run test:sin-demo` (frontend); `npm run test:e2e` y `npm run test:comparar` (navegador real, necesitan Postgres y
  PostgREST: ver abajo). El workflow `.github/workflows/pruebas.yml` corre todo en cada PR y en cada push a `developer`/`main`.
- El crawl corre con el reloj fijo (`TT_AHORA`, por defecto 2026-10-21 15:00): la cantidad de toques depende de la
  fecha (la agenda de la demo sale de "hoy"). Lo que importa es 0 errores y 0 destinos equivocados.
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
python3 pruebas/reproducir_errores_cobro.py "host=... dbname=OTRA_BASE_LIMPIA user=postgres"
```

## Cómo correr las pruebas en navegador

```bash
npx playwright install chromium                  # una sola vez
# PostgREST 12: https://github.com/PostgREST/postgrest/releases (binario en el PATH o en POSTGREST=/ruta/postgrest)
export PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=...
npm run test:e2e        # recorrido completo en vivo (base nueva + PostgREST + pruebas/e2e_server.js)
npm run test:comparar   # versión anterior al Bloque A vs. la actual: demo y en vivo, texto y capturas
```

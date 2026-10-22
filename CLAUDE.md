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

- `src/prototipo.html`: **única fuente del frontend** (CSS + HTML + JS en un archivo). Se edita acá, nunca en `dist/`.
  Fue reconstruido desde el `app.cjs` minificado del cliente: las variables internas siguen con letras sueltas
  (`e`, `a`, `t`). Cuando toques una función, renombrá sus variables con nombres claros en ese mismo cambio.
- `src/static/`: archivos que se copian tal cual a Hostinger (`.htaccess`, fuentes, `vendor/supabase.js`, `config.example.js`).
- `tools/build.mjs`: genera `dist/` (lo que se sube a Hostinger). `dist/` no se versiona.
- `supabase/migrations/`: migraciones idempotentes en orden. `supabase/TODO_EN_UNO.sql` es su concatenación exacta:
  si cambiás una migración, regenerá TODO_EN_UNO y verificá que sigan siendo idénticos.
- `supabase/functions/`: Edge Functions de Mercado Pago (`_shared/util.ts` compartido).
- `supabase/seed/ejemplos.NO-USAR-EN-PRODUCCION.sql`: usa negocios reales de Olavarría. Solo para pruebas locales.
- `pruebas/`: pruebas del cliente + `reproducir_errores_cobro.py` (reproduce los 2 errores de cobro conocidos).

## Arquitectura del frontend (respetarla)

Capas dentro del script de `prototipo.html`: (1) estado `S` y datos; (2) `demoApi` y `liveApi` con las mismas
funciones, toda escritura pasa por `api.m.*` → `saved()`; (3) vistas `v*()` que solo arman HTML, con `esc()` para
todo texto de usuario; (4) un manejador de toques por `data-act` / `data-go` / `data-btab` y uno de formularios por id.
Una función nueva = vista + `data-act` + rama en el manejador + `api.m.*` en demo y en vivo.

## Reglas no negociables

- **Dinero:** montos enteros en pesos. Precios, señas, comisión y descuentos los calcula la base; el navegador solo muestra.
  Un pago aprobado por Mercado Pago **nunca** puede quedar sin turno ni sin devolución registrada.
- **Seguridad:** RLS en toda tabla nueva; permisos cerrados por defecto y abiertos explícitamente; funciones
  `security definer` siempre con `set search_path`. Nada de `service_role` en el frontend.
- **Hora:** todo "hoy/ahora" en `America/Argentina/Buenos_Aires`, calculado en el servidor o con `NOW()` de la app.
- **Migraciones nuevas:** archivo nuevo (`0007_...sql`, `0008_...sql`), idempotente, sin borrar datos.
- **Producción:** nunca toques producción ni corras SQL contra un proyecto remoto. Bruno despliega.
- **Secretos:** nunca en el repo. `config.js` real, claves de Mercado Pago y de Supabase quedan fuera de git.

## Forma de trabajo

- Bloques numerados. Al terminar cada bloque **te detenés** y entregás: qué hiciste, archivos tocados, cómo probarlo,
  resultado de las pruebas y riesgos. No empezás el siguiente sin autorización.
- Ramas: `main` (lo que está en producción) y `developer`. Cada bloque en `feature/<bloque>` desde `developer`, con PR.
  Nunca commit directo a `main`. Commits chicos, en español.
- Si trabajás en un entorno aislado, hacé push de la rama al terminar y avisá el nombre.
- Ningún bloque termina con pruebas en rojo. Antes de cerrar cada bloque corré, según lo que tocaste:
  `pruebas/test_db.py` (base), `npm run test:crawl` y `npm run test:clicks` (frontend), `node tools/build.mjs`.
- No inventes reglas de negocio: si algo no está en el SQL ni en `docs/01-decisiones.md`, preguntá.
- Textos de interfaz en español rioplatense (voseo), con el tono actual de la app.

## Cómo correr las pruebas de base localmente

```bash
# Postgres 16 local (las pruebas usan btree_gist, pg_trgm, unaccent)
createdb tt
psql -d tt -f pruebas/supabase_emulation.sql     # imita lo que Supabase ya trae (roles, auth, storage)
psql -d tt -f supabase/TODO_EN_UNO.sql
python3 pruebas/test_db.py "host=... port=... dbname=tt user=postgres"
python3 pruebas/reproducir_errores_cobro.py "host=... dbname=OTRA_BASE_LIMPIA user=postgres"
```

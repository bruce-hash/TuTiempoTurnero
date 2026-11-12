# TuTiempo

Turnos online de belleza y bienestar en Olavarría. Versión 31 (Supabase + Hostinger).

- Reglas para el desarrollo con Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Estado y errores conocidos: [`docs/00-estado-y-hallazgos.md`](docs/00-estado-y-hallazgos.md)
- Decisiones de negocio: [`docs/01-decisiones.md`](docs/01-decisiones.md)
- Cómo ponerlo en marcha (Supabase, Mercado Pago, Hostinger): [`docs/02-puesta-en-marcha.md`](docs/02-puesta-en-marcha.md)

## Uso rápido

Node 22 (ver `.nvmrc`).

```bash
npm ci
npm run dev          # servidor local con recarga; sin config.js completo, en modo demo
npm run build        # genera dist/ (lo que se sube a Hostinger: solo en vivo, sin demo)
npm run test:crawl   # toca cada botón de cada pantalla (modo demo, reloj fijo)
npm run test:clicks  # cada botón con su acción, cada formulario con su envío
```

Más pruebas (base, navegador real, comparación con la versión anterior): ver [`CLAUDE.md`](CLAUDE.md).

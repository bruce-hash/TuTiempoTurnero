# TuTiempo

Turnos online de belleza y bienestar en Olavarría. Versión 31 (Supabase + Hostinger).

- Reglas para el desarrollo con Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Estado y errores conocidos: [`docs/00-estado-y-hallazgos.md`](docs/00-estado-y-hallazgos.md)
- Decisiones de negocio: [`docs/01-decisiones.md`](docs/01-decisiones.md)
- Cómo ponerlo en marcha (Supabase, Mercado Pago, Hostinger): [`docs/02-puesta-en-marcha.md`](docs/02-puesta-en-marcha.md)

## Uso rápido

```bash
npm install
npm run build        # genera dist/ desde src/prototipo.html (lo que se sube a Hostinger)
npm run test:crawl   # toca cada botón de cada pantalla (modo demo)
npm run test:clicks  # cada botón con su acción, cada formulario con su envío
```

Abrir `src/prototipo.html` en el navegador muestra la app en modo demo (datos de ejemplo, no guarda nada).

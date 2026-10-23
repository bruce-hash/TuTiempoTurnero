# Licencias de terceros

Código de terceros que viaja en el sitio o se usa en las pruebas. Versiones fijas (sin `^` ni `~` en `package.json`).

| Paquete | Versión | Licencia | Dónde se usa |
| --- | --- | --- | --- |
| [`@supabase/supabase-js`](https://github.com/supabase/supabase-js) (`public/vendor/supabase.js`) | 2.45.4 | MIT | Sitio: conexión con Supabase |
| [`qrcode-generator`](https://github.com/kazuhikoarase/qrcode-generator) (Kazuhiko Arase) | 2.0.4 | MIT | Sitio: QR del perfil del prestador (`src/views/prestador/comunidad.js`, Bloque B) |
| [`jsqr`](https://github.com/cozmo/jsQR) | 1.4.0 | Apache-2.0 | Solo pruebas: decodifica el QR y lo compara con la dirección del perfil (`pruebas/rutas.mjs`) |

Las herramientas de desarrollo (Vite, Playwright, jsdom, pg) no viajan en el sitio.

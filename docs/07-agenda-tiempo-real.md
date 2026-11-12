# Agenda en tiempo real (Realtime de Supabase) · qué haría falta y qué cuesta

Pedido de la revisión v2 del cliente (3/11, opcionales): "Agenda en tiempo real: hoy se actualiza cada 30 s. Decime qué
haría falta para que sea instantánea y qué cuesta, sin programarlo." **No está programado.**

## Cómo funciona hoy (C22)
`src/lib/agenda-al-dia.js` vuelve a pedir los turnos de la Agenda cada 30 segundos y al volver a la pestaña, y dibuja solo
si cambió algo. Lo más que tarda en aparecer un turno nuevo es unos 30 segundos. No usa nada de Realtime ni cuesta nada
aparte.

## Qué haría falta para que sea instantáneo
Supabase Realtime mantiene una conexión abierta (WebSocket) entre el navegador del profesional y el proyecto. Cuando
cambia un turno, la base avisa por esa conexión y la Agenda se pone al día en uno o dos segundos.

1. **Base (una migración).**
   - Un trigger en `bookings` que, en cada alta, cambio o cancelación, mande un aviso al canal privado del profesional
     (`agenda:<id del profesional>`) con `realtime.broadcast_changes`. Es lo que recomienda Supabase en lugar de
     "escuchar la tabla": manda solo el aviso, sin datos del cliente.
   - Una política RLS en `realtime.messages`: solo el dueño del negocio (y el admin) puede escuchar su canal. Nadie más
     se entera de que hubo un turno.
2. **App.**
   - Al abrir la Agenda, `agenda-al-dia.js` se suscribe a ese canal con el cliente de Supabase que ya usa la app. Cuando
     llega un aviso, pide los turnos igual que hoy (la misma función, con las mismas reglas: no toca la pantalla si el
     profesional está escribiendo o guardando).
   - La consulta cada 30 s queda como respaldo, más espaciada (por ejemplo cada 2 minutos), por si la conexión se corta
     (celular sin señal, pestaña dormida).
   - Al salir de la Agenda o cerrar sesión, se desuscribe.
3. **Servidor.** La política de seguridad del `.htaccess` ya permite `wss://*.supabase.co`, así que no hace falta
   cambiarla. En el panel de Supabase, Realtime viene prendido; hay que dejar los canales privados como obligatorios
   (Realtime → Settings → "Allow public access" apagado).
4. **Pruebas.** Las pruebas locales usan Postgres y PostgREST, que no tienen Realtime. Haría falta sumar el servidor de
   Realtime de Supabase (en Docker) al entorno de pruebas y al CI, y una prueba e2e: el cliente reserva y la Agenda
   abierta del profesional lo muestra sin esperar los 30 s; otro profesional no recibe el aviso.

Estimación: un bloque chico de trabajo (base + app + pruebas). La parte que más lleva es armar Realtime en las pruebas.

## Qué cuesta
Según la documentación de precios de Supabase (verificalo en el panel al contratar, los cupos cambian):

| Plan | Conexiones simultáneas incluidas | Mensajes por mes incluidos | Si se pasa |
| --- | --- | --- | --- |
| Free | 200 | 2 millones | No cobra: avisa y da un período de gracia |
| Pro (US$ 25 por mes, el plan que conviene para producción) | 500 | 5 millones | US$ 10 cada 1.000 conexiones de pico; US$ 2,50 cada millón de mensajes |

**Para TuTiempo hoy, el costo extra es cero.** Cada profesional con la Agenda abierta es una conexión: aunque estuvieran
los 100 profesionales de Olavarría con la Agenda abierta al mismo tiempo, son 100 de las 200 (Free) o 500 (Pro) incluidas.
Cada turno que cambia es un mensaje: con 3.000 turnos por mes y unos 3 cambios por turno (reserva, confirmación de pago,
asistencia), son unos 10.000 mensajes, menos del 1% de lo incluido.

Lo que sí cambia: hay más piezas que pueden fallar (la conexión abierta), por eso se mantiene la consulta periódica de
respaldo.

## Fuentes
- [Realtime Pricing](https://supabase.com/docs/guides/realtime/pricing)
- [Manage Realtime Peak Connections usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-peak-connections)
- [Manage Realtime Messages usage](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)
- [Realtime Limits](https://supabase.com/docs/guides/realtime/limits)
- [Pricing & Fees](https://supabase.com/pricing)

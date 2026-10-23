# Estado de la versión 31 y hallazgos

Auditoría de Bruno (con Claude) sobre el paquete del cliente, octubre 2026.

## Qué se verificó

| Qué | Resultado |
| --- | --- |
| Migraciones `0001`–`0006` (hoy `20261001000001`–`20261001000006`) vs `TODO_EN_UNO.sql` | Idénticas |
| Carga del SQL en Postgres 16 | Sin errores: 34 tablas, 45 políticas, 76 funciones |
| `pruebas/test_db.py` | 243 de 244. La que falla es la prueba (ver H09), no la app |
| RLS | Activa en todas las tablas. Funciones `security definer` con `search_path`. Nada interno ejecutable por `anon` |
| `vendor/supabase.js` | Idéntico byte a byte al oficial `@supabase/supabase-js` 2.45.4 |
| `src/prototipo.html` (reconstruido) | Mismo comportamiento que el `app.cjs` del cliente: crawl (465 toques, 0 errores), audit_clicks y recorrido en navegador idénticos |
| `tools/build.mjs` → `dist/` | Mismo comportamiento que el paquete del cliente en navegador real |
| Edge Functions de Mercado Pago | Bien diseñadas, con los errores de abajo |
| Bloque A1: `src/prototipo.html` → módulos de `src/` con Vite (`1368349` → merge `9899126`) | Mudanza pura: cada declaración de la referencia, idéntica en su módulo (`tools/mudanza/`, borrado al aprobar A1). Crawl idéntico toque por toque, e2e 107/107, comparación en navegador 36/36 |
| Bloque A2: nombres claros y comentarios (merge `9899126` → merge `6d7b5a0`) | Código idéntico módulo por módulo: árbol de sintaxis con las variables locales en nombres canónicos y sin comentarios (`tools/legibilidad/`, borrado al aprobar A2). Variables locales de una letra: 2834 → 0. Crawl idéntico toque por toque, e2e 107/107, comparación 36/36 |

## Hallazgos

### H01 · Alta · Devolución que nunca se ejecuta (verificado)
**Caso:** el cliente paga después de que venció su reserva temporal (10 min) y otro ya tomó ese horario.
`confirm_payment` marca el turno `cancelled_provider` con `refund_pending`, pero **no guarda `mp_payment_id`**
(solo lo guarda en el primer turno *confirmado*: `case when ok + failed = 0`). `mp-refunds` busca el pago por
`mp_payment_id` (o por la serie) y no lo encuentra: la devolución queda pendiente para siempre.
Lo mismo pasa en una serie si el primer turno es el que falla.
**Reproducción:** `pruebas/reproducir_errores_cobro.py` (caso 1).

### H02 · Alta · Pago aprobado sin turno ni devolución (verificado)
**Caso:** el prestador cancela un turno en estado `hold` (o bloquea ese día, o el admin lo elimina) y el cliente
termina de pagar igual. `confirm_payment` solo acepta turnos `hold`/`expired` → `bookings_not_found` → el webhook
responde 409 y Mercado Pago reintenta indefinidamente. La plata queda en la cuenta del prestador, sin turno ni devolución.
**Reproducción:** `pruebas/reproducir_errores_cobro.py` (caso 2).

### H03 · Media · Monto distinto deja el pago en el limbo
`confirm_payment` lanza `amount_mismatch` → mismo efecto que H02.

**Arreglo de H01–H03 (uno solo):** tabla `payments` (id de pago de MP único, ids de turnos, monto, comisión,
estado, fecha) como fuente de verdad del cobro. `confirm_payment` **nunca falla** para un pago aprobado:
registra el pago y, si un turno ya no está disponible, fue cancelado o el monto no coincide, lo marca para
devolver (o para revisión manual) en lugar de lanzar error. `mp-refunds` toma el id de pago de `payments`.
Idempotencia por id de pago.

### H04 · Media · Contracargos y devoluciones hechas en Mercado Pago se ignoran
`mp-webhook` solo procesa `status = approved`. Si el pago pasa a `refunded`, `cancelled` o `charged_back`,
el turno sigue confirmado y pagado. Hay que reflejarlo en el turno y en `payments`.

### H05 · Media · Devoluciones fallidas sin aviso ni registro
`mp-refunds` reintenta cada 10 minutos sin límite y sin avisar (por ejemplo, prestador sin saldo). Tampoco guarda
el id ni la fecha de la devolución hecha. Registrar cada intento y resultado, y mostrar las fallidas en el panel admin
("Para revisar").

### H06 · Media · A verificar en la primera prueba real
`mp-webhook` exige la firma `x-signature` con `MP_WEBHOOK_SECRET`. Confirmar con un pago de prueba que Mercado Pago
firma con la clave de la aplicación de TuTiempo los avisos de pagos cobrados con la llave del prestador
(`notification_url` de la preferencia). Si no, ningún turno se confirmaría.

### H07 · Media · Recordatorios solo dentro de la app
`send_scheduled_notices` crea avisos en `client_messages`: quien no abre la app no se entera del recordatorio de
24 h / 2 h. Agregar envío por email (y opcionalmente Web Push). Afecta directamente las faltas.

### H08 · Media · Precios ×100 con coma decimal (heredado del prototipo)
Los campos de precio usan `parseInt(valor.replace(/\D/g, ""))`: "12500,50" se guarda como 1.250.050.
Validar enteros en pesos y rechazar decimales con mensaje claro (editor de servicios, productos, gastos, caja, admin).

### H09 · Baja · Prueba que depende de la fecha (resuelto en el Bloque 0)
`test_db.py` línea ~259 ("repetición cada 6 semanas permitida") reserva un horario que otra prueba anterior ya
ocupó según el día en que se corre. Usar un horario libre garantizado.

### H10 · Media · DNI en los metadatos de la cuenta
El registro de prestador manda `provider_reg` (con el DNI) en `user_metadata` de Supabase Auth. Queda en
`auth.users` y en el token de sesión hasta que se crea el perfil. El DNI tiene que ir directo a
`provider_private` por función del servidor, nunca por metadatos.

### H11 · Baja · "Identidad verificada" siempre visible
En el perfil público la insignia no depende de `dni_verified`. Riesgo bajo (solo se ven perfiles activados por un
admin), pero debe mostrarse según el dato.

### H12 · Baja · Se puede conectar la cuenta de Mercado Pago de TuTiempo como prestador
El LEEME dice que no se puede, pero `mp-oauth` no lo controla. Comparar `tok.user_id` con el id de usuario de
Mercado Pago de TuTiempo (variable `MP_OWNER_USER_ID`) y rechazar.

### H13 · Baja · Llaves y secretos
- Las llaves de Mercado Pago (`provider_secrets`) se guardan sin cifrar. Evaluar Supabase Vault.
- La tarea programada de devoluciones lleva la `service_role` key escrita en el SQL del cron: guardarla en Vault.
- `mp_oauth_states` no se limpia si el prestador abandona la conexión: borrar estados de más de 1 día.

### H14 · Alta (antes de abrir) · Negocios reales en datos de ejemplo
`ejemplos.sql` y el array `P` de la demo usan nombres, direcciones y hasta un teléfono de negocios reales de
Olavarría. Esos perfiles se pueden reservar y fallan (no tienen Mercado Pago). Reemplazar por datos ficticios y
no cargar ejemplos en producción.

**Ampliado en el Bloque A2:** además de `src/demo/`, hay datos de ejemplo en funciones de producción que mezclan demo y
vivo, y llegan a `dist/`:
- `seedStore` y `demoClosings` (`src/views/prestador/panel.js`): clientes, fichas ("Koleston 7.1 + oxidante 20 vol",
  "Trabajar cervicales; evitar lumbar"…), teléfonos "2284 4…", finanzas de 29 días, gastos ("Alquiler", "Insumos de …")
  y cierres de caja. Viajan enteros en el build de producción. Solo se ejecutan desde `useProvider`, que en vivo solo
  llama la acción `demoLogin` (su botón solo aparece en la demo), pero el código y los textos están.
- `seedComm` (`src/views/prestador/comunidad.js`): en vivo devuelve una comunidad vacía. Sus reseñas y trabajos
  inventados **no** llegan a `dist/` (el minificador los saca porque `LIVE` vale `true`); conviene moverlo igual.

**En el Bloque 2:** mover todo eso a `src/demo/` (en vivo el panel arranca vacío y lo llena la base) y ampliar
`test:sin-demo` para que lo detecte: buscar en `dist/` textos de esos datos (por ejemplo "Koleston 7.1") y que ninguna
función de siembra (`seedStore`, `demoClosings`, `seedComm`) sobreviva en el build de producción.

### H15 · Baja · Contradicciones del LEEME
- Clientes: "si el profesional bloquea el día se devuelve la seña y hay botón Reprogramar". Prestadores y pruebas
  (v31): TuTiempo **no** devuelve la seña en bloqueos de días; el prestador la arregla. Vale la segunda.
- "No puede ser la misma cuenta de TuTiempo": no está implementado (H12).

### H16 · Baja · Mantenimiento
- `vendor/supabase.js` 2.45.4 es viejo: actualizar en un bloque propio, con todas las pruebas.
- Variables internas con letras sueltas: resuelto en el Bloque A2 (ver la tabla de arriba).

### H17 · Baja · Código muerto de saldo y cashback (Bloque A1)
TuTiempo ya no maneja saldo ni cashback (v25), pero el código sigue: `src/lib/saldo.js` (`CASHBACK = 0`, `cbOf`, `wMove`,
`walletPay`, `applyPay`, `refundPay`, `walletBox`, `walletPanel`) y sus usos (`S.wallet`, `S.wmov`, `paid_wallet`, `cashback`
en las vistas y en `liveApi`). En el Bloque A1 se mudó tal cual. **Borrarlo en el Bloque 2**, con sus pruebas (la base
conserva las columnas por compatibilidad).

### H18 · Media · Credenciales de demo precargadas en vivo (Bloque A1)
El estado inicial (`fresh()` en `src/state.js`) trae `S.blogin = { email: "hidro.style@tutiempo.demo", pass: "barbero123" }`
y el formulario "Acceso prestadores" los muestra **también en vivo** (versión 31). Además, `vBPerfil` usa
`sofia@tutiempo.demo` / `hidro.style@tutiempo.demo` como email de respaldo si no hay usuario. En A1 no se tocó (cero cambios
visibles); `pruebas/sin_demo.mjs` los tolera con un tope exacto y avisa "PEND". **Corregir en el Bloque 2** (con H14) y
bajar el tope a 0.

### H19 · Baja · Texto de prototipo visible en producción (Bloque A1)
El pie dice "… Olavarría, Buenos Aires, Argentina · Prototipo" (`index.html`). Revisar en el Bloque 2.

### H20 · Baja · Prueba e2e que dependía de la hora (resuelto en el Bloque A1)
`pruebas/e2e.js` bloqueaba de 20:00 a 21:00 el día de la reserva de la clienta, que es su primer turno libre: corrida de
tarde, la reserva caía a las 20:00 y el bloqueo chocaba ("bloqueo guardado en la base" fallaba también con la versión 31).
Ahora bloquea un día hábil sin turnos. 107/107 con la versión 31 y con la nueva.

### H21 · Media · Lógica de demo en código de producción (Bloque A2)
- `realClients` (`src/views/prestador/clientes.js`) descarta con una expresión regular los nombres de relleno de la demo
  (`Lucas|Matías|Bruno|Iván|Leo|Nahuel|Franco` + inicial A–G + punto) y el nombre "R". **Corre en vivo:** un cliente
  real que se llame, por ejemplo, "Bruno F." no aparece en la lista de clientes ni en los mensajes del prestador.
- `vBPerfil` (`src/views/prestador/perfil.js`): con Mercado Pago conectado, **en vivo** muestra la cuenta
  "hidro.style.mp" (la de la demo). Y el botón "Desconectar" (`mpDesc`) solo cambia la pantalla (`S.mp = "none"`): no
  desconecta nada en la base.
- `occAt` (`estadisticas.js`) y `monthTotals` (`finanzas.js`) inventan ocupación e ingresos de días y meses pasados con
  fórmulas cuando no es `LIVE`. En el build de producción esas ramas no quedan (el minificador las saca), así que hoy
  solo afectan a la demo, pero mezclan demo y vivo en la misma función.

**En el Bloque 2:** que `realClients` no filtre por nombre en vivo; mostrar la cuenta de Mercado Pago real (o ninguna) y
resolver qué hace "Desconectar"; pasar las ramas de demo a `src/demo/`.

### H22 · Baja · Código muerto y texto viejo (Bloque A2)
- `misTurnosHtml` (`src/ui/bookbar.js`) no se usa (el build ya la descarta).
- `const hours = hoursUntil(booking)` en `src/views/cliente/turno.js` no se usa.
- La barra de la demo dice "completá config.cjs": el archivo ahora es `config.js`. Solo se ve en la demo (desarrollo y
  pruebas); el build de producción no la incluye.

**En el Bloque 2:** borrar lo muerto y corregir el texto.


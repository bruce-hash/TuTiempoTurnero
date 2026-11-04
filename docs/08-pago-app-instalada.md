# Pago con Mercado Pago desde la app instalada (4/11 · Bloque 1)

Caso real (Carlos): reserva desde la app instalada en el iPhone, la app lo manda a pagar a Mercado Pago y, pagado, Mercado
Pago lo devuelve **al navegador** (Safari), no a la app. Safari no tiene la sesión de la app (en iPhone, la app instalada y
Safari no comparten sesión ni almacenamiento): ahí no veía su turno.

## Diagnóstico: cómo se abre el cobro hoy

| Dónde | Cómo se abre Mercado Pago | Adónde vuelve |
| --- | --- | --- |
| Navegador (celu o compu) | En la misma pestaña (`location.assign`, `safeRedirect` en `src/lib/dom.js`). Sin `window.open` ni `target=_blank`. | A la misma pestaña, `/turno/<id>?pago=<token>&mp=success` (Mercado Pago vuelve solo con el pago aprobado, `auto_return`). Con la sesión: «Estamos confirmando tu pago» y después «Tenés turno». |
| App instalada en Android | Igual: misma ventana. Android abre la página de Mercado Pago encima de la app (otra dirección, fuera de la app) | La vuelta es una dirección de la app: Android la abre en la app, con la sesión. |
| App instalada en iPhone | Igual: misma ventana. Si Mercado Pago pasa a su propia app o a Safari para pagar, la vuelta se abre en **Safari** | Safari, sin la sesión: antes mostraba «Ingresá para ver tu turno». |

Reproducido en las pruebas con un Mercado Pago falso que hace lo mismo que el real: la vuelta llega **antes** que el aviso
del pago (el turno sigue «pagando») y con los parámetros que agrega Mercado Pago (`collection_id`, `status`,
`external_reference`, `merchant_order_id`, `preference_id`…). En el navegador con sesión anda: confirmando → confirmado.
El problema era solo la app instalada en iPhone.

## Qué se cambió

1. **La confirmación ya no depende de la vuelta** (`src/lib/cobro-pendiente.js`). Antes de salir a Mercado Pago, la app
   guarda el cobro abierto en el dispositivo: el número del turno y el token de regreso, nada personal (vence a los 40
   minutos). Cada vez que la app se abre o vuelve a primer plano (`visibilitychange`, `pageshow`, `focus`), si ese turno
   sigue «pagando», va sola a la pantalla del turno: «Estamos confirmando tu pago», le pide a `mp-reconcile` que consulte
   a Mercado Pago y pasa a «Tenés turno». Si a los 20 segundos Mercado Pago no tiene el pago: «El pago no se completó ·
   Volver a intentar» (y si el pago llega después, la pantalla igual pasa sola a «Tenés turno»: se sigue consultando unos
   3 minutos). Al confirmarse, vencer o cerrar sesión, el cobro guardado se borra.
2. **La vuelta en Safari dice qué hacer.** Desde la app instalada, la vuelta lleva `app=1`
   (`mp-create-preference` recibe `app: true`). Esa pantalla, sin sesión, muestra «Pago recibido · Volvé a la app
   TuTiempo para ver tu turno» (con el servicio, el profesional, el día y la hora, sin datos de la persona) y deja
   «Ingresá acá con tu cuenta» por si no tiene la app a mano. Si el pago no se completó: «Volvé a la app TuTiempo para
   intentarlo de nuevo».
3. **Actualizar en la app instalada** (`src/lib/actualizar.js`). La app instalada no tiene botón de recargar:
   - Al volver a primer plano se vuelven a pedir los datos de la pantalla (Mis turnos y avisos, los turnos del panel, el
     panel de TuTiempo; la Agenda y el perfil del profesional ya lo hacían). Nunca con un guardado en curso, un formulario
     abierto o alguien escribiendo.
   - Deslizar hacia abajo desde arriba de todo: «Deslizá para actualizar» → «Soltá para actualizar» → recarga la misma
     pantalla. Solo en la app instalada (en el navegador ya está el gesto del navegador). No arranca sobre campos, la
     ventana de ingreso, las historias ni la grilla de la Agenda.
   - Por si el gesto choca con algo: «Actualizar» en el menú de cuenta (solo en la app instalada).

## Misma ventana o ventana nueva: qué quedó y por qué

**Quedó la misma ventana** (como estaba). Opciones consideradas:

- **Misma ventana (`location.assign`)**: en el navegador vuelve a la pantalla del turno con la sesión (probado en las
  pruebas); en Android, la vuelta es una dirección de la app y la abre la app (a confirmar en el celular, abajo). En iPhone,
  si Mercado Pago devuelve a Safari, ahora la app lo resuelve sola al volver a abrirla (punto 1) y Safari dice «Volvé a la
  app» (punto 2).
- **Ventana nueva (`window.open` / `target=_blank`)**: en el iPhone con la app instalada abre Safari directo, así que el
  pago siempre terminaría en Safari, también cuando hoy vuelve a la app. Además, el iPhone bloquea las ventanas que no se
  abren en el mismo toque, y el link de Mercado Pago llega después de pedirlo a la base. Es peor en todos los casos.

Lo único que no se puede probar acá es el iPhone real: qué muestra la app cuando la persona vuelve a ella después de pagar
en Safari o en la app de Mercado Pago. Si mostrara todavía la página de Mercado Pago (en lugar de TuTiempo), la solución
es cerrar la app y volver a abrirla: al abrirse, confirma el pago sola. Es el paso 6 de la lista de abajo; si pasa, avisá y
lo resolvemos con otra opción.

## Probar en celulares reales

Con un profesional que tenga Mercado Pago conectado y un servicio con seña. Conviene una tarjeta de prueba de Mercado
Pago si el proyecto está en modo prueba; si no, una seña chica con una tarjeta real (se devuelve cancelando con tiempo).

**iPhone · app instalada (Safari → Compartir → Agregar a inicio)**
1. Abrí TuTiempo desde el ícono, ingresá como cliente y reservá un turno con seña.
2. Tocá pagar: se abre Mercado Pago. Pagá.
3. Si Mercado Pago te deja en Safari: tiene que decir «Pago recibido · Volvé a la app TuTiempo para ver tu turno», con el
   servicio, el profesional y la hora.
4. Volvé a la app TuTiempo (desde el ícono o deslizando entre apps): tiene que mostrar «Estamos confirmando tu pago» y, en
   unos segundos, «Tenés turno».
5. Repetí sin pagar: en Mercado Pago, volvé atrás o cerrá. Al volver a la app: «Estamos confirmando tu pago» y a los
   ~20 segundos «El pago no se completó» con «Volver a intentar». Tocá «Volver a intentar» y pagá: queda confirmado.
6. Anotá qué ves al volver a la app después de pagar: TuTiempo o la página de Mercado Pago. Si es Mercado Pago, cerrá la
   app (deslizando hacia arriba en el selector de apps) y abrila de nuevo: tiene que ir sola al turno confirmado.
7. En Mis turnos, deslizá hacia abajo desde arriba de todo: aparece «Soltá para actualizar» y la pantalla se recarga. En
   el menú de cuenta está «Actualizar».

**iPhone · Safari (sin instalar)**
1. Reservá y pagá. Tiene que volver a Safari, a la pantalla del turno: «Estamos confirmando tu pago» → «Tenés turno».
2. Sin pagar (volver atrás en Mercado Pago): «El pago no se completó» con «Volver a intentar».

**Android · app instalada (Chrome → Instalar app)**
1. Reservá y pagá. Tiene que volver a la app (no a Chrome): «Estamos confirmando tu pago» → «Tenés turno».
2. Si en cambio abre Chrome: tiene que decir «Pago recibido · Volvé a la app TuTiempo», y al volver a la app, confirmado
   (como en el iPhone, pasos 3 y 4).
3. Sin pagar: «El pago no se completó · Volver a intentar».
4. Deslizar hacia abajo en Mis turnos recarga; «Actualizar» en el menú.

**Android · Chrome (sin instalar)**: igual que Safari en el iPhone.

**En los cuatro**: con el turno confirmado, el profesional lo ve en su Agenda, y el cliente recibe el aviso en la app (y
por email y push si los tiene activados). Dejar la app en segundo plano un rato y volver: Mis turnos se pone al día sola.

## Pruebas automáticas
- `pruebas/e2e.js` (bloque «4/11»): navegador con el aviso tardío; app instalada (simulada: `navigator.standalone` y la
  vuelta interceptada como si se abriera en Safari) que confirma sola al volver a abrirse; la vuelta en Safari sin sesión;
  volver a primer plano sin pago → «El pago no se completó»; deslizar para actualizar y «Actualizar» solo en la app.
- `pruebas/funciones/funciones.ts`: `mp-create-preference` devuelve el token y el turno, y marca las tres vueltas con
  `app=1` solo con `app: true`.
- `pruebas/e2e_server.js`: `GET /__mp?modo=tarde|ya` cambia el Mercado Pago falso (la vuelta antes que el aviso).

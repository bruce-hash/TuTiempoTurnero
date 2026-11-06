# Feriados: propuesta (4/11 · Bloque 4, sin programar)

Objetivo: que cada profesional decida, feriado por feriado, si abre o cierra, sin cargar las fechas a mano. Hoy lo puede
hacer con "Bloquear días o semanas" (Horarios), pero tiene que acordarse de cada feriado.

## Cómo funcionaría

1. **Las fechas las trae el servidor, no el navegador.** Una Edge Function nueva, `holidays-sync`, corre una vez por
   semana (cron con `CRON_SECRET`, como `mp-refunds`) y guarda los feriados nacionales del año en curso y del siguiente
   en una tabla `holidays`. El navegador no sale a ninguna API externa (la CSP solo deja conectarse a Supabase).
2. **La decisión es de cada profesional.** Una tabla `provider_holidays (provider_id, day, open)` guarda lo que elige.
   Las dos tablas llevan RLS: `holidays` se lee para todos y la escribe solo la función; `provider_holidays` la ve y la
   cambia solo su profesional.
3. **En Horarios**, debajo de "Bloquear días o semanas": "Próximos feriados", con la fecha, el nombre y dos botones
   "Abro" / "Cierro". "Cierro" usa el mismo bloqueo de días que ya existe: nadie reserva ese día, los turnos que ya
   hubiera se cancelan con el mismo aviso y la misma lista para llamar a cada cliente.
4. **Aviso con tiempo.** Diez días antes de cada feriado sin decidir, un aviso en la campanita del profesional (y push,
   si lo tiene activado): «El lunes 24 es feriado (Día de la Soberanía Nacional). ¿Abrís?», que lleva a Horarios.

## De dónde salen las fechas (para elegir una)

| Fuente | A favor | En contra |
| --- | --- | --- |
| **ArgentinaDatos** (`api.argentinadatos.com/v1/feriados/<año>`, abierta, sin clave) | JSON simple; trae inamovibles, trasladables y puentes turísticos; ya trasladados | Es un proyecto comunitario: si se cae, la función reintenta y quedan las fechas ya guardadas |
| **Calendario público de Google** (feriados de Argentina, archivo ICS) | Muy estable | Mezcla feriados con días no laborables y conmemoraciones: hay que filtrar por nombre; no dice si es puente |
| **Lista cargada a mano** (una migración por año) | Cero dependencias | Hay que acordarse de cargarla; los traslados por decreto llegan tarde |

Recomendación: ArgentinaDatos como fuente principal, con la lista del año guardada en la base. Si la API falla, quedan las
fechas que ya se habían traído, y el admin ve el error en "Para revisar".

## Lo que tenés que decidir antes de programarlo

- **Si no elige nada:** el día queda abierto (como hoy) o se cierra solo. Recomendación: abierto, con el aviso de diez
  días antes. Así nadie pierde turnos por un feriado que no quería cerrar.
- **Qué entra:** solo los nacionales, o también los puentes turísticos y los días no laborables. Recomendación:
  nacionales y puentes; los no laborables no.
- **Feriados de Olavarría** (por ejemplo, el aniversario de la ciudad): no vienen en ninguna fuente nacional. Se pueden
  agregar desde el admin, en la misma tabla.

## Pruebas que llevaría

- La función contra una API falsa (como Mercado Pago y Resend en `pruebas/funciones/`): guarda, no duplica y, si la API
  falla, deja lo que ya había.
- En la base: la RLS de las dos tablas, y que "Cierro" bloquee y cancele igual que "Bloquear días".
- e2e: el profesional ve los próximos feriados, elige "Cierro" y ese día nadie le puede reservar.

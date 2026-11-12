# Avisos de seguidores: cómo funcionan, por qué pueden no llegar y cómo revisarlo (10/11)

## Los cuatro casos

| Qué pasa | Aviso en la app (campanita) | Push |
|---|---|---|
| Alguien sigue al profesional | `provider_notices` `new_follower`: «Ana empezó a seguirte.» (trigger `follows_notice`, **una vez por persona**: dejar de seguir y volver a seguir no lo repite, C06) | «Nuevo seguidor», a Clientes → Seguidores. Solo con «Nuevos seguidores» prendido (`profiles.push_followers`) |
| «Avisar a tus seguidores» (Trabajos) | `client_messages` `news` a cada seguidor, con «Ver perfil» | «Novedad de …», al perfil. Solo con «Recordatorios y avisos» prendido del cliente (`profiles.push_notices`) |
| «Ofrecer» (Agenda o Seguidores) | `client_messages` `offer` con «Reservar» a ese día | «Turno libre en …», al perfil con el día (`/<perfil>?dia=AAAA-MM-DD`). Mismo interruptor del cliente. Vence cuando empieza el horario |
| Dejar de seguir | Sale de la lista de Seguidores y del número (al toque, `provider_followers`) | **10/11:** lo que quedaba en la cola de ese profesional ya no sale (`skip_reason = 'unfollowed'`). Lo que ya le llegó a la campanita queda |

Topes (los pone la base): «Avisar» y «Ofrecer a todos» comparten **5 por día** por profesional; «Ofrecer» a una persona, 10 por día. Con el negocio suspendido o pendiente no se puede (`not_active`, S19). Una cuenta de negocio no sigue a nadie (D33).

## Lo que se corrigió el 10/11

1. **La campanita del cliente no se ponía al día con la app abierta.** Los avisos se pedían al abrir la app y al volver a primer plano, nada más: si la clienta tenía TuTiempo abierto, «Avisar a tus seguidores» y «Ofrecer» no aparecían hasta salir y volver. Ahora se vuelven a pedir cada minuto (`src/lib/avisos-al-dia.js`) y, si llega un push con la app abierta, el service worker le avisa a la app y se ponen al día en el momento (cliente: su campanita; profesional: seguidores, avisos y Agenda).
2. **Dejar de seguir no cortaba la cola de push.** Una novedad u oferta que todavía no había salido le llegaba igual. Ahora `push_due` la saltea (`unfollowed`).
3. **Una suscripción vencida no dejaba rastro.** Cuando Apple o Google contestan 404/410 (el celular desinstaló la app, borró los datos del navegador o el permiso vencido), la suscripción se borra y con ella su cola: no había forma de ver por qué no llegó. Ahora queda una fila en `push_gone` (cuenta, dispositivo, servidor de push, código y qué aviso era; sin el endpoint), 90 días.

## Por qué puede no llegar aunque todo funcione

- **Un celular recibe los push de UNA cuenta: la que tiene la sesión abierta.** Cerrar sesión borra la suscripción del dispositivo, y si en el mismo celular se entra con otra cuenta, el dispositivo pasa a esa cuenta (D27). Si Bruno prueba con la cuenta del profesional y con la de un cliente en el mismo teléfono, solo le llegan los de la cuenta que dejó abierta. Para probar los dos lados hacen falta dos dispositivos (o un navegador por cuenta en la compu).
- **«Empezó a seguirte» sale una sola vez por persona.** Si se prueba siguiendo, dejando de seguir y volviendo a seguir con la misma cuenta, el segundo no llega (a propósito, para que nadie lo use para molestar).
- **Interruptores:** el profesional apaga «Nuevos seguidores» → no hay push de seguidores (el aviso en la campanita queda). El cliente apaga «Recordatorios y avisos» → no hay push de novedades ni de ofertas (quedan en la campanita).
- **iPhone:** el push solo funciona con la app agregada a la pantalla de inicio (iOS 16.4 o más) y con «Activar avisos» tocado ahí adentro.
- **Permiso del sistema:** si el celular tiene las notificaciones de Chrome/Safari apagadas, el servicio de push las acepta (la base dice «enviada») pero el teléfono no las muestra.
- **El envío depende del cron `tt-push`** (cada minuto) y de los secretos `tt_project_url` y `tt_cron_secret` en Vault, más `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` en las Edge Functions (docs/02). Si faltan, la cola queda en `pending`.

## Consultas para el SQL Editor (solo lectura)

Copiá cada una por separado. Ninguna cambia nada. Las horas salen en hora de Argentina.

**1. Las últimas 30 filas de la cola de push, con su estado y error**

```sql
select o.id, (o.created_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as creado,
       u.email as cuenta, s.label as dispositivo, o.kind as aviso, o.status as estado, o.skip_reason as por_que_no,
       o.attempts as intentos, o.last_status as codigo, o.last_error as error,
       (o.sent_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as enviado
  from public.push_outbox o
  join auth.users u on u.id = o.user_id
  left join public.push_subscriptions s on s.id = o.subscription_id
 order by o.id desc
 limit 30;
```

Cómo leerla: `pending` con intentos 0 durante más de 2 minutos → el cron o los secretos no están andando (consulta 6). `skipped` + `opt_out` → la persona tiene apagado ese tipo de aviso. `skipped` + `stale` → venció antes de salir (turno pasado, oferta ya empezada). `skipped` + `unfollowed` → dejó de seguir. `failed` con código 403 → la clave VAPID no coincide con la de la suscripción (volver a «Activar avisos» en ese dispositivo). `sent` → Apple/Google lo aceptó; si no se vio, es el permiso del celular.

**2. Los últimos avisos de seguidor nuevo (lo que ve el profesional en la campanita)**

```sql
select (n.created_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as cuando, p.name as profesional,
       n.body as aviso, n.read_at is not null as leido, n.dismissed_at is not null as borrado
  from public.provider_notices n join public.providers p on p.id = n.provider_id
 where n.kind = 'new_follower'
 order by n.id desc
 limit 20;
```

**3. Quién sigue a quién (los últimos 20)**

```sql
select (f.created_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as desde, p.name as profesional, u.email as seguidor
  from public.follows f join public.providers p on p.id = f.provider_id join auth.users u on u.id = f.user_id
 order by f.created_at desc
 limit 20;
```

**4. Las últimas novedades y ofertas que recibieron los clientes (lo que ven en la campanita)**

```sql
select (m.created_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as cuando, p.name as profesional,
       u.email as cliente, m.kind as tipo, m.body as texto, m.read_at is not null as leido, m.dismissed_at is not null as borrado
  from public.client_messages m join public.providers p on p.id = m.provider_id join auth.users u on u.id = m.user_id
 where m.kind in ('news', 'offer')
 order by m.id desc
 limit 30;
```

**5. Dispositivos con push de cada cuenta, y sus opciones**

```sql
select u.email as cuenta, s.label as dispositivo, (s.created_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as activado,
       (s.last_ok_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as ultimo_ok, s.failures as fallas_seguidas,
       pr.push_notices as recordatorios_y_avisos, pr.push_bookings as reservas, pr.push_followers as nuevos_seguidores
  from auth.users u
  left join public.push_subscriptions s on s.user_id = u.id
  left join public.profiles pr on pr.id = u.id
 order by u.email, s.created_at desc;
```

Una cuenta sin ninguna fila de dispositivo no tiene push en ningún lado (no tocó «Activar avisos», cerró sesión o la suscripción venció: consulta 7).

**6. ¿Está andando el envío? (cron y llamadas a la función)**

```sql
select j.jobname, j.schedule, j.active,
       (select (max(d.start_time) at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) from cron.job_run_details d where d.jobid = j.jobid) as ultima_corrida,
       (select d.status || ' ' || coalesce(d.return_message, '') from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as resultado
  from cron.job j where j.jobname = 'tt-push';

select id, status_code as codigo, left(content::text, 200) as respuesta, error_msg as error,
       (created at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as cuando
  from net._http_response order by id desc limit 10;
```

`codigo` 200 con `{"sent":…}` → la función anda. 401/403 → `tt_cron_secret` de Vault no coincide con `CRON_SECRET` de las funciones. 500 con `config` → faltan las claves VAPID. Sin filas → el cron no llama (faltan `tt_project_url` o `tt_cron_secret` en Vault).

**7. Suscripciones que Apple o Google dieron por vencidas (desde el 10/11)**

```sql
select (g.gone_at at time zone 'America/Argentina/Buenos_Aires')::timestamp(0) as cuando, u.email as cuenta, g.label as dispositivo,
       g.host as servidor, g.status as codigo, g.kind as aviso
  from public.push_gone g left join auth.users u on u.id = g.user_id
 order by g.id desc
 limit 20;
```

Si aparece la cuenta, ese dispositivo tiene que volver a tocar «Activar avisos» (Mi perfil o el Perfil del panel).

**8. Cuántos avisos a seguidores usó hoy cada profesional (tope de 5)**

```sql
select p.name as profesional,
       (select count(*) from public.slot_offers so where so.provider_id = p.id and so.target_user is null
           and (so.created_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date) as ofertas_a_todos,
       (select count(*) from public.posts po where po.provider_id = p.id
           and (po.created_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date) as novedades,
       p.followers as seguidores
  from public.providers p
 where p.followers > 0
 order by p.name;
```

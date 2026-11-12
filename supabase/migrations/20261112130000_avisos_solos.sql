-- =====================================================================
-- 12/11 · Las notificaciones se reactivan solas al ingresar (src/lib/push.js, refreshPush)
-- Con el permiso del navegador ya concedido, al ingresar o al abrir la app el dispositivo se vuelve a ligar solo a la
-- cuenta (push_subscribe; si era de otra cuenta, pasa a esta: una suscripción por dispositivo, como ya era). Al cerrar
-- sesión la suscripción del navegador queda (sin fila en la base no le llega nada) para no pedir otro toque al volver.
-- Una suscripción que el servicio de push dio por vencida (404/410) no tiene que volver a entrar: push_result anota la
-- huella (sha256) de su dirección en push_gone, y push_subscribe la rechaza con push_gone; la app pide entonces una
-- suscripción nueva al navegador. La dirección en sí no se guarda.
-- 12/11 (Bruno): también van por push
--   · los mensajes que el profesional les escribe a sus clientes (Clientes → Mensajes, kind 'msg'): «Mensaje de
--     <profesional>» con el texto; se apagan con «Recordatorios y novedades por notificación» (push_optional) y al
--     bloqueado no le llegan (client_messages_marketing ya no los deja entrar);
--   · «Mandarme una de prueba» (Mi perfil → Notificaciones): push_test manda una a ese dispositivo y push_test_status
--     dice qué pasó (enviada, en camino o el error del servicio de push), para verificar en un celular de verdad.
-- Idempotente.
-- =====================================================================
set search_path = public, extensions;

alter table public.push_gone add column if not exists endpoint_sha text;
create index if not exists push_gone_endpoint on public.push_gone (endpoint_sha) where endpoint_sha is not null;

create or replace function public.push_endpoint_sha(p text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;
revoke execute on function public.push_endpoint_sha(text) from public, anon, authenticated;

-- lo mismo que antes (20261028160000_push.sql), y una dirección vencida no vuelve a entrar
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login_required'; end if;
  if not public.push_endpoint_ok(p_endpoint) then raise exception 'bad_push_endpoint'; end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{22,24}$' then
    raise exception 'bad_push_keys';
  end if;
  -- 12/11: el servicio de push ya dijo que esta dirección no existe más (404/410): el navegador tiene que pedir otra
  if exists (select 1 from public.push_gone where endpoint_sha = public.push_endpoint_sha(p_endpoint)) then
    raise exception 'push_gone';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (uid, p_endpoint, p_p256dh, p_auth, left(nullif(trim(p_label), ''), 60))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    label = excluded.label, failures = 0, first_failure_at = null,
    -- si el dispositivo pasa a otra cuenta, lo pendiente de la anterior no le llega (se borra abajo)
    created_at = case when push_subscriptions.user_id = excluded.user_id then push_subscriptions.created_at else now() end;
  delete from public.push_outbox o using public.push_subscriptions s
   where s.endpoint = p_endpoint and o.subscription_id = s.id and o.user_id <> uid;
  delete from public.push_subscriptions where id in (
    select id from public.push_subscriptions where user_id = uid order by created_at desc offset 10);
end $$;

-- lo mismo que antes (20261110120000_avisos_seguidores.sql), con la huella de la dirección vencida en push_gone
create or replace function public.push_result(p_id bigint, p_status integer, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; n int; wait interval;
begin
  select * into o from public.push_outbox where id = p_id for update;
  if o.id is null or o.status <> 'pending' then return; end if;
  n := o.attempts + 1;
  if p_status between 200 and 299 then
    update public.push_outbox set status = 'sent', attempts = n, sent_at = now(), last_status = p_status, last_error = null where id = p_id;
    update public.push_subscriptions set last_ok_at = now(), failures = 0, first_failure_at = null where id = o.subscription_id;
    return;
  end if;
  if p_status in (404, 410) then
    insert into public.push_gone (user_id, label, host, status, kind, endpoint_sha)
    select s.user_id, s.label, substring(s.endpoint from '^[a-z]+://([^/]+)'), p_status, o.kind, public.push_endpoint_sha(s.endpoint)
      from public.push_subscriptions s where s.id = o.subscription_id;
    delete from public.push_gone where gone_at < now() - interval '90 days';
    delete from public.push_subscriptions where id = o.subscription_id;
    return;
  end if;
  update public.push_subscriptions set failures = least(failures + 1, 30000), first_failure_at = coalesce(first_failure_at, now())
   where id = o.subscription_id;
  wait := (array[interval '1 minute', interval '5 minutes', interval '15 minutes', interval '1 hour'])[least(n, 4)];
  if (p_status = 0 or p_status = 429 or p_status >= 500) and n < 5 and now() + wait < o.expires_at then
    update public.push_outbox set attempts = n, last_status = p_status, last_error = left(p_error, 300), next_attempt_at = now() + wait where id = p_id;
  else
    update public.push_outbox set status = 'failed', attempts = n, last_status = p_status, last_error = left(p_error, 300) where id = p_id;
  end if;
end $$;

-- ---------- 12/11: los mensajes del profesional y la prueba, por push ----------
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect','new_follower','offer','news','holiday',
                  'account','msg','test')) not valid;

-- los que el cliente apaga con «Recordatorios y novedades por notificación» (más el mensaje del profesional)
create or replace function public.push_optional(p_kind text) returns boolean
language sql immutable set search_path = public as $$ select p_kind in ('r24','r2','rev','bday','offer','news','msg') $$;

-- lo mismo que antes (20261104190000_seguidores.sql), más el mensaje del profesional ('msg', vale dos días)
create or replace function public.client_messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid bigint; starts timestamptz;
begin
  if new.kind not in ('conf','r24','r2','rev','bday','cancel','offer','news','msg') then return null; end if;
  if new.kind in ('news','msg') then
    perform public.push_enqueue(new.user_id, new.kind, 'message', new.id, null, now() + interval '2 days');
    return null;
  end if;
  if new.kind = 'offer' then
    -- la oferta vale hasta que empieza el horario
    select o.starts_at into starts from public.slot_offers o where o.id = new.ref::bigint;
    if starts is null then return null; end if;
    perform public.push_enqueue(new.user_id, 'offer', 'message', new.id, null, starts);
    return null;
  end if;
  if new.kind <> 'bday' and new.ref ~ '^[0-9]{1,18}$' then
    select id, starts_at into bid, starts from public.bookings where id = new.ref::bigint;
  end if;
  perform public.push_enqueue(new.user_id, new.kind, 'message', new.id, bid,
    -- un recordatorio vale hasta que empieza el turno; el resto, dos días
    case when new.kind in ('r24','r2') and starts is not null then starts else now() + interval '2 days' end);
  return null;
end $$;

-- «Mandarme una de prueba»: una push a ESTE dispositivo (tiene que ser de quien llama), a lo sumo una cada 30 segundos.
-- Devuelve el número de la prueba para preguntar después cómo salió (push_test_status).
create or replace function public.push_test(p_endpoint text) returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); sid bigint; oid bigint;
begin
  if uid is null then raise exception 'login_required'; end if;
  select id into sid from public.push_subscriptions where endpoint = p_endpoint and user_id = uid;
  if sid is null then raise exception 'push_not_registered'; end if;
  if exists (select 1 from public.push_outbox where subscription_id = sid and kind = 'test' and created_at > now() - interval '30 seconds') then
    raise exception 'push_test_wait';
  end if;
  insert into public.push_outbox (subscription_id, user_id, kind, source, source_id, expires_at)
  values (sid, uid, 'test', 'notice', (extract(epoch from clock_timestamp()) * 1000)::bigint, now() + interval '10 minutes')
  returning id into oid;
  return oid;
end $$;

-- cómo salió la prueba: pending (en camino), sent, failed (con el código y el error del servicio de push) o gone (el
-- servicio dijo que la suscripción ya no existe: se borró, y la app pide una nueva)
create or replace function public.push_test_status(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('status', o.status, 'attempts', o.attempts, 'code', o.last_status, 'error', o.last_error)
       from public.push_outbox o where o.id = p_id and o.user_id = auth.uid() and o.kind = 'test'),
    jsonb_build_object('status', 'gone'))
$$;
revoke execute on function public.push_test(text), public.push_test_status(bigint) from public, anon;
grant execute on function public.push_test(text), public.push_test_status(bigint) to authenticated;

-- push_due: igual que en 20261110240000_feriados_cerrados.sql, con el mensaje del profesional y la prueba
create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; hday text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
        o_start timestamptz; o_pid bigint; o_slug text; o_body text; a_kind text; a_status text;
begin
  for r in select o.id, o.kind, o.source, o.source_id, o.booking_id, o.expires_at, s.endpoint, s.p256dh, s.auth,
                  coalesce(pr.push_notices, true) as wants, coalesce(pr.push_bookings, true) as wants_bookings,
                  coalesce(pr.push_followers, true) as wants_followers
             from public.push_outbox o
             join public.push_subscriptions s on s.id = o.subscription_id
             left join public.profiles pr on pr.id = o.user_id
            where o.status = 'pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.id
            limit greatest(coalesce(p_limit, 100), 1)
            for update of o skip locked loop
    b_status := null; b_start := null; b_pid := null; b_svc := null; b_client := null;
    o_start := null; o_pid := null; o_slug := null; o_body := null; a_kind := null; a_status := null;
    if r.booking_id is not null then
      select bb.status, bb.starts_at, bb.provider_id, bb.service_name, bb.client_name into b_status, b_start, b_pid, b_svc, b_client
        from public.bookings bb where bb.id = r.booking_id;
    end if;
    if r.kind = 'offer' then
      select so.starts_at, so.provider_id, p.slug, m.body into o_start, o_pid, o_slug, o_body
        from public.client_messages m
        join public.slot_offers so on so.id = m.ref::bigint
        join public.providers p on p.id = so.provider_id
       where m.id = r.source_id and m.kind = 'offer';
    end if;
    if r.kind = 'account' then
      select n.kind, p.status into a_kind, a_status
        from public.provider_notices n join public.providers p on p.id = n.provider_id where n.id = r.source_id;
    end if;
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings)
                   or (r.kind = 'new_follower' and not r.wants_followers) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
                 -- 10/11 (20261110120000_avisos_seguidores.sql): dejó de seguir al profesional → lo que quedaba en la cola de ese profesional ya no le llega
                 when r.kind in ('offer','news') and not exists (
                        select 1 from public.client_messages m join public.follows f on f.provider_id = m.provider_id and f.user_id = m.user_id
                         where m.id = r.source_id) then 'unfollowed'
                 when r.kind = 'offer' and (o_start is null or o_start <= now()) then 'stale'
                 -- 10/11 · feriados (D39): el de 7 días antes, si ya eligió; el de los turnos, si ya lo abrió; los dos, si el
                 -- admin sacó el feriado
                 when r.kind = 'holiday' and exists (select 1 from public.provider_notices n where n.id = r.source_id and (
                        not exists (select 1 from public.holidays h where h.day::text = n.ref)
                        or (n.kind = 'holiday' and exists (select 1 from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref))
                        or (n.kind = 'holiday_bookings' and exists (select 1 from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref and d.open)))) then 'stale'
                 -- 10/11 · cuenta: el aviso de suspendida solo mientras lo esté; el de activa, solo si no la volvieron a suspender
                 when r.kind = 'account' and (a_kind is null or a_status = 'deleted' or (a_kind = 'suspended') <> (a_status = 'suspended')) then 'stale'
            end;
    if skip is not null then
      update public.push_outbox set status = 'skipped', skip_reason = skip where push_outbox.id = r.id;
      continue;
    end if;
    t := null; b := null; u := null;
    if r.source = 'message' then
      select p.name into pname from public.client_messages m join public.providers p on p.id = m.provider_id where m.id = r.source_id;
      lt := b_start at time zone public.provider_tz(b_pid);
      case r.kind
        when 'conf' then t := 'Turno confirmado'; b := pname || ' · ' || public.push_when(b_start, b_pid);
        when 'r24'  then t := 'Mañana tenés turno'; b := pname || ' a las ' || to_char(lt, 'HH24:MI');
        when 'r2'   then t := 'Hoy a las ' || to_char(lt, 'HH24:MI') || ' tenés turno'; b := pname || coalesce(' · ' || nullif(b_svc, ''), '');
        when 'rev'  then t := '¿Qué tal tu turno?'; b := 'Contale a ' || pname || ' cómo te fue';
        when 'bday' then t := '¡Feliz cumpleaños!'; b := 'De parte de ' || pname;
        when 'offer' then t := 'Turno libre en ' || pname; b := o_body;
        when 'news' then t := 'Novedad de ' || pname; select m.body into b from public.client_messages m where m.id = r.source_id;
        -- 12/11: el mensaje que el profesional le escribe (Clientes → Mensajes), con su texto
        when 'msg' then t := 'Mensaje de ' || pname; select m.body into b from public.client_messages m where m.id = r.source_id;
        else t := case when b_status = 'expired' then 'No pudimos confirmar tu turno' else 'Se canceló tu turno' end;
             b := pname || '. Abrí TuTiempo para ver el detalle.';
      end case;
      u := case when r.kind = 'news' then '/' || (select p.slug from public.client_messages m join public.providers p on p.id = m.provider_id where m.id = r.source_id)
                when r.kind = 'offer' then '/' || o_slug || '?dia=' || to_char(o_start at time zone public.provider_tz(o_pid), 'YYYY-MM-DD')
                when r.booking_id is not null and r.kind in ('conf','r24','r2','cancel','rev') then '/turno/' || r.booking_id
                else '/mis-turnos' end;
    elsif r.source = 'booking' then
      -- del cliente, solo el nombre de pila (sin apellido ni teléfono)
      who := left(coalesce(nullif(split_part(trim(b_client), ' ', 1), ''), 'Un cliente'), 30);
      svc := coalesce(nullif(b_svc, ''), 'Turno');
      t := case r.kind when 'new_booking' then 'Nueva reserva' else 'Se canceló una reserva' end;
      b := who || ' · ' || svc || ' · ' || public.push_when(b_start, b_pid);
      u := '/panel/agenda?dia=' || to_char(b_start at time zone public.provider_tz(b_pid), 'YYYY-MM-DD');
    else
      -- C06 (V8): un seguidor nuevo, con su nombre de pila (lo guarda el aviso; nada más). 4/11: a la pestaña Seguidores
      if r.kind = 'test' then
        -- 12/11: «Mandarme una de prueba» (Mi perfil → Notificaciones)
        t := 'Prueba de TuTiempo'; b := 'Si ves esto, las notificaciones funcionan en este dispositivo.'; u := '/';
      elsif r.kind = 'account' then
        -- 10/11 · cuenta suspendida (D43): llega siempre (aviso del servicio), a la Agenda, donde está el aviso fijo
        t := case a_kind when 'suspended' then 'Tu cuenta está suspendida' else 'Tu cuenta está activa de nuevo' end;
        b := case a_kind when 'suspended' then 'No aparecés en TuTiempo ni recibís reservas nuevas. Abrí tu panel para ver cómo resolverlo.'
                         else 'Ya aparecés en TuTiempo y podés recibir reservas nuevas.' end;
        u := '/panel/agenda';
      elsif r.kind = 'holiday' then
        -- 10/11 · feriados (D39): «El lunes 24/11 es feriado y tu agenda está cerrada. ¿Vas a trabajar?», a Horarios
        -- (Próximos feriados); «Tenés N turnos el …, que es feriado…», a la Agenda de ese día
        select n.body, case when n.kind = 'holiday_bookings' then n.ref end into b, hday from public.provider_notices n where n.id = r.source_id;
        if hday is not null then
          t := 'Turnos en un feriado'; u := '/panel/agenda?dia=' || hday;
        else
          t := 'Feriado: tu agenda está cerrada'; u := '/panel/horarios';
        end if;
      elsif r.kind = 'new_follower' then
        select n.body into b from public.provider_notices n where n.id = r.source_id;
        t := 'Nuevo seguidor'; b := left(coalesce(b, 'Alguien empezó a seguirte'), 120); u := '/panel/clientes?ver=seguidores';
      -- C41/C42 (V6): el aviso de TuTiempo para conectar Mercado Pago por primera vez ("Avisarle" en el admin)
      elsif r.kind = 'mp_reconnect' and (select n.kind from public.provider_notices n where n.id = r.source_id) = 'mp_connect' then
        t := 'Conectá Mercado Pago'; b := 'Sin Mercado Pago no podés cobrar señas ni recibir reservas online. Conectalo desde tu perfil.';
        u := '/panel/perfil';
      else
        t := case r.kind when 'mp_reconnect' then 'Volvé a conectar Mercado Pago' else 'Novedad en tus cobros' end;
        b := case r.kind when 'mp_reconnect' then 'Hoy no podés cobrar señas. Conectalo desde tu perfil.' else 'Abrí tu panel para ver el detalle.' end;
        u := case r.kind when 'mp_reconnect' then '/panel/perfil' else '/panel/agenda' end;
      end if;
    end if;
    if t is null or b is null then
      update public.push_outbox set status = 'skipped', skip_reason = 'stale' where push_outbox.id = r.id;
      continue;
    end if;
    update public.push_outbox set next_attempt_at = now() + interval '2 minutes' where push_outbox.id = r.id;
    id := r.id; endpoint := r.endpoint; p256dh := r.p256dh; auth := r.auth; title := left(t, 80); body := left(b, 160); url := u;
    -- los avisos de un mismo turno se reemplazan entre sí en la pantalla (el recordatorio pisa a la confirmación)
    tag := case when r.booking_id is not null then 'turno-' || r.booking_id else r.kind || '-' || r.source_id end;
    -- cuánto la guarda el servicio de push si el dispositivo está apagado: hasta que vence, y nunca después del turno
    ttl := greatest(60, least(2419200, extract(epoch from (least(r.expires_at, case when r.kind in ('conf','r24','r2','new_booking') then b_start end) - now()))::int));
    urgency := case when r.kind in ('conf','cancel','r2','new_booking','client_cancel','mp_reconnect','account') then 'high' else 'normal' end;
    return next;
  end loop;
end $$;

revoke execute on function public.push_due(int) from public, anon, authenticated;
grant execute on function public.push_due(int) to service_role;

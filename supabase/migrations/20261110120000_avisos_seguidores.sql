-- =====================================================================
-- TuTiempo · 10/11 · punto 3 · avisos de seguidores
--   - Dejar de seguir: lo que todavía estaba en la cola de push de ese profesional (turno libre ofrecido, novedades)
--     ya no sale (skip_reason 'unfollowed'). Lo que ya le llegó a la campanita queda como estaba.
--   - Suscripciones vencidas: cuando el servicio de push contesta 404/410 la suscripción se borra (y con ella su cola,
--     por la FK). Antes no quedaba rastro; ahora queda una fila en push_gone (cuenta, dispositivo, servidor de push,
--     código y qué aviso era) para poder diagnosticar "no me llegan". Sin el endpoint (es una dirección privada): solo
--     su servidor. Se guarda 90 días. Solo la lee el SQL Editor (RLS sin políticas, sin permisos para la app).
-- Idempotente y sin borrar datos.
-- =====================================================================

alter table public.push_outbox drop constraint if exists push_outbox_skip_reason_check;
alter table public.push_outbox add constraint push_outbox_skip_reason_check
  check (skip_reason in ('opt_out','stale','unfollowed'));

create table if not exists public.push_gone (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  label      text,
  host       text,
  status     smallint,
  kind       text,
  gone_at    timestamptz not null default now()
);
alter table public.push_gone enable row level security;
revoke all on public.push_gone from public, anon, authenticated;
create index if not exists push_gone_user on public.push_gone (user_id, gone_at desc);

-- push_due: igual que antes, más el caso 'unfollowed'
create or replace function public.push_due(p_limit integer DEFAULT 100)
 RETURNS TABLE(id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl integer, urgency text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; skip text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
        o_start timestamptz; o_pid bigint; o_slug text; o_body text;
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
    o_start := null; o_pid := null; o_slug := null; o_body := null;
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
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings)
                   or (r.kind = 'new_follower' and not r.wants_followers) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
                 -- 10/11: dejó de seguir al profesional → lo que quedaba en la cola de ese profesional ya no le llega
                 when r.kind in ('offer','news') and not exists (
                        select 1 from public.client_messages m join public.follows f on f.provider_id = m.provider_id and f.user_id = m.user_id
                         where m.id = r.source_id) then 'unfollowed'
                 when r.kind = 'offer' and (o_start is null or o_start <= now()) then 'stale'
                 -- 7/11 · feriados: ya eligió Abro o Cierro
                 when r.kind = 'holiday' and exists (select 1 from public.provider_notices n join public.provider_holidays d
                                                       on d.provider_id = n.provider_id and d.day::text = n.ref where n.id = r.source_id) then 'stale'
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
      if r.kind = 'holiday' then
        -- 7/11 · feriados: «El lunes 24/11 es feriado (…). ¿Abrís?», a Horarios (Próximos feriados)
        select n.body into b from public.provider_notices n where n.id = r.source_id;
        t := 'Feriado: ¿abrís?'; u := '/panel/horarios';
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
    urgency := case when r.kind in ('conf','cancel','r2','new_booking','client_cancel','mp_reconnect') then 'high' else 'normal' end;
    return next;
  end loop;
end $function$;

-- 404/410: la suscripción ya no existe en el servicio de push. Queda el rastro en push_gone antes de borrarla.
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
    insert into public.push_gone (user_id, label, host, status, kind)
    select s.user_id, s.label, substring(s.endpoint from '^https://([^/]+)'), p_status, o.kind
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

revoke execute on function public.push_due(int), public.push_result(bigint, integer, text) from public, anon, authenticated;
grant execute on function public.push_due(int), public.push_result(bigint, integer, text) to service_role;

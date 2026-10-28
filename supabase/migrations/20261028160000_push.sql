-- =====================================================================
-- TuTiempo · Bloque C · Notificaciones push (D27)
-- Los avisos de la app también salen como notificación al celular o la compu de quien las activó:
--   - cliente: los mismos que por email (confirmación, recordatorios de 24 h y de 2 h, reseña, cumpleaños y
--     cancelaciones), con la misma regla: "Recordatorios y novedades por notificación" (profiles.push_notices, prendida
--     por defecto) apaga los recordatorios, la reseña y el cumpleaños; la confirmación y las cancelaciones llegan siempre;
--   - prestador: "Nueva reserva" y "Cancelación del cliente" (profiles.push_bookings, prendida por defecto) y todo lo de
--     "Avisos de cobros" (provider_notices), que llega siempre.
-- - push_subscriptions: una por dispositivo (endpoint único), solo de servicios de push conocidos (push_endpoint_ok:
--   Google, Mozilla, Apple y Microsoft). Se agrega con push_subscribe; si otra cuenta la activa en el mismo dispositivo,
--   pasa a esa cuenta. Al cerrar sesión la app la borra (push_unsubscribe).
-- - push_outbox: la cola, una fila por aviso y por dispositivo. La llenan triggers en client_messages, provider_notices y
--   bookings; no guarda el texto: push_due lo arma al mandar, con lo mínimo (sin montos, sin DNI; del cliente al
--   prestador, solo el nombre de pila).
-- - La Edge Function push-send (con CRON_SECRET) pide los pendientes (push_due) y avisa cada resultado (push_result):
--   404/410 borra la suscripción; 429 y 5xx reintentan; el resto falla. La base la llama en el momento (pg_net, al
--   encolar) y pg_cron cada minuto (tt-push) como respaldo.
-- - Limpieza diaria: la cola terminada con más de 30 días y las suscripciones que fallan sin parar hace 30 días.
-- No cambia datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Opciones (Mi perfil) ----------
alter table public.profiles add column if not exists push_notices boolean not null default true;
alter table public.profiles add column if not exists push_bookings boolean not null default true;
grant select (push_notices, push_bookings), update (push_notices, push_bookings) on public.profiles to authenticated;   -- su fila (profiles_self/update)

-- ---------- Servicios de push conocidos ----------
-- https, sin puerto ni usuario, y el host de un servicio de push (el mismo criterio que knownEndpoint en webpush.ts)
create or replace function public.push_endpoint_ok(p text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(char_length(p) <= 1000 and p ~ ('^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|'
                  || '([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'), false)
$$;

-- ---------- Suscripciones ----------
create table if not exists public.push_subscriptions (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users(id) on delete cascade,
  endpoint         text not null unique check (char_length(endpoint) <= 1000),
  p256dh           text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}$'),   -- 65 octetos en base64url
  auth             text not null check (auth ~ '^[A-Za-z0-9_-]{22,24}$'),     -- 16 octetos
  label            text check (char_length(label) <= 60),
  created_at       timestamptz not null default now(),
  last_ok_at       timestamptz,
  failures         smallint not null default 0,
  first_failure_at timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;   -- sin políticas: solo las funciones de abajo
revoke all on public.push_subscriptions from public, anon, authenticated;

-- agregar (o renovar) la suscripción de este dispositivo; hasta 10 por cuenta (se borran las más viejas)
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text default null) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'login_required'; end if;
  if not public.push_endpoint_ok(p_endpoint) then raise exception 'bad_push_endpoint'; end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{86,88}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{22,24}$' then
    raise exception 'bad_push_keys';
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

-- borrar la de este dispositivo (Desactivar o cerrar sesión): solo si es de quien llama
create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;

-- ¿este dispositivo está suscripto a esta cuenta? (Mi perfil: "Activadas")
create or replace function public.push_registered(p_endpoint text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid())
$$;

-- ---------- La cola ----------
create table if not exists public.push_outbox (
  id              bigint generated always as identity primary key,
  subscription_id bigint not null references public.push_subscriptions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect')),
  source          text not null check (source in ('message','notice','booking')),
  source_id       bigint not null,
  booking_id      bigint references public.bookings(id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts        smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  expires_at      timestamptz not null,
  last_status     smallint,
  last_error      text check (char_length(last_error) <= 300),
  skip_reason     text check (skip_reason in ('opt_out','stale')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  unique (source, source_id, kind, subscription_id)
);
create index if not exists push_outbox_due on public.push_outbox (next_attempt_at) where status = 'pending';
alter table public.push_outbox enable row level security;   -- sin políticas: solo las funciones de abajo
revoke all on public.push_outbox from public, anon, authenticated;

-- los que el cliente puede apagar (como en email) y los que el prestador puede apagar
create or replace function public.push_optional(p_kind text) returns boolean
language sql immutable set search_path = public as $$ select p_kind in ('r24','r2','rev','bday') $$;
create or replace function public.push_booking_kind(p_kind text) returns boolean
language sql immutable set search_path = public as $$ select p_kind in ('new_booking','client_cancel') $$;

-- una fila por dispositivo de quien recibe (si no lo apagó)
create or replace function public.push_enqueue(p_user uuid, p_kind text, p_source text, p_source_id bigint, p_booking bigint, p_expires timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if p_user is null or p_expires <= now() then return; end if;
  select push_notices, push_bookings into pr from public.profiles where id = p_user;
  if (public.push_optional(p_kind) and not coalesce(pr.push_notices, true))
     or (public.push_booking_kind(p_kind) and not coalesce(pr.push_bookings, true)) then
    return;
  end if;
  insert into public.push_outbox (subscription_id, user_id, kind, source, source_id, booking_id, expires_at)
  select s.id, p_user, p_kind, p_source, p_source_id, p_booking, p_expires from public.push_subscriptions s where s.user_id = p_user
  on conflict do nothing;
end $$;

-- cliente: los avisos que la app le deja en client_messages (los mismos tipos que van por email)
create or replace function public.client_messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid bigint; starts timestamptz;
begin
  if new.kind not in ('conf','r24','r2','rev','bday','cancel') then return null; end if;
  if new.kind <> 'bday' and new.ref ~ '^[0-9]{1,18}$' then
    select id, starts_at into bid, starts from public.bookings where id = new.ref::bigint;
  end if;
  perform public.push_enqueue(new.user_id, new.kind, 'message', new.id, bid,
    -- un recordatorio vale hasta que empieza el turno; el resto, dos días
    case when new.kind in ('r24','r2') and starts is not null then starts else now() + interval '2 days' end);
  return null;
end $$;
drop trigger if exists client_messages_push on public.client_messages;
create trigger client_messages_push after insert on public.client_messages
  for each row execute function public.client_messages_push();

-- prestador: "Avisos de cobros" (siempre)
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind = 'mp_reconnect' then 'mp_reconnect' else 'cobros' end, 'notice', new.id, null, now() + interval '3 days');
  return null;
end $$;
drop trigger if exists provider_notices_push on public.provider_notices;
create trigger provider_notices_push after insert on public.provider_notices
  for each row execute function public.provider_notices_push();

-- prestador: una reserva de la app que queda confirmada (la seña acreditada o sin seña) y el cliente que cancela
create or replace function public.bookings_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.source <> 'app' or new.starts_at <= now() then return null; end if;
  select owner_id into owner from public.providers where id = new.provider_id;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status = 'hold') then
    perform public.push_enqueue(owner, 'new_booking', 'booking', new.id, new.id, new.starts_at);
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled_client' then
    perform public.push_enqueue(owner, 'client_cancel', 'booking', new.id, new.id, new.starts_at);
  end if;
  return null;
end $$;
drop trigger if exists bookings_push on public.bookings;
create trigger bookings_push after insert or update of status on public.bookings
  for each row execute function public.bookings_push();

-- ---------- Llamar a push-send ----------
-- p_quiet: desde el trigger de la cola no avisa si faltan los secretos (en un entorno sin Vault no hace nada)
create or replace function public.run_push_send(p_quiet boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    if not p_quiet then raise warning 'run_push_send: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)'; end if;
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/push-send',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

-- en el momento: una llamada por sentencia que encola (pg_net la manda solo si la transacción se confirma)
create or replace function public.push_outbox_kick() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.run_push_send(true);
  return null;
exception when others then
  -- un problema para llamar a la función nunca frena el turno ni el aviso: el cron lo manda en un minuto
  return null;
end $$;
drop trigger if exists push_outbox_kick on public.push_outbox;
create trigger push_outbox_kick after insert on public.push_outbox
  for each statement execute function public.push_outbox_kick();

-- respaldo: cada minuto (requiere pg_cron y pg_net; si no están, no hace nada y se puede volver a correr)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('tt-push', '* * * * *', 'select public.run_push_send()');
  end if;
end $$;

-- ---------- Lo que la función tiene que mandar ----------
-- día y hora cortos para la notificación: "jue 22/10, 17:30" (en la hora del prestador)
create or replace function public.push_when(p_start timestamptz, p_pid bigint) returns text
language sql stable security definer set search_path = public as $$
  select (array['dom','lun','mar','mié','jue','vie','sáb'])[extract(dow from lt)::int + 1] || ' ' || to_char(lt, 'DD/MM, HH24:MI')
  from (select p_start at time zone public.provider_tz(p_pid) as lt) x
$$;

-- Toma hasta p_limit pendientes (los reserva 2 minutos para que dos corridas no manden lo mismo), descarta los que ya no
-- van y arma lo que se muestra: título, texto (lo mínimo), adónde lleva al tocarla, etiqueta, TTL y urgencia.
create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
begin
  for r in select o.id, o.kind, o.source, o.source_id, o.booking_id, o.expires_at, s.endpoint, s.p256dh, s.auth,
                  coalesce(pr.push_notices, true) as wants, coalesce(pr.push_bookings, true) as wants_bookings
             from public.push_outbox o
             join public.push_subscriptions s on s.id = o.subscription_id
             left join public.profiles pr on pr.id = o.user_id
            where o.status = 'pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.id
            limit greatest(coalesce(p_limit, 100), 1)
            for update of o skip locked loop
    b_status := null; b_start := null; b_pid := null; b_svc := null; b_client := null;
    if r.booking_id is not null then
      select bb.status, bb.starts_at, bb.provider_id, bb.service_name, bb.client_name into b_status, b_start, b_pid, b_svc, b_client
        from public.bookings bb where bb.id = r.booking_id;
    end if;
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
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
        else t := case when b_status = 'expired' then 'No pudimos confirmar tu turno' else 'Se canceló tu turno' end;
             b := pname || '. Abrí TuTiempo para ver el detalle.';
      end case;
      u := case when r.booking_id is not null and r.kind in ('conf','r24','r2','cancel','rev') then '/turno/' || r.booking_id else '/mis-turnos' end;
    elsif r.source = 'booking' then
      -- del cliente, solo el nombre de pila (sin apellido ni teléfono)
      who := left(coalesce(nullif(split_part(trim(b_client), ' ', 1), ''), 'Un cliente'), 30);
      svc := coalesce(nullif(b_svc, ''), 'Turno');
      t := case r.kind when 'new_booking' then 'Nueva reserva' else 'Se canceló una reserva' end;
      b := who || ' · ' || svc || ' · ' || public.push_when(b_start, b_pid);
      u := '/panel/agenda?dia=' || to_char(b_start at time zone public.provider_tz(b_pid), 'YYYY-MM-DD');
    else
      t := case r.kind when 'mp_reconnect' then 'Volvé a conectar Mercado Pago' else 'Novedad en tus cobros' end;
      b := case r.kind when 'mp_reconnect' then 'Hoy no podés cobrar señas. Conectalo desde tu perfil.' else 'Abrí tu panel para ver el detalle.' end;
      u := case r.kind when 'mp_reconnect' then '/panel/perfil' else '/panel/agenda' end;
    end if;
    if t is null or b is null then
      update public.push_outbox set status = 'skipped', skip_reason = 'stale' where push_outbox.id = r.id;
      continue;
    end if;
    update public.push_outbox set next_attempt_at = now() + interval '2 minutes' where push_outbox.id = r.id;
    id := r.id; endpoint := r.endpoint; p256dh := r.p256dh; auth := r.auth; title := left(t, 80); body := left(b, 160); url := u;
    -- los avisos de un mismo turno se reemplazan entre sí en la pantalla (el recordatorio pisa a la confirmación)
    tag := case when r.booking_id is not null then 'turno-' || r.booking_id else r.kind || '-' || r.source_id end;
    ttl := greatest(60, least(2419200, extract(epoch from (r.expires_at - now()))::int));
    urgency := case when r.kind in ('conf','cancel','r2','new_booking','client_cancel','mp_reconnect') then 'high' else 'normal' end;
    return next;
  end loop;
end $$;

-- ---------- Resultado de cada envío ----------
-- p_status: el código HTTP del servicio de push (0 si no respondió).
--   2xx: enviado. 404/410: la suscripción venció o la sacaron: se borra (con lo pendiente de ese dispositivo).
--   429, 5xx o sin respuesta: reintento a 1, 5, 15 y 60 minutos, sin pasar del vencimiento; después del quinto, falla.
--   El resto (400, 401, 403, 413): falla enseguida (403 suele ser una clave VAPID que no coincide).
create or replace function public.push_result(p_id bigint, p_status int, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
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

-- ---------- Estado para el admin ----------
-- cuántos dispositivos y cómo salieron las últimas 24 horas; vapid_rejected > 0 = las claves VAPID no coinciden
create or replace function public.admin_push_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'devices', (select count(*) from public.push_subscriptions),
    'sent_24h', (select count(*) from public.push_outbox where status = 'sent' and sent_at > now() - interval '1 day'),
    'failed_24h', (select count(*) from public.push_outbox where status = 'failed' and created_at > now() - interval '1 day'),
    'vapid_rejected_24h', (select count(*) from public.push_outbox where last_status in (401, 403) and created_at > now() - interval '1 day'));
end $$;

-- ---------- Limpieza diaria ----------
-- La de 20261026033854_emails.sql más la cola de push terminada con más de 30 días y las suscripciones que fallan sin
-- parar hace 30 días (las que vencen de verdad las borra push_result con el 404/410).
create or replace function public.daily_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_states int; n_events int; n_emails int; n_push int; n_subs int;
begin
  delete from public.mp_oauth_states where created_at < now() - interval '1 day';
  get diagnostics n_states = row_count;
  delete from public.mp_webhook_events e
   where e.created_at < now() - interval '180 days'
     and not exists (select 1 from public.payments p where p.mp_payment_id = e.mp_payment_id
                     and p.outcome = 'review' and p.review_resolved_at is null);
  get diagnostics n_events = row_count;
  delete from public.email_outbox where status in ('sent','skipped','failed') and created_at < now() - interval '90 days';
  get diagnostics n_emails = row_count;
  delete from public.push_outbox where status in ('sent','skipped','failed') and created_at < now() - interval '30 days';
  get diagnostics n_push = row_count;
  delete from public.push_subscriptions where first_failure_at < now() - interval '30 days';
  get diagnostics n_subs = row_count;
  return jsonb_build_object('oauth_states', n_states, 'webhook_events', n_events, 'emails', n_emails, 'push', n_push, 'push_devices', n_subs);
end $$;

-- ---------- Permisos ----------
revoke execute on function public.push_endpoint_ok(text), public.push_optional(text), public.push_booking_kind(text),
  public.push_enqueue(uuid, text, text, bigint, bigint, timestamptz), public.client_messages_push(), public.provider_notices_push(),
  public.bookings_push(), public.run_push_send(boolean), public.push_outbox_kick(), public.push_when(timestamptz, bigint),
  public.push_due(int), public.push_result(bigint, int, text), public.push_subscribe(text, text, text, text),
  public.push_unsubscribe(text), public.push_registered(text), public.admin_push_health() from public, anon, authenticated;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(text), public.push_registered(text),
  public.admin_push_health() to authenticated;
grant execute on function public.push_due(int), public.push_result(bigint, int, text), public.run_push_send(boolean) to service_role;
revoke execute on function public.daily_cleanup() from public, anon, authenticated;
grant execute on function public.daily_cleanup() to service_role;

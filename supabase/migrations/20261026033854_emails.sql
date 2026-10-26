-- =====================================================================
-- TuTiempo · Bloque 3 · Avisos por email (H07, D10, D14: Resend)
-- Los avisos que la app ya le deja al cliente en client_messages (confirmación, recordatorio de 24 h y de 2 h, reseña,
-- cumpleaños y cancelaciones) también salen por email, con el mismo texto (ya armado con la plantilla y respetando el
-- interruptor del prestador). Un email por aviso, y client_messages ya tiene un aviso por turno y tipo
-- (client_messages_once): una sola vez por turno y tipo.
-- - profiles.email_notices ("Recordatorios y novedades por email" en Mi perfil, por defecto encendida): apaga los
--   recordatorios de 24 h y de 2 h, la reseña y el cumpleaños. La confirmación y las cancelaciones salen siempre: son
--   avisos del servicio, no promoción (D25).
-- - email_outbox: la cola. La llena un trigger en client_messages; la Edge Function email-send (pg_cron cada 5 minutos,
--   con CRON_SECRET de Vault, como mp-refunds) pide los pendientes (emails_due), los manda con Resend y avisa el
--   resultado (email_result), con reintentos.
-- - Solo a emails confirmados. Un recordatorio no sale si el turno ya empezó o dejó de estar confirmado.
-- - Turno que el sistema no pudo confirmar (expired con devolución): ahora también deja su aviso de cancelación en la
--   app (antes solo se veía en Mis turnos), con el mismo texto.
-- - Retención: la limpieza diaria (daily_cleanup) borra de la cola lo enviado, descartado o fallido con más de 90 días.
-- No cambia datos: los avisos que ya existían no se mandan.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Opción del cliente ----------
alter table public.profiles add column if not exists email_notices boolean not null default true;
grant select (email_notices), update (email_notices) on public.profiles to authenticated;   -- su fila (profiles_self/update)

-- ---------- Aviso del turno que el sistema no pudo confirmar ----------
-- confirm_payment deja el turno en 'expired' con lo cobrado y pide la devolución (refunds): el aviso sale de ahí, con
-- el motivo que muestra Mis turnos (src/lib/devoluciones.js).
create or replace function public.refunds_expired_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; why text;
begin
  why := case new.reason when 'slot_taken' then 'el horario ya no estaba libre cuando se acreditó tu pago'
                         when 'booking_unavailable' then 'el turno ya no estaba disponible cuando se acreditó tu pago'
                         when 'amount_short' then 'el pago no alcanzó para el turno' end;
  if why is null or new.booking_id is null then return null; end if;
  select bk.id, bk.provider_id, bk.client_id, bk.status, p.id as pid, p.name, p.slug into b
    from public.bookings bk join public.providers p on p.id = bk.provider_id where bk.id = new.booking_id;
  if b.id is null or b.client_id is null or b.status <> 'expired' then return null; end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id,
          left('No pudimos confirmar tu turno del ' || public.booking_when(b.id) || ' en ' || b.name || ': ' || why ||
               '. Te devolvemos ' || public.money_txt(new.amount) || '. Si querés, reservá de nuevo: ' || public.provider_link(b.pid, b.slug), 600),
          'cancel', b.id::text)
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists refunds_expired_notice on public.refunds;
create trigger refunds_expired_notice after insert on public.refunds
  for each row execute function public.refunds_expired_notice();

-- ---------- La cola ----------
create table if not exists public.email_outbox (
  id                  bigint generated always as identity primary key,
  message_id          bigint not null unique references public.client_messages(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  kind                text not null check (kind in ('conf','r24','r2','rev','bday','cancel')),
  booking_id          bigint references public.bookings(id) on delete set null,
  status              text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts            smallint not null default 0,
  next_attempt_at     timestamptz not null default now(),
  expires_at          timestamptz not null,
  provider_message_id text check (char_length(provider_message_id) <= 100),
  last_error          text check (char_length(last_error) <= 300),
  skip_reason         text check (skip_reason in ('opt_out','no_email','stale')),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz
);
create index if not exists email_outbox_due on public.email_outbox (next_attempt_at) where status = 'pending';
alter table public.email_outbox enable row level security;   -- sin políticas: solo las funciones de abajo
revoke all on public.email_outbox from anon, authenticated;

-- avisos que el cliente puede apagar en Mi perfil; la confirmación y las cancelaciones salen siempre
create or replace function public.email_optional(p_kind text) returns boolean
language sql immutable set search_path = public as $$ select p_kind in ('r24','r2','rev','bday') $$;

-- cada aviso de estos tipos entra a la cola (los opcionales, si el cliente no los apagó)
create or replace function public.client_messages_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid bigint; starts timestamptz;
begin
  if new.kind not in ('conf','r24','r2','rev','bday','cancel') then return null; end if;
  if public.email_optional(new.kind) and not coalesce((select email_notices from public.profiles where id = new.user_id), true) then
    return null;
  end if;
  if new.kind <> 'bday' and new.ref ~ '^[0-9]{1,18}$' then
    select id, starts_at into bid, starts from public.bookings where id = new.ref::bigint;
  end if;
  insert into public.email_outbox (message_id, user_id, kind, booking_id, expires_at)
  values (new.id, new.user_id, new.kind, bid,
          -- un recordatorio vale hasta que empieza el turno; el resto, dos días
          case when new.kind in ('r24','r2') and starts is not null then starts else now() + interval '2 days' end)
  on conflict (message_id) do nothing;
  return null;
end $$;
drop trigger if exists client_messages_email on public.client_messages;
create trigger client_messages_email after insert on public.client_messages
  for each row execute function public.client_messages_email();

-- ---------- Lo que la función tiene que mandar ----------
-- Toma hasta p_limit pendientes (los reserva 15 minutos para que dos corridas no manden lo mismo) y descarta los que
-- ya no van: opcional que el cliente apagó, sin email confirmado, recordatorio de un turno que ya empezó o no está
-- confirmado, o vencidos.
create or replace function public.emails_due(p_limit int default 50)
returns table (id bigint, to_email text, subject text, body text, provider_name text, site_url text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; subj text; site text := (select s.site_url from public.app_settings s where s.id);
begin
  for r in select o.id, o.kind, o.expires_at, o.user_id, m.body, p.name as pname, u.email, u.email_confirmed_at,
                  coalesce(pr.email_notices, true) as wants, b.status as bstatus, b.starts_at,
                  b.starts_at at time zone public.provider_tz(b.provider_id) as lt
             from public.email_outbox o
             join public.client_messages m on m.id = o.message_id
             join public.providers p on p.id = m.provider_id
             join auth.users u on u.id = o.user_id
             left join public.profiles pr on pr.id = o.user_id
             left join public.bookings b on b.id = o.booking_id
            where o.status = 'pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.id
            limit greatest(coalesce(p_limit, 50), 1)
            for update of o skip locked loop
    skip := case when not r.wants and public.email_optional(r.kind) then 'opt_out'
                 when r.email is null or r.email_confirmed_at is null then 'no_email'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('r24','r2','conf') and (r.bstatus is distinct from 'confirmed' or r.starts_at <= now()) then 'stale'
            end;
    if skip is not null then
      update public.email_outbox set status = 'skipped', skip_reason = skip where email_outbox.id = r.id;
      continue;
    end if;
    subj := case r.kind
      when 'conf' then 'Tu turno en ' || r.pname || ' quedó confirmado'
      when 'r24'  then 'Mañana tenés turno en ' || r.pname
      when 'r2'   then 'Hoy a las ' || to_char(r.lt, 'HH24:MI') || ' tenés turno en ' || r.pname
      when 'rev'  then '¿Qué tal tu turno en ' || r.pname || '?'
      when 'bday' then '¡Feliz cumpleaños de parte de ' || r.pname || '!'
      else case r.bstatus
             when 'cancelled_provider' then r.pname || ' canceló tu turno'
             when 'expired' then 'No pudimos confirmar tu turno en ' || r.pname
             else 'Tu turno en ' || r.pname || ' quedó cancelado' end
    end;
    update public.email_outbox set next_attempt_at = now() + interval '15 minutes' where email_outbox.id = r.id;
    id := r.id; to_email := r.email; subject := left(subj, 200); body := r.body; provider_name := r.pname; site_url := site;
    return next;
  end loop;
end $$;

-- ---------- Resultado de cada envío ----------
-- Si falla, se reintenta a los 5 minutos, 15 minutos, 1 hora y 3 horas; después del quinto intento (o vencido) queda
-- 'failed'. Un error que no se arregla reintentando (dirección inválida, p_permanent) queda 'failed' enseguida.
create or replace function public.email_result(p_id bigint, p_ok boolean, p_provider_message_id text default null,
                                               p_error text default null, p_permanent boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare o record; n int; wait interval;
begin
  select * into o from public.email_outbox where id = p_id for update;
  if o.id is null or o.status <> 'pending' then return; end if;
  n := o.attempts + 1;
  if p_ok then
    update public.email_outbox set status = 'sent', attempts = n, sent_at = now(), last_error = null,
           provider_message_id = left(p_provider_message_id, 100) where id = p_id;
    return;
  end if;
  wait := (array[interval '5 minutes', interval '15 minutes', interval '1 hour', interval '3 hours'])[least(n, 4)];
  if p_permanent or n >= 5 or now() + wait >= o.expires_at then
    update public.email_outbox set status = 'failed', attempts = n, last_error = left(p_error, 300) where id = p_id;
  else
    update public.email_outbox set attempts = n, last_error = left(p_error, 300), next_attempt_at = now() + wait where id = p_id;
  end if;
end $$;

-- ---------- Llamar a email-send (cron) ----------
create or replace function public.run_email_send() returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    raise warning 'run_email_send: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/email-send',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
end $$;

-- cada 5 minutos (como tt-refunds: requiere pg_cron y pg_net; si no están, no hace nada y se puede volver a correr)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('tt-emails', '*/5 * * * *', 'select public.run_email_send()');
  end if;
end $$;

-- ---------- Limpieza diaria ----------
-- La de 20261025171952_seguridad.sql (intentos de conexión con Mercado Pago y avisos descartados) más la cola de emails:
-- lo enviado, descartado o fallido con más de 90 días (D25). Lo pendiente no se borra.
create or replace function public.daily_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_states int; n_events int; n_emails int;
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
  return jsonb_build_object('oauth_states', n_states, 'webhook_events', n_events, 'emails', n_emails);
end $$;

-- ---------- Permisos ----------
revoke execute on function public.refunds_expired_notice(), public.client_messages_email(), public.emails_due(int),
  public.email_result(bigint, boolean, text, text, boolean), public.run_email_send() from public, anon, authenticated;
grant execute on function public.emails_due(int), public.email_result(bigint, boolean, text, text, boolean), public.run_email_send() to service_role;
revoke execute on function public.daily_cleanup() from public, anon, authenticated;
grant execute on function public.daily_cleanup() to service_role;

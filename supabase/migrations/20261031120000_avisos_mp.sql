-- Paso 1 (correcciones v4): ningún pago de Mercado Pago queda sin registrar aunque el aviso no llegue o se rechace.
-- - mp_checkouts: cada cobro que se abre (mp-create-preference) con un token de regreso. La pantalla de regreso lo usa
--   para mostrar el estado del pago y del turno SIN sesión (checkout_status), y mp-reconcile lo usa para preguntarle a
--   Mercado Pago por el pago si el aviso no llegó (checkouts_due / checkout_checked, cron tt-mp-sync cada 2 minutos).
-- - mp_webhook_events: también quedan los avisos rechazados ANTES de procesar (firma inválida o vencida, sin firma, sin
--   datos, configuración incompleta) y los pagos que encontró la consulta sin aviso ('recovered'). Con el detalle (sin
--   datos personales), cuántas veces llegó (hits) y la última vez. Un aviso repetido suma hits en vez de otra fila.
-- - admin_review: el detalle de cada aviso y un resumen ('webhook_alert') para el aviso de "Para revisar".
-- - checkout_backfill: para los cobros abiertos antes de esta migración (por ejemplo, los del 30/10). No corre sola: la
--   corre Bruno a mano (docs/02), porque puede confirmar o devolver pagos reales.

-- ---------- Avisos rechazados o recuperados ----------
alter table public.mp_webhook_events add column if not exists detail text check (char_length(detail) <= 160);
alter table public.mp_webhook_events add column if not exists hits int not null default 1;
alter table public.mp_webhook_events add column if not exists last_at timestamptz not null default now();
alter table public.mp_webhook_events drop constraint if exists mp_webhook_events_reason_check;
alter table public.mp_webhook_events add constraint mp_webhook_events_reason_check check (reason in (
  'unknown_provider','payment_not_found','wrong_collector','bad_currency',            -- después de consultar el pago
  'bad_signature','stale_signature','no_signature','bad_request','config_error',     -- antes de procesar (rechazados)
  'recovered'));                                                                      -- pago sin aviso, lo encontró mp-reconcile
create index if not exists mp_webhook_events_dedupe on public.mp_webhook_events (reason, mp_payment_id, last_at desc);

-- un solo registro por motivo, pago y prestador en 24 h (los reintentos de Mercado Pago suman hits); a lo sumo 500
-- registros nuevos o repetidos por hora: un aviso falso en cantidad no llena la tabla
drop function if exists public.mp_webhook_event(text, bigint, bigint, text);
create or replace function public.mp_webhook_event(p_payment_id text, p_provider bigint, p_account bigint, p_reason text,
                                                   p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pay text := nullif(left(regexp_replace(coalesce(p_payment_id, ''), '[^A-Za-z0-9_-]', '', 'g'), 40), '');
        prov bigint := (select id from public.providers where id = p_provider);
        acc bigint := (select id from public.mp_accounts where id = p_account);
        det text := nullif(left(btrim(regexp_replace(coalesce(p_detail, ''), '[[:cntrl:]<>]', ' ', 'g')), 160), '');
        hit bigint;
begin
  if (select count(*) from public.mp_webhook_events where last_at > now() - interval '1 hour') >= 500 then return; end if;
  update public.mp_webhook_events set hits = hits + 1, last_at = now(), detail = coalesce(det, detail)
   where id = (select id from public.mp_webhook_events
                where reason = p_reason and mp_payment_id is not distinct from pay and provider_id is not distinct from prov
                  and last_at > now() - interval '24 hours'
                order by last_at desc limit 1)
  returning id into hit;
  if hit is null then
    insert into public.mp_webhook_events (mp_payment_id, provider_id, mp_account_id, reason, detail)
    values (pay, prov, acc, p_reason, det);
  end if;
end $$;

-- ---------- Cobros abiertos: token de regreso y consulta a Mercado Pago ----------
create table if not exists public.mp_checkouts (
  id            bigint generated always as identity primary key,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 del token (el token viaja solo en la vuelta)
  booking_ids   bigint[] not null check (cardinality(booking_ids) between 1 and 4),   -- en el orden del external_reference
  provider_id   bigint references public.providers(id) on delete cascade,
  mp_account_id bigint references public.mp_accounts(id) on delete set null,          -- la cuenta que cobra (y con la que se consulta)
  created_at    timestamptz not null default now(),
  checks        smallint not null default 0,
  next_check_at timestamptz not null default now() + interval '2 minutes',
  last_check_at timestamptz,
  last_error    text check (char_length(last_error) <= 200),
  closed_at     timestamptz,
  closed_reason text check (closed_reason in ('paid','gave_up'))
);
create index if not exists mp_checkouts_due on public.mp_checkouts (next_check_at) where closed_at is null;
create index if not exists mp_checkouts_provider on public.mp_checkouts (provider_id) where closed_at is null;
alter table public.mp_checkouts enable row level security;
revoke all on public.mp_checkouts from public, anon, authenticated;
grant select, insert, update, delete on public.mp_checkouts to service_role;

create or replace function public.checkout_hash(p_token text) returns text
language sql immutable set search_path = public as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
$$;

-- abre el cobro (mp-create-preference, antes de crear la preferencia) y devuelve el token de regreso
create or replace function public.checkout_open(p_booking_ids bigint[], p_account bigint) returns text
language plpgsql security definer set search_path = public as $$
declare tok text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
        pid bigint; n int;
begin
  select min(provider_id), count(*) into pid, n from public.bookings
   where id = any(coalesce(p_booking_ids, '{}')) and source = 'app' and status = 'hold';
  if n = 0 or n <> cardinality(p_booking_ids) or n > 4
     or (select count(distinct provider_id) from public.bookings where id = any(p_booking_ids)) <> 1 then
    raise exception 'bad_checkout';
  end if;
  insert into public.mp_checkouts (token_hash, booking_ids, provider_id, mp_account_id)
  values (public.checkout_hash(tok), p_booking_ids, pid, (select id from public.mp_accounts where id = p_account and provider_id = pid));
  return tok;
end $$;

-- estado para la pantalla de regreso, sin sesión: solo el servicio, el prestador, el día y la hora (nada del cliente ni
-- montos). Estados: confirmed, partial, refunded, waiting (hold vigente), checking (venció el hold pero todavía se le
-- pregunta a Mercado Pago), not_paid. null si el token no existe.
create or replace function public.checkout_status(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ck record; st record; tz text; state text;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into ck from public.mp_checkouts where token_hash = public.checkout_hash(p_token);
  if ck.id is null then return null; end if;
  select count(*) as n,
         count(*) filter (where b.status in ('confirmed','done','no_show') and b.payment_id is not null) as conf,
         count(*) filter (where b.status = 'hold' and b.hold_expires_at > now()) as holding,
         count(*) filter (where b.payment_id is not null and b.status not in ('confirmed','done','no_show')) as back,
         min(b.starts_at) as starts_at, min(b.provider_id) as pid,
         (array_agg(b.service_name order by b.starts_at))[1] as service
    into st from public.bookings b where b.id = any(ck.booking_ids);
  if st.n = 0 then return null; end if;
  state := case when st.conf = st.n then 'confirmed'
                when st.conf > 0 then 'partial'
                when st.back > 0 then 'refunded'
                when st.holding > 0 then 'waiting'
                when ck.closed_at is null then 'checking'
                else 'not_paid' end;
  tz := public.provider_tz(st.pid);
  return jsonb_build_object('state', state, 'n', st.n, 'confirmed', st.conf, 'booking', ck.booking_ids[1],
    'service', st.service, 'provider', (select name from public.providers where id = st.pid), 'provider_id', st.pid,
    'date', to_char(st.starts_at at time zone tz, 'YYYY-MM-DD'), 'time', to_char(st.starts_at at time zone tz, 'HH24:MI'));
end $$;

-- los cobros que hay que consultar (mp-reconcile). Primero cierra los ya pagados (todos sus turnos tienen pago o ya no
-- esperan uno) y los de más de 3 días; borra los cerrados de más de 30 días. Cada fila que devuelve queda reservada 2
-- minutos (dos corridas a la vez no consultan el mismo cobro). p_only: solo ese cobro (desde la pantalla de regreso).
create or replace function public.checkouts_due(p_limit int default 30, p_only bigint default null)
returns table (id bigint, booking_ids bigint[], provider_id bigint, mp_account_id bigint, external_reference text)
language plpgsql security definer set search_path = public as $$
begin
  update public.mp_checkouts c set closed_at = now(), closed_reason = 'paid'
   where c.closed_at is null
     and not exists (select 1 from public.bookings b where b.id = any(c.booking_ids) and b.payment_id is null and b.status in ('hold','expired'));
  update public.mp_checkouts c set closed_at = now(), closed_reason = 'gave_up'
   where c.closed_at is null and c.created_at < now() - interval '3 days';
  delete from public.mp_checkouts c where c.closed_at < now() - interval '30 days';
  return query
  with picked as (
    select c.id from public.mp_checkouts c
     where c.closed_at is null and c.next_check_at <= now() and (p_only is null or c.id = p_only)
     order by c.next_check_at limit least(greatest(coalesce(p_limit, 30), 1), 100)
     for update skip locked)
  update public.mp_checkouts c set next_check_at = now() + interval '2 minutes'
    from picked where c.id = picked.id
  returning c.id, c.booking_ids, c.provider_id, c.mp_account_id, array_to_string(c.booking_ids, ',');
end $$;

-- resultado de una consulta: encontró el pago (se cierra) o se vuelve a preguntar más tarde (2, 3, 5, 10, 15, 30 min
-- y después cada hora, hasta los 3 días)
create or replace function public.checkout_checked(p_id bigint, p_found boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.mp_checkouts set checks = least(checks + 1, 1000), last_check_at = now(), last_error = left(p_error, 200),
         closed_at = case when p_found then now() end, closed_reason = case when p_found then 'paid' end,
         next_check_at = now() + case least(checks, 6) when 0 then interval '2 minutes' when 1 then interval '3 minutes'
                                   when 2 then interval '5 minutes' when 3 then interval '10 minutes' when 4 then interval '15 minutes'
                                   when 5 then interval '30 minutes' else interval '1 hour' end
   where id = p_id
$$;

-- la pantalla de regreso pide consultar ya (a lo sumo cada 15 segundos por cobro): devuelve el id o null
create or replace function public.checkout_poke(p_token text) returns bigint
language sql security definer set search_path = public as $$
  update public.mp_checkouts set next_check_at = now()
   where token_hash = public.checkout_hash(p_token) and closed_at is null
     and (last_check_at is null or last_check_at < now() - interval '15 seconds')
  returning id
$$;

-- un aviso del prestador que no se pudo procesar: sus cobros abiertos se consultan en la próxima corrida (el aviso no
-- se usa para nada más: lo que vale es lo que responde la API de Mercado Pago)
create or replace function public.checkout_hint(p_provider bigint) returns void
language sql security definer set search_path = public as $$
  update public.mp_checkouts set next_check_at = least(next_check_at, now())
   where provider_id = p_provider and closed_at is null and created_at > now() - interval '3 days'
$$;

-- cobros abiertos antes de esta migración (con preferencia y sin pago): se suman a la consulta. Lo corre Bruno a mano
-- (docs/02), sabiendo que si Mercado Pago tiene el pago aprobado, el turno se confirma o se devuelve la plata.
create or replace function public.checkout_backfill(p_days int default 7) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.mp_checkouts (token_hash, booking_ids, provider_id, mp_account_id, next_check_at)
  select public.checkout_hash(gen_random_uuid()::text || gen_random_uuid()::text), g.ids, g.provider_id, null, now()
    from (select b.provider_id, b.mp_preference_id, array_agg(b.id order by b.id) as ids
            from public.bookings b
           where b.source = 'app' and b.payment_id is null and b.status in ('hold','expired') and b.mp_preference_id is not null
             and b.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30))
           group by b.provider_id, b.mp_preference_id) g
   where cardinality(g.ids) <= 4
     and not exists (select 1 from public.mp_checkouts c where c.closed_at is null and c.booking_ids && g.ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Cron: consulta cada 2 minutos (mp-reconcile, con CRON_SECRET desde Vault) ----------
create or replace function public.run_mp_reconcile(p_quiet boolean default false) returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    if not p_quiet then raise warning 'run_mp_reconcile: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)'; end if;
    return null;
  end if;
  -- solo si hay algo que consultar (casi siempre no hay nada: no se llama a la función de balde)
  if not exists (select 1 from public.mp_checkouts where closed_at is null and next_check_at <= now()) then return null; end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/mp-reconcile',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('tt-mp-sync', '*/2 * * * *', 'select public.run_mp_reconcile()');
  end if;
end $$;

-- ---------- Para revisar: el detalle de los avisos y el resumen para el aviso de arriba ----------
create or replace function public.admin_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'refunds', (select coalesce(jsonb_agg(x order by x.failed desc, x.created_at), '[]') from (
      select r.id, r.amount, r.reason, r.status, r.attempts, r.last_error, r.last_attempt_at, r.next_attempt_at, r.created_at,
             r.mp_payment_id, (r.status = 'failed') as failed, p.name as provider_name, b.client_name, b.starts_at
      from public.refunds r left join public.providers p on p.id = r.provider_id left join public.bookings b on b.id = r.booking_id
      where r.status = 'failed' or (r.status = 'pending' and r.attempts > 0)
      order by r.created_at limit 200) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
      select pm.id, pm.mp_payment_id, pm.amount, pm.fee_expected, pm.fee_mp, pm.mp_status, pm.review_reasons, pm.created_at,
             pm.collector_id, (pm.mp_account_id is not null) as refundable_from_app, public.payment_reprocessable(pm.id) as reprocessable,
             -- lo que falta devolver: lo cobrado que no respalda un turno que sigue en pie, menos lo ya devuelto o pedido
             greatest(pm.amount
                      - coalesce((select sum(pb.amount) from public.payment_bookings pb join public.bookings b on b.id = pb.booking_id
                                  where pb.payment_id = pm.id and pb.result = 'confirmed'
                                    and b.status in ('confirmed','done','no_show','cancelled_client')), 0)
                      - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = pm.id and r.status <> 'cancelled'), 0), 0) as refundable,
             p.name as provider_name, (select min(b.client_name) from public.bookings b where b.payment_id = pm.id) as client_name
      from public.payments pm left join public.providers p on p.id = pm.provider_id
      where pm.outcome = 'review' and pm.review_resolved_at is null
      order by pm.created_at limit 200) x),
    -- cuentas que hoy no pueden cobrar o devolver por un error de su llave: las que cobran, y las de solo devoluciones
    -- que todavía tienen devoluciones pendientes
    'accounts', (select coalesce(jsonb_agg(x order by x.error_at), '[]') from (
      select a.id, a.mp_user_id, a.status, a.last_error, coalesce(a.last_error_at, a.connected_at) as error_at, p.name as provider_name,
             (select count(*) from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed')) as refunds_pending
      from public.mp_accounts a join public.providers p on p.id = a.provider_id
      where a.last_error is not null and a.status <> 'purged'
        and (a.status = 'active' or exists (select 1 from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed')))
      order by coalesce(a.last_error_at, a.connected_at) limit 200) x),
    'webhook_events', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.detail, e.hits, e.created_at, e.last_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.last_at > now() - interval '30 days'
      order by e.last_at desc limit 50) x),
    -- avisos rechazados antes de procesar (casi siempre, Mercado Pago mal configurado) y pagos sin aviso, últimos 7 días
    'webhook_alert', (select jsonb_build_object(
        'rejected', coalesce(sum(e.hits) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')), 0),
        'rejected_last', max(e.last_at) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')),
        'rejected_reason', (select e2.reason from public.mp_webhook_events e2
                             where e2.last_at > now() - interval '7 days'
                               and e2.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')
                             order by e2.last_at desc limit 1),
        'recovered', count(*) filter (where e.reason = 'recovered'),
        'recovered_last', max(e.last_at) filter (where e.reason = 'recovered'))
      from public.mp_webhook_events e where e.last_at > now() - interval '7 days'));
end $$;

-- ---------- Permisos ----------
revoke execute on function public.mp_webhook_event(text, bigint, bigint, text, text), public.checkout_hash(text),
  public.checkout_open(bigint[], bigint), public.checkout_status(text), public.checkouts_due(int, bigint),
  public.checkout_checked(bigint, boolean, text), public.checkout_poke(text), public.checkout_hint(bigint),
  public.checkout_backfill(int), public.run_mp_reconcile(boolean) from public, anon, authenticated;
grant execute on function public.mp_webhook_event(text, bigint, bigint, text, text), public.checkout_open(bigint[], bigint),
  public.checkouts_due(int, bigint), public.checkout_checked(bigint, boolean, text), public.checkout_poke(text),
  public.checkout_hint(bigint), public.checkout_status(text), public.run_mp_reconcile(boolean) to service_role;
-- la pantalla de regreso, con o sin sesión
grant execute on function public.checkout_status(text) to anon, authenticated;
grant execute on function public.admin_review() to authenticated;

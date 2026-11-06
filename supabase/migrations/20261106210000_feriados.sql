-- 7/11 · Punto 4: feriados (docs/09, D39). Idempotente; no borra datos.
--
-- Qué feriados: los nacionales (inamovibles y trasladables) y los días no laborables con fines turísticos (puentes).
-- No entran los provinciales ni los municipales.
-- De dónde: la Edge Function holidays-sync trae la lista oficial del año en curso y del siguiente de una fuente pública
-- (ArgentinaDatos) una vez por semana y la guarda acá. El admin la revisa y confirma una vez por año (panel → Comisión →
-- Feriados); si la fuente falla, la carga o la corrige a mano. Los profesionales ven solo los años confirmados.
-- Qué pasa: si el profesional no elige, el feriado queda abierto (como cualquier día). Siete días antes le llega un aviso
-- (en la campanita y por notificación): «El lunes 24/11 es feriado (…). ¿Abrís?», con Abro / Cierro. Cierro usa el
-- mismo bloqueo de días de Horarios (block_days): nadie reserva y los turnos de ese día se cancelan con el mismo aviso.

-- ---------- Tablas ----------
create table if not exists public.holidays (
  day        date primary key,
  name       text not null check (char_length(name) between 1 and 80),
  kind       text not null check (kind in ('inamovible','trasladable','puente')),
  source     text not null default 'api' check (source in ('api','admin')),
  updated_at timestamptz not null default now()
);
create table if not exists public.holiday_years (
  year           int primary key check (year between 2020 and 2100),
  fetched_at     timestamptz,
  fetch_error    text check (char_length(fetch_error) <= 300),
  fetched_count  int,
  -- la fuente trajo algo distinto después de confirmar el año (un traslado por decreto, por ejemplo): el admin lo revisa
  source_changed boolean not null default false,
  confirmed_at   timestamptz,
  confirmed_by   uuid references auth.users(id) on delete set null
);
create table if not exists public.provider_holidays (
  provider_id bigint not null references public.providers(id) on delete cascade,
  day         date not null,
  open        boolean not null,
  decided_at  timestamptz not null default now(),
  primary key (provider_id, day)
);
-- cerradas por defecto: se leen y se escriben solo con las funciones de abajo (provider_holidays, además, la ve su dueño)
alter table public.holidays enable row level security;
alter table public.holiday_years enable row level security;
alter table public.provider_holidays enable row level security;
revoke all on public.holidays, public.holiday_years, public.provider_holidays from public, anon, authenticated;
grant select on public.provider_holidays to authenticated;
grant select on public.holidays, public.holiday_years, public.provider_holidays to service_role;
drop policy if exists provider_holidays_read on public.provider_holidays;
create policy provider_holidays_read on public.provider_holidays for select to authenticated
  using (provider_id = (select public.my_provider()));

-- "lunes 24/11"
create or replace function public.holiday_label(p_day date) returns text
language sql immutable set search_path = public as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from p_day)::int + 1]
         || ' ' || to_char(p_day, 'DD/MM')
$$;

-- ---------- Lo que trae holidays-sync ----------
-- p_rows: la lista de la fuente ([{fecha, tipo, nombre}]). Solo entran los tipos de arriba y las fechas de ese año.
-- Año sin confirmar: se reemplaza lo que vino de la fuente (lo cargado a mano por el admin queda). Año confirmado: no se
-- toca nada; si la fuente cambió, queda marcado para que el admin lo revise.
create or replace function public.holidays_sync_save(p_year int, p_rows jsonb, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare y record; n int := 0; changed boolean := false; rows jsonb;
begin
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'bad_year'; end if;
  insert into public.holiday_years (year) values (p_year) on conflict do nothing;
  if p_error is not null then
    update public.holiday_years set fetched_at = now(), fetch_error = left(p_error, 300) where year = p_year;
    return jsonb_build_object('year', p_year, 'error', left(p_error, 300));
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'bad_rows'; end if;
  -- la lista limpia: [{day, name, kind}], una por fecha
  select coalesce(jsonb_agg(jsonb_build_object('day', d, 'name', nm, 'kind', k) order by d), '[]') into rows from (
    select distinct on (x.d) x.d, left(btrim(regexp_replace(coalesce(r->>'nombre', ''), '[[:cntrl:]<>]', '', 'g')), 80) as nm, x.k
      from jsonb_array_elements(p_rows) r
      cross join lateral (select case when (r->>'fecha') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'fecha')::date end as d,
                                 lower(btrim(coalesce(r->>'tipo', ''))) as k) x
     where x.d is not null and extract(year from x.d) = p_year and x.k in ('inamovible','trasladable','puente')
       and btrim(regexp_replace(coalesce(r->>'nombre', ''), '[[:cntrl:]<>]', '', 'g')) <> ''
     order by x.d) s;
  n := jsonb_array_length(rows);
  select * into y from public.holiday_years where year = p_year for update;
  if y.confirmed_at is null then
    if n > 0 then
      delete from public.holidays h
       where extract(year from h.day) = p_year and h.source = 'api'
         and not exists (select 1 from jsonb_to_recordset(rows) i(day date, name text, kind text) where i.day = h.day);
      insert into public.holidays (day, name, kind, source, updated_at)
      select i.day, i.name, i.kind, 'api', now() from jsonb_to_recordset(rows) i(day date, name text, kind text)
      on conflict (day) do update set name = excluded.name, kind = excluded.kind, updated_at = now()
       where holidays.source = 'api' and (holidays.name, holidays.kind) is distinct from (excluded.name, excluded.kind);
    end if;
  else
    changed := n > 0 and exists (
      (select i.day, i.name, i.kind from jsonb_to_recordset(rows) i(day date, name text, kind text)
       except select hh.day, hh.name, hh.kind from public.holidays hh where extract(year from hh.day) = p_year)
      union all
      (select hh.day, hh.name, hh.kind from public.holidays hh where extract(year from hh.day) = p_year and hh.source = 'api'
       except select i.day, i.name, i.kind from jsonb_to_recordset(rows) i(day date, name text, kind text)));
  end if;
  update public.holiday_years set fetched_at = now(), fetch_error = case when n = 0 then 'la fuente no trajo feriados de ese año' end,
         fetched_count = n, source_changed = source_changed or changed
   where year = p_year;
  return jsonb_build_object('year', p_year, 'count', n, 'confirmed', y.confirmed_at is not null, 'changed', changed);
end $$;

-- llamar a holidays-sync (cron semanal y botón del admin), con la URL y la clave del cron de Vault, como run_dni_cleanup
create or replace function public.run_holidays_sync() returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    raise warning 'run_holidays_sync: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/holidays-sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

-- ---------- Admin: revisar, corregir y confirmar ----------
create or replace function public.admin_holidays() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cy int := extract(year from (now() at time zone 'America/Argentina/Buenos_Aires'))::int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'year', g.y,
      'fetched_at', hy.fetched_at, 'fetch_error', hy.fetch_error, 'fetched_count', hy.fetched_count,
      'source_changed', coalesce(hy.source_changed, false), 'confirmed_at', hy.confirmed_at,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name, 'kind', h.kind, 'source', h.source) order by h.day), '[]')
                 from public.holidays h where extract(year from h.day) = g.y)) order by g.y), '[]')
    from generate_series(cy, cy + 1) g(y) left join public.holiday_years hy on hy.year = g.y);
end $$;

create or replace function public.admin_holiday_save(p_day date, p_name text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_day is null or extract(year from p_day) < 2020 or extract(year from p_day) > 2100 then raise exception 'bad_day'; end if;
  if nm = '' then raise exception 'bad_name'; end if;
  if p_kind not in ('inamovible','trasladable','puente') then raise exception 'bad_kind'; end if;
  insert into public.holiday_years (year) values (extract(year from p_day)::int) on conflict do nothing;
  insert into public.holidays (day, name, kind, source, updated_at) values (p_day, nm, p_kind, 'admin', now())
  on conflict (day) do update set name = excluded.name, kind = excluded.kind, source = 'admin', updated_at = now();
end $$;

create or replace function public.admin_holiday_delete(p_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.holidays where day = p_day;
end $$;

-- confirmar el año: desde ahí los profesionales lo ven (y les llegan los avisos)
create or replace function public.admin_holidays_confirm(p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.holidays where extract(year from day) = p_year) then raise exception 'no_holidays'; end if;
  insert into public.holiday_years (year) values (p_year) on conflict do nothing;
  update public.holiday_years set confirmed_at = now(), confirmed_by = auth.uid(), source_changed = false where year = p_year;
end $$;

-- "Traer de nuevo" desde la fuente (la respuesta llega a los pocos segundos: el panel vuelve a pedir la lista)
create or replace function public.admin_holidays_fetch() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return public.run_holidays_sync() is not null;
end $$;

-- ---------- El profesional ----------
-- los próximos feriados de los años confirmados (hasta un año), con lo que eligió y si ese día atiende
create or replace function public.my_holidays() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; today date;
begin
  if pid is null then return '[]'; end if;
  tz := coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires'); today := (now() at time zone tz)::date;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'day', h.day, 'name', h.name, 'kind', h.kind, 'open', ph.open,
      'works', exists (select 1 from public.provider_hours ph2 where ph2.provider_id = pid and ph2.dow = extract(dow from h.day)::int)) order by h.day), '[]')
    from public.holidays h
    join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
    left join public.provider_holidays ph on ph.provider_id = pid and ph.day = h.day
   where h.day >= today and h.day <= today + 366);
end $$;

-- Abro / Cierro. Cierro bloquea ese día con block_days (y devuelve lo mismo: los turnos cancelados para llamar a cada
-- cliente); Abro, si antes lo había cerrado desde acá, lo desbloquea (los turnos que se cancelaron siguen cancelados).
create or replace function public.holiday_decide(p_day date, p_open boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; h record; prev boolean; res jsonb := '{}';
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_open is null then raise exception 'bad_choice'; end if;
  tz := coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires');
  select hl.day, hl.name into h from public.holidays hl
    join public.holiday_years hy on hy.year = extract(year from hl.day)::int and hy.confirmed_at is not null
   where hl.day = p_day;
  if h.day is null then raise exception 'not_holiday'; end if;
  if h.day < (now() at time zone tz)::date then raise exception 'past_days'; end if;
  select open into prev from public.provider_holidays where provider_id = pid and day = p_day;
  if p_open then
    if prev is false then
      delete from public.bookings where provider_id = pid and source = 'block' and coalesce(service_name, '') like '🏖️ Feriado%'
         and starts_at >= p_day::timestamp at time zone tz and starts_at < (p_day + 1)::timestamp at time zone tz;
    end if;
  else
    res := public.block_days(p_day, p_day, 'Feriado: ' || h.name);
  end if;
  insert into public.provider_holidays (provider_id, day, open, decided_at) values (pid, p_day, p_open, now())
  on conflict (provider_id, day) do update set open = excluded.open, decided_at = now();
  update public.provider_notices set read_at = coalesce(read_at, now()) where provider_id = pid and kind = 'holiday' and ref = p_day::text;
  return res || jsonb_build_object('day', p_day, 'open', p_open);
end $$;

-- ---------- El aviso, 7 días antes ----------
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost','mp_connect','new_follower','mp_term','holiday'));
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect','new_follower','offer','news','holiday'));

-- una vez por día (tt-holiday-notices): a cada profesional activo, por cada feriado de un año confirmado de acá a 7 días
-- que cae en un día que atiende, que no tiene bloqueado y sobre el que no eligió nada. Una sola vez por feriado.
create or replace function public.holiday_notices() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.provider_notices (provider_id, kind, ref, body)
  select p.id, 'holiday', h.day::text,
         'El ' || public.holiday_label(h.day) || ' es feriado (' || h.name || '). ¿Abrís?'
    from public.holidays h
    join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
    join public.providers p on p.status = 'active'
   where h.day >= (now() at time zone coalesce(public.provider_tz(p.id), 'America/Argentina/Buenos_Aires'))::date
     and h.day <= (now() at time zone coalesce(public.provider_tz(p.id), 'America/Argentina/Buenos_Aires'))::date + 7
     and exists (select 1 from public.provider_hours ph where ph.provider_id = p.id and ph.dow = extract(dow from h.day)::int)
     and not exists (select 1 from public.provider_holidays d where d.provider_id = p.id and d.day = h.day)
     and not exists (select 1 from public.bookings b where b.provider_id = p.id and b.source = 'block' and coalesce(b.service_name, '') like '🏖️%'
                       and b.starts_at >= h.day::timestamp at time zone coalesce(public.provider_tz(p.id), 'America/Argentina/Buenos_Aires')
                       and b.starts_at < (h.day + 1)::timestamp at time zone coalesce(public.provider_tz(p.id), 'America/Argentina/Buenos_Aires'))
  on conflict (provider_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- el push del aviso de feriado: su propio tipo, vale hasta el día del feriado
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind in ('mp_reconnect','mp_connect') then 'mp_reconnect' when new.kind in ('new_follower','holiday') then new.kind else 'cobros' end,
    'notice', new.id, null,
    case when new.kind = 'new_follower' then now() + interval '1 day'
         when new.kind = 'holiday' and new.ref ~ '^\d{4}-\d{2}-\d{2}$' then least(now() + interval '8 days', (new.ref::date)::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else now() + interval '3 days' end);
  return null;
end $$;

-- los avisos del panel, con la fecha del feriado (ref) y lo que eligió (para no ofrecer Abro / Cierro dos veces)
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null,
                                               'ref', case when n.kind = 'holiday' then n.ref end,
                                               'open', case when n.kind = 'holiday' then (select d.open from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref) end)
                            order by n.created_at desc), '[]')
  from (select * from public.provider_notices where provider_id = public.my_provider() order by created_at desc limit 30) n
$$;

-- push_due: igual que en 20261104190000_seguidores.sql, más el aviso de feriado (holiday)
create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
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
end $$;

revoke execute on function public.push_due(int) from public, anon, authenticated;
grant execute on function public.push_due(int) to service_role;

-- ---------- Tareas programadas ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- el aviso de los feriados de acá a 7 días: todos los días a las 9:07 de Argentina (12:07 UTC)
    perform cron.schedule('tt-holiday-notices', '7 12 * * *', 'select public.holiday_notices()');
    -- traer la lista oficial: los lunes a las 6:23 de Argentina (9:23 UTC), con pg_net
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule('tt-holidays', '23 9 * * 1', 'select public.run_holidays_sync()');
    end if;
  end if;
end $$;

-- ---------- Permisos ----------
revoke execute on function public.holiday_label(date), public.holidays_sync_save(int, jsonb, text), public.run_holidays_sync(),
  public.admin_holidays(), public.admin_holiday_save(date, text, text), public.admin_holiday_delete(date), public.admin_holidays_confirm(int),
  public.admin_holidays_fetch(), public.my_holidays(), public.holiday_decide(date, boolean), public.holiday_notices(),
  public.provider_notices_push(), public.my_provider_notices() from public, anon, authenticated;
grant execute on function public.holidays_sync_save(int, jsonb, text), public.run_holidays_sync() to service_role;
grant execute on function public.admin_holidays(), public.admin_holiday_save(date, text, text), public.admin_holiday_delete(date),
  public.admin_holidays_confirm(int), public.admin_holidays_fetch(), public.my_holidays(), public.holiday_decide(date, boolean),
  public.my_provider_notices() to authenticated;

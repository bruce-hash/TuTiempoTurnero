-- 10/11 · Punto 13: feriados cerrados por defecto (cambia D39). Idempotente; no borra datos.
--
-- Antes: si el profesional no elegía, el feriado quedaba abierto, y «Cierro» lo bloqueaba con block_days (cancelando los
-- turnos de ese día, D09). Ahora: cuando el admin confirma los feriados del año, esos días quedan CERRADOS para todos los
-- profesionales (el turnero no ofrece horarios y la base no acepta reservas). El profesional los abre cuando quiera desde
-- Horarios → Próximos feriados («Voy a trabajar este día») y los puede volver a cerrar.
--   - El cierre NO se guarda como bloqueo: se calcula (holiday_closed). Por eso nunca cancela turnos: los que ya estaban
--     reservados ese día se mantienen y al profesional le llega el aviso «Tenés N turnos el <día>, que es feriado…»
--     (holiday_bookings_notices: al confirmar el año, cuando el admin agrega un feriado y al aplicar esta migración; uno
--     por profesional y día). Si el admin corrige la lista, el cambio vale solo, para los días que todavía no pasaron.
--   - provider_holidays sigue guardando lo que eligió: open = true, abre; open = false, lo dejó cerrado (no lo bloquea);
--     sin fila, cerrado por defecto. Las elecciones de antes se respetan: «Abro» sigue abierto y «Cierro» sigue cerrado
--     (con su bloqueo de block_days, que no se toca; si ahora lo abre, ese bloqueo se saca como antes).
--   - El aviso de 7 días antes: «El <día> es feriado y tu agenda está cerrada. ¿Vas a trabajar?» (con la cantidad de turnos
--     si los tiene), con «Abrir el día» / «Dejarlo cerrado». No sale si ya eligió.
--   - Los turnos que agenda a mano el profesional (source = 'manual') no pasan por acá: los puede cargar igual.
set search_path = public, extensions;

-- ---------- ¿El feriado está cerrado para este profesional? ----------
-- feriado de un año confirmado, que todavía no pasó (hora del profesional) y que no abrió
create or replace function public.holiday_closed(pid bigint, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select pid is not null and p_day is not null
     and p_day >= (now() at time zone coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires'))::date
     and exists (select 1 from public.holidays h
                   join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
                  where h.day = p_day)
     and not exists (select 1 from public.provider_holidays d where d.provider_id = pid and d.day = p_day and d.open)
$$;

-- los turnos de un profesional que siguen en pie un día (por la app o agendados a mano; las reservas en pago, mientras valen)
create or replace function public.holiday_bookings(pid bigint, p_day date) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.bookings b
   where b.provider_id = pid and b.source in ('app','manual')
     and (b.status = 'confirmed' or (b.status = 'hold' and b.hold_expires_at > now()))
     and b.starts_at >= p_day::timestamp at time zone coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires')
     and b.starts_at < (p_day + 1)::timestamp at time zone coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires')
$$;

-- ---------- El turnero de la base: un feriado cerrado no tiene horarios ----------
-- igual que en 20261101180000_turnos_duracion.sql (D31), más el feriado cerrado. Lo usan book_slot (slot_fits) y
-- next_free_slot (las tarjetas del listado): nadie reserva por la app ese día.
create or replace function public.slot_starts(pid bigint, p_day date, p_dur int, p_ignore bigint default null)
returns setof timestamp
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); h record; p timestamp; e timestamptz;
begin
  if pid is null or p_day is null or coalesce(p_dur, 0) <= 0 then return; end if;
  -- 10/11 · feriado cerrado (D39): sin horarios; los turnos que ya tenía ese día siguen en pie
  if public.holiday_closed(pid, p_day) then return; end if;
  for h in select opens, closes from public.provider_hours
           where provider_id = pid and dow = extract(dow from p_day)::int order by opens loop
    p := p_day + h.opens;
    while p + make_interval(mins => p_dur) <= p_day + h.closes loop
      select max(b.busy_until) into e from public.bookings b
       where b.provider_id = pid and b.status in ('hold','confirmed','done') and b.id is distinct from p_ignore
         and b.during && tstzrange(p at time zone tz, (p + make_interval(mins => p_dur)) at time zone tz, '[)');
      if e is null then
        return next p;
        p := p + make_interval(mins => p_dur);
      else
        p := greatest(e at time zone tz, p + interval '1 minute');
      end if;
    end loop;
  end loop;
end $$;

-- ---------- Los feriados cerrados de un profesional, para el turnero de la app (perfil público) ----------
-- solo las fechas (son públicas: los feriados nacionales que no abrió), de los que se pueden ver como get_provider
create or replace function public.provider_closed_days(pid bigint, p_from date, p_to date) returns table (day date)
language sql stable security definer set search_path = public as $$
  select h.day from public.holidays h
    join public.providers p on p.id = pid and (p.status = 'active' or p.owner_id = auth.uid() or public.is_admin())
   where p_from is not null and p_to is not null
     and h.day >= p_from and h.day <= least(p_to, p_from + 140)
     and public.holiday_closed(pid, h.day)
   order by h.day
$$;

-- ---------- Ofrecer un hueco (S19) en un feriado cerrado: no (nadie lo podría reservar) ----------
create or replace function public.slot_offers_holiday() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.holiday_closed(new.provider_id, (new.starts_at at time zone coalesce(public.provider_tz(new.provider_id), 'America/Argentina/Buenos_Aires'))::date) then
    raise exception 'holiday_closed';
  end if;
  return new;
end $$;
drop trigger if exists slot_offers_holiday on public.slot_offers;
create trigger slot_offers_holiday before insert on public.slot_offers for each row execute function public.slot_offers_holiday();

-- ---------- El profesional ----------
-- los próximos feriados de los años confirmados (hasta un año), con lo que eligió, si quedó cerrado, si ese día atiende
-- y cuántos turnos tiene ese día
create or replace function public.my_holidays() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; today date;
begin
  if pid is null then return '[]'; end if;
  tz := coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires'); today := (now() at time zone tz)::date;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'day', h.day, 'name', h.name, 'kind', h.kind, 'open', ph.open, 'closed', ph.open is not true,
      'works', exists (select 1 from public.provider_hours ph2 where ph2.provider_id = pid and ph2.dow = extract(dow from h.day)::int),
      'bookings', public.holiday_bookings(pid, h.day)) order by h.day), '[]')
    from public.holidays h
    join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
    left join public.provider_holidays ph on ph.provider_id = pid and ph.day = h.day
   where h.day >= today and h.day <= today + 366);
end $$;

-- «Voy a trabajar este día» (true) / «Cerrar el día de nuevo» o «Dejarlo cerrado» (false). Cerrar ya no usa block_days:
-- solo guarda la elección y el día vuelve a quedar cerrado, sin cancelar nada (devuelve cuántos turnos tiene ese día).
-- Abrir uno que se había cerrado con el «Cierro» de antes saca ese bloqueo (los turnos cancelados entonces siguen cancelados).
create or replace function public.holiday_decide(p_day date, p_open boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; h record; prev boolean;
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
  if p_open and prev is false then
    delete from public.bookings where provider_id = pid and source = 'block' and coalesce(service_name, '') like '🏖️ Feriado%'
       and starts_at >= p_day::timestamp at time zone tz and starts_at < (p_day + 1)::timestamp at time zone tz;
  end if;
  insert into public.provider_holidays (provider_id, day, open, decided_at) values (pid, p_day, p_open, now())
  on conflict (provider_id, day) do update set open = excluded.open, decided_at = now();
  update public.provider_notices set read_at = coalesce(read_at, now())
   where provider_id = pid and kind in ('holiday','holiday_bookings') and ref = p_day::text;
  return jsonb_build_object('day', p_day, 'open', p_open, 'bookings', public.holiday_bookings(pid, p_day));
end $$;

-- ---------- Los avisos ----------
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost','mp_connect','new_follower','mp_term','holiday',
                  'suspended','reactivated','holiday_bookings'));

-- «Tenés N turnos el <día>, que es feriado. Se mantienen; …»: a cada profesional con turnos en un feriado cerrado que no
-- pasó (de un año confirmado). p_day: solo ese día; null: todos. Una sola vez por profesional y día (unique de provider_notices).
create or replace function public.holiday_bookings_notices(p_day date default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.provider_notices (provider_id, kind, ref, body)
  select x.pid, 'holiday_bookings', x.day::text,
         case when x.n = 1
              then 'Tenés 1 turno el ' || public.holiday_label(x.day) || ', que es feriado. Se mantiene; si no vas a trabajar, avisale y cancelalo (con devolución).'
              else 'Tenés ' || x.n || ' turnos el ' || public.holiday_label(x.day) || ', que es feriado. Se mantienen; si no vas a trabajar, avisales y cancelalos (con devolución).' end
    from (select p.id as pid, h.day, public.holiday_bookings(p.id, h.day) as n
            from public.holidays h
            join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
            join public.providers p on p.status <> 'deleted'
           where (p_day is null or h.day = p_day)
             and h.day >= (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1
             and public.holiday_closed(p.id, h.day)) x
   where x.n > 0
  on conflict (provider_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- una vez por día (tt-holiday-notices): a cada profesional activo, por cada feriado cerrado de acá a 7 días que cae en un
-- día que atiende, que no bloqueó y sobre el que no eligió nada. Una sola vez por feriado.
create or replace function public.holiday_notices() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  insert into public.provider_notices (provider_id, kind, ref, body)
  select x.pid, 'holiday', x.day::text,
         'El ' || public.holiday_label(x.day) || ' es feriado y tu agenda está cerrada. ¿Vas a trabajar?'
         || case when x.n = 1 then ' Tenés 1 turno ese día: se mantiene.'
                 when x.n > 1 then ' Tenés ' || x.n || ' turnos ese día: se mantienen.' else '' end
    from (select p.id as pid, h.day, public.holiday_bookings(p.id, h.day) as n,
                 coalesce(public.provider_tz(p.id), 'America/Argentina/Buenos_Aires') as tz
            from public.holidays h
            join public.holiday_years hy on hy.year = extract(year from h.day)::int and hy.confirmed_at is not null
            join public.providers p on p.status = 'active') x
   where x.day >= (now() at time zone x.tz)::date and x.day <= (now() at time zone x.tz)::date + 7
     and exists (select 1 from public.provider_hours ph where ph.provider_id = x.pid and ph.dow = extract(dow from x.day)::int)
     and not exists (select 1 from public.provider_holidays d where d.provider_id = x.pid and d.day = x.day)
     and not exists (select 1 from public.bookings b where b.provider_id = x.pid and b.source = 'block' and coalesce(b.service_name, '') like '🏖️%'
                       and b.starts_at >= x.day::timestamp at time zone x.tz and b.starts_at < (x.day + 1)::timestamp at time zone x.tz)
  on conflict (provider_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- el push de los avisos del prestador: igual que en 20261110175000_cuenta_suspendida.sql (account), más el aviso de turnos en
-- un feriado (holiday_bookings), con el tipo de push 'holiday' y que vale hasta el día del feriado
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind in ('mp_reconnect','mp_connect') then 'mp_reconnect' when new.kind = 'new_follower' then new.kind
         when new.kind in ('holiday','holiday_bookings') then 'holiday'
         when new.kind in ('suspended','reactivated') then 'account' else 'cobros' end,
    'notice', new.id, null,
    case when new.kind = 'new_follower' then now() + interval '1 day'
         when new.kind in ('holiday','holiday_bookings') and new.ref ~ '^\d{4}-\d{2}-\d{2}$'
           then greatest(now() + interval '1 hour', least(now() + interval '8 days', (new.ref::date)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
         else now() + interval '3 days' end);
  return null;
end $$;

-- la campanita: igual que en 20261107120000_avisos_profesional.sql, con la fecha y la elección también en el aviso de turnos
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null,
                                               'ref', case when n.kind in ('holiday','holiday_bookings') then n.ref end,
                                               'open', case when n.kind in ('holiday','holiday_bookings') then (select d.open from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref) end)
                            order by n.created_at desc), '[]')
  from (select * from public.provider_notices where provider_id = public.my_provider() and dismissed_at is null
         order by created_at desc limit 30) n
$$;

-- ---------- Admin ----------
-- confirmar el año: desde ahí sus feriados quedan cerrados para todos; a quien ya tiene turnos esos días, el aviso
create or replace function public.admin_holidays_confirm(p_year int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.holidays where extract(year from day) = p_year) then raise exception 'no_holidays'; end if;
  insert into public.holiday_years (year) values (p_year) on conflict do nothing;
  update public.holiday_years set confirmed_at = now(), confirmed_by = auth.uid(), source_changed = false where year = p_year;
  perform public.holiday_bookings_notices(d.day) from public.holidays d where extract(year from d.day) = p_year;
end $$;

-- corregir o agregar (igual que en 20261107140000_feriados_google.sql): en un año confirmado, el día nuevo queda cerrado
-- (si no pasó) y a quien ya tiene turnos ese día le llega el aviso
create or replace function public.admin_holiday_save(p_day date, p_name text, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
declare nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_day is null or extract(year from p_day) < 2020 or extract(year from p_day) > 2100 then raise exception 'bad_day'; end if;
  if nm = '' then raise exception 'bad_name'; end if;
  if p_kind not in ('inamovible','trasladable','puente','nacional') then raise exception 'bad_kind'; end if;
  insert into public.holiday_years (year) values (extract(year from p_day)::int) on conflict do nothing;
  insert into public.holidays (day, name, kind, source, updated_at) values (p_day, nm, p_kind, 'admin', now())
  on conflict (day) do update set name = excluded.name, kind = excluded.kind, source = 'admin', updated_at = now();
  perform public.holiday_bookings_notices(p_day);
end $$;

-- sacar un feriado: el día vuelve a abrir (se calcula). Los avisos de ese día que todavía no pasó dejan de verse (dirían
-- que la agenda está cerrada). Lo que eligieron los profesionales queda guardado (vale si se vuelve a agregar) y un
-- bloqueo del «Cierro» de antes no se toca: es del profesional.
create or replace function public.admin_holiday_delete(p_day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.holidays where day = p_day;
  if p_day >= (now() at time zone 'America/Argentina/Buenos_Aires')::date then
    update public.provider_notices set dismissed_at = coalesce(dismissed_at, now()), read_at = coalesce(read_at, now())
     where kind in ('holiday','holiday_bookings') and ref = p_day::text;
  end if;
end $$;

-- push_due: igual que en 20261110175000_cuenta_suspendida.sql ('unfollowed' y 'account'), con los dos avisos de feriado (10/11)
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
      if r.kind = 'account' then
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

-- ---------- Permisos ----------
revoke execute on function public.holiday_closed(bigint, date), public.holiday_bookings(bigint, date), public.slot_starts(bigint, date, int, bigint),
  public.slot_offers_holiday(), public.holiday_bookings_notices(date), public.holiday_notices(), public.provider_notices_push(),
  public.provider_closed_days(bigint, date, date), public.my_holidays(), public.holiday_decide(date, boolean), public.my_provider_notices(),
  public.admin_holidays_confirm(int), public.admin_holiday_save(date, text, text), public.admin_holiday_delete(date)
  from public, anon, authenticated;
grant execute on function public.slot_starts(bigint, date, int, bigint) to service_role;
grant execute on function public.provider_closed_days(bigint, date, date) to anon, authenticated;
grant execute on function public.my_holidays(), public.holiday_decide(date, boolean), public.my_provider_notices(),
  public.admin_holidays_confirm(int), public.admin_holiday_save(date, text, text), public.admin_holiday_delete(date) to authenticated;

-- ---------- Los que ya tienen turnos en un feriado que desde hoy queda cerrado (años ya confirmados) ----------
do $$ begin perform public.holiday_bookings_notices(); end $$;

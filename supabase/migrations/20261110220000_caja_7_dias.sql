-- =====================================================================
-- TuTiempo · 10/11 · punto 8 · corregir la Caja de los últimos 7 días
--   - Un día de los últimos 7 (y hoy) se puede volver a abrir y corregir: lo cargado sin turno y las ventas (walkins) y
--     cómo se cobró el resto de los turnos (rest_method / rest_parts). Después se cierra de nuevo.
--   - Más de 7 días atrás: solo se ve (day_too_old). Con el mes de ese día cerrado en Finanzas no se reabre ni se
--     corrige nada: primero hay que reabrir el mes (month_closed). Con la caja del día cerrada no se corrige: primero
--     «Volver a abrir la caja» (day_closed). La base lo controla también si se escribe directo (triggers).
--   - Registro: los cambios hechos sobre un día que se volvió a abrir quedan en cash_day_log (qué y cuándo), que el
--     profesional ve en la Caja de ese día. Lo escriben solo los triggers.
--   - Las tareas internas (sin sesión: cron, SQL Editor) no pasan por estas reglas.
-- Idempotente y sin borrar datos.
-- =====================================================================

create table if not exists public.cash_day_log (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  day         date not null,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('reopen','close','add','edit','delete','rest')),
  detail      text not null check (char_length(detail) between 1 and 240)
);
create index if not exists cash_day_log_day on public.cash_day_log (provider_id, day, at);
alter table public.cash_day_log enable row level security;
drop policy if exists cash_day_log_owner on public.cash_day_log;
create policy cash_day_log_owner on public.cash_day_log for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin()));
revoke all on public.cash_day_log from public, anon, authenticated;
grant select on public.cash_day_log to authenticated;

-- ---------- reglas ----------
-- "open" se puede corregir; si no, por qué no: day_too_old (más de 7 días), month_closed, day_closed
create or replace function public.cash_day_state(p_provider bigint, p_day date) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_day < (now() at time zone 'America/Argentina/Buenos_Aires')::date - 7 then 'day_too_old'
    when exists (select 1 from public.cash_closings c where c.provider_id = p_provider and c.kind = 'month'
                  and c.period = date_trunc('month', p_day)::date) then 'month_closed'
    when exists (select 1 from public.cash_closings c where c.provider_id = p_provider and c.kind = 'day' and c.period = p_day) then 'day_closed'
    else 'open' end
$$;

-- el día de caja de un movimiento sin turno y de un turno (en la hora del profesional)
create or replace function public.cash_day_of(p_provider bigint, p_at timestamptz) returns date
language sql stable security definer set search_path = public as $$
  select (p_at at time zone coalesce(public.provider_tz(p_provider), 'America/Argentina/Buenos_Aires'))::date
$$;

create or replace function public.cash_money(p int) returns text language sql immutable set search_path = public as $$
  select '$' || replace(to_char(coalesce(p, 0), 'FM999,999,999,990'), ',', '.')
$$;
create or replace function public.cash_medio(p text) returns text language sql immutable set search_path = public as $$
  select case p when 'cash' then 'Efectivo' when 'transfer' then 'Transferencia' when 'mp' then 'Mercado Pago' else coalesce(p, '—') end
$$;

-- ¿ese día se volvió a abrir después de cerrarlo? (desde ahí, todo cambio queda en el registro)
create or replace function public.cash_day_reopened(p_provider bigint, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cash_day_log l where l.provider_id = p_provider and l.day = p_day and l.kind = 'reopen')
$$;

create or replace function public.cash_day_log_add(p_provider bigint, p_day date, p_kind text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into public.cash_day_log (provider_id, day, kind, detail) values (p_provider, p_day, p_kind, left(p_detail, 240))
$$;

-- ---------- lo cargado sin turno y las ventas ----------
create or replace function public.walkins_cash_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op in ('UPDATE','DELETE') then
    st := public.cash_day_state(old.provider_id, public.cash_day_of(old.provider_id, old.at));
    if st <> 'open' then raise exception '%', st; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    st := public.cash_day_state(new.provider_id, public.cash_day_of(new.provider_id, new.at));
    if st <> 'open' then raise exception '%', st; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists walkins_cash_guard on public.walkins;
create trigger walkins_cash_guard before insert or update or delete on public.walkins
  for each row execute function public.walkins_cash_guard();

create or replace function public.walkins_cash_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; what text;
begin
  if tg_op = 'DELETE' then
    d := public.cash_day_of(old.provider_id, old.at);
    if public.cash_day_reopened(old.provider_id, d) then
      perform public.cash_day_log_add(old.provider_id, d, 'delete', 'Borraste ' || old.description || ' · ' || public.cash_money(old.amount + old.tip) || ' en ' || public.cash_medio(old.method));
    end if;
    return old;
  end if;
  d := public.cash_day_of(new.provider_id, new.at);
  if not public.cash_day_reopened(new.provider_id, d) then return new; end if;
  if tg_op = 'INSERT' then
    perform public.cash_day_log_add(new.provider_id, d, 'add', 'Agregaste ' || new.description || ' · ' || public.cash_money(new.amount + new.tip) || ' en ' || public.cash_medio(new.method));
  elsif (old.amount + old.tip, old.method, old.description, old.at) is distinct from (new.amount + new.tip, new.method, new.description, new.at) then
    what := 'Cambiaste ' || old.description || ': ' || public.cash_money(old.amount + old.tip) || ' en ' || public.cash_medio(old.method)
            || ' → ' || case when new.description <> old.description then new.description || ' ' else '' end
            || public.cash_money(new.amount + new.tip) || ' en ' || public.cash_medio(new.method);
    perform public.cash_day_log_add(new.provider_id, d, 'edit', what);
  end if;
  return new;
end $$;
drop trigger if exists walkins_cash_log on public.walkins;
create trigger walkins_cash_log after insert or update or delete on public.walkins
  for each row execute function public.walkins_cash_log();

-- ---------- cómo se cobró el resto de un turno ----------
create or replace function public.bookings_rest_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or (new.rest_method is not distinct from old.rest_method and new.rest_parts is not distinct from old.rest_parts) then
    return new;
  end if;
  st := public.cash_day_state(new.provider_id, public.cash_day_of(new.provider_id, new.starts_at));
  if st <> 'open' then raise exception '%', st; end if;
  return new;
end $$;
drop trigger if exists bookings_rest_guard on public.bookings;
create trigger bookings_rest_guard before update of rest_method, rest_parts on public.bookings
  for each row execute function public.bookings_rest_guard();

create or replace function public.bookings_rest_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; how text;
begin
  if new.source = 'block' or (new.rest_method is not distinct from old.rest_method and new.rest_parts is not distinct from old.rest_parts) then
    return null;
  end if;
  d := public.cash_day_of(new.provider_id, new.starts_at);
  if not public.cash_day_reopened(new.provider_id, d) then return null; end if;
  how := case
    when new.rest_parts is not null and jsonb_typeof(new.rest_parts) = 'array' and jsonb_array_length(new.rest_parts) > 0 then
      (select string_agg(public.cash_money((x->>'amount')::int) || ' en ' || public.cash_medio(x->>'method'), ' + ') from jsonb_array_elements(new.rest_parts) x)
    when new.rest_method is not null then 'todo en ' || public.cash_medio(new.rest_method)
    else 'sin anotar' end;
  perform public.cash_day_log_add(new.provider_id, d, 'rest', 'Resto de ' || coalesce(nullif(new.client_name, ''), 'un cliente') || ': ' || how);
  return null;
end $$;
drop trigger if exists bookings_rest_log on public.bookings;
create trigger bookings_rest_log after update of rest_method, rest_parts on public.bookings
  for each row execute function public.bookings_rest_log();

-- ---------- volver a abrir y cerrar de nuevo ----------
create or replace function public.cash_closings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or old.kind <> 'day' then return old; end if;
  st := public.cash_day_state(old.provider_id, old.period);
  -- reabrir un día: solo de los últimos 7 y con su mes abierto (day_closed es justamente lo que se está deshaciendo)
  if st in ('day_too_old', 'month_closed') then raise exception '%', st; end if;
  return old;
end $$;
drop trigger if exists cash_closings_guard on public.cash_closings;
create trigger cash_closings_guard before delete on public.cash_closings
  for each row execute function public.cash_closings_guard();

create or replace function public.cash_closings_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.kind = 'day' then
      perform public.cash_day_log_add(old.provider_id, old.period, 'reopen', 'Volviste a abrir la caja (estaba cerrada con ' || public.cash_money(old.income) || ')');
    end if;
    return old;
  end if;
  if new.kind = 'day' and public.cash_day_reopened(new.provider_id, new.period) then
    perform public.cash_day_log_add(new.provider_id, new.period, 'close', 'Cerraste la caja de nuevo: ' || public.cash_money(new.income));
  end if;
  return new;
end $$;
drop trigger if exists cash_closings_log on public.cash_closings;
create trigger cash_closings_log after insert or update or delete on public.cash_closings
  for each row execute function public.cash_closings_log();

-- para la app: el estado de un día de la caja (open, day_closed, month_closed, day_too_old)
create or replace function public.my_cash_day(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider();
begin
  if pid is null then raise exception 'not_provider'; end if;
  return jsonb_build_object('state', public.cash_day_state(pid, p_day),
    'log', coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'kind', l.kind, 'detail', l.detail) order by l.at, l.id)
                       from public.cash_day_log l where l.provider_id = pid and l.day = p_day), '[]'));
end $$;

revoke execute on function public.cash_day_state(bigint, date), public.cash_day_of(bigint, timestamptz), public.cash_day_reopened(bigint, date),
  public.cash_day_log_add(bigint, date, text, text), public.walkins_cash_guard(), public.walkins_cash_log(), public.bookings_rest_guard(),
  public.bookings_rest_log(), public.cash_closings_guard(), public.cash_closings_log() from public, anon, authenticated;
revoke execute on function public.my_cash_day(date) from public, anon;
grant execute on function public.my_cash_day(date) to authenticated;

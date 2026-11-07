-- 7/11 · Revisión del cliente (punto 6): feriados con respaldo en el calendario público de Google (D39).
-- La fuente principal sigue siendo ArgentinaDatos (trae el tipo: inamovible, trasladable o puente). Si falla, holidays-sync
-- lee el calendario de feriados de Argentina de Google (.ics), que no dice el tipo: esos feriados entran como 'nacional'
-- (y los puentes turísticos, como 'puente'). holiday_years.fetched_from dice de dónde vino cada año. Lo demás de D39
-- sigue igual: el admin confirma una vez por año. Idempotente; no borra datos.

alter table public.holidays drop constraint if exists holidays_kind_check;
alter table public.holidays add constraint holidays_kind_check check (kind in ('inamovible','trasladable','puente','nacional'));
alter table public.holiday_years add column if not exists fetched_from text;
alter table public.holiday_years drop constraint if exists holiday_years_fetched_from_check;
alter table public.holiday_years add constraint holiday_years_fetched_from_check check (fetched_from is null or fetched_from in ('argentinadatos','google'));

-- holidays_sync_save con la fuente: la de 3 argumentos se reemplaza por esta (el mismo nombre, un parámetro más)
drop function if exists public.holidays_sync_save(int, jsonb, text);
create or replace function public.holidays_sync_save(p_year int, p_rows jsonb, p_error text default null, p_source text default 'argentinadatos') returns jsonb
language plpgsql security definer set search_path = public as $$
declare y record; n int := 0; changed boolean := false; rows jsonb;
begin
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'bad_year'; end if;
  if p_source not in ('argentinadatos','google') then raise exception 'bad_source'; end if;
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
     where x.d is not null and extract(year from x.d) = p_year and x.k in ('inamovible','trasladable','puente','nacional')
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
         fetched_count = n, fetched_from = p_source, source_changed = source_changed or changed
   where year = p_year;
  return jsonb_build_object('year', p_year, 'count', n, 'confirmed', y.confirmed_at is not null, 'changed', changed, 'source', p_source);
end $$;


-- el admin ve de dónde vino cada año
create or replace function public.admin_holidays() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cy int := extract(year from (now() at time zone 'America/Argentina/Buenos_Aires'))::int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'year', g.y,
      'fetched_at', hy.fetched_at, 'fetch_error', hy.fetch_error, 'fetched_count', hy.fetched_count, 'fetched_from', hy.fetched_from,
      'source_changed', coalesce(hy.source_changed, false), 'confirmed_at', hy.confirmed_at,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name, 'kind', h.kind, 'source', h.source) order by h.day), '[]')
                 from public.holidays h where extract(year from h.day) = g.y)) order by g.y), '[]')
    from generate_series(cy, cy + 1) g(y) left join public.holiday_years hy on hy.year = g.y);
end $$;

-- el admin también puede cargar uno como 'nacional'
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
end $$;


revoke execute on function public.holidays_sync_save(int, jsonb, text, text), public.admin_holidays(), public.admin_holiday_save(date, text, text)
  from public, anon, authenticated;
grant execute on function public.holidays_sync_save(int, jsonb, text, text) to service_role;
grant execute on function public.admin_holidays(), public.admin_holiday_save(date, text, text) to authenticated;

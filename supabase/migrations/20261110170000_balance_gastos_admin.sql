-- =====================================================================
-- TuTiempo · 10/11 · punto 12 · Balance del admin: gastos fijos y variables de TuTiempo (D44)
--   Los gastos de TuTiempo funcionan como los del profesional en Finanzas (C31, D40, S16/S17):
--   - Gastos fijos (admin_fixed_expenses): se repiten solos cada mes. admin_fixed_sync() carga en admin_expenses la
--     fila de cada mes que falte (una por gasto y mes: admin_expenses.fixed_id + fixed_month), desde el mes en que se
--     creó y nunca en un mes cerrado. Se cambian solo desde el mes actual en adelante (admin_fixed_save, como S17): ese
--     mes y los siguientes que no estén cerrados; los meses anteriores y los cerrados quedan como estaban
--     (applies_from: desde qué mes vale el monto actual; antes de cambiarlo se cargan los meses que falten con el
--     monto viejo, así nada se carga hacia atrás con el nuevo). admin_fixed_stop lo deja de repetir desde el mes actual.
--   - Precargados de ejemplo (preset): hosting, base de datos, emails y dominio, sin monto (0 = «Completá el monto»:
--     no se carga hasta que el admin pone el monto). Una sola vez: si la migración corre de nuevo no se duplican y si
--     el admin los dio de baja no vuelven.
--   - Gastos variables: los de siempre (admin_expenses sin fixed_id). Los que ya estaban cargados quedan como
--     variables (no se mueve ni se borra nada). Ahora también se editan (admin_update_expense); un gasto fijo se
--     cambia desde «Gastos fijos», no suelto (fixed_expense).
--   - Resultado del mes y del año: comisiones − gastos fijos − gastos variables. admin_month_live y admin_finance
--     devuelven fixed y variable aparte (expenses sigue siendo el total) y el cierre guarda los fijos
--     (admin_closings.expenses_fixed; los cierres viejos quedan con 0 fijos: todo lo que tenían era variable).
--   - Cerrar y reabrir el mes y el año siguen igual (antes de cerrar se cargan los fijos que falten).
--   - Solo el admin (is_admin()): la tabla nueva sin acceso directo (RLS, sin grants a anon/authenticated); todo por
--     funciones security definer con search_path.
--   - No hay estado «Pagado / Debo»: los gastos del profesional no lo tienen y no se inventa (ver D44).
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- gastos fijos de TuTiempo ----------
create table if not exists public.admin_fixed_expenses (
  id           bigint generated always as identity primary key,
  concept      text not null check (char_length(concept) between 1 and 80),
  amount       integer not null default 0 check (amount between 0 and 2000000000),   -- 0 = sin monto: no se carga
  since        date not null,                     -- el 1° del mes desde el que se repite
  until_month  date,                              -- el 1° del último mes (null = sigue; antes de since = dado de baja)
  applies_from date not null,                     -- el 1° del mes desde el que vale el monto actual
  preset       text unique,                       -- los precargados: una vez cada uno
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (extract(day from since) = 1 and extract(day from applies_from) = 1 and applies_from >= since),
  check (until_month is null or (extract(day from until_month) = 1 and until_month >= (since - interval '1 month')::date))
);
alter table public.admin_fixed_expenses enable row level security;
revoke all on public.admin_fixed_expenses from public, anon, authenticated;

-- la fila de cada mes de un gasto fijo, en los gastos de TuTiempo
alter table public.admin_expenses add column if not exists fixed_id bigint references public.admin_fixed_expenses(id) on delete set null;
alter table public.admin_expenses add column if not exists fixed_month date;
create unique index if not exists admin_expenses_fixed_month on public.admin_expenses (fixed_id, fixed_month) where fixed_id is not null;

-- el cierre guarda los fijos aparte (expenses sigue siendo el total: fijos + variables)
alter table public.admin_closings add column if not exists expenses_fixed bigint not null default 0;

-- ---------- precargados (sin monto, desde el mes actual de Buenos Aires) ----------
insert into public.admin_fixed_expenses (concept, amount, since, applies_from, preset)
select v.concept, 0, public.month_start_ba(), public.month_start_ba(), v.preset
  from (values ('hosting', 'Hosting (Hostinger)'), ('database', 'Base de datos (Supabase)'),
               ('email', 'Emails (Resend)'), ('domain', 'Dominio')) as v(preset, concept)
on conflict (preset) do nothing;

-- ¿el mes del balance de TuTiempo está cerrado?
create or replace function public.admin_month_closed(p_month date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_closings where kind = 'month' and period = date_trunc('month', p_month)::date)
$$;

-- carga los gastos fijos que falten hasta este mes: desde que vale su monto actual, nunca en un mes cerrado. Idempotente.
create or replace function public.admin_fixed_sync() returns int
language plpgsql security definer set search_path = public as $$
declare m0 date := public.month_start_ba(); f record; m date; n int := 0;
begin
  for f in select * from public.admin_fixed_expenses where amount > 0 loop
    m := greatest(f.since, f.applies_from);
    while m <= least(m0, coalesce(f.until_month, m0)) loop
      if not public.admin_month_closed(m) then
        insert into public.admin_expenses (day, concept, amount, fixed_id, fixed_month, created_by)
        values (m, f.concept, f.amount, f.id, m, f.created_by)
        on conflict (fixed_id, fixed_month) where fixed_id is not null do nothing;
        if found then n := n + 1; end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;

-- crea un gasto fijo (p_id null) o lo cambia desde el mes actual en adelante (S17): el nombre y el monto de este mes
-- y de los siguientes que no estén cerrados. Un mes pasado o futuro es bad_month; un mes cerrado nunca se toca.
create or replace function public.admin_fixed_save(p_id bigint, p_concept text, p_amount int, p_from date) returns bigint
language plpgsql security definer set search_path = public as $$
declare mfrom date := date_trunc('month', p_from)::date; f record; fid bigint;
        txt text := left(btrim(regexp_replace(coalesce(p_concept, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if txt = '' then raise exception 'empty_concept'; end if;
  if p_amount is null or p_amount < 0 or p_amount > 2000000000 or (p_id is null and p_amount < 1) then raise exception 'bad_amount'; end if;
  if mfrom is distinct from public.month_start_ba() then raise exception 'bad_month'; end if;
  if public.admin_month_closed(mfrom) then raise exception 'month_closed'; end if;
  if p_id is null then
    insert into public.admin_fixed_expenses (concept, amount, since, applies_from, created_by)
    values (txt, p_amount, mfrom, mfrom, auth.uid()) returning id into fid;
  else
    select * into f from public.admin_fixed_expenses where id = p_id for update;
    if f.id is null or (f.until_month is not null and f.until_month < mfrom) then raise exception 'not_found'; end if;
    fid := f.id;
    -- los meses anteriores que falten, con el monto que tenían
    perform public.admin_fixed_sync();
    update public.admin_fixed_expenses set concept = txt, amount = p_amount, applies_from = greatest(since, mfrom),
           until_month = null
     where id = fid;
    delete from public.admin_expenses e where e.fixed_id = fid and e.fixed_month >= mfrom and p_amount = 0
       and not public.admin_month_closed(e.fixed_month);
    update public.admin_expenses e set amount = p_amount, concept = txt
     where e.fixed_id = fid and e.fixed_month >= mfrom and p_amount > 0 and not public.admin_month_closed(e.fixed_month);
  end if;
  perform public.admin_fixed_sync();
  return fid;
end $$;

-- deja de repetirlo desde el mes actual (este mes y los siguientes que no estén cerrados salen de los gastos)
create or replace function public.admin_fixed_stop(p_id bigint, p_from date) returns void
language plpgsql security definer set search_path = public as $$
declare mfrom date := date_trunc('month', p_from)::date; f record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if mfrom is distinct from public.month_start_ba() then raise exception 'bad_month'; end if;
  if public.admin_month_closed(mfrom) then raise exception 'month_closed'; end if;
  select * into f from public.admin_fixed_expenses where id = p_id for update;
  if f.id is null then raise exception 'not_found'; end if;
  perform public.admin_fixed_sync();
  update public.admin_fixed_expenses set until_month = (greatest(mfrom, since) - interval '1 month')::date where id = f.id;
  delete from public.admin_expenses e where e.fixed_id = f.id and e.fixed_month >= mfrom and not public.admin_month_closed(e.fixed_month);
end $$;

-- ---------- gastos variables ----------
-- cambiar un gasto variable (nombre y monto) de un mes que no esté cerrado
create or replace function public.admin_update_expense(p_id bigint, p_concept text, p_amount int) returns void
language plpgsql security definer set search_path = public as $$
declare e record; txt text := left(btrim(regexp_replace(coalesce(p_concept, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if txt = '' then raise exception 'empty_concept'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 2000000000 then raise exception 'bad_amount'; end if;
  select * into e from public.admin_expenses where id = p_id for update;
  if e.id is null then raise exception 'not_found'; end if;
  if e.fixed_id is not null then raise exception 'fixed_expense'; end if;
  if public.admin_month_closed(e.day) then raise exception 'month_closed'; end if;
  update public.admin_expenses set concept = txt, amount = p_amount where id = e.id;
end $$;

-- borrar un gasto variable (un gasto fijo se deja de repetir desde «Gastos fijos»)
create or replace function public.admin_delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into e from public.admin_expenses where id = p_id;
  if e.id is null then return; end if;
  if e.fixed_id is not null then raise exception 'fixed_expense'; end if;
  if public.admin_month_closed(e.day) then raise exception 'month_closed'; end if;
  delete from public.admin_expenses where id = p_id;
end $$;

-- ---------- balance: comisiones − gastos fijos − gastos variables ----------
-- Números en vivo de un mes (hora Argentina). Cuenta lo cobrado por Mercado Pago que no se devolvió.
create or replace function public.admin_month_live(m date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires'; rate numeric := public.commission();
        m0 date := make_date(extract(year from m)::int, extract(month from m)::int, 1); m1 date; r jsonb;
begin
  m1 := (m0 + interval '1 month')::date;
  with b as (select x.*, public.booking_fee(x, rate) fee from public.bookings x
             where x.source = 'app' and x.paid_mp > 0 and (x.status in ('confirmed','done','no_show','cancelled_client') or (x.status = 'cancelled_provider' and x.settle_by_provider))
               and x.created_at >= (m0::timestamp at time zone tz) and x.created_at < (m1::timestamp at time zone tz)),
       g as (select amount, fixed_id from public.admin_expenses where day >= m0 and day < m1)
  select jsonb_build_object(
    'bookings',   (select count(*) from b),
    'charged',    (select coalesce(sum(paid_mp + case when client_fee > 0 then fee else 0 end), 0) from b),
    'deposits',   (select coalesce(sum(paid_mp - case when client_fee > 0 then 0 else fee end), 0) from b),
    'commission', (select coalesce(sum(fee), 0) from b),
    'expenses',   (select coalesce(sum(amount), 0) from g),
    'fixed',      (select coalesce(sum(amount), 0) from g where fixed_id is not null),
    'variable',   (select coalesce(sum(amount), 0) from g where fixed_id is null)) into r;
  return r;
end $$;

-- el balance de un año. Antes carga los gastos fijos que falten (por eso ya no es stable).
create or replace function public.admin_finance(p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; y int := coalesce(p_year, extract(year from today)::int);
        ms jsonb := '[]'; m date; cj jsonb; v jsonb; ycl timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if y < 2024 or y > 2100 then raise exception 'bad_year'; end if;
  perform public.admin_fixed_sync();
  for m in select g::date from generate_series(make_date(y, 1, 1), make_date(y, 12, 1), interval '1 month') g loop
    select to_jsonb(ac) into cj from public.admin_closings ac where kind = 'month' and period = m;
    v := case when cj is not null then jsonb_build_object('bookings', cj->'bookings', 'charged', cj->'charged', 'deposits', cj->'deposits',
                                                          'commission', cj->'commission', 'expenses', cj->'expenses',
                                                          'fixed', cj->'expenses_fixed',
                                                          'variable', (cj->>'expenses')::bigint - (cj->>'expenses_fixed')::bigint)
              when m > today then jsonb_build_object('bookings', 0, 'charged', 0, 'deposits', 0, 'commission', 0, 'expenses', 0,
                                                     'fixed', 0, 'variable', 0)
              else public.admin_month_live(m) end;
    ms := ms || (v || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'closed_at', cj->'closed_at',
                                         'state', case when cj is not null then 'closed' when m > today then 'future'
                                                       when (m + interval '1 month')::date > today then 'open' else 'ended' end));
  end loop;
  select closed_at into ycl from public.admin_closings where kind = 'year' and period = make_date(y, 1, 1);
  return jsonb_build_object('year', y, 'months', ms, 'year_closed_at', ycl, 'can_close_year', make_date(y + 1, 1, 1) <= today,
    'current_month', to_char(public.month_start_ba(), 'YYYY-MM'),
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'day', to_char(day, 'YYYY-MM-DD'), 'concept', concept, 'amount', amount,
                                                              'fixed_id', fixed_id) order by day desc, id desc), '[]')
                 from public.admin_expenses where day >= make_date(y, 1, 1) and day < make_date(y + 1, 1, 1)),
    -- los gastos fijos (los dados de baja desde que empezaron no se muestran en ningún mes)
    'fixed_items', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'concept', concept, 'amount', amount,
                                                                 'since', to_char(since, 'YYYY-MM'), 'until', to_char(until_month, 'YYYY-MM'),
                                                                 'preset', preset is not null) order by id), '[]')
                    from public.admin_fixed_expenses where until_month is null or until_month >= since),
    'years', (select coalesce(jsonb_agg(jsonb_build_object('year', extract(year from period)::int, 'commission', commission, 'expenses', expenses,
                                                           'fixed', expenses_fixed, 'variable', expenses - expenses_fixed,
                                                           'bookings', bookings, 'closed_at', closed_at) order by period), '[]')
              from public.admin_closings where kind = 'year'));
end $$;

-- Cerrar un mes (cuando terminó) o un año (cuando terminó: cierra también sus meses abiertos). Igual que antes, con
-- los gastos fijos aparte y cargados antes de la foto.
create or replace function public.admin_close(p_kind text, p_period date) returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; m0 date := date_trunc('month', p_period)::date; m date; v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'month' then
    if (m0 + interval '1 month')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'month' and period = m0) then raise exception 'already_closed'; end if;
    perform public.admin_fixed_sync();
    v := public.admin_month_live(m0);
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, expenses_fixed, closed_by)
    values ('month', m0, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint,
            (v->>'expenses')::bigint, (v->>'fixed')::bigint, auth.uid());
  elsif p_kind = 'year' then
    m0 := date_trunc('year', p_period)::date;
    if (m0 + interval '1 year')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'year' and period = m0) then raise exception 'already_closed'; end if;
    perform public.admin_fixed_sync();
    for m in select g::date from generate_series(m0, (m0 + interval '11 months')::date, interval '1 month') g loop
      if not exists (select 1 from public.admin_closings where kind = 'month' and period = m) then
        v := public.admin_month_live(m);
        insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, expenses_fixed, closed_by)
        values ('month', m, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint,
                (v->>'expenses')::bigint, (v->>'fixed')::bigint, auth.uid());
      end if;
    end loop;
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, expenses_fixed, closed_by)
    select 'year', m0, sum(bookings), sum(charged), sum(deposits), sum(commission), sum(expenses), sum(expenses_fixed), auth.uid()
      from public.admin_closings where kind = 'month' and period >= m0 and period < (m0 + interval '1 year')::date;
  else raise exception 'bad_kind'; end if;
end $$;

-- ---------- permisos ----------
revoke execute on function public.admin_month_closed(date), public.admin_fixed_sync(), public.admin_month_live(date)
  from public, anon, authenticated;
revoke execute on function public.admin_fixed_save(bigint, text, int, date), public.admin_fixed_stop(bigint, date),
  public.admin_update_expense(bigint, text, int), public.admin_delete_expense(bigint), public.admin_finance(int),
  public.admin_close(text, date) from public, anon;
grant execute on function public.admin_fixed_save(bigint, text, int, date), public.admin_fixed_stop(bigint, date),
  public.admin_update_expense(bigint, text, int), public.admin_delete_expense(bigint), public.admin_finance(int),
  public.admin_close(text, date) to authenticated;

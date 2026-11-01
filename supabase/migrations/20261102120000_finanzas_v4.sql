-- =====================================================================
-- TuTiempo · V4 (Finanzas y productos, la parte que no espera decisiones)
--   - C25: "Transferencia" como medio de pago de lo que se cobra en el local: en lo cargado sin turno (walkins.method)
--     y en el resto de un turno (bookings.rest_method, nuevo: cómo se cobró el resto en el local; lo carga el
--     prestador desde Caja del día con set_rest_method). bookings.pay_method no cambia: es lo que eligió el cliente al
--     reservar y lo ve él en Mis turnos.
--   - H36: Finanzas descontaba la comisión de TuTiempo del precio de los turnos de la app. Desde la versión 30 la
--     comisión la paga el cliente aparte de la seña (y desde D30 es un % de la seña): el prestador recibe el precio
--     completo. Solo los turnos de antes de la versión 30 tenían la comisión adentro de la seña (app_fee − client_fee).
--   - C33: provider_month_breakdown(año): lo mismo que provider_month_totals, separado por origen (turnos de la app,
--     agendados a mano, sin turno, productos) y por tipo de gasto (fijos y compras de productos), para el resumen del mes.
-- No mueve plata ni cambia cobros ni devoluciones. Idempotente.
-- =====================================================================

-- ---------- C25 · Transferencia ----------
alter table public.walkins drop constraint if exists walkins_method_check;
alter table public.walkins add constraint walkins_method_check check (method in ('cash','mp','transfer'));

alter table public.bookings add column if not exists rest_method text;
alter table public.bookings drop constraint if exists bookings_rest_method_check;
alter table public.bookings add constraint bookings_rest_method_check check (rest_method is null or rest_method in ('cash','mp','transfer'));

-- el prestador anota cómo cobró el resto de un turno suyo que ya pasó por la caja (asistió)
create or replace function public.set_rest_method(p_booking bigint, p_method text) returns text
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if p_method is not null and p_method not in ('cash','mp','transfer') then raise exception 'bad_method'; end if;
  select id, provider_id, status, source into b from public.bookings where id = p_booking for update;
  if b.id is null or b.provider_id is distinct from public.my_provider() then raise exception 'forbidden'; end if;
  if b.source = 'block' or b.status <> 'done' then raise exception 'not_done'; end if;
  update public.bookings set rest_method = p_method where id = p_booking;
  return p_method;
end $$;

-- ---------- H36 · Finanzas: el precio completo de los turnos de la app ----------
create or replace function public.provider_finance(p_from date, p_to date)
returns table (day date, app int, man int, walk int, prod int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  days as (select generate_series(p_from, least(p_to, p_from + 400), interval '1 day')::date as day)
  select d.day,
    -- el precio, menos la comisión que salió de la seña en los turnos de antes de la versión 30 (en los nuevos es 0)
    coalesce((select sum(b.price - greatest(coalesce(b.app_fee, 0) - coalesce(b.client_fee, 0), 0))::int from public.bookings b, tz
              where b.provider_id = (select id from pid)
              and b.source = 'app' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(b.price)::int from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'manual' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount + w.tip)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'service' and (w.at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'product' and (w.at at time zone tz.z)::date = d.day), 0)
  from days d where (select id from pid) is not null order by d.day
$$;

-- ---------- C33 · Resumen del mes ----------
create or replace function public.provider_month_breakdown(p_year int)
returns table (month int, app int, man int, walk int, prod int, exp_fixed int, exp_products int)
language sql stable security definer set search_path = public as $$
  with f as (select * from public.provider_finance(make_date(p_year,1,1), make_date(p_year,12,31))),
  e as (select extract(month from x.spent_on)::int as em, x.category, x.amount from public.expenses x
        where x.provider_id = public.my_provider() and extract(year from x.spent_on) = p_year)
  select m,
    coalesce((select sum(f.app)::int from f where extract(month from f.day) = m), 0),
    coalesce((select sum(f.man)::int from f where extract(month from f.day) = m), 0),
    coalesce((select sum(f.walk)::int from f where extract(month from f.day) = m), 0),
    coalesce((select sum(f.prod)::int from f where extract(month from f.day) = m), 0),
    coalesce((select sum(e.amount)::int from e where e.em = m and e.category <> 'Productos'), 0),
    coalesce((select sum(e.amount)::int from e where e.em = m and e.category = 'Productos'), 0)
  from generate_series(1,12) m
$$;

revoke execute on function public.set_rest_method(bigint, text), public.provider_month_breakdown(int), public.provider_finance(date, date)
  from public, anon;
grant execute on function public.set_rest_method(bigint, text), public.provider_month_breakdown(int), public.provider_finance(date, date)
  to authenticated;

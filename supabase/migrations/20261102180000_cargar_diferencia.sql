-- =====================================================================
-- TuTiempo · V4b · C25 "Cargar diferencia"
-- El resto de un turno (precio menos la seña pagada) se cobra en el local en uno o dos medios. Por ejemplo, de un resto
-- de $5.000: $3.000 en efectivo y $2.000 por transferencia.
--   - bookings.rest_parts: las partes, como [{"method":"cash","amount":3000},{"method":"transfer","amount":2000}].
--     null = no se cargó: el resto entero va en rest_method (o en lo que eligió el cliente), como hasta ahora.
--   - set_rest_parts(turno, partes): lo carga el prestador al marcar "Asistió" o después desde Finanzas. Una o dos
--     partes, medios distintos, montos enteros mayores que 0 y la suma no puede superar el resto. rest_method queda con
--     el medio de la primera parte. set_rest_method (un solo medio, el resto entero) borra las partes.
--   - Si la suma es menor que el resto, lo que falta no se cobró: no entra en la caja ni en Finanzas (provider_finance).
-- No mueve plata ni cambia cobros ni devoluciones. Idempotente.
-- =====================================================================

alter table public.bookings add column if not exists rest_parts jsonb;

-- el resto de un turno: lo que queda por cobrar en el local después de la seña (y del saldo usado)
create or replace function public.booking_rest(p_price int, p_paid_mp int, p_paid_wallet int) returns int
language sql immutable set search_path = public as $$
  select greatest(coalesce(p_price, 0) - coalesce(p_paid_mp, 0) - coalesce(p_paid_wallet, 0), 0)
$$;

-- lo que quedó sin cobrar del resto: solo si se cargaron partes y suman menos que el resto
create or replace function public.rest_uncollected(p_price int, p_paid_mp int, p_paid_wallet int, p_parts jsonb) returns int
language sql immutable set search_path = public as $$
  select case when p_parts is null then 0 else greatest(public.booking_rest(p_price, p_paid_mp, p_paid_wallet)
    - coalesce((select sum((x->>'amount')::int) from jsonb_array_elements(p_parts) x), 0), 0) end
$$;

create or replace function public.set_rest_parts(p_booking bigint, p_parts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; part jsonb; total int := 0; methods text[] := '{}'; clean jsonb := '[]'; amt int; m text;
begin
  select id, provider_id, status, source, price, paid_mp, paid_wallet into b from public.bookings where id = p_booking for update;
  if b.id is null or b.provider_id is distinct from public.my_provider() then raise exception 'forbidden'; end if;
  if b.source = 'block' or b.status <> 'done' then raise exception 'not_done'; end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) not between 1 and 2 then
    raise exception 'bad_parts';
  end if;
  for part in select * from jsonb_array_elements(p_parts) loop
    m := part->>'method';
    if m is null or m not in ('cash','mp','transfer') then raise exception 'bad_method'; end if;
    if m = any(methods) then raise exception 'bad_parts'; end if;
    -- montos enteros en pesos (sin decimales ni texto)
    if coalesce(jsonb_typeof(part->'amount'), '') <> 'number' or coalesce(part->>'amount', '') !~ '^[0-9]+$' then raise exception 'bad_amount'; end if;
    amt := (part->>'amount')::int;
    if amt <= 0 then raise exception 'bad_amount'; end if;
    methods := methods || m;
    total := total + amt;
    clean := clean || jsonb_build_array(jsonb_build_object('method', m, 'amount', amt));
  end loop;
  if total > public.booking_rest(b.price, b.paid_mp, b.paid_wallet) then raise exception 'over_rest'; end if;
  update public.bookings set rest_parts = clean, rest_method = methods[1] where id = p_booking;
  return clean;
end $$;

-- un solo medio para el resto entero: sin partes
create or replace function public.set_rest_method(p_booking bigint, p_method text) returns text
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if p_method is not null and p_method not in ('cash','mp','transfer') then raise exception 'bad_method'; end if;
  select id, provider_id, status, source into b from public.bookings where id = p_booking for update;
  if b.id is null or b.provider_id is distinct from public.my_provider() then raise exception 'forbidden'; end if;
  if b.source = 'block' or b.status <> 'done' then raise exception 'not_done'; end if;
  update public.bookings set rest_method = p_method, rest_parts = null where id = p_booking;
  return p_method;
end $$;

-- Finanzas: lo que quedó sin cobrar del resto no entró
create or replace function public.provider_finance(p_from date, p_to date)
returns table (day date, app int, man int, walk int, prod int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  days as (select generate_series(p_from, least(p_to, p_from + 400), interval '1 day')::date as day)
  select d.day,
    -- el precio, menos la comisión que salió de la seña en los turnos de antes de la versión 30 (en los nuevos es 0)
    -- y menos lo que no se cobró del resto (V4b)
    coalesce((select sum(b.price - greatest(coalesce(b.app_fee, 0) - coalesce(b.client_fee, 0), 0)
                         - public.rest_uncollected(b.price, b.paid_mp, b.paid_wallet, b.rest_parts))::int from public.bookings b, tz
              where b.provider_id = (select id from pid)
              and b.source = 'app' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(b.price - public.rest_uncollected(b.price, b.paid_mp, b.paid_wallet, b.rest_parts))::int
              from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'manual' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount + w.tip)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'service' and (w.at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'product' and (w.at at time zone tz.z)::date = d.day), 0)
  from days d where (select id from pid) is not null order by d.day
$$;

revoke execute on function public.booking_rest(int, int, int), public.rest_uncollected(int, int, int, jsonb) from public, anon, authenticated;
revoke execute on function public.set_rest_parts(bigint, jsonb), public.set_rest_method(bigint, text), public.provider_finance(date, date)
  from public, anon;
grant execute on function public.set_rest_parts(bigint, jsonb), public.set_rest_method(bigint, text), public.provider_finance(date, date)
  to authenticated;

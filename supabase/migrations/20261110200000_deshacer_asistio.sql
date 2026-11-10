-- =====================================================================
-- TuTiempo · 10/11 · punto 4 · deshacer o editar «Asistió» (decidido por Bruno el 10/11)
--   - undo_attendance(turno, 'confirmed' | 'no_show'): el turno atendido vuelve a Confirmado o pasa a No vino.
--       · se borra el resto cobrado en el local (rest_parts y rest_method: sale de la Caja del día);
--       · se resta el sello que sumó ese turno (loyalty_events 'undo'). Si el cliente ya lo usó en un canje
--         (un canje de esa tarjeta después del sello, sin devolver), NO se puede deshacer: stamp_redeemed;
--       · la ficha del cliente: una visita menos, lo que gastó menos el precio, la última visita vuelve a la anterior;
--         con No vino, una falta más (como el botón «No vino»);
--       · el ranking de actividad lo corrige solo el trigger bookings_activity (deja de ser 'done');
--       · NUNCA hay devolución de Mercado Pago (D08) y el pedido de reseña que ya salió queda (una reseña que ya existe
--         también; una nueva ya no se puede dejar porque la base pide el turno atendido).
--   - Solo con la caja de ese día abierta (y el mes sin cerrar): si no, day_closed. Lo mismo para cambiar cómo se cobró
--     el resto (set_rest_method, set_rest_parts): antes se podía con la caja cerrada y el cierre dejaba de cerrar.
--   - attendance_undo_check(turno): lo que hace falta saber antes de confirmar (sello y caja), para el aviso de la app.
-- Idempotente y sin borrar datos.
-- =====================================================================

alter table public.loyalty_events drop constraint if exists loyalty_events_kind_check;
alter table public.loyalty_events add constraint loyalty_events_kind_check
  check (kind in ('earn','manual','redeem','refund','undo'));

-- un turno puede sumar su sello, perderlo al deshacer y volver a sumarlo si se marca Asistió de nuevo: el índice que
-- dejaba un solo evento por turno y tipo queda para los canjes y sus devoluciones. Que un turno no sume dos veces lo
-- asegura mark_booking (solo pasa de Confirmado a Atendido una vez por vuelta, con el turno bloqueado).
drop index if exists public.loyalty_events_once;
create unique index if not exists loyalty_events_once_redeem on public.loyalty_events (booking_id, kind)
  where booking_id is not null and kind in ('redeem', 'refund');

-- sellos: 'undo' resta un sello ganado (también con los sellos apagados, como la devolución)
create or replace function public.stamp_add(pid bigint, uid uuid, sid bigint, d integer, k text, bid bigint)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- C29: con los sellos apagados no se suma (la visita se marca igual) y no se canjea; la devolución y el deshacer sí
  if not public.stamps_enabled() then
    if k = 'earn' then
      return null;
    end if;
    if k in ('manual', 'redeem') then
      raise exception 'stamps_off';
    end if;
  end if;
  insert into public.loyalty_events (provider_id, user_id, service_id, kind, delta, booking_id) values (pid, uid, sid, k, d, bid);
  insert into public.loyalty_cards as lc (provider_id, user_id, service_id, stamps, earned, redeemed)
  values (pid, uid, sid, greatest(d, 0), case when k in ('earn','manual','undo') then greatest(d, 0) else 0 end, 0)
  on conflict (provider_id, user_id, service_id) do update set
    stamps   = lc.stamps + d,
    earned   = lc.earned + case when k in ('earn','manual','undo') then d else 0 end,
    redeemed = lc.redeemed + case when k = 'redeem' then -d when k = 'refund' then -d else 0 end,
    updated_at = now()
  returning stamps into n;
  return n;
end $$;

-- ¿la caja del día de ese turno (o su mes) está cerrada?
create or replace function public.booking_day_closed(p_provider bigint, p_starts timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.cash_closings c
     where c.provider_id = p_provider
       and ((c.kind = 'day' and c.period = (p_starts at time zone public.provider_tz(p_provider))::date)
         or (c.kind = 'month' and c.period = date_trunc('month', p_starts at time zone public.provider_tz(p_provider))::date)))
$$;

-- el sello que sumó un turno: 'none' (no sumó o ya se restó), 'undo' (se puede restar) o 'redeemed' (ya lo canjeó)
create or replace function public.attendance_stamp_state(p_booking bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare e record; have int;
begin
  select * into e from public.loyalty_events where booking_id = p_booking and kind = 'earn' order by id desc limit 1;
  if e.id is null or exists (select 1 from public.loyalty_events u where u.booking_id = p_booking and u.kind = 'undo' and u.id > e.id) then
    return 'none';
  end if;
  select stamps into have from public.loyalty_cards
   where provider_id = e.provider_id and user_id = e.user_id and service_id = e.service_id;
  if coalesce(have, 0) < e.delta
     or exists (select 1 from public.loyalty_events r
                 where r.provider_id = e.provider_id and r.user_id = e.user_id and r.service_id = e.service_id
                   and r.kind = 'redeem' and r.id > e.id
                   and not exists (select 1 from public.loyalty_events f where f.booking_id = r.booking_id and f.kind = 'refund')) then
    return 'redeemed';
  end if;
  return 'undo';
end $$;

-- antes de confirmar: qué pasa con el sello y si la caja de ese día está cerrada
create or replace function public.attendance_undo_check(p_booking bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b record;
begin
  select id, provider_id, status, source, starts_at into b from public.bookings where id = p_booking;
  if b.id is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  return jsonb_build_object('status', b.status,
                            'stamp', public.attendance_stamp_state(b.id),
                            'day_closed', public.booking_day_closed(b.provider_id, b.starts_at));
end $$;

create or replace function public.undo_attendance(p_booking bigint, p_to text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; tz text; st text; e record; prev date;
begin
  if p_to is null or p_to not in ('confirmed','no_show') then raise exception 'bad_status'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status <> 'done' or b.source = 'block' then raise exception 'bad_state'; end if;
  if public.booking_day_closed(b.provider_id, b.starts_at) then raise exception 'day_closed'; end if;
  st := public.attendance_stamp_state(b.id);
  if st = 'redeemed' then raise exception 'stamp_redeemed'; end if;
  if st = 'undo' then
    select * into e from public.loyalty_events where booking_id = b.id and kind = 'earn' order by id desc limit 1;
    perform public.stamp_add(e.provider_id, e.user_id, e.service_id, -e.delta, 'undo', b.id);
  end if;
  tz := public.provider_tz(b.provider_id);
  update public.bookings set status = p_to, rest_parts = null, rest_method = null where id = b.id;
  -- la última visita anterior de ese cliente (sin este turno)
  select max((x.starts_at at time zone tz)::date) into prev from public.bookings x
   where x.provider_id = b.provider_id and x.status = 'done' and x.id <> b.id
     and ((b.client_id is not null and x.client_id = b.client_id) or (b.client_id is null and lower(x.client_name) = lower(b.client_name)));
  update public.provider_clients c set
     visits = greatest(visits - 1, 0),
     no_shows = no_shows + (p_to = 'no_show')::int,
     total_spent = greatest(total_spent - b.price, 0),
     last_visit = case when last_visit = (b.starts_at at time zone tz)::date then prev else last_visit end
   where c.provider_id = b.provider_id
     and ((b.client_id is not null and c.user_id = b.client_id) or (b.client_id is null and lower(c.name) = lower(b.client_name)));
  return jsonb_build_object('status', p_to, 'stamp', st);
end $$;

-- cambiar cómo se cobró el resto: solo con la caja de ese día abierta
create or replace function public.set_rest_method(p_booking bigint, p_method text) returns text
language plpgsql security definer set search_path = public as $$
declare b record;
begin
  if p_method is not null and p_method not in ('cash','mp','transfer') then raise exception 'bad_method'; end if;
  select id, provider_id, status, source, starts_at into b from public.bookings where id = p_booking for update;
  if b.id is null or b.provider_id is distinct from public.my_provider() then raise exception 'forbidden'; end if;
  if b.source = 'block' or b.status <> 'done' then raise exception 'not_done'; end if;
  if public.booking_day_closed(b.provider_id, b.starts_at) then raise exception 'day_closed'; end if;
  update public.bookings set rest_method = p_method, rest_parts = null where id = p_booking;
  return p_method;
end $$;

create or replace function public.set_rest_parts(p_booking bigint, p_parts jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; part jsonb; total int := 0; methods text[] := '{}'; clean jsonb := '[]'; amt int; m text;
begin
  select id, provider_id, status, source, price, paid_mp, paid_wallet, starts_at into b from public.bookings where id = p_booking for update;
  if b.id is null or b.provider_id is distinct from public.my_provider() then raise exception 'forbidden'; end if;
  if b.source = 'block' or b.status <> 'done' then raise exception 'not_done'; end if;
  if public.booking_day_closed(b.provider_id, b.starts_at) then raise exception 'day_closed'; end if;
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

revoke execute on function public.booking_day_closed(bigint, timestamptz), public.attendance_stamp_state(bigint)
  from public, anon, authenticated;
revoke execute on function public.undo_attendance(bigint, text), public.attendance_undo_check(bigint),
  public.set_rest_method(bigint, text), public.set_rest_parts(bigint, jsonb) from public, anon;
grant execute on function public.undo_attendance(bigint, text), public.attendance_undo_check(bigint),
  public.set_rest_method(bigint, text), public.set_rest_parts(bigint, jsonb) to authenticated;

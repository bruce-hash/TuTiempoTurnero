-- =====================================================================
-- TuTiempo · 0004 · Funciones del servidor (RPC)
-- Todo lo que mueve dinero o valida horarios se hace acá, nunca en el navegador.
-- Los precios, señas, descuentos y cashback los calcula la base: el cliente
-- solo dice "servicio + horario".
-- =====================================================================
set search_path = public, extensions;

-- Comisión de TuTiempo (por defecto 10%), la cambia un admin desde el panel.
create or replace function public.commission() returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select commission_pct / 100 from public.app_settings where id), 0.10)::numeric
$$;
-- Sin cashback: TuTiempo no acumula dinero de los clientes (queda en 0 por compatibilidad).
create or replace function public.cashback_rate() returns numeric language sql immutable as $$ select 0::numeric $$;

create or replace function public.provider_tz(pid bigint) returns text
language sql stable security definer set search_path = public as $$
  select c.tz from public.providers p join public.cities c on c.id = p.city_id where p.id = pid
$$;

-- ¿El horario local cae dentro de una jornada y respeta el intervalo?
create or replace function public.slot_fits(pid bigint, local_start timestamp, dur int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.provider_hours h, public.provider_settings st
    where h.provider_id = pid and st.provider_id = pid
      and h.dow = extract(dow from local_start)::int
      and local_start::time >= h.opens
      and (local_start + make_interval(mins => dur))::time <= h.closes
      and (local_start + make_interval(mins => dur))::date = local_start::date
      and (extract(epoch from (local_start::time - h.opens))::int / 60) % st.step_min = 0)
$$;

create or replace function public.happy_disc(pid bigint, local_start timestamp) returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce((select st.happy_pct from public.provider_settings st
    where st.provider_id = pid and st.happy_on
      and extract(dow from local_start)::smallint = any(st.happy_days)
      and local_start::time >= st.happy_from and local_start::time < st.happy_to), 0)::smallint
$$;

-- Primer horario libre en la ventana de reserva (para las tarjetas del listado).
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; h record; t timestamp; now_l timestamp; dd int;
begin
  select * into st from public.provider_settings where provider_id = pid;
  if st is null or not st.online then return null; end if;
  dd := coalesce(dur, (select min(duration_min) from public.services where provider_id = pid and active));
  if dd is null then return null; end if;
  now_l := (now() at time zone tz) + make_interval(mins => st.notice_min);
  for d in 0 .. st.ahead_days - 1 loop
    for h in select opens, closes from public.provider_hours
             where provider_id = pid and dow = extract(dow from (now() at time zone tz)::date + d)::int order by opens loop
      t := ((now() at time zone tz)::date + d) + h.opens;
      while t + make_interval(mins => dd) <= ((now() at time zone tz)::date + d) + h.closes loop
        if t >= now_l and not exists (select 1 from public.bookings b where b.provider_id = pid
             and b.status in ('hold','confirmed','done')
             and b.during && tstzrange(t at time zone tz, (t + make_interval(mins => dd + st.buffer_min)) at time zone tz, '[)')) then
          return t at time zone tz;
        end if;
        t := t + make_interval(mins => st.step_min);
      end loop;
    end loop;
  end loop;
  return null;
end $$;

-- Listado paginado por cursor (no por offset): rinde igual con 100 o con millones de prestadores.
-- Sin búsqueda: primero los más activos (rank_key = shuffle_key - activity); entre iguales, orden rotativo diario.
-- Con búsqueda: por relevancia, máximo 200 resultados.
drop function if exists public.list_providers(text,text,text,double precision,bigint,int);
create or replace function public.list_providers(
  p_city text default 'olavarria', p_category text default null, p_q text default null,
  p_after_key double precision default null, p_after_id bigint default null, p_limit int default 12)
returns table (id bigint, slug text, name text, address text, hue smallint, photo_path text, rating_avg numeric, rating_count int,
               categories text[], min_price int, min_service text, happy_pct smallint, next_free timestamptz,
               sort_key double precision, activity int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare cid smallint; lim int := least(greatest(coalesce(p_limit,12),1),48); q text := left(nullif(trim(p_q),''), 60);
        tsq tsquery := websearch_to_tsquery('simple', unaccent(coalesce(left(nullif(trim(p_q),''), 60),'')));
begin
  select c.id into cid from public.cities c where c.slug = p_city;
  if cid is null then return; end if;
  return query
  with base as (
    select pc.provider_id, pc.rank_key as k
    from public.provider_categories pc
    where q is null and pc.active and pc.city_id = cid
      and (case when p_category is null then pc.is_primary else pc.category_id = p_category end)
      and (p_after_key is null or (pc.rank_key, pc.provider_id) > (p_after_key, p_after_id))
    order by pc.rank_key, pc.provider_id
    limit lim
  ), fts as (
    -- 1) búsqueda de texto (nombre, servicios, dirección) o coincidencia parcial del nombre
    select p.id as provider_id, (1 - ts_rank(p.search, tsq))::double precision as k
    from public.providers p
    where q is not null and p.status = 'active' and p.city_id = cid
      and (p.search @@ tsq or p.name ilike '%' || q || '%')
      and (p_category is null or exists (select 1 from public.provider_categories pc2 where pc2.provider_id = p.id and pc2.category_id = p_category))
    order by k, p.id
    limit 200
  ), fuzzy as (
    -- 2) si no hubo nada: tolerancia a errores de tipeo (trigramas)
    select x.provider_id, x.k from (
      select p.id as provider_id, (1 + (p.name <-> q))::double precision as k   -- índice GiST: vecinos más parecidos
      from public.providers p
      where q is not null and not exists (select 1 from fts) and p.status = 'active' and p.city_id = cid
        and (p_category is null or exists (select 1 from public.provider_categories pc2 where pc2.provider_id = p.id and pc2.category_id = p_category))
      order by p.name <-> q
      limit 50) x
    where x.k < 1.7
  ), found as (
    select * from fts union all select * from fuzzy
  ), pick as (
    select * from base
    union all
    select f.provider_id, f.k from found f
      where (p_after_key is null or (f.k, f.provider_id) > (p_after_key, p_after_id))
  )
  select p.id, p.slug, p.name, p.address, p.hue, p.photo_path, p.rating_avg, p.rating_count,
         (select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from public.provider_categories pc where pc.provider_id = p.id),
         ms.price, ms.name,
         (select case when st.online and st.happy_on then st.happy_pct else 0::smallint end from public.provider_settings st where st.provider_id = p.id),
         public.next_free_slot(p.id),
         pick.k, p.activity
  from (select * from pick order by k, provider_id limit lim) pick
  join public.providers p on p.id = pick.provider_id
  left join lateral (select s.price, s.name from public.services s where s.provider_id = p.id and s.active
                     and (p_category is null or s.category_id = p_category) order by s.price limit 1) ms on true
  order by pick.k, p.id;
end $$;

create or replace function public.category_counts(p_city text default 'olavarria')
returns table (category_id text, providers bigint)
language sql stable security definer set search_path = public as $$
  select pc.category_id, count(*) from public.provider_categories pc
  join public.cities c on c.id = pc.city_id and c.slug = p_city
  where pc.active group by pc.category_id
  union all
  select 'todos', count(*) from public.provider_categories pc
  join public.cities c on c.id = pc.city_id and c.slug = p_city
  where pc.active and pc.is_primary
$$;

-- Ficha completa del prestador en una sola llamada.
create or replace function public.get_provider(pid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'bio', p.bio, 'address', p.address, 'instagram', p.instagram,
    'hue', p.hue, 'photo_path', p.photo_path, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count, 'followers', p.followers,
    'dni_verified', p.dni_verified, 'tz', c.tz,
    'categories', (select coalesce(jsonb_agg(pc.category_id order by pc.is_primary desc, pc.category_id), '[]') from public.provider_categories pc where pc.provider_id = p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_min, 'price', s.price, 'category', s.category_id,
                   'repeat_days', s.repeat_days, 'prep_note', s.prep_note, 'stamp_goal', s.stamp_goal,
                   'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'duration', a.duration_min) order by a.sort, a.id), '[]')
                              from public.service_addons a where a.service_id = s.id and a.active)) order by s.category_id, s.sort, s.price), '[]')
                 from public.services s where s.provider_id = p.id and s.active),
    'settings', (select to_jsonb(st) from public.provider_settings st where st.provider_id = p.id),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'shift', h.shift, 'opens', to_char(h.opens,'HH24:MI'), 'closes', to_char(h.closes,'HH24:MI'))), '[]')
              from public.provider_hours h where h.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(r), '[]') from (select id, author, stars, body, reply, created_at from public.reviews where provider_id = p.id order by created_at desc limit 20) r),
    'media', (select coalesce(jsonb_agg(m), '[]') from (select id, storage_path, kind, label from public.media where provider_id = p.id order by created_at desc limit 24) m),
    'following', exists (select 1 from public.follows f where f.provider_id = p.id and f.user_id = auth.uid()),
    'my_stamps', coalesce((select jsonb_object_agg(lc.service_id::text, lc.stamps) from public.loyalty_cards lc where lc.provider_id = p.id and lc.user_id = auth.uid()), '{}'::jsonb)
  ) end
  from public.providers p join public.cities c on c.id = p.city_id
  where p.id = pid and (p.status = 'active' or p.owner_id = auth.uid() or public.is_admin())
$$;

-- Horarios ocupados (sin nombres ni datos de clientes) para pintar el turnero.
drop function if exists public.provider_busy(bigint, date, date);
create or replace function public.provider_busy(pid bigint, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz, day_block boolean)
language sql stable security definer set search_path = public as $$
  -- ends_at incluye el descanso del prestador: ese tiempo tampoco se puede reservar. day_block = día bloqueado (vacaciones)
  select b.starts_at, b.busy_until, (b.source = 'block' and coalesce(b.service_name, '') like '🏖️%') from public.bookings b
  where b.provider_id = pid and b.status in ('hold','confirmed','done')
    and b.starts_at >= p_from::timestamp at time zone public.provider_tz(pid)
    and b.starts_at <  (least(p_to, p_from + 140) + 1)::timestamp at time zone public.provider_tz(pid)
  order by b.starts_at
  limit 5000
$$;

-- Vincula (o crea) la ficha del cliente en la agenda del prestador.
create or replace function public.link_client(pid bigint, uid uuid, nm text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid is null then return; end if;
  update public.provider_clients set user_id = uid where provider_id = pid and user_id is null and lower(name) = lower(nm)
    and not exists (select 1 from public.provider_clients x where x.provider_id = pid and x.user_id = uid);
  if not exists (select 1 from public.provider_clients where provider_id = pid and user_id = uid) then
    insert into public.provider_clients (provider_id, user_id, name)
    values (pid, uid, coalesce(nm, 'Cliente') || case when exists (select 1 from public.provider_clients where provider_id = pid and lower(name) = lower(coalesce(nm,'Cliente'))) then ' (' || left(uid::text, 4) || ')' else '' end);
  end if;
end $$;

-- ---------- RESERVAR ----------
-- Crea el turno (y los repetidos) en estado 'hold' por 10 minutos mientras se paga.
-- Si el saldo TuTiempo cubre todo, queda confirmado al instante.
drop function if exists public.book_slot(bigint,timestamptz,int,int,boolean);
drop function if exists public.book_slot(bigint,timestamptz,int,int,boolean,bigint[],jsonb);
create or replace function public.book_slot(p_service bigint, p_start timestamptz, p_repeat_weeks int default 0,
                                            p_extra int default 0, p_pay text default 'mp',
                                            p_addons bigint[] default '{}', p_intake jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s record; p record; st record; tz text; nm text;
  i int; t timestamptz; lt timestamp; disc smallint; v_price int; dep int; v_fee int; v_full boolean;
  ids bigint[] := '{}'; deps int[] := '{}'; total int := 0; bal int; w int := 0; left_w int; pay int;
  sid uuid := case when coalesce(p_extra,0) > 0 then gen_random_uuid() end; bid bigint; skipped int := 0;
  ad_ids bigint[] := array(select distinct x from unnest(coalesce(p_addons,'{}')) x where x is not null);
  ad_price int := 0; ad_min int := 0; ad_json jsonb := '[]'; ad_n int := 0; dur int; v_intake jsonb := '{}';
  v_cash boolean := coalesce(p_pay,'mp') = 'cash'; v_reward boolean := coalesce(p_pay,'mp') = 'reward'; v_have int;
begin
  if uid is null then raise exception 'login_required' using errcode = '28000'; end if;
  if coalesce(p_pay,'mp') not in ('mp','cash','reward') then raise exception 'bad_pay'; end if;
  if coalesce(p_repeat_weeks,0) not in (0,1,2,3,4,6) or coalesce(p_extra,0) not between 0 and 3
     or (coalesce(p_extra,0) > 0 and coalesce(p_repeat_weeks,0) = 0) then raise exception 'bad_repeat'; end if;
  if cardinality(ad_ids) > 10 then raise exception 'bad_addon'; end if;
  select * into s from public.services where id = p_service and active;
  if s is null then raise exception 'service_not_found'; end if;
  select * into p from public.providers where id = s.provider_id and status = 'active';
  if p is null then raise exception 'provider_not_available'; end if;
  select * into st from public.provider_settings where provider_id = p.id;
  if st is null or not st.online then raise exception 'online_booking_off'; end if;
  -- anti-abuso: nadie puede "acaparar" horarios con reservas sin pagar
  if (select count(*) from public.bookings where client_id = uid and status = 'hold' and hold_expires_at > now()) >= 5 then
    raise exception 'too_many_holds';
  end if;
  if (select count(*) from public.bookings where client_id = uid and source = 'app' and status in ('hold','expired') and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_attempts';
  end if;
  -- adicionales: solo los de ESTE servicio; precio y minutos salen de la base
  if cardinality(ad_ids) > 0 then
    select count(*), coalesce(sum(price),0), coalesce(sum(duration_min),0),
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'min', duration_min) order by sort, id), '[]')
      into ad_n, ad_price, ad_min, ad_json
      from public.service_addons where id = any(ad_ids) and service_id = s.id and active;
    if ad_n <> cardinality(ad_ids) then raise exception 'bad_addon'; end if;
  end if;
  dur := s.duration_min + ad_min;
  if dur > 480 then raise exception 'bad_addon'; end if;
  -- preguntas previas: solo texto corto, claves simples, máximo 12
  if jsonb_typeof(coalesce(p_intake,'{}')) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}') into v_intake from (
      select key as k, left(regexp_replace(value #>> '{}', '[[:cntrl:]]', ' ', 'g'), 200) as v
      from jsonb_each(p_intake)
      where key ~ '^[a-z_]{1,20}$' and jsonb_typeof(value) in ('string','number','boolean')
      limit 12) x;
  end if;
  tz := public.provider_tz(p.id);
  select coalesce(nullif(full_name,''),'Cliente') into nm from public.profiles where id = uid;
  perform public.expire_holds(p.id);
  v_full := false;   -- el que faltó perdió su seña: no se le cobra el total en las próximas reservas
  -- premio de la tarjeta de sellos: ese mismo servicio gratis, con SU tarjeta llena, sin repetir
  if v_reward then
    if coalesce(p_extra,0) > 0 or cardinality(ad_ids) > 0 then raise exception 'bad_repeat'; end if;
    if not st.stamps_on or s.stamp_goal is null then raise exception 'reward_not_available'; end if;
    select stamps into v_have from public.loyalty_cards where provider_id = p.id and user_id = uid and service_id = s.id for update;
    if coalesce(v_have,0) < s.stamp_goal then raise exception 'not_enough_stamps'; end if;
  end if;
  -- la seña se paga SIEMPRE con Mercado Pago; 'cash' = el resto en efectivo en el local (si el prestador lo acepta y el cliente no tiene faltas)
  if v_cash then
    if not st.cash_ok or v_full then raise exception 'cash_not_allowed'; end if;
  end if;

  for i in 0 .. coalesce(p_extra,0) loop
    t := p_start + make_interval(days => 7 * coalesce(p_repeat_weeks,0) * i);
    lt := t at time zone tz;
    if not public.slot_fits(p.id, lt, dur)
       or (i = 0 and (t < now() + make_interval(mins => st.notice_min)
                      or lt::date > (now() at time zone tz)::date + st.ahead_days - 1)) then
      if i = 0 then raise exception 'slot_not_available'; end if;
      skipped := skipped + 1; continue;
    end if;
    disc := public.happy_disc(p.id, lt);
    v_price := case when v_reward then 0 else round((s.price + ad_price) * (100 - disc) / 100.0) end;
    dep := case when v_reward then 0 when st.pay_mode = 'full' or v_full then v_price else round(v_price * st.deposit_pct / 100.0) end;
    -- comisión de TuTiempo: % del precio, la paga el cliente APARTE de la seña (el prestador recibe la seña completa)
    v_fee := case when v_reward then 0 else round(v_price * public.commission())::int end;
    begin
      insert into public.bookings (provider_id, service_id, client_id, client_name, service_name, source, status,
                                   starts_at, ends_at, buffer_min, price, discount_pct, deposit, client_fee, series_id, hold_expires_at, addons, intake, pay_method)
      values (p.id, s.id, uid, nm, s.name, 'app', 'hold', t, t + make_interval(mins => dur), st.buffer_min,
              v_price, disc, dep, v_fee, sid, now() + interval '10 minutes', ad_json, v_intake, case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end)
      returning id into bid;
    exception when exclusion_violation then
      if i = 0 then raise exception 'slot_taken'; end if;
      skipped := skipped + 1; continue;
    end;
    ids := ids || bid; deps := deps || dep; total := total + dep + v_fee;
  end loop;

  -- sin saldo TuTiempo: se paga con Mercado Pago o en efectivo en el local
  if v_reward then perform public.stamp_add(p.id, uid, s.id, -s.stamp_goal, 'redeem', ids[1]); end if;
  if total - w = 0 then
    update public.bookings set status = 'confirmed', hold_expires_at = null where id = any(ids);
    perform public.link_client(p.id, uid, nm);
    perform public.notify_booking(ids[1], 'conf');
    return jsonb_build_object('status','confirmed','booking_ids', to_jsonb(ids), 'amount_due', 0, 'pay', case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end,
                              'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur);
  end if;
  return jsonb_build_object('status','pending_payment','booking_ids', to_jsonb(ids), 'amount_due', total - w,
                            'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur,
                            'hold_expires_at', now() + interval '10 minutes');
end $$;

-- Libera reservas en pago que vencieron y devuelve el saldo usado.
create or replace function public.expire_holds(pid bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in update public.bookings set status = 'expired'
           where status = 'hold' and hold_expires_at < now() and (pid is null or provider_id = pid)
           returning id, client_id, paid_wallet loop
    n := n + 1;
    if r.paid_wallet > 0 and r.client_id is not null then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note)
      values (r.client_id, 'refund', r.paid_wallet, r.id, 'Devolución: no se completó el pago');
      update public.bookings set paid_wallet = 0 where id = r.id;
    end if;
  end loop;
  return n;
end $$;

-- Lo llama SOLO la Edge Function del webhook de Mercado Pago (service_role), después de verificar el pago.
create or replace function public.confirm_payment(p_booking_ids bigint[], p_payment_id text, p_amount int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare due int; uid uuid; pid bigint; r record; cb int; left_amt int := p_amount; pay int; total_cb int := 0; ok int := 0; failed int := 0; nm text;
begin
  if exists (select 1 from public.bookings where mp_payment_id = p_payment_id) then
    return jsonb_build_object('status','already_processed');
  end if;
  select sum(deposit + client_fee - paid_wallet), min(client_id::text)::uuid, min(provider_id), min(client_name)
    into due, uid, pid, nm from public.bookings where id = any(p_booking_ids) and status in ('hold','expired') and source = 'app';
  if due is null then raise exception 'bookings_not_found'; end if;
  if p_amount < due then raise exception 'amount_mismatch'; end if;
  for r in select * from public.bookings where id = any(p_booking_ids) order by starts_at loop
    -- pay = lo que se cobró por este turno (seña + comisión); paid_mp = la seña (del prestador); app_fee = la comisión
    pay := least(left_amt, r.deposit + r.client_fee - r.paid_wallet); left_amt := left_amt - pay;
    cb := floor(greatest(pay - r.client_fee, 0) * public.cashback_rate());
    begin
      update public.bookings set status = 'confirmed', hold_expires_at = null, paid_mp = greatest(pay - r.client_fee, 0), cashback = cb,
             app_fee = least(pay, r.client_fee),
             mp_payment_id = case when ok + failed = 0 then p_payment_id else null end
       where id = r.id;
      ok := ok + 1; total_cb := total_cb + cb;
    exception when exclusion_violation then
      -- el hold venció y otro tomó el horario: se devuelve lo pagado
      update public.bookings set status = 'cancelled_provider', paid_mp = greatest(pay - r.client_fee, 0), app_fee = least(pay, r.client_fee), refund_pending = pay where id = r.id;
      if r.paid_wallet > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (uid, 'refund', r.paid_wallet, r.id, 'Devolución: el horario ya no estaba libre');
      end if;
      failed := failed + 1;
    end;
  end loop;
  if total_cb > 0 then
    insert into public.wallet_movements (user_id, kind, amount, booking_id, note)
    values (uid, 'cashback', total_cb, p_booking_ids[1], 'Cashback 5%');
  end if;
  perform public.link_client(pid, uid, nm);
  perform public.notify_booking((select min(id) from public.bookings where id = any(p_booking_ids) and status = 'confirmed'), 'conf');
  return jsonb_build_object('status','confirmed','confirmed', ok, 'refunded', failed, 'cashback', total_cb);
end $$;

-- Cliente avisa que no va: lo pagado queda para el prestador (regla de negocio). Un hold se libera y devuelve saldo.
create or replace function public.cancel_by_client(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; waiting int;
begin
  select * into b from public.bookings where id = p_booking and client_id = auth.uid() for update;
  if b is null then raise exception 'not_found'; end if;
  if b.status = 'hold' then
    update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second' where id = b.id;
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: reserva sin pagar');
      update public.bookings set paid_wallet = 0 where id = b.id;
    end if;
    return jsonb_build_object('status','released');
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then raise exception 'cannot_cancel'; end if;
  update public.bookings set status = 'cancelled_client' where id = b.id;
  perform public.stamp_refund(b.id);
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','kept_by_provider', b.paid_mp + b.paid_wallet, 'waitlist', waiting);
end $$;

-- Prestador cancela: al cliente se le devuelve todo (saldo al saldo, MP queda pendiente de reembolso).
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  update public.bookings set status = 'cancelled_provider', refund_pending = b.paid_mp + least(b.client_fee, b.app_fee), hold_expires_at = null where id = b.id;
  perform public.stamp_refund(b.id);
  if b.status = 'confirmed' then perform public.notify_booking(b.id, 'cancel'); end if;
  if b.client_id is not null then
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: el prestador canceló');
    end if;
    if b.cashback > 0 then
      select balance into bal from public.wallets where user_id = b.client_id for update;
      rev := least(coalesce(bal,0), b.cashback);
      if rev > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'reversal', -rev, b.id, 'Se descuenta el cashback del turno cancelado');
      end if;
    end if;
  end if;
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','refund_mp', b.paid_mp + least(b.client_fee, b.app_fee), 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;

-- Asistió / No vino (actualiza la ficha del cliente).
create or replace function public.mark_booking(p_booking bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; tz text; v_st int;
begin
  if p_status not in ('done','no_show') then raise exception 'bad_status'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status <> 'confirmed' or b.source = 'block' then raise exception 'bad_state'; end if;
  if b.starts_at > now() + interval '12 hours' then raise exception 'too_early'; end if;
  tz := public.provider_tz(b.provider_id);
  update public.bookings set status = p_status where id = b.id;
  if b.client_id is not null then perform public.link_client(b.provider_id, b.client_id, b.client_name); end if;
  update public.provider_clients c set
     visits = visits + (p_status = 'done')::int,
     no_shows = no_shows + (p_status = 'no_show')::int,
     total_spent = total_spent + case when p_status = 'done' then b.price else 0 end,
     last_visit = case when p_status = 'done' then (b.starts_at at time zone tz)::date else last_visit end
   where c.provider_id = b.provider_id
     and ((b.client_id is not null and c.user_id = b.client_id) or (b.client_id is null and lower(c.name) = lower(b.client_name)));
  -- tarjeta de sellos: cada servicio atendido de un cliente de la app suma 1 (el premio no suma)
  if p_status = 'done' and b.client_id is not null and b.source = 'app' and b.pay_method <> 'reward'
     and exists (select 1 from public.provider_settings where provider_id = b.provider_id and stamps_on)
     and exists (select 1 from public.services where id = b.service_id and provider_id = b.provider_id and stamp_goal is not null) then
    v_st := public.stamp_add(b.provider_id, b.client_id, b.service_id, 1, 'earn', b.id);
  end if;
  if p_status = 'done' then perform public.notify_booking(b.id, 'rev'); end if;
  return jsonb_build_object('status', p_status, 'to_collect', greatest(b.price - b.paid_mp - b.paid_wallet, 0), 'stamps', v_st);
end $$;

create or replace function public.confirm_attendance(p_booking bigint) returns void
language sql security definer set search_path = public as $$
  update public.bookings set attendance_ok = true where id = p_booking and client_id = auth.uid() and status = 'confirmed'
$$;

-- Teléfono del prestador: solo para quien tiene un turno pago con él.
create or replace function public.provider_contact(pid bigint) returns text
language sql stable security definer set search_path = public as $$
  select pp.phone from public.provider_private pp
  where pp.provider_id = pid and (public.owns_provider(pid) or exists (
    select 1 from public.bookings b where b.provider_id = pid and b.client_id = auth.uid() and b.status in ('confirmed','done')))
$$;

create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
           exists (select 1 from public.reviews r where r.booking_id = b.id) as reviewed, b.pay_method, p.photo_path,
           exists (select 1 from public.loyalty_events le where le.booking_id = b.id and le.kind = 'earn') as stamped
    from public.bookings b join public.providers p on p.id = b.provider_id join public.cities c on c.id = p.city_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = auth.uid() and b.source = 'app'
    order by b.starts_at desc limit 200) x
$$;

-- ---------- Alta de prestador (todo junto, en una transacción) ----------
create or replace function public.register_provider(p_name text, p_address text, p_categories text[], p_phone text,
                                                    p_dni text, p_instagram text default null, p_city text default 'olavarria')
returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pid bigint; cid smallint; base text; sl text; n int := 0; c text; d int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if exists (select 1 from public.providers where owner_id = uid) then raise exception 'already_registered'; end if;
  if p_categories is null or array_length(p_categories,1) is null then raise exception 'category_required'; end if;
  if array_length(p_categories,1) > 6 then raise exception 'too_many_categories'; end if;
  if p_dni !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
  select id into cid from public.cities where slug = p_city;
  if cid is null then raise exception 'bad_city'; end if;
  base := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(base) < 3 then base := 'prestador'; end if;
  base := left(base, 50); sl := base;
  while exists (select 1 from public.providers where slug = sl) loop n := n + 1; sl := base || '-' || n; end loop;
  insert into public.providers (owner_id, slug, name, address, city_id, instagram, hue, status)
  values (uid, sl, left(p_name, 80), left(p_address, 160), cid, left(p_instagram, 60), (abs(hashtext(sl)) % 360), 'pending')
  returning id into pid;
  insert into public.provider_private (provider_id, phone, dni_number) values (pid, left(p_phone, 40), p_dni);
  insert into public.provider_settings (provider_id) values (pid);
  foreach c in array p_categories loop
    insert into public.provider_categories (provider_id, category_id) values (pid, c) on conflict do nothing;
  end loop;
  for d in 1 .. 5 loop
    insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00');
  end loop;
  insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
  insert into public.message_templates (provider_id, key, enabled, body) values
   (pid,'conf',true,'¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.'),
   (pid,'r24',true,'{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¿Venís? Confirmá acá: {link}'),
   (pid,'r2',true,'¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}'),
   (pid,'rev',true,'¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? {link}'),
   (pid,'back',true,'{nombre}, ya te toca tu próximo turno. ¿Te reservo? Elegí tu horario: {link}'),
   (pid,'bday',false,'¡Feliz cumpleaños, {nombre}! Este mes tenés 15% off. Reservá: {link}');
  return pid;
end $$;

-- ---------- Bajas ----------
create or replace function public.provider_teardown(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if pid is null or not public.owns_provider(pid) then raise exception 'not_found'; end if;
  for r in select id from public.bookings where provider_id = pid and status in ('confirmed','hold') and source = 'app' and starts_at > now() loop
    perform public.cancel_by_provider(r.id); n := n + 1;
  end loop;
  delete from public.bookings where provider_id = pid and source in ('manual','block') and starts_at > now();
  delete from public.provider_clients where provider_id = pid;
  delete from public.walkins where provider_id = pid;
  delete from public.expenses where provider_id = pid;
  delete from public.cash_closings where provider_id = pid;
  delete from public.products where provider_id = pid;
  -- la llave de Mercado Pago se borra recién cuando se hicieron todas las devoluciones (las hace mp-refunds con esa llave)
  delete from public.provider_secrets where provider_id = pid
     and not exists (select 1 from public.bookings where provider_id = pid and refund_pending > 0);
  update public.provider_private set phone = null, dni_number = null, dni_paths = '{}', mp_user_id = null, mp_connected = false where provider_id = pid;
  update public.providers set status = 'deleted', owner_id = null, updated_at = now() where id = pid;
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

create or replace function public.delete_my_provider() returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider();
begin
  if pid is null then raise exception 'not_found'; end if;
  return public.provider_teardown(pid);
end $$;

-- Borra la llave de Mercado Pago de los prestadores eliminados cuando ya no quedan devoluciones pendientes (mp-refunds / cron).
create or replace function public.purge_deleted_secrets() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.provider_secrets s using public.providers p
             where p.id = s.provider_id and p.status = 'deleted'
               and not exists (select 1 from public.bookings b where b.provider_id = p.id and b.refund_pending > 0) returning 1)
  select count(*)::int from d
$$;

-- El cliente borra su cuenta: sus turnos futuros se cancelan (lo pagado no se devuelve) y pierde el saldo.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if public.my_provider() is not null then raise exception 'delete_provider_first'; end if;
  update public.bookings set status = case when status = 'hold' then 'expired' else 'cancelled_client' end, client_name = 'Cliente eliminado', client_phone = null
   where client_id = uid and status in ('confirmed','hold') and starts_at > now();
  get diagnostics n = row_count;
  update public.bookings set client_name = 'Cliente eliminado', client_phone = null where client_id = uid;
  update public.provider_clients set user_id = null, phone = null where user_id = uid;
  delete from auth.users where id = uid;   -- en cascada: perfil, billetera, seguidos, lista de espera
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

-- ---------- Reportes del panel ----------
create or replace function public.provider_finance(p_from date, p_to date)
returns table (day date, app int, man int, walk int, prod int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  days as (select generate_series(p_from, least(p_to, p_from + 400), interval '1 day')::date as day)
  select d.day,
    coalesce((select sum(round(b.price * (1 - public.commission())))::int from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'app' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(b.price)::int from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'manual' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount + w.tip)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'service' and (w.at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'product' and (w.at at time zone tz.z)::date = d.day), 0)
  from days d where (select id from pid) is not null order by d.day
$$;

create or replace function public.provider_month_totals(p_year int)
returns table (month int, income int, expenses int)
language sql stable security definer set search_path = public as $$
  with f as (select * from public.provider_finance(make_date(p_year,1,1), make_date(p_year,12,31)))
  select m, coalesce((select sum(app+man+walk+prod)::int from f where extract(month from f.day) = m), 0),
         coalesce((select sum(e.amount)::int from public.expenses e where e.provider_id = public.my_provider()
                   and extract(year from e.spent_on) = p_year and extract(month from e.spent_on) = m), 0)
  from generate_series(1,12) m
$$;

-- Minutos ocupados por día y hora (para el mapa de calor de ocupación).
create or replace function public.provider_occupancy(p_from date, p_to date)
returns table (day date, hour int, busy_min int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  b as (select (bk.starts_at at time zone tz.z) as s, (bk.ends_at at time zone tz.z) as e
        from public.bookings bk, tz where bk.provider_id = (select id from pid) and bk.source <> 'block'
          and bk.status in ('confirmed','done','no_show')
          and bk.starts_at >= p_from::timestamp at time zone tz.z and bk.starts_at < (least(p_to, p_from + 400) + 1)::timestamp at time zone tz.z),
  h as (select b.*, gs as hs from b, generate_series(date_trunc('hour', b.s), b.e - interval '1 second', interval '1 hour') gs)
  select hs::date, extract(hour from hs)::int,
         sum(extract(epoch from (least(e, hs + interval '1 hour') - greatest(s, hs))) / 60)::int
  from h group by 1, 2 order by 1, 2
$$;

-- ---------- Mantenimiento (pg_cron) ----------
create or replace function public.refresh_activity() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with c as (select provider_id, count(*)::int as k from public.bookings
             where source = 'app' and status = 'done' and starts_at >= now() - interval '30 days' group by 1)
  update public.providers p set activity = coalesce(c.k, 0)
    from public.providers p2 left join c on c.provider_id = p2.id
   where p.id = p2.id and p.activity is distinct from coalesce(c.k, 0);
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.reshuffle_providers() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_activity();
  update public.providers set shuffle_key = random() where status = 'active';
end $$;

-- ---------- Mensajes del prestador a sus clientes ----------
-- Solo a clientes propios que tienen cuenta en la app. {nombre} se reemplaza por el nombre de cada uno.
-- Límites: 300 destinatarios por envío y 600 mensajes por día por prestador (anti-spam).
create or replace function public.send_client_messages(p_client_ids bigint[], p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); b text := btrim(regexp_replace(coalesce(p_body,''), '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g'));
        n int := 0; today int; ids bigint[] := array(select distinct x from unnest(coalesce(p_client_ids,'{}')) x where x is not null);
begin
  if pid is null then raise exception 'not_provider'; end if;
  if char_length(b) < 2 or char_length(b) > 500 then raise exception 'bad_message'; end if;
  if cardinality(ids) = 0 or cardinality(ids) > 300 then raise exception 'bad_recipients'; end if;
  select count(*) into today from public.client_messages where provider_id = pid and created_at > now() - interval '24 hours';
  if today + cardinality(ids) > 600 then raise exception 'too_many_messages'; end if;
  insert into public.client_messages (provider_id, user_id, body)
  select pid, c.user_id, left(replace(b, '{nombre}', split_part(c.name, ' ', 1)), 600)
  from public.provider_clients c
  where c.provider_id = pid and c.id = any(ids) and c.user_id is not null;
  get diagnostics n = row_count;
  update public.provider_clients set contacted_at = now() where provider_id = pid and id = any(ids);
  return jsonb_build_object('sent', n, 'without_app', cardinality(ids) - n);
end $$;

create or replace function public.my_messages() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select m.id, m.provider_id, p.name as provider_name, p.photo_path, p.hue, m.body, m.created_at, m.read_at is not null as read, m.kind
    from public.client_messages m join public.providers p on p.id = m.provider_id
    where m.user_id = auth.uid() order by m.created_at desc limit 50) x
$$;

create or replace function public.mark_messages_read() returns void
language sql security definer set search_path = public as $$
  update public.client_messages set read_at = now() where user_id = auth.uid() and read_at is null
$$;

-- ---------- Tarjeta de sellos (una por servicio) ----------
drop function if exists public.stamp_add(bigint,uuid,int,text,bigint);
drop function if exists public.give_stamp(bigint);
drop function if exists public.redeem_stamps(bigint);
-- Interno: mueve sellos de la tarjeta de un servicio y deja el registro (no se puede llamar desde la app).
create or replace function public.stamp_add(pid bigint, uid uuid, sid bigint, d int, k text, bid bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.loyalty_events (provider_id, user_id, service_id, kind, delta, booking_id) values (pid, uid, sid, k, d, bid);
  insert into public.loyalty_cards as lc (provider_id, user_id, service_id, stamps, earned, redeemed)
  values (pid, uid, sid, greatest(d, 0), case when k in ('earn','manual') then d else 0 end, 0)
  on conflict (provider_id, user_id, service_id) do update set
    stamps   = lc.stamps + d,
    earned   = lc.earned + case when k in ('earn','manual') then d else 0 end,
    redeemed = lc.redeemed + case when k = 'redeem' then -d when k = 'refund' then -d else 0 end,
    updated_at = now()
  returning stamps into n;
  return n;
end $$;

-- Interno: si se cancela un turno pagado con el premio, vuelven los sellos a esa tarjeta (una sola vez).
create or replace function public.stamp_refund(bid bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from public.loyalty_events where booking_id = bid and kind = 'redeem';
  if e is null or e.service_id is null or exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'refund') then return; end if;
  perform public.stamp_add(e.provider_id, e.user_id, e.service_id, -e.delta, 'refund', bid);
end $$;

-- Los servicios de las tarjetas viejas tienen que ser del mismo prestador (compatibilidad).
create or replace function public.settings_reward_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stamps_reward is not null and not exists (select 1 from public.services where id = new.stamps_reward and provider_id = new.provider_id) then
    raise exception 'bad_reward';
  end if;
  if new.stamps_services is not null and exists (select 1 from unnest(new.stamps_services) x
       where not exists (select 1 from public.services s where s.id = x and s.provider_id = new.provider_id)) then
    raise exception 'bad_reward';
  end if;
  return new;
end $$;
drop trigger if exists ps_reward_check on public.provider_settings;
create trigger ps_reward_check before insert or update of stamps_reward, stamps_services on public.provider_settings
  for each row execute function public.settings_reward_check();

-- Valida que el servicio sea del prestador y tenga tarjeta.
create or replace function public.stamp_service(pid bigint, sid bigint) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare g smallint;
begin
  if not exists (select 1 from public.provider_settings where provider_id = pid and stamps_on) then raise exception 'stamps_off'; end if;
  select stamp_goal into g from public.services where id = sid and provider_id = pid and active;
  if g is null then raise exception 'no_stamp_card'; end if;
  return g;
end $$;

-- Prestador: sello a mano (cliente con la app; máximo 1 por día, por cliente y por servicio).
create or replace function public.give_stamp(p_client bigint, p_service bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); c record; g smallint; n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  g := public.stamp_service(pid, p_service);
  select * into c from public.provider_clients where id = p_client and provider_id = pid;
  if c is null then raise exception 'not_found'; end if;
  if c.user_id is null then raise exception 'client_without_app'; end if;
  if exists (select 1 from public.loyalty_events where provider_id = pid and user_id = c.user_id and service_id = p_service
             and kind = 'manual' and created_at > now() - interval '20 hours') then
    raise exception 'stamp_today';
  end if;
  n := public.stamp_add(pid, c.user_id, p_service, 1, 'manual', null);
  return jsonb_build_object('stamps', n, 'goal', g);
end $$;

-- Prestador: canjea el premio en el local (descuenta los sellos de esa tarjeta llena).
create or replace function public.redeem_stamps(p_client bigint, p_service bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); c record; g smallint; have int; n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  g := public.stamp_service(pid, p_service);
  select * into c from public.provider_clients where id = p_client and provider_id = pid;
  if c is null or c.user_id is null then raise exception 'not_found'; end if;
  select stamps into have from public.loyalty_cards where provider_id = pid and user_id = c.user_id and service_id = p_service for update;
  if coalesce(have,0) < g then raise exception 'not_enough_stamps'; end if;
  n := public.stamp_add(pid, c.user_id, p_service, -g, 'redeem', null);
  return jsonb_build_object('stamps', n, 'goal', g);
end $$;

-- Cliente: sus tarjetas, una por servicio, con cuántas veces se lo hizo en cada una.
create or replace function public.my_stamps() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]') from (
    select lc.provider_id, lc.service_id, sv.name as service_name, sv.stamp_goal, p.name as provider_name, p.photo_path, p.hue,
           lc.stamps, lc.earned, lc.redeemed, lc.updated_at, coalesce(st.stamps_on, false) and sv.stamp_goal is not null and sv.active as stamps_on,
           sv.category_id as category,
           (select count(*) from public.bookings b where b.provider_id = lc.provider_id and b.client_id = auth.uid() and b.service_id = lc.service_id and b.status = 'done')::int as done
    from public.loyalty_cards lc
    join public.providers p on p.id = lc.provider_id and p.status = 'active'
    join public.services sv on sv.id = lc.service_id
    left join public.provider_settings st on st.provider_id = lc.provider_id
    where lc.user_id = auth.uid()
    limit 200) x
$$;

-- ---------- Avisos automáticos en la app (sin WhatsApp) ----------
-- Arma el aviso con la plantilla del prestador ({nombre}, {barberia}, {dia}, {hora}, {direccion}, {link}).
-- Cada turno recibe cada aviso una sola vez (índice client_messages_once).
create or replace function public.notify_booking(bid bigint, k text) returns void
language plpgsql security definer set search_path = public as $$
declare b record; t record; p record; lt timestamp; body text;
        dias text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
begin
  if bid is null then return; end if;
  select * into b from public.bookings where id = bid;
  if b is null or b.client_id is null or b.source <> 'app' then return; end if;
  if k = 'cancel' then
    if b.settle_by_provider then
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}. {barberia} se va a comunicar con vos para devolverte la seña ($' ||
             replace(to_char(b.paid_mp + b.paid_wallet, 'FM999,999,999'), ',', '.') || ') o pasarte el turno a otro día.' as body into t;
    else
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}.' ||
             case when b.paid_mp > 0 then ' Te devolvemos todo lo que pagaste ($' || replace(to_char(b.paid_mp + least(b.client_fee, b.app_fee), 'FM999,999,999'), ',', '.') || ').' else '' end ||
             ' Reprogramalo cuando quieras desde Mis turnos: {link}' as body into t;
    end if;
  else
    select enabled, mt.body into t from public.message_templates mt where provider_id = b.provider_id and key = k;
    if t is null or not t.enabled then return; end if;
  end if;
  select name, address, slug into p from public.providers where id = b.provider_id;
  lt := b.starts_at at time zone public.provider_tz(b.provider_id);
  body := replace(replace(replace(replace(replace(replace(t.body,
            '{nombre}', split_part(coalesce(b.client_name, ''), ' ', 1)), '{barberia}', p.name),
            '{dia}', dias[extract(dow from lt)::int + 1] || ' ' || extract(day from lt)::int || '/' || extract(month from lt)::int),
            '{hora}', to_char(lt, 'HH24:MI')), '{direccion}', coalesce(p.address, '')), '{link}', 'tutiempo.com.ar/' || p.slug);
  if k = 'rev' and exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'earn') then
    body := body || ' 🎟️ Sumaste 1 sello en tu tarjeta de ' || coalesce(b.service_name, 'este servicio') || '.';
  end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id, left(body, 600), k, bid::text) on conflict do nothing;
end $$;

-- Recordatorios (24 h y 2 h antes) y cumpleaños. Lo corre pg_cron cada 10 minutos.
create or replace function public.send_scheduled_notices() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; tz text := 'America/Argentina/Buenos_Aires';
begin
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() + interval '2 hours' and b.starts_at <= now() + interval '24 hours' and b.created_at < b.starts_at - interval '24 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r24' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r24'); n := n + 1;
  end loop;
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() and b.starts_at <= now() + interval '2 hours' and b.created_at < b.starts_at - interval '2 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r2' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r2'); n := n + 1;
  end loop;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  select c.provider_id, c.user_id,
         left(replace(replace(replace(t.body, '{nombre}', split_part(c.name, ' ', 1)), '{barberia}', p.name), '{link}', 'tutiempo.com.ar/' || p.slug), 600),
         'bday', to_char(now() at time zone tz, 'YYYY')
  from public.provider_clients c
  join public.message_templates t on t.provider_id = c.provider_id and t.key = 'bday' and t.enabled
  join public.providers p on p.id = c.provider_id and p.status = 'active'
  where c.user_id is not null and c.birthday = to_char(now() at time zone tz, 'MM-DD')
  on conflict do nothing;
  return n;
end $$;

-- ---------- Bloquear días o semanas (vacaciones) ----------
-- En una sola transacción: cancela los turnos de esos días (a los de la app les llega el aviso), deja cada día bloqueado
-- y devuelve la lista de clientes cancelados con su teléfono y la seña que pagaron. TuTiempo NO devuelve la seña:
-- el prestador llama a cada cliente y se la devuelve o le da otro turno (settle_by_provider).
create or replace function public.block_days(p_from date, p_to date, p_reason text default 'Vacaciones') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; d date; o time; c time; r record; why text; lst jsonb := '[]'; nb int := 0; today date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  tz := public.provider_tz(pid); today := (now() at time zone tz)::date;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_range'; end if;
  if p_from < today then raise exception 'past_days'; end if;
  if p_to - p_from > 92 then raise exception 'range_too_long'; end if;
  why := '🏖️ ' || left(coalesce(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]<>]', '', 'g')), ''), 'Día libre'), 40);
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    select min(opens), max(closes) into o, c from public.provider_hours where provider_id = pid and dow = extract(dow from d)::int;
    if o is null then continue; end if;                                   -- ese día no atiende
    if exists (select 1 from public.bookings where provider_id = pid and source = 'block' and coalesce(service_name, '') like '🏖️%'
               and starts_at >= d::timestamp at time zone tz and starts_at < (d + 1)::timestamp at time zone tz) then continue; end if;
    for r in select b.id, b.client_id, b.client_name, b.service_name, b.starts_at, b.source, b.status, b.paid_mp + b.paid_wallet as paid,
                    coalesce(nullif(b.client_phone, ''), (select nullif(pc.phone, '') from public.provider_clients pc where pc.provider_id = pid and pc.user_id = b.client_id limit 1),
                             (select nullif(pf.phone, '') from public.profiles pf where pf.id = b.client_id)) as tel
             from public.bookings b
             where b.provider_id = pid and b.source in ('app','manual') and b.status in ('confirmed','hold')
               and b.starts_at >= d::timestamp at time zone tz and b.starts_at < (d + 1)::timestamp at time zone tz
             order by b.starts_at loop
      if r.status = 'hold' then
        update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second' where id = r.id;   -- no estaba pagado
        continue;
      end if;
      -- sin devolución automática: el prestador se encarga (devuelve la seña o reprograma)
      update public.bookings set status = 'cancelled_provider', refund_pending = 0, hold_expires_at = null,
             settle_by_provider = (r.source = 'app' and r.paid > 0) where id = r.id;
      perform public.stamp_refund(r.id);
      if r.source = 'app' then perform public.notify_booking(r.id, 'cancel'); end if;
      lst := lst || jsonb_build_object('id', r.id, 'name', r.client_name, 'service', r.service_name, 'day', to_char(d, 'YYYY-MM-DD'),
                                       'time', to_char(r.starts_at at time zone tz, 'HH24:MI'), 'app', r.client_id is not null, 'tel', r.tel, 'paid', r.paid);
    end loop;
    delete from public.bookings where provider_id = pid and source = 'block'
       and starts_at >= d::timestamp at time zone tz and starts_at < (d + 1)::timestamp at time zone tz;
    insert into public.bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at, price)
    values (pid, 'Día bloqueado', why, 'block', 'confirmed', (d + o) at time zone tz, (d + c) at time zone tz, 0);
    nb := nb + 1;
  end loop;
  return jsonb_build_object('blocked', nb, 'cancelled', lst);
end $$;

-- Comisión de TuTiempo de un turno pagado: la que se cobró (app_fee); en turnos muy viejos, el % sobre el precio.
create or replace function public.booking_fee(b public.bookings, rate numeric) returns int
language sql immutable as $$
  select case when b.app_fee > 0 or b.client_fee > 0 then b.app_fee else least(b.paid_mp, round(b.price * rate)::int) end
$$;

-- ---------- Panel de administración (solo admins: tabla app_admins) ----------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires';
        m0 timestamptz := date_trunc('month', now() at time zone tz) at time zone tz;      -- 1° del mes (hora Argentina)
        m1 timestamptz := (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz;
        p0 timestamptz := (date_trunc('month', now() at time zone tz) - interval '1 month') at time zone tz;
        p1 timestamptz := now() - interval '1 month';                                       -- mismo período del mes pasado
        rate numeric := public.commission(); r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  with b as (select * from public.bookings where source = 'app' and starts_at >= p0 - interval '1 day' and starts_at < m1 + interval '1 day'),
  fee as (select *, case when app_fee > 0 or client_fee > 0 then app_fee else least(paid_mp, round(price * rate)::int) end as fee from b)
  select jsonb_build_object(
    'commission_pct', (select commission_pct from public.app_settings where id),
    'providers_active', (select count(*) from public.providers where status = 'active'),
    'providers_pending', (select count(*) from public.providers where status = 'pending'),
    'providers_suspended', (select count(*) from public.providers where status = 'suspended'),
    'new_providers_month', (select count(*) from public.providers where created_at >= m0 and status <> 'deleted'),
    'clients', (select count(*) from public.profiles),
    'new_clients_month', (select count(*) from public.profiles where created_at >= m0),
    'bookings_month', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'bookings_prev', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    'gross_month', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'gross_prev', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    'deposits_month', (select coalesce(sum(paid_mp),0) from public.bookings where source = 'app' and paid_mp > 0 and created_at >= m0),
    'commission_month', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= m0),
    'commission_prev', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= p0 and created_at < p1),
    'no_show_month', (select count(*) from fee where status = 'no_show' and starts_at >= m0 and starts_at < m1),
    'cancelled_month', (select count(*) from fee where status = 'cancelled_client' and starts_at >= m0 and starts_at < m1),
    'mp_missing', (select count(*) from public.providers p join public.provider_private pp on pp.provider_id = p.id where p.status = 'active' and not pp.mp_connected),
    'stamp_cards', (select count(distinct s.provider_id) from public.services s join public.provider_settings st on st.provider_id = s.provider_id and st.stamps_on where s.stamp_goal is not null and s.active),
    'by_category', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select category_id, count(*) n from public.provider_categories where active group by 1) x),
    'by_category_month', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select s.category_id, count(*) n from fee f join public.services s on s.id = f.service_id
                           where f.status in ('confirmed','done','no_show') and f.starts_at >= m0 and f.starts_at < m1 group by 1) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n', coalesce(x.n,0), 'gross', coalesce(x.gross,0), 'fee', coalesce(x.fee,0)) order by d.day), '[]')
               from (select g::date as day from generate_series((now() at time zone tz)::date - 29, (now() at time zone tz)::date, interval '1 day') g) d
               left join (select (starts_at at time zone tz)::date as day, count(*) n, sum(price) gross, sum(fee) fee from fee
                          where status in ('confirmed','done','no_show') group by 1) x on x.day = d.day),
    'top', (select coalesce(jsonb_agg(t order by t.activity desc, t.id), '[]') from (
              select p.id, p.name, p.activity, p.photo_path, p.hue,
                     (select array_agg(pc.category_id order by pc.is_primary desc) from public.provider_categories pc where pc.provider_id = p.id) as cats
              from public.providers p where p.status = 'active' order by p.activity desc, p.id limit 5) t)
  ) into r;
  return r;
end $$;

create or replace function public.admin_providers(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(x order by x.pending desc, x.activity desc, x.created_at desc), '[]') from (
    select p.id, p.name, p.slug, p.status, p.dni_verified, p.owner_id, p.created_at, p.rating_avg, p.rating_count, p.activity, (p.status = 'pending') as pending,
           (select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from public.provider_categories pc where pc.provider_id = p.id) as categories,
           (select count(*) from public.bookings b where b.provider_id = p.id and b.source = 'app' and b.status in ('confirmed','done') and b.starts_at >= date_trunc('month', now())) as bookings_month,
           (select pp.mp_connected from public.provider_private pp where pp.provider_id = p.id) as mp_connected,
           (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at) order by n.created_at desc), '[]')
              from (select * from public.admin_notes an where an.provider_id = p.id order by an.created_at desc limit 30) n) as notes
    from public.providers p
    where p.status <> 'deleted' and (p_status is null or p.status = p_status)
    order by (p.status = 'pending') desc, p.activity desc, p.created_at desc limit 500) x);
end $$;

create or replace function public.admin_set_provider(pid bigint, p_status text, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid and status <> 'deleted';
end $$;

create or replace function public.admin_set_commission(p_pct numeric) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 30 then raise exception 'bad_commission'; end if;
  update public.app_settings set commission_pct = round(p_pct, 2), updated_at = now() where id;
  return round(p_pct, 2);
end $$;

-- ---------- Panel admin · notas privadas y baja de prestadores ----------
create or replace function public.admin_add_note(pid bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare txt text := left(btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g')), 1000); nid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if txt = '' then raise exception 'empty_note'; end if;
  if not exists (select 1 from public.providers where id = pid) then raise exception 'not_found'; end if;
  if (select count(*) from public.admin_notes where provider_id = pid) >= 500 then raise exception 'too_many_notes'; end if;
  insert into public.admin_notes (provider_id, author, body) values (pid, auth.uid(), txt) returning id into nid;
  return nid;
end $$;

create or replace function public.admin_delete_note(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.admin_notes where id = p_id;
end $$;

-- El admin elimina un prestador: se cancelan sus turnos futuros (a los clientes se les devuelve todo y les llega el aviso),
-- deja de aparecer y su cuenta queda sin panel. No se puede deshacer.
create or replace function public.admin_delete_provider(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.providers where id = pid and status <> 'deleted') then raise exception 'not_found'; end if;
  r := public.provider_teardown(pid);
  insert into public.admin_notes (provider_id, author, body) values (pid, auth.uid(), 'Eliminado por el administrador.');
  return r;
end $$;

-- ---------- Panel admin · balance de TuTiempo (mes a mes y año a año) ----------
-- Números en vivo de un mes (hora Argentina). Cuenta lo cobrado por Mercado Pago que no se devolvió.
create or replace function public.admin_month_live(m date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires'; rate numeric := public.commission();
        m0 date := make_date(extract(year from m)::int, extract(month from m)::int, 1); m1 date; r jsonb;
begin
  m1 := (m0 + interval '1 month')::date;
  with b as (select x.*, public.booking_fee(x, rate) fee from public.bookings x
             where x.source = 'app' and x.paid_mp > 0 and (x.status in ('confirmed','done','no_show','cancelled_client') or (x.status = 'cancelled_provider' and x.settle_by_provider))
               and x.created_at >= (m0::timestamp at time zone tz) and x.created_at < (m1::timestamp at time zone tz))
  select jsonb_build_object(
    'bookings',   (select count(*) from b),
    'charged',    (select coalesce(sum(paid_mp + case when client_fee > 0 then fee else 0 end), 0) from b),
    'deposits',   (select coalesce(sum(paid_mp - case when client_fee > 0 then 0 else fee end), 0) from b),
    'commission', (select coalesce(sum(fee), 0) from b),
    'expenses',   (select coalesce(sum(amount), 0) from public.admin_expenses where day >= m0 and day < m1)) into r;
  return r;
end $$;

create or replace function public.admin_finance(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; y int := coalesce(p_year, extract(year from today)::int);
        ms jsonb := '[]'; m date; cj jsonb; v jsonb; ycl timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if y < 2024 or y > 2100 then raise exception 'bad_year'; end if;
  for m in select g::date from generate_series(make_date(y, 1, 1), make_date(y, 12, 1), interval '1 month') g loop
    select to_jsonb(ac) into cj from public.admin_closings ac where kind = 'month' and period = m;
    v := case when cj is not null then jsonb_build_object('bookings', cj->'bookings', 'charged', cj->'charged', 'deposits', cj->'deposits',
                                                          'commission', cj->'commission', 'expenses', cj->'expenses')
              when m > today then jsonb_build_object('bookings', 0, 'charged', 0, 'deposits', 0, 'commission', 0, 'expenses', 0)
              else public.admin_month_live(m) end;
    ms := ms || (v || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'closed_at', cj->'closed_at',
                                         'state', case when cj is not null then 'closed' when m > today then 'future'
                                                       when (m + interval '1 month')::date > today then 'open' else 'ended' end));
  end loop;
  select closed_at into ycl from public.admin_closings where kind = 'year' and period = make_date(y, 1, 1);
  return jsonb_build_object('year', y, 'months', ms, 'year_closed_at', ycl, 'can_close_year', make_date(y + 1, 1, 1) <= today,
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'day', to_char(day, 'YYYY-MM-DD'), 'concept', concept, 'amount', amount) order by day desc, id desc), '[]')
                 from public.admin_expenses where day >= make_date(y, 1, 1) and day < make_date(y + 1, 1, 1)),
    'years', (select coalesce(jsonb_agg(jsonb_build_object('year', extract(year from period)::int, 'commission', commission, 'expenses', expenses,
                                                           'bookings', bookings, 'closed_at', closed_at) order by period), '[]')
              from public.admin_closings where kind = 'year'));
end $$;

-- Cerrar un mes (cuando terminó) o un año (cuando terminó: cierra también sus meses abiertos).
create or replace function public.admin_close(p_kind text, p_period date) returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; m0 date := date_trunc('month', p_period)::date; m date; v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'month' then
    if (m0 + interval '1 month')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'month' and period = m0) then raise exception 'already_closed'; end if;
    v := public.admin_month_live(m0);
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
    values ('month', m0, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint, (v->>'expenses')::bigint, auth.uid());
  elsif p_kind = 'year' then
    m0 := date_trunc('year', p_period)::date;
    if (m0 + interval '1 year')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'year' and period = m0) then raise exception 'already_closed'; end if;
    for m in select g::date from generate_series(m0, (m0 + interval '11 months')::date, interval '1 month') g loop
      if not exists (select 1 from public.admin_closings where kind = 'month' and period = m) then
        v := public.admin_month_live(m);
        insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
        values ('month', m, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint, (v->>'expenses')::bigint, auth.uid());
      end if;
    end loop;
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
    select 'year', m0, sum(bookings), sum(charged), sum(deposits), sum(commission), sum(expenses), auth.uid()
      from public.admin_closings where kind = 'month' and period >= m0 and period < (m0 + interval '1 year')::date;
  else raise exception 'bad_kind'; end if;
end $$;

create or replace function public.admin_reopen(p_kind text, p_period date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'month' then
    if exists (select 1 from public.admin_closings where kind = 'year' and period = date_trunc('year', p_period)::date) then raise exception 'year_closed'; end if;
    delete from public.admin_closings where kind = 'month' and period = date_trunc('month', p_period)::date;
  elsif p_kind = 'year' then
    delete from public.admin_closings where kind = 'year' and period = date_trunc('year', p_period)::date;
  else raise exception 'bad_kind'; end if;
end $$;

-- Gastos de TuTiempo (no se pueden tocar en un mes cerrado)
create or replace function public.admin_add_expense(p_day date, p_concept text, p_amount int) returns bigint
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; nid bigint;
        txt text := left(btrim(regexp_replace(coalesce(p_concept, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_day is null or p_day > today + 31 or p_day < make_date(2024, 1, 1) then raise exception 'bad_day'; end if;
  if txt = '' then raise exception 'empty_concept'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 2000000000 then raise exception 'bad_amount'; end if;
  if exists (select 1 from public.admin_closings where kind = 'month' and period = date_trunc('month', p_day)::date) then raise exception 'month_closed'; end if;
  insert into public.admin_expenses (day, concept, amount, created_by) values (p_day, txt, p_amount, auth.uid()) returning id into nid;
  return nid;
end $$;

create or replace function public.admin_delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select day into d from public.admin_expenses where id = p_id;
  if d is null then return; end if;
  if exists (select 1 from public.admin_closings where kind = 'month' and period = date_trunc('month', d)::date) then raise exception 'month_closed'; end if;
  delete from public.admin_expenses where id = p_id;
end $$;

-- ---------- Permisos de ejecución ----------
-- Cierre total: ninguna función se puede llamar desde la app salvo las de esta lista.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin(), public.my_provider(), public.owns_provider(bigint) to anon, authenticated;
grant execute on function public.commission() to anon, authenticated, service_role;
grant execute on function public.list_providers(text,text,text,double precision,bigint,int), public.category_counts(text),
  public.get_provider(bigint), public.provider_busy(bigint,date,date), public.next_free_slot(bigint,int)
  to anon, authenticated;
grant execute on function public.book_slot(bigint,timestamptz,int,int,text,bigint[],jsonb), public.cancel_by_client(bigint),
  public.cancel_by_provider(bigint), public.mark_booking(bigint,text),
  public.my_bookings(), public.send_client_messages(bigint[],text), public.my_messages(), public.mark_messages_read(),
  public.give_stamp(bigint,bigint), public.redeem_stamps(bigint,bigint), public.my_stamps(), public.block_days(date,date,text),
  public.admin_stats(), public.admin_providers(text), public.admin_set_provider(bigint,text,boolean), public.admin_set_commission(numeric),
  public.admin_add_note(bigint,text), public.admin_delete_note(bigint), public.admin_delete_provider(bigint), public.admin_finance(int),
  public.admin_close(text,date), public.admin_reopen(text,date), public.admin_add_expense(date,text,int), public.admin_delete_expense(bigint), public.register_provider(text,text,text[],text,text,text,text),
  public.delete_my_provider(), public.delete_my_account(), public.provider_finance(date,date),
  public.provider_month_totals(int), public.provider_occupancy(date,date)
  to authenticated;
-- confirm_payment, expire_holds, reshuffle_providers, link_client: solo service_role / cron.
revoke execute on function public.confirm_payment(bigint[],text,int), public.expire_holds(bigint),
  public.reshuffle_providers(), public.link_client(bigint,uuid,text), public.refresh_provider_search(bigint)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(bigint[],text,int), public.expire_holds(bigint), public.reshuffle_providers(), public.purge_deleted_secrets(),
  public.refresh_activity(), public.send_scheduled_notices()
  to service_role;

-- =====================================================================
-- TuTiempo · D34 · La comisión de TuTiempo vuelve a ser un % del PRECIO del turno (cambia D30)
--   - comisión = precio final del turno (con happy hour y adicionales) × % de TuTiempo (app_settings.deposit_commission_pct,
--     7 por defecto, editable desde el admin), al peso más cercano. Se cobra al reservar, junto con la seña.
--   - Mercado Pago no cambia: total = ⌈(seña + comisión) / (1 − % MP)⌉. El prestador recibe la seña completa.
--   - Un turno de premio (sin seña) no paga comisión. Los turnos ya reservados mantienen lo que pagaron (client_fee).
--   - charge_parts(seña, precio, %TuTiempo, %MP) es la misma cuenta que chargeFor en src/lib/cobro.js. La versión de tres
--     argumentos (comisión sobre la seña) queda para lo que ya la usaba.
-- Idempotente y sin borrar datos.
-- =====================================================================
set search_path = public, extensions;

create or replace function public.charge_parts(p_deposit int, p_price int, p_cpct numeric, p_mpct numeric) returns int[]
language plpgsql immutable set search_path = public as $$
declare dep bigint := greatest(coalesce(p_deposit, 0), 0); base bigint := greatest(coalesce(p_price, 0), 0);
        c100 bigint := round(coalesce(p_cpct, 0) * 100); m100 bigint := round(coalesce(p_mpct, 0) * 100); fee bigint; total bigint; d bigint;
begin
  if dep = 0 then return array[0, 0, 0]; end if;
  if c100 < 0 or c100 > 3000 or m100 < 0 or m100 > 1500 then raise exception 'bad_pct'; end if;
  fee := (base * c100 + 5000) / 10000;
  d := 10000 - m100;
  total := ((dep + fee) * 10000 + d - 1) / d;
  return array[fee::int, (total - dep - fee)::int, total::int];
end $$;
revoke execute on function public.charge_parts(int, int, numeric, numeric) from public;
grant execute on function public.charge_parts(int, int, numeric, numeric) to anon, authenticated;

-- ---------- Reservar: la comisión sale del precio del turno ----------
create or replace function public.book_slot(p_service bigint, p_start timestamptz, p_repeat_weeks int default 0,
                                            p_extra int default 0, p_pay text default 'mp',
                                            p_addons bigint[] default '{}', p_intake jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s record; p record; st record; tz text; nm text;
  i int; t timestamptz; lt timestamp; disc smallint; v_price int; dep int; v_fee int; v_mp int; v_full boolean;
  v_cpct numeric := public.deposit_commission(); v_mpct numeric; parts int[];
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
  -- D30: % de Mercado Pago del plazo de acreditación que eligió el prestador (0 hasta que el admin lo cargue)
  v_mpct := public.mp_term_pct(st.payout_term);
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
                      or lt::date > (now() at time zone tz)::date + st.ahead_days - 1))
       -- D15: una serie puede pasar los 31 días del turnero, pero ningún turno a más de 90 días desde hoy
       or (i > 0 and lt::date > (now() at time zone tz)::date + 90) then
      if i = 0 then raise exception 'slot_not_available'; end if;
      skipped := skipped + 1; continue;
    end if;
    disc := public.happy_disc(p.id, lt);
    v_price := case when v_reward then 0 else round((s.price + ad_price) * (100 - disc) / 100.0) end;
    dep := case when v_reward then 0 when st.pay_mode = 'full' or v_full then v_price else round(v_price * st.deposit_pct / 100.0) end;
    -- D34: comisión de TuTiempo = % del PRECIO FINAL del turno (con happy hour y adicionales), cobrada al reservar junto
    -- con la seña; el costo de Mercado Pago no cambia: total = (seña + comisión) / (1 − % MP), redondeado para arriba.
    parts := public.charge_parts(dep, v_price, v_cpct, v_mpct);
    v_fee := parts[1]; v_mp := parts[2];
    begin
      insert into public.bookings (provider_id, service_id, client_id, client_name, service_name, source, status,
                                   starts_at, ends_at, buffer_min, price, discount_pct, deposit, client_fee, mp_fee, mp_fee_pct, series_id, hold_expires_at, addons, intake, pay_method)
      values (p.id, s.id, uid, nm, s.name, 'app', 'hold', t, t + make_interval(mins => dur), st.buffer_min,
              v_price, disc, dep, v_fee, v_mp, case when v_mp > 0 then v_mpct else 0 end, sid, now() + interval '10 minutes', ad_json, v_intake, case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end)
      returning id into bid;
    exception when exclusion_violation then
      if i = 0 then raise exception 'slot_taken'; end if;
      skipped := skipped + 1; continue;
    end;
    ids := ids || bid; deps := deps || dep; total := total + dep + v_fee + v_mp;
  end loop;

  -- Bloque 1 (H23): si hay que pagar con Mercado Pago, el prestador tiene que poder cobrar hoy
  if total - w > 0 and not public.provider_can_charge(p.id) then raise exception 'provider_mp_not_connected'; end if;
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

-- =====================================================================
-- TuTiempo · V1 · D30: comisión de TuTiempo sobre la SEÑA y costo de Mercado Pago según el plazo de acreditación
--   - Comisión de TuTiempo: % de la seña (app_settings.deposit_commission_pct, editable desde el admin, 7 por defecto).
--     La de antes (commission_pct, % del precio) queda solo para las cuentas de los turnos viejos (booking_fee).
--   - Mercado Pago: un % por plazo (al instante, 10, 18 y 35 días), editable desde el admin, todos en 0 hasta la
--     aprobación legal. El prestador elige su plazo (provider_settings.payout_term, "al instante" por defecto).
--   - Total que paga el cliente: (seña + comisión) / (1 − % MP), redondeado para arriba, en pesos enteros
--     (charge_parts, la misma cuenta que src/lib/cobro.js). El prestador recibe la seña completa y TuTiempo su comisión.
--   - Cada turno guarda lo que se sumó por Mercado Pago (mp_fee, mp_fee_pct) y, al pagarse, lo cobrado por eso
--     (paid_mp_fee): las devoluciones devuelven todo lo que pagó el cliente, como hasta ahora (devoluciones sin cambios).
--   - Después de cada pago se compara la comisión que informa Mercado Pago (fee_details, mercadopago_fee) con la
--     esperada (% del plazo sobre el total), con $2 de margen. Si no coincide, el turno igual se confirma, el pago queda
--     en "Para revisar" (mp_cost_mismatch) y el prestador recibe un aviso con los dos números.
--   - Los turnos ya reservados no cambian (mp_fee = 0). Los prestadores arrancan con "al instante".
-- No borra datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Configuración (solo el admin la cambia, con admin_set_fees) ----------
alter table public.app_settings add column if not exists deposit_commission_pct numeric(4,2) not null default 7
  check (deposit_commission_pct between 0 and 30);
alter table public.app_settings add column if not exists mp_pct_instant numeric(4,2) not null default 0 check (mp_pct_instant between 0 and 15);
alter table public.app_settings add column if not exists mp_pct_d10 numeric(4,2) not null default 0 check (mp_pct_d10 between 0 and 15);
alter table public.app_settings add column if not exists mp_pct_d18 numeric(4,2) not null default 0 check (mp_pct_d18 between 0 and 15);
alter table public.app_settings add column if not exists mp_pct_d35 numeric(4,2) not null default 0 check (mp_pct_d35 between 0 and 15);

-- ---------- Plazo de acreditación del prestador (el mismo que eligió en su cuenta de Mercado Pago) ----------
alter table public.provider_settings add column if not exists payout_term text not null default 'instant'
  check (payout_term in ('instant','d10','d18','d35'));

-- ---------- Turnos y pagos ----------
alter table public.bookings add column if not exists mp_fee integer not null default 0 check (mp_fee >= 0);                  -- lo que se suma por MP
alter table public.bookings add column if not exists mp_fee_pct numeric(4,2) not null default 0 check (mp_fee_pct between 0 and 15);
alter table public.bookings add column if not exists paid_mp_fee integer not null default 0 check (paid_mp_fee >= 0);        -- lo cobrado por eso
alter table public.payments add column if not exists mp_cost integer check (mp_cost >= 0);                    -- mercadopago_fee informado
alter table public.payments add column if not exists mp_cost_expected integer check (mp_cost_expected >= 0);  -- % del plazo sobre el total

-- aviso al prestador si Mercado Pago le cobró otro % que el de su plazo
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost'));

-- ---------- Cuentas ----------
-- comisión de TuTiempo en % de la seña (7 = 7%)
create or replace function public.deposit_commission() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select deposit_commission_pct from public.app_settings where id), 7)::numeric
$$;
-- % de Mercado Pago de un plazo (0 si no hay)
create or replace function public.mp_term_pct(p_term text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select case p_term when 'd10' then mp_pct_d10 when 'd18' then mp_pct_d18 when 'd35' then mp_pct_d35 else mp_pct_instant end
                   from public.app_settings where id), 0)::numeric
$$;
-- {comisión, costo de MP, total} de una seña, con números enteros (la misma cuenta que chargeFor en src/lib/cobro.js):
--   comisión = seña × % TuTiempo, al peso más cercano; total = ⌈(seña + comisión) / (1 − % MP)⌉; costo MP = total − seña − comisión
create or replace function public.charge_parts(p_deposit int, p_cpct numeric, p_mpct numeric) returns int[]
language plpgsql immutable set search_path = public as $$
declare dep bigint := greatest(coalesce(p_deposit, 0), 0); c100 bigint := round(coalesce(p_cpct, 0) * 100);
        m100 bigint := round(coalesce(p_mpct, 0) * 100); fee bigint; total bigint; d bigint;
begin
  if dep = 0 then return array[0, 0, 0]; end if;
  if c100 < 0 or c100 > 3000 or m100 < 0 or m100 > 1500 then raise exception 'bad_pct'; end if;
  fee := (dep * c100 + 5000) / 10000;
  d := 10000 - m100;
  total := ((dep + fee) * 10000 + d - 1) / d;
  return array[fee::int, (total - dep - fee)::int, total::int];
end $$;
-- porcentaje para los textos ("7,61", "5")
create or replace function public.pct_txt(n numeric) returns text language sql immutable as $$
  select replace(rtrim(rtrim(to_char(round(coalesce(n, 0), 2), 'FM9990.00'), '0'), '.'), '.', ',')
$$;

-- el admin cambia la comisión de TuTiempo (% de la seña) y los % de Mercado Pago por plazo; vale para las reservas nuevas
create or replace function public.admin_set_fees(p_commission numeric, p_instant numeric, p_d10 numeric, p_d18 numeric, p_d35 numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_commission is null or p_commission < 0 or p_commission > 30 then raise exception 'bad_commission'; end if;
  if p_instant is null or p_d10 is null or p_d18 is null or p_d35 is null
     or least(p_instant, p_d10, p_d18, p_d35) < 0 or greatest(p_instant, p_d10, p_d18, p_d35) > 15 then raise exception 'bad_mp_pct'; end if;
  update public.app_settings set deposit_commission_pct = round(p_commission, 2), mp_pct_instant = round(p_instant, 2),
         mp_pct_d10 = round(p_d10, 2), mp_pct_d18 = round(p_d18, 2), mp_pct_d35 = round(p_d35, 2), updated_at = now()
   where id returning * into r;
  return jsonb_build_object('commission', r.deposit_commission_pct, 'instant', r.mp_pct_instant, 'd10', r.mp_pct_d10,
                            'd18', r.mp_pct_d18, 'd35', r.mp_pct_d35);
end $$;

-- ---------- Reservar: seña, comisión de TuTiempo sobre la seña y costo de Mercado Pago del plazo ----------
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
    -- D30: comisión de TuTiempo = % de la SEÑA y costo de Mercado Pago del plazo del prestador, los dos aparte de la seña:
    -- total = (seña + comisión) / (1 − % MP), redondeado para arriba. El prestador recibe la seña completa.
    parts := public.charge_parts(dep, v_cpct, v_mpct);
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

-- ---------- Confirmar un pago: se debe también el costo de Mercado Pago; control de la comisión que informa ----------
create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; mpf_part int; short boolean; why text;
        mp_pct numeric; cost_exp int; cost_mp int; mp_id text;
        reasons text[] := '{}'; ok int := 0; back int := 0; first_ok bigint;
begin
  pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(ids)));
  acct := coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active'));
  -- lo que se debía: seña + comisión + costo de Mercado Pago (D30) de los turnos de ESTE prestador que vinieron en el pago
  select sum(deposit + client_fee + mp_fee - paid_wallet), sum(client_fee), min(client_id::text)::uuid, min(client_name), max(mp_fee_pct)
    into due, fee_exp, uid, nm, mp_pct
    from public.bookings where id = any(ids) and provider_id = pid and source = 'app';
  due := coalesce(due, 0); fee_exp := coalesce(fee_exp, 0);
  -- D30: la comisión de Mercado Pago esperada (% del plazo sobre el total) y la que informa (fee_details, mercadopago_fee).
  -- Solo se compara si al cliente se le sumó un costo de Mercado Pago (% del plazo > 0).
  if coalesce(mp_pct, 0) > 0 then cost_exp := round(due * mp_pct / 100); end if;
  select round(sum((f->>'amount')::numeric))::int into cost_mp
    from jsonb_array_elements(case when jsonb_typeof(p_raw->'fee_details') = 'array' then p_raw->'fee_details' else '[]'::jsonb end) f
   where f->>'type' = 'mercadopago_fee' and (f->>'amount') ~ '^[0-9]+(\.[0-9]+)?$';
  if cost_exp is not null and cost_mp is not null and abs(cost_mp - cost_exp) > 2 then
    reasons := array_append(reasons, 'mp_cost_mismatch');
  end if;
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.bookings b where b.id = x and b.provider_id = pid and b.source = 'app')) then
    reasons := array_append(reasons, 'other_provider');      -- turnos de otro prestador o que no existen: no se tocan
  end if;
  -- comisión: la que informa Mercado Pago tiene que ser la calculada por la base
  if fee_exp > 0 and p_fee_mp is null then reasons := array_append(reasons, 'fee_missing');
  elsif p_fee_mp is not null and p_fee_mp <> fee_exp then reasons := array_append(reasons, 'fee_mismatch'); end if;
  short := left_amt < due;                       -- D16: llegó menos → no se confirma nada y se devuelve todo
  if left_amt > due and due > 0 then reasons := array_append(reasons, 'amount_over'); end if;   -- D16: llegó más → se confirma y la diferencia se revisa

  insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, client_id, booking_ids, amount, fee_expected, fee_mp,
                               mp_status_detail, mp_cost, mp_cost_expected)
  values (p_payment_id, pid, acct, left(p_collector, 40), uid, ids, left_amt, fee_exp, p_fee_mp, left(p_status_detail, 60), cost_mp, cost_exp)
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);

  for r in select * from public.bookings where id = any(ids) and provider_id = pid and source = 'app' order by starts_at for update loop
    pay := least(left_amt, r.deposit + r.client_fee + r.mp_fee - r.paid_wallet); left_amt := left_amt - pay;
    fee_part := least(pay, r.client_fee);
    mpf_part := least(pay - fee_part, r.mp_fee);   -- D30: lo que se sumó por Mercado Pago (no es del prestador ni de TuTiempo)
    why := null;
    if short then
      why := 'amount_short';
    elsif r.status not in ('hold', 'expired') or r.payment_id is not null then
      why := 'booking_unavailable';             -- cancelado (por el prestador, un bloqueo, una baja) o ya pagado por otro pago
    elsif r.starts_at <= now() then
      why := 'booking_past';                    -- D29: el pago llegó cuando el turno ya había empezado: se devuelve
    else
      begin
        update public.bookings set status = 'confirmed', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part - mpf_part, app_fee = fee_part, paid_mp_fee = mpf_part
         where id = r.id;
        ok := ok + 1; first_ok := coalesce(first_ok, r.id);
      exception when exclusion_violation then
        why := 'slot_taken';                     -- el hold venció y otro tomó el horario
      end;
    end if;
    insert into public.payment_bookings (payment_id, booking_id, amount, fee, result, reason)
    values (pay_id, r.id, pay, fee_part, case when why is null then 'confirmed' else 'refund' end, why);
    if why is not null and pay > 0 then
      if r.status in ('hold', 'expired') and r.payment_id is null then
        -- lo canceló el sistema, no el prestador: 'expired' con lo cobrado (el cliente ve que se le devuelve y por qué)
        update public.bookings set status = 'expired', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part - mpf_part, app_fee = fee_part, paid_mp_fee = mpf_part
         where id = r.id;
      end if;
      perform public.refund_request(r.id, pay_id, pay, why);
      back := back + 1;
    end if;
  end loop;
  -- nada de este prestador en el pago: se devuelve todo lo cobrado (sin turno)
  if not exists (select 1 from public.payment_bookings where payment_id = pay_id) and left_amt > 0 then
    perform public.refund_request(null, pay_id, left_amt, 'unknown_booking');
    left_amt := 0;
  end if;

  update public.payments set
    outcome = case when cardinality(reasons) > 0 then 'review' when ok > 0 and back = 0 then 'confirmed' when ok > 0 then 'partial' else 'refund' end,
    review_reasons = reasons, updated_at = now()
   where id = pay_id;
  -- D30: el prestador se entera si Mercado Pago le cobró otro % que el del plazo de su perfil (con los dos números)
  if 'mp_cost_mismatch' = any(reasons) and pid is not null then
    select mp_payment_id into mp_id from public.payments where id = pay_id;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pid, 'mp_cost', left('costo-' || mp_id, 40),
            'Mercado Pago te cobró ' || public.pct_txt(cost_mp * 100.0 / nullif(due, 0)) || '% (' || public.money_txt(cost_mp) ||
            ') en vez de ' || public.pct_txt(mp_pct) || '% (' || public.money_txt(cost_exp) || ') en el pago n° ' || mp_id ||
            ': revisá que el plazo de acreditación de tu perfil (Cobros) sea el mismo que el de tu cuenta de Mercado Pago.')
    on conflict (provider_id, kind, ref) do update set body = excluded.body;
  end if;
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;



-- ---------- Cancela el prestador: se devuelve todo lo que pagó el cliente (también lo de Mercado Pago) ----------
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int; pay_id bigint; tries int := 0;
begin
  loop
    select payment_id into pay_id from public.bookings where id = p_booking;
    if pay_id is not null then perform 1 from public.payments where id = pay_id for update; end if;
    select * into b from public.bookings where id = p_booking for update;
    exit when b is null or b.payment_id is not distinct from pay_id;
    -- se pagó entre la lectura y el bloqueo: otra vuelta, ahora con ese pago (el turno sigue bloqueado)
    tries := tries + 1;
    if tries >= 3 then raise exception 'busy_retry' using errcode = 'serialization_failure'; end if;
  end loop;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  back := b.paid_mp + least(b.client_fee, b.app_fee) + b.paid_mp_fee;   -- D30: también lo que se sumó por Mercado Pago
  update public.bookings set status = 'cancelled_provider', hold_expires_at = null where id = b.id;
  perform public.refund_request(b.id, b.payment_id, back, 'provider_cancelled');
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
  return jsonb_build_object('status','cancelled','refund_mp', back, 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;

-- ---------- Aviso al cliente: el monto que se le devuelve incluye lo de Mercado Pago ----------
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
             case when b.paid_mp > 0 then ' Te devolvemos todo lo que pagaste ($' || replace(to_char(b.paid_mp + least(b.client_fee, b.app_fee) + b.paid_mp_fee, 'FM999,999,999'), ',', '.') || ').' else '' end ||
             ' Reprogramalo cuando quieras desde Mis turnos: {link}' as body into t;
    end if;
  else
    select enabled, mt.body into t from public.message_templates mt where provider_id = b.provider_id and key = k;
    if t is null or not t.enabled then return; end if;
  end if;
  select id, name, address, slug into p from public.providers where id = b.provider_id;
  lt := b.starts_at at time zone public.provider_tz(b.provider_id);
  body := replace(replace(replace(replace(replace(replace(t.body,
            '{nombre}', split_part(coalesce(b.client_name, ''), ' ', 1)), '{barberia}', p.name),
            '{dia}', dias[extract(dow from lt)::int + 1] || ' ' || extract(day from lt)::int || '/' || extract(month from lt)::int),
            '{hora}', to_char(lt, 'HH24:MI')), '{direccion}', coalesce(p.address, '')), '{link}', public.provider_link(p.id, p.slug));
  if k = 'rev' and exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'earn') then
    body := body || ' 🎟️ Sumaste 1 sello en tu tarjeta de ' || coalesce(b.service_name, 'este servicio') || '.';
  end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id, left(body, 600), k, bid::text) on conflict do nothing;
end $$;

-- ---------- Mis turnos: lo que se sumó y se pagó por Mercado Pago ----------
create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.paid_mp_fee, b.mp_fee, b.mp_fee_pct, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
           exists (select 1 from public.reviews r where r.booking_id = b.id) as reviewed, b.pay_method, p.photo_path,
           exists (select 1 from public.loyalty_events le where le.booking_id = b.id and le.kind = 'earn') as stamped,
           rf.amount as refund_amount, rf.done_at as refund_done_at, rf.reason as refund_reason,
           case when rf.amount is null then null when rf.open then 'pending' else 'done' end as refund_status
    from public.bookings b join public.providers p on p.id = b.provider_id join public.cities c on c.id = p.city_id
    left join public.services sv on sv.id = b.service_id
    left join lateral (select sum(r.amount)::int as amount, max(r.done_at) as done_at, min(r.reason) as reason,
                              bool_or(r.status in ('pending','failed')) as open
                       from public.refunds r where r.booking_id = b.id and r.status <> 'cancelled' having count(*) > 0) rf on true
    where b.client_id = auth.uid() and b.source = 'app'
    order by b.starts_at desc limit 200) x
$$;


-- ---------- Para revisar: la comisión de Mercado Pago esperada y la informada ----------
create or replace function public.admin_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'refunds', (select coalesce(jsonb_agg(x order by x.failed desc, x.created_at), '[]') from (
      select r.id, r.amount, r.reason, r.status, r.attempts, r.last_error, r.last_attempt_at, r.next_attempt_at, r.created_at,
             r.mp_payment_id, (r.status = 'failed') as failed, p.name as provider_name, b.client_name, b.starts_at
      from public.refunds r left join public.providers p on p.id = r.provider_id left join public.bookings b on b.id = r.booking_id
      where r.status = 'failed' or (r.status = 'pending' and r.attempts > 0)
      order by r.created_at limit 200) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
      select pm.id, pm.mp_payment_id, pm.amount, pm.fee_expected, pm.fee_mp, pm.mp_status, pm.review_reasons, pm.created_at,
             pm.mp_cost, pm.mp_cost_expected,
             pm.collector_id, (pm.mp_account_id is not null) as refundable_from_app, public.payment_reprocessable(pm.id) as reprocessable,
             -- lo que falta devolver: lo cobrado que no respalda un turno que sigue en pie, menos lo ya devuelto o pedido
             greatest(pm.amount
                      - coalesce((select sum(pb.amount) from public.payment_bookings pb join public.bookings b on b.id = pb.booking_id
                                  where pb.payment_id = pm.id and pb.result = 'confirmed'
                                    and b.status in ('confirmed','done','no_show','cancelled_client')), 0)
                      - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = pm.id and r.status <> 'cancelled'), 0), 0) as refundable,
             p.name as provider_name, (select min(b.client_name) from public.bookings b where b.payment_id = pm.id) as client_name
      from public.payments pm left join public.providers p on p.id = pm.provider_id
      where pm.outcome = 'review' and pm.review_resolved_at is null
      order by pm.created_at limit 200) x),
    -- cuentas que hoy no pueden cobrar o devolver por un error de su llave: las que cobran, y las de solo devoluciones
    -- que todavía tienen devoluciones pendientes
    'accounts', (select coalesce(jsonb_agg(x order by x.error_at), '[]') from (
      select a.id, a.mp_user_id, a.status, a.last_error, coalesce(a.last_error_at, a.connected_at) as error_at, p.name as provider_name,
             (select count(*) from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed')) as refunds_pending
      from public.mp_accounts a join public.providers p on p.id = a.provider_id
      where a.last_error is not null and a.status <> 'purged'
        and (a.status = 'active' or exists (select 1 from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed')))
      order by coalesce(a.last_error_at, a.connected_at) limit 200) x),
    'webhook_events', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.detail, e.hits, e.created_at, e.last_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.last_at > now() - interval '30 days'
      order by e.last_at desc limit 50) x),
    -- avisos rechazados antes de procesar (casi siempre, Mercado Pago mal configurado) y pagos sin aviso, últimos 7 días
    'webhook_alert', (select jsonb_build_object(
        'rejected', coalesce(sum(e.hits) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')), 0),
        'rejected_last', max(e.last_at) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')),
        'rejected_reason', (select e2.reason from public.mp_webhook_events e2
                             where e2.last_at > now() - interval '7 days'
                               and e2.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')
                             order by e2.last_at desc limit 1),
        'recovered', count(*) filter (where e.reason = 'recovered'),
        'recovered_last', max(e.last_at) filter (where e.reason = 'recovered'))
      from public.mp_webhook_events e where e.last_at > now() - interval '7 days'));
end $$;

-- ---------- Permisos ----------
revoke execute on function public.deposit_commission(), public.mp_term_pct(text), public.charge_parts(int, numeric, numeric),
  public.pct_txt(numeric), public.admin_set_fees(numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.deposit_commission(), public.mp_term_pct(text), public.charge_parts(int, numeric, numeric)
  to anon, authenticated, service_role;
grant execute on function public.admin_set_fees(numeric, numeric, numeric, numeric, numeric) to authenticated;

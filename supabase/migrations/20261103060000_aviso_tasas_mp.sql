-- v2 · Profesional (3/11): el aviso de D30 cuando Mercado Pago cobra otro % que el del plazo ya no manda a "tu perfil
-- (Cobros)", que no tiene el plazo: ahora dice "Si tu cuenta tiene otras tasas, avisanos.". El caso ya queda en
-- "Para revisar" del admin (el pago sale con review_reasons = mp_cost_mismatch); acá solo cambia el texto.
-- Idempotente: confirm_payment_core se redefine igual que en 20261103030000 salvo el texto, y los avisos ya enviados
-- con el texto viejo se reescriben (no se borra ninguno).

create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; mpf_part int; short boolean; why text;
        mp_pct numeric; cost_exp int; cost_mp int; mp_id text; cur_term text; got_term text; new_term text;
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
  -- D30 (plazo automático): si la comisión que informa Mercado Pago es la de OTRO plazo de la tabla del admin (con o sin
  -- IVA, $2 de margen), ese es el plazo real de la cuenta: se le cambia al prestador (después del pago) y se le avisa.
  -- Si no es la de ningún plazo, el pago queda para revisar (como antes). Con todos los % en 0 no se detecta nada.
  if cost_mp is not null and due > 0 and pid is not null then
    cur_term := coalesce((select payout_term from public.provider_settings where provider_id = pid), 'instant');
    got_term := public.mp_term_match(due, cost_mp, cur_term);
    if got_term is not null and got_term <> cur_term then
      new_term := got_term;
    elsif got_term is null and cost_exp is not null then
      reasons := array_append(reasons, 'mp_cost_mismatch');
    end if;
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
            '. Si tu cuenta tiene otras tasas, avisanos.')
    on conflict (provider_id, kind, ref) do update set body = excluded.body;
  end if;
  -- D30: el plazo detectado queda en el perfil del prestador (los próximos cobros ya salen con ese %) y se le avisa
  if new_term is not null then
    update public.provider_settings set payout_term = new_term where provider_id = pid;
    select mp_payment_id into mp_id from public.payments where id = pay_id;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pid, 'mp_term', left('plazo-' || new_term || '-' || mp_id, 40),
            'Detectamos que tu cuenta de Mercado Pago acredita ' ||
            case new_term when 'instant' then 'al instante' when 'd10' then 'a 10 días' when 'd18' then 'a 18 días' else 'a 35 días' end ||
            case when public.mp_term_pct(new_term) < public.mp_term_pct(cur_term)
                 then '; desde ahora tus clientes pagan menos.'
                 else '; desde ahora el costo de Mercado Pago de tus cobros es el de ese plazo.' end ||
            ' Si no es así, cambialo en Horarios (Plazo de acreditación).')
    on conflict (provider_id, kind, ref) do nothing;
  end if;
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;

update public.provider_notices
   set body = regexp_replace(body, ': revisá que el plazo de acreditación de tu perfil \(Cobros\) sea el mismo que el de tu cuenta de Mercado Pago\.$',
                             '. Si tu cuenta tiene otras tasas, avisanos.')
 where kind = 'mp_cost' and body like '%(Cobros)%';

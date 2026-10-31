-- D29: un pago que llega cuando la hora del turno ya pasó (por ejemplo, un aviso de Mercado Pago tardío o un pago que
-- recupera mp-reconcile días después) se DEVUELVE, aunque el horario esté libre. Antes, se confirmaba un turno en el pasado.
-- - refunds.reason suma 'booking_past'; confirm_payment_core lo usa antes de intentar confirmar.
-- - El cliente y el prestador reciben el aviso de siempre del pago devuelto (refunds_expired_notice, refunds_late_notice)
--   con el motivo "después de la hora del turno".

alter table public.refunds drop constraint if exists refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check
  check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking','admin','booking_past'));

create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; short boolean; why text;
        reasons text[] := '{}'; ok int := 0; back int := 0; first_ok bigint;
begin
  pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(ids)));
  acct := coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active'));
  -- lo que se debía: seña + comisión de los turnos de ESTE prestador que vinieron en el pago
  select sum(deposit + client_fee - paid_wallet), sum(client_fee), min(client_id::text)::uuid, min(client_name)
    into due, fee_exp, uid, nm
    from public.bookings where id = any(ids) and provider_id = pid and source = 'app';
  due := coalesce(due, 0); fee_exp := coalesce(fee_exp, 0);
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.bookings b where b.id = x and b.provider_id = pid and b.source = 'app')) then
    reasons := array_append(reasons, 'other_provider');      -- turnos de otro prestador o que no existen: no se tocan
  end if;
  -- comisión: la que informa Mercado Pago tiene que ser la calculada por la base
  if fee_exp > 0 and p_fee_mp is null then reasons := array_append(reasons, 'fee_missing');
  elsif p_fee_mp is not null and p_fee_mp <> fee_exp then reasons := array_append(reasons, 'fee_mismatch'); end if;
  short := left_amt < due;                       -- D16: llegó menos → no se confirma nada y se devuelve todo
  if left_amt > due and due > 0 then reasons := array_append(reasons, 'amount_over'); end if;   -- D16: llegó más → se confirma y la diferencia se revisa

  insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, client_id, booking_ids, amount, fee_expected, fee_mp, mp_status_detail)
  values (p_payment_id, pid, acct, left(p_collector, 40), uid, ids, left_amt, fee_exp, p_fee_mp, left(p_status_detail, 60))
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);

  for r in select * from public.bookings where id = any(ids) and provider_id = pid and source = 'app' order by starts_at for update loop
    pay := least(left_amt, r.deposit + r.client_fee - r.paid_wallet); left_amt := left_amt - pay;
    fee_part := least(pay, r.client_fee);
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
               paid_mp = pay - fee_part, app_fee = fee_part
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
               paid_mp = pay - fee_part, app_fee = fee_part
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
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;


create or replace function public.refunds_late_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare total int; who text; why text; mp_id text;
begin
  if new.payment_id is null or new.reason not in ('slot_taken','booking_unavailable','amount_short','unknown_booking','booking_past') then
    return new;
  end if;
  select coalesce(sum(amount), 0) into total from public.refunds
   where payment_id = new.payment_id and reason in ('slot_taken','booking_unavailable','amount_short','unknown_booking','booking_past') and status <> 'cancelled';
  select coalesce((select b.client_name from public.bookings b where b.id = new.booking_id),
                  (select min(b.client_name) from public.bookings b where b.id = any(pm.booking_ids))), pm.mp_payment_id
    into who, mp_id from public.payments pm where pm.id = new.payment_id;
  why := case new.reason
           when 'slot_taken' then 'llegó cuando el horario ya no estaba libre'
           when 'booking_unavailable' then 'llegó cuando el turno ya no estaba disponible (cancelado o pagado por otro pago)'
           when 'amount_short' then 'llegó con un monto menor al de la reserva'
           when 'booking_past' then 'llegó después de la hora del turno'
           else 'no corresponde a ningún turno tuyo' end;
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (new.provider_id, 'mp_refunded', left('tarde-' || coalesce(mp_id, new.payment_id::text), 40),
          'El pago ' || coalesce('de ' || nullif(who, ''), 'n° ' || mp_id) || ' ' || why || ': se le devuelve ' ||
          public.money_txt(total) || ' desde tu cuenta de Mercado Pago. No tenés que hacer nada.')
  on conflict (provider_id, kind, ref) do update set body = excluded.body;
  return new;
end $$;

create or replace function public.refunds_expired_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; why text;
begin
  why := case new.reason when 'slot_taken' then 'el horario ya no estaba libre cuando se acreditó tu pago'
                         when 'booking_unavailable' then 'el turno ya no estaba disponible cuando se acreditó tu pago'
                         when 'amount_short' then 'el pago no alcanzó para el turno'
                         when 'booking_past' then 'tu pago se acreditó después de la hora del turno' end;
  if why is null or new.booking_id is null then return null; end if;
  select bk.id, bk.provider_id, bk.client_id, bk.status, p.id as pid, p.name, p.slug into b
    from public.bookings bk join public.providers p on p.id = bk.provider_id where bk.id = new.booking_id;
  if b.id is null or b.client_id is null or b.status <> 'expired' then return null; end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id,
          left('No pudimos confirmar tu turno del ' || public.booking_when(b.id) || ' en ' || b.name || ': ' || why ||
               '. Te devolvemos ' || public.money_txt(new.amount) || '. Si querés, reservá de nuevo: ' || public.provider_link(b.pid, b.slug), 600),
          'cancel', b.id::text)
  on conflict do nothing;
  return null;
end $$;

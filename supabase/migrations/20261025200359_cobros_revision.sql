-- =====================================================================
-- TuTiempo · Bloque 2b · Cobros: lo que el admin tiene que ver y poder resolver
-- - Cuentas de Mercado Pago con error (llave que no se puede descifrar, renovación fallida, llave sin cifrar): aparecen
--   en "Para revisar" con el prestador, la cuenta, el error y desde cuándo (mp_accounts.last_error_at).
-- - H27 "Reprocesar": un pago que quedó para revisar por un error inesperado (motivo "error: …") se vuelve a procesar
--   con confirm_payment_core, solo si sus turnos siguen en hold/expired sin pago; en la misma transacción se borra el
--   registro de revisión y queda quién, cuándo y por qué (payments.reprocessed).
-- - H28: cuando un pago llega tarde y se devuelve (horario ocupado, turno ya cancelado, monto de menos, sin turno), el
--   prestador recibe un aviso, uno por pago, con el total que se devuelve desde su cuenta.
-- No borra datos (salvo el registro de revisión que reemplaza el reproceso).
-- =====================================================================
set search_path = public, extensions;

-- ---------- Desde cuándo tiene error una cuenta ----------
alter table public.mp_accounts add column if not exists last_error_at timestamptz;
update public.mp_accounts set last_error_at = coalesce(refreshed_at, connected_at) where last_error is not null and last_error_at is null;
create or replace function public.mp_accounts_error_since() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.last_error is null then
    new.last_error_at := null;
  elsif tg_op = 'INSERT' or old.last_error is null then
    new.last_error_at := now();               -- el primer error; si cambia el texto, sigue la misma fecha
  end if;
  return new;
end $$;
drop trigger if exists mp_accounts_error_since on public.mp_accounts;
create trigger mp_accounts_error_since before insert or update of last_error on public.mp_accounts
  for each row execute function public.mp_accounts_error_since();

-- ---------- El error inesperado guarda también la comisión que informó Mercado Pago (para poder reprocesar) ----------
create or replace function public.confirm_payment(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                  p_provider bigint default null, p_account bigint default null,
                                                  p_fee_mp int default null, p_collector text default null,
                                                  p_raw jsonb default null, p_status_detail text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; pay_id bigint; pid bigint;
begin
  if coalesce(p_payment_id, '') = '' then raise exception 'bad_payment'; end if;
  -- el mismo aviso dos veces: no se hace nada (solo se guarda la consulta)
  select id, outcome into prev from public.payments where mp_payment_id = p_payment_id;
  if prev.id is not null then
    perform public.payment_log(prev.id, p_raw);
    return jsonb_build_object('status', 'already_processed', 'payment', prev.id, 'outcome', prev.outcome);
  end if;
  -- pagos confirmados antes del Bloque 1 (quedaron en bookings.mp_payment_id)
  if exists (select 1 from public.bookings where mp_payment_id = p_payment_id) then
    return jsonb_build_object('status', 'already_processed');
  end if;
  begin
    return public.confirm_payment_core(p_booking_ids, p_payment_id, p_amount, p_provider, p_account, p_fee_mp, p_collector, p_raw, p_status_detail);
  exception
    -- pasajeros: que suban. Dos avisos a la vez chocan en unique_violation y el reintento termina en already_processed.
    when deadlock_detected or serialization_failure or lock_not_available or query_canceled or unique_violation then
      raise;
    when others then
      -- nunca falla ante un pago aprobado: queda registrado para revisar, con el error
      pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(coalesce(p_booking_ids, '{}'))));
      insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, booking_ids, amount, fee_mp, outcome, review_reasons, mp_status_detail)
      values (p_payment_id, pid, coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active')),
              left(p_collector, 40), coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), p_fee_mp, 'review',
              array['error: ' || left(sqlerrm, 200)], left(p_status_detail, 60))
      on conflict (mp_payment_id) do nothing
      returning id into pay_id;
      perform public.payment_log(pay_id, p_raw);
      return jsonb_build_object('status', 'review', 'payment', pay_id, 'error', sqlerrm);
  end;
end $$;

-- ---------- H27: Reprocesar ----------
alter table public.payments add column if not exists reprocessed jsonb;   -- {at, by, note, error}: quién lo reprocesó y por qué

-- se puede reprocesar: en revisión, solo por errores inesperados, sin devoluciones ni turnos ligados todavía, y con sus
-- turnos de la app todavía en hold/expired sin pago
create or replace function public.payment_reprocessable(p_payment bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.payments pm
     where pm.id = p_payment and pm.outcome = 'review' and pm.review_resolved_at is null
       and cardinality(pm.review_reasons) > 0
       and not exists (select 1 from unnest(pm.review_reasons) r where r not like 'error: %')
       and not exists (select 1 from public.payment_bookings pb where pb.payment_id = pm.id)
       and not exists (select 1 from public.refunds rf where rf.payment_id = pm.id)
       and not exists (select 1 from public.bookings b where b.payment_id = pm.id)
       and exists (select 1 from public.bookings b where b.id = any(pm.booking_ids))
       and not exists (select 1 from public.bookings b where b.id = any(pm.booking_ids)
                         and (b.status not in ('hold','expired') or b.payment_id is not null)))
$$;

create or replace function public.admin_reprocess(p_payment bigint, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare txt text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 500);
        pm record; fee int; res jsonb; new_id bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(txt) < 3 then raise exception 'note_required'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if pm.id is null then raise exception 'not_found'; end if;
  perform 1 from public.bookings where id = any(pm.booking_ids) order by id for update;
  if not public.payment_reprocessable(pm.id) then raise exception 'cannot_reprocess'; end if;
  -- la comisión que informó Mercado Pago: la guardada, o la de la última consulta registrada
  fee := coalesce(pm.fee_mp, (
    select coalesce((select (f->>'amount')::numeric from jsonb_array_elements(e->'body'->'fee_details') f where f->>'type' = 'application_fee' limit 1),
                    (e->'body'->>'marketplace_fee')::numeric)::int
      from jsonb_array_elements(pm.mp_responses) with ordinality t(e, n) order by n desc limit 1));
  -- el registro de revisión se reemplaza por el procesamiento real; si falla, la transacción entera vuelve atrás
  delete from public.payments where id = pm.id;
  res := public.confirm_payment_core(pm.booking_ids, pm.mp_payment_id, pm.amount, pm.provider_id, pm.mp_account_id, fee,
                                     pm.collector_id, null, pm.mp_status_detail);
  new_id := (res->>'payment')::bigint;
  update public.payments set mp_responses = pm.mp_responses, mp_status = pm.mp_status, refunded_mp = pm.refunded_mp,
         created_at = pm.created_at, updated_at = now(),
         reprocessed = jsonb_build_object('at', now(), 'by', auth.uid(), 'note', txt, 'error', to_jsonb(pm.review_reasons))
   where id = new_id;
  return res;
end $$;

-- ---------- H28: aviso al prestador de un pago tardío que se devuelve ----------
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_late_refund'));

create or replace function public.refunds_late_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare total int; who text; why text; mp_id text;
begin
  if new.payment_id is null or new.reason not in ('slot_taken','booking_unavailable','amount_short','unknown_booking') then
    return new;
  end if;
  select coalesce(sum(amount), 0) into total from public.refunds
   where payment_id = new.payment_id and reason in ('slot_taken','booking_unavailable','amount_short','unknown_booking') and status <> 'cancelled';
  select coalesce((select b.client_name from public.bookings b where b.id = new.booking_id),
                  (select min(b.client_name) from public.bookings b where b.id = any(pm.booking_ids))), pm.mp_payment_id
    into who, mp_id from public.payments pm where pm.id = new.payment_id;
  why := case new.reason
           when 'slot_taken' then 'llegó cuando el horario ya no estaba libre'
           when 'booking_unavailable' then 'llegó cuando el turno ya no estaba disponible (cancelado o pagado por otro pago)'
           when 'amount_short' then 'llegó con un monto menor al de la reserva'
           else 'no corresponde a ningún turno tuyo' end;
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (new.provider_id, 'mp_late_refund', left('tarde-' || coalesce(mp_id, new.payment_id::text), 40),
          'El pago ' || coalesce('de ' || nullif(who, ''), 'n° ' || mp_id) || ' ' || why || ': se le devuelve ' ||
          public.money_txt(total) || ' desde tu cuenta de Mercado Pago. No tenés que hacer nada.')
  on conflict (provider_id, kind, ref) do update set body = excluded.body;
  return new;
end $$;
drop trigger if exists refunds_late_notice on public.refunds;
create trigger refunds_late_notice after insert on public.refunds
  for each row execute function public.refunds_late_notice();

-- ---------- "Para revisar": también las cuentas con error y si un pago se puede reprocesar ----------
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
    'webhook_events', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.created_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.created_at > now() - interval '30 days'
      order by e.created_at desc limit 50) x));
end $$;

-- ---------- Permisos ----------
revoke execute on function public.mp_accounts_error_since(), public.payment_reprocessable(bigint), public.admin_reprocess(bigint, text),
  public.refunds_late_notice() from public, anon, authenticated;
grant execute on function public.admin_reprocess(bigint, text) to authenticated;

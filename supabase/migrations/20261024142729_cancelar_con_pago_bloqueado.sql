-- =====================================================================
-- TuTiempo · Bloque 1 · cancel_by_provider con el pago correcto bloqueado
-- Bloquea primero el pago y después el turno (mismo orden que payment_mp_update). Si entre la lectura sin bloqueo y el
-- bloqueo del turno cambió su payment_id (un hold que se pagó justo), repite con el pago correcto. Todo lo demás
-- (estado, monto a devolver, pago de la devolución) sale de la lectura bloqueada.
-- No cambia datos.
-- =====================================================================
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
  back := b.paid_mp + least(b.client_fee, b.app_fee);
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

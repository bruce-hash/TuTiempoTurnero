-- =====================================================================
-- TuTiempo · Bloque 1 · Ajustes de cobros (revisión del PR #4)
-- - Turnos que cancela el sistema (pago tardío con el horario ocupado, monto de menos) quedan 'expired' con lo cobrado
--   y su devolución, nunca como "canceló el prestador".
-- - Avisos de Mercado Pago descartados: quedan en mp_webhook_events (sin datos personales). Cobrador equivocado: además
--   el pago va a "Para revisar" sin confirmar turnos.
-- - Renovación de llaves sin carreras (refreshing_until), respuesta de MP guardada con lista de campos permitidos,
--   devolución creada por el admin, errores pasajeros que suben (MP reintenta), orden de bloqueos pago → turno.
-- No borra datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Renovación de llaves: una sola a la vez por cuenta ----------
alter table public.mp_accounts add column if not exists refreshing_until timestamptz;

-- Reserva la renovación: solo la obtiene quien la toma (los demás siguen con la llave actual mientras no venza)
create or replace function public.mp_account_refresh_claim(p_account bigint, p_seconds int default 60) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mp_accounts set refreshing_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 5), 300))
   where id = p_account and status <> 'purged' and refresh_token is not null
     and (refreshing_until is null or refreshing_until < now());
  return found;
end $$;
-- Guarda la llave renovada y libera la reserva
create or replace function public.mp_account_refreshed(p_account bigint, p_access text, p_refresh text, p_expires_in int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_access, '') = '' then raise exception 'bad_token'; end if;
  update public.mp_accounts set access_token = p_access, refresh_token = coalesce(nullif(p_refresh, ''), refresh_token),
         expires_at = case when p_expires_in > 0 then now() + make_interval(secs => p_expires_in) end,
         refreshed_at = now(), refreshing_until = null, last_error = null
   where id = p_account and status <> 'purged';
end $$;
-- Llave que venció y no se pudo renovar: también libera la reserva
create or replace function public.mp_account_error(p_account bigint, p_error text, p_expired boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.mp_accounts set last_error = left(p_error, 300), refreshing_until = null,
         status = case when p_expired and status = 'active' then 'refunds_only' else status end,
         disconnected_at = case when p_expired and status = 'active' then now() else disconnected_at end
  where id = p_account
$$;

-- ---------- Avisos de Mercado Pago descartados (sin datos personales) ----------
create table if not exists public.mp_webhook_events (
  id            bigint generated always as identity primary key,
  mp_payment_id text check (char_length(mp_payment_id) <= 40),
  provider_id   bigint references public.providers(id) on delete set null,
  mp_account_id bigint references public.mp_accounts(id) on delete set null,
  reason        text not null check (reason in ('unknown_provider','payment_not_found','wrong_collector','bad_currency')),
  created_at    timestamptz not null default now()
);
create index if not exists mp_webhook_events_recent on public.mp_webhook_events (created_at desc);
alter table public.mp_webhook_events enable row level security;
revoke all on public.mp_webhook_events from public, anon, authenticated;
grant select on public.mp_webhook_events to authenticated;
grant select, insert on public.mp_webhook_events to service_role;
drop policy if exists mp_webhook_events_read on public.mp_webhook_events;
create policy mp_webhook_events_read on public.mp_webhook_events for select to authenticated using ((select public.is_admin()));

create or replace function public.mp_webhook_event(p_payment_id text, p_provider bigint, p_account bigint, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into public.mp_webhook_events (mp_payment_id, provider_id, mp_account_id, reason)
  values (left(p_payment_id, 40),
          (select id from public.providers where id = p_provider),
          (select id from public.mp_accounts where id = p_account),
          p_reason)
$$;

-- Pago que no se puede tomar como bueno (por ejemplo, cobrado por otra cuenta): queda registrado en "Para revisar",
-- sin confirmar turnos ni pedir devoluciones (las decide el admin).
create or replace function public.payment_review(p_payment_id text, p_provider bigint, p_collector text, p_booking_ids bigint[],
                                                 p_amount int, p_reason text, p_raw jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay_id bigint;
begin
  if coalesce(p_payment_id, '') = '' then raise exception 'bad_payment'; end if;
  select id into pay_id from public.payments where mp_payment_id = p_payment_id;
  if pay_id is not null then
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'already_processed', 'payment', pay_id);
  end if;
  insert into public.payments (mp_payment_id, provider_id, collector_id, booking_ids, amount, outcome, review_reasons)
  values (p_payment_id, (select id from public.providers where id = p_provider), left(p_collector, 40),
          coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review', array[p_reason])
  on conflict (mp_payment_id) do nothing
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);
  return jsonb_build_object('status', 'review', 'payment', pay_id);
end $$;

-- ---------- Respuesta de Mercado Pago: solo campos permitidos ----------
create or replace function public.mp_clean(p jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p) <> 'object' then null else
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v)
      where k in ('id','status','status_detail','transaction_amount','currency_id','date_created','date_approved',
                  'date_last_updated','collector_id','external_reference','metadata','fee_details','marketplace_fee'))
    || case when jsonb_typeof(p->'refunds') = 'array' then jsonb_build_object('refunds',
         (select coalesce(jsonb_agg(jsonb_build_object('id', r->'id', 'amount', r->'amount', 'status', r->'status', 'date_created', r->'date_created')), '[]'::jsonb)
            from jsonb_array_elements(p->'refunds') r where jsonb_typeof(r) = 'object'))
       else '{}'::jsonb end
  end
$$;

-- ---------- Devoluciones creadas por el admin (salida de "Para revisar", D20) ----------
alter table public.refunds add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.refunds add column if not exists note text check (char_length(note) <= 500);
alter table public.refunds drop constraint if exists refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check
  check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking','admin'));

-- Crea una devolución de un pago (todo o una parte, de un turno o del pago entero). La ejecuta mp-refunds con la llave
-- de la cuenta que cobró; refunds_cap impide devolver más de lo cobrado. Si el pago estaba en revisión, queda resuelto
-- con la misma nota.
create or replace function public.admin_refund_create(p_payment bigint, p_booking bigint default null, p_amount int default null,
                                                      p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare pm record; txt text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 500); rid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(txt) < 3 then raise exception 'note_required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'bad_amount'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if pm.id is null then raise exception 'not_found'; end if;
  if p_booking is not null and not exists (select 1 from public.payment_bookings where payment_id = pm.id and booking_id = p_booking) then
    raise exception 'not_found';
  end if;
  insert into public.refunds (payment_id, booking_id, provider_id, mp_payment_id, mp_account_id, amount, reason, status,
                              created_by, note, last_error)
  values (pm.id, p_booking, pm.provider_id, pm.mp_payment_id, pm.mp_account_id, p_amount, 'admin',
          case when pm.mp_account_id is null then 'failed' else 'pending' end, auth.uid(), txt,
          case when pm.mp_account_id is null then 'El pago no está ligado a una cuenta de Mercado Pago de TuTiempo: devolverlo a mano' end)
  returning id into rid;
  if p_booking is not null then
    update public.bookings set refund_pending = refund_pending + p_amount where id = p_booking;
  end if;
  update public.payments set review_resolved_at = now(), review_resolved_by = auth.uid(),
         review_note = left('Devolución de ' || public.money_txt(p_amount) || ': ' || txt, 500), updated_at = now()
   where id = pm.id and outcome = 'review' and review_resolved_at is null;
  return rid;
end $$;

-- ---------- confirm_payment: los errores pasajeros suben (el webhook responde 500 y Mercado Pago reintenta) ----------
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
      insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, booking_ids, amount, outcome, review_reasons, mp_status_detail)
      values (p_payment_id, pid, coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active')),
              left(p_collector, 40), coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review',
              array['error: ' || left(sqlerrm, 200)], left(p_status_detail, 60))
      on conflict (mp_payment_id) do nothing
      returning id into pay_id;
      perform public.payment_log(pay_id, p_raw);
      return jsonb_build_object('status', 'review', 'payment', pay_id, 'error', sqlerrm);
  end;
end $$;

-- Cancelaciones del sistema: el turno queda 'expired' (con lo cobrado y su devolución), nunca 'cancelled_provider'.
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

-- ---------- Cambios de estado en Mercado Pago ----------
-- 'approved' vuelve a poner el pago como aprobado (por ejemplo, un reclamo resuelto a favor del prestador); los motivos
-- quedan en review_reasons como historial. Cada reclamo o contracargo nuevo genera su aviso y vuelve a "Para revisar".
create or replace function public.payment_mp_update(p_payment_id text, p_status text, p_refunded int default 0,
                                                    p_status_detail text default null, p_raw jsonb default null,
                                                    p_provider bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pm record; r record; ours int; done_sum int; pend_sum int; n int := 0; reasons text[]; pay_id bigint; prov_name text; txt text;
        refd int := greatest(coalesce(p_refunded, 0), 0); nref text;
begin
  if p_status not in ('approved','refunded','cancelled','charged_back','in_mediation') then raise exception 'bad_status'; end if;
  select * into pm from public.payments where mp_payment_id = p_payment_id for update;
  if pm.id is null then
    -- aviso de un pago que no está registrado (por ejemplo, de antes del Bloque 1): queda para revisar
    if p_status = 'approved' then return jsonb_build_object('status', 'unknown_payment'); end if;
    insert into public.payments (mp_payment_id, provider_id, amount, mp_status, mp_status_detail, refunded_mp, outcome, review_reasons)
    values (p_payment_id, coalesce(p_provider, (select min(provider_id) from public.bookings where mp_payment_id = p_payment_id)),
            0, p_status, left(p_status_detail, 60), refd, 'review', array['unregistered_' || p_status])
    on conflict (mp_payment_id) do nothing returning id into pay_id;
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'review', 'payment', pay_id);
  end if;
  perform public.payment_log(pm.id, p_raw);
  select coalesce(sum(amount) filter (where status in ('done','resolved')), 0), coalesce(sum(amount) filter (where status in ('pending','failed')), 0)
    into done_sum, pend_sum from public.refunds where payment_id = pm.id;
  reasons := pm.review_reasons;
  select name into prov_name from public.providers where id = pm.provider_id;
  -- aviso nuevo por cada vez que pasa (un segundo reclamo del mismo pago es otro aviso)
  nref := p_payment_id || coalesce('#' || nullif((select count(*) from public.provider_notices
                                                  where provider_id = pm.provider_id and (ref = p_payment_id or ref like p_payment_id || '#%')), 0) + 1, '');

  if p_status = 'approved' then
    -- devolución parcial: tiene que coincidir con las de la app (hechas, o hechas + en curso)
    if refd > 0 and refd <> done_sum and refd <> done_sum + pend_sum and not ('partial_refund_mismatch' = any(reasons)) then
      reasons := array_append(reasons, 'partial_refund_mismatch');
    end if;
    update public.payments set mp_status = 'approved', refunded_mp = refd, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons,
           outcome = case when cardinality(reasons) > cardinality(pm.review_reasons) then 'review' else outcome end,
           review_resolved_at = case when cardinality(reasons) > cardinality(pm.review_reasons) then null else review_resolved_at end,
           updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;
  if pm.mp_status = p_status then return jsonb_build_object('status', 'already_processed', 'payment', pm.id); end if;

  if p_status = 'in_mediation' then
    if not ('in_mediation' = any(reasons)) then reasons := array_append(reasons, 'in_mediation'); end if;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, 'mp_in_mediation', nref,
            'El cliente abrió un reclamo en Mercado Pago por el pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) ||
            '). Respondelo desde tu cuenta de Mercado Pago. Tus turnos siguen como están.')
    on conflict do nothing;
    update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons, outcome = 'review',
           review_resolved_at = null, review_resolved_by = null, updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;

  -- refunded / cancelled / charged_back: Mercado Pago ya le devolvió la plata al cliente.
  -- Si la app ya había pedido devolver todo, el aviso es la confirmación de esas devoluciones.
  ours := done_sum + pend_sum;
  if p_status = 'charged_back' and not ('charged_back' = any(reasons)) then reasons := array_append(reasons, 'charged_back'); end if;
  for r in select * from public.bookings where payment_id = pm.id and status = 'confirmed' and starts_at > now() order by starts_at for update loop
    update public.bookings set status = 'cancelled_refunded', hold_expires_at = null where id = r.id;
    perform public.stamp_refund(r.id);
    n := n + 1;
    if r.client_id is not null then
      txt := case when p_status = 'charged_back'
                  then 'Por el contracargo de tu pago en Mercado Pago, tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado.'
                  else 'Mercado Pago te devolvió el pago, así que tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado. Si querés, reservá de nuevo.' end;
      insert into public.client_messages (provider_id, user_id, body, kind, ref)
      values (r.provider_id, r.client_id, left(txt, 600), 'cancel', r.id::text) on conflict do nothing;
    end if;
  end loop;
  -- las devoluciones que la app tenía en curso: si cubrían todo el pago, son las que Mercado Pago acaba de informar (hechas);
  -- si no, ya no hacen falta (Mercado Pago devolvió el pago entero)
  for r in update public.refunds set status = case when ours >= pm.amount then 'done' else 'cancelled' end,
                  done_at = case when ours >= pm.amount then now() end,
                  last_error = case when ours >= pm.amount then null else 'Mercado Pago ya devolvió el pago (' || p_status || ')' end
            where payment_id = pm.id and status in ('pending','failed') returning booking_id, amount loop
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
  end loop;
  if p_status = 'charged_back' or ours < pm.amount then
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, case when p_status = 'charged_back' then 'mp_charged_back' else 'mp_refunded' end, nref,
            case when p_status = 'charged_back'
                 then 'El cliente pidió un contracargo del pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') a su banco.'
                 else 'El pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') se devolvió desde Mercado Pago.' end ||
            case when n > 0 then ' Se cancel' || case when n = 1 then 'ó 1 turno futuro' else 'aron ' || n || ' turnos futuros' end || ' de ese pago.' else '' end)
    on conflict do nothing;
  end if;
  update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), refunded_mp = greatest(refd, refunded_mp),
         review_reasons = reasons, outcome = case when cardinality(reasons) > 0 then 'review' else outcome end,
         review_resolved_at = case when p_status = 'charged_back' then null else review_resolved_at end, updated_at = now()
   where id = pm.id;
  return jsonb_build_object('status', 'ok', 'payment', pm.id, 'cancelled', n, 'ours', ours >= pm.amount);
end $$;

-- ---------- Cancelación del prestador: bloquea primero el pago y después el turno ----------
-- Mismo orden que payment_mp_update (pago → turnos): así dos operaciones sobre el mismo pago no se cruzan.
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int; pay_id bigint;
begin
  select payment_id into pay_id from public.bookings where id = p_booking;
  if pay_id is not null then perform 1 from public.payments where id = pay_id for update; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  back := b.paid_mp + least(b.client_fee, b.app_fee);
  update public.bookings set status = 'cancelled_provider', hold_expires_at = null where id = b.id;
  perform public.refund_request(b.id, null, back, 'provider_cancelled');
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

-- ---------- El cliente ve también las devoluciones de sus pagos sin turno ----------
drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin())
         or exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = (select auth.uid()))
         or exists (select 1 from public.payments p where p.id = payment_id and p.client_id = (select auth.uid())));

-- ---------- "Para revisar": lo que falta devolver de cada pago y los avisos descartados ----------
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
             pm.collector_id, (pm.mp_account_id is not null) as refundable_from_app,
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
    'webhook_events', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.created_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.created_at > now() - interval '30 days'
      order by e.created_at desc limit 50) x));
end $$;

-- ---------- admin_stats: las señas del mes cuentan solo lo que quedó cobrado ----------
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
    -- Bloque 1: solo las señas que quedaron cobradas (no las devueltas: cancelaciones del prestador, pagos tardíos, devoluciones desde MP)
    'deposits_month', (select coalesce(sum(paid_mp),0) from public.bookings where source = 'app' and paid_mp > 0 and created_at >= m0
                        and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider))),
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

-- ---------- Permisos de ejecución ----------
revoke execute on function public.mp_account_refresh_claim(bigint, int), public.mp_account_refreshed(bigint, text, text, int),
  public.mp_account_error(bigint, text, boolean), public.mp_webhook_event(text, bigint, bigint, text),
  public.payment_review(text, bigint, text, bigint[], int, text, jsonb), public.mp_clean(jsonb),
  public.admin_refund_create(bigint, bigint, int, text),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.confirm_payment_core(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.admin_review()
  from public, anon, authenticated;
grant execute on function public.admin_refund_create(bigint, bigint, int, text), public.admin_review(), public.admin_stats() to authenticated;
grant execute on function public.mp_account_refresh_claim(bigint, int), public.mp_account_refreshed(bigint, text, text, int),
  public.mp_account_error(bigint, text, boolean), public.mp_webhook_event(text, bigint, bigint, text),
  public.payment_review(text, bigint, text, bigint[], int, text, jsonb),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint)
  to service_role;

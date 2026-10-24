-- =====================================================================
-- TuTiempo · Bloque 1 · Cobros sin plata en el limbo (H01 a H05, H23; decisiones D15 a D21)
-- - mp_accounts: una llave de Mercado Pago por prestador y cuenta. Solo la "active" crea cobros; las demás quedan
--   para devoluciones y consultas hasta que no hagan falta (después se borran solas).
-- - payments: cada pago aprobado, con la cuenta que lo cobró y lo que respondió Mercado Pago. payment_bookings: lo
--   que se cobró por cada turno. refunds: cada devolución, con sus intentos.
-- - confirm_payment nunca falla ante un pago aprobado: confirma lo que se puede y lo demás queda para devolver o
--   para revisar, siempre ligado al pago.
-- No borra datos: provider_secrets queda intacta y sin uso (D21); se copia a mp_accounts.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Estado nuevo del turno: el pago se devolvió (o hubo contracargo) desde Mercado Pago (D17, D18) ----------
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('hold','confirmed','done','no_show','cancelled_client','cancelled_provider','cancelled_refunded','expired'));

-- ---------- Cuentas de Mercado Pago (llaves) ----------
create table if not exists public.mp_accounts (
  id              bigint generated always as identity primary key,
  provider_id     bigint not null references public.providers(id) on delete cascade,
  mp_user_id      text check (char_length(mp_user_id) between 1 and 40),   -- null: cuenta de antes del Bloque 1 sin id
  status          text not null default 'active' check (status in ('active','refunds_only','purged')),
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  connected_at    timestamptz not null default now(),
  disconnected_at timestamptz,
  purged_at       timestamptz,
  refreshed_at    timestamptz,
  last_error      text check (char_length(last_error) <= 300),
  legacy          boolean not null default false,   -- copiada de provider_secrets (antes del Bloque 1)
  unique (provider_id, mp_user_id)
);
-- una sola cuenta que cobra por prestador
create unique index if not exists mp_accounts_one_active on public.mp_accounts (provider_id) where status = 'active';
create index if not exists mp_accounts_expiring on public.mp_accounts (expires_at) where status <> 'purged';
alter table public.mp_accounts enable row level security;
revoke all on public.mp_accounts from public, anon, authenticated;
grant select, insert, update on public.mp_accounts to service_role;

-- Las llaves de antes del Bloque 1 (provider_secrets) se copian una sola vez; provider_secrets no se toca (D21).
insert into public.mp_accounts (provider_id, mp_user_id, status, access_token, refresh_token, expires_at, disconnected_at, legacy)
select s.provider_id, nullif(pp.mp_user_id, ''),
       case when coalesce(pp.mp_connected, false) and p.status <> 'deleted' then 'active' else 'refunds_only' end,
       s.mp_access_token, s.mp_refresh_token, s.mp_expires_at,
       case when coalesce(pp.mp_connected, false) and p.status <> 'deleted' then null else now() end, true
from public.provider_secrets s
join public.providers p on p.id = s.provider_id
left join public.provider_private pp on pp.provider_id = s.provider_id
where s.mp_access_token is not null
  and not exists (select 1 from public.mp_accounts a where a.provider_id = s.provider_id);

-- provider_private.mp_connected y mp_user_id reflejan la cuenta que cobra (los leen el panel y el admin)
create or replace function public.mp_accounts_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  update public.provider_private pp set
    mp_connected = exists (select 1 from public.mp_accounts a where a.provider_id = pid and a.status = 'active'),
    mp_user_id = coalesce((select a.mp_user_id from public.mp_accounts a where a.provider_id = pid and a.status = 'active'), pp.mp_user_id)
  where pp.provider_id = pid;
  return null;
end $$;
drop trigger if exists mp_accounts_sync on public.mp_accounts;
create trigger mp_accounts_sync after insert or update of status, mp_user_id or delete on public.mp_accounts
  for each row execute function public.mp_accounts_sync();

-- ¿Puede cobrar hoy? (cuenta activa con llave vigente). No expone datos de la cuenta.
create or replace function public.provider_can_charge(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mp_accounts a where a.provider_id = pid and a.status = 'active'
                 and a.access_token is not null and (a.expires_at is null or a.expires_at > now()))
$$;

-- ---------- Pagos ----------
create table if not exists public.payments (
  id                 bigint generated always as identity primary key,
  mp_payment_id      text not null unique check (char_length(mp_payment_id) between 1 and 40),
  provider_id        bigint references public.providers(id) on delete restrict,
  mp_account_id      bigint references public.mp_accounts(id) on delete restrict,   -- la cuenta que cobró
  collector_id       text check (char_length(collector_id) <= 40),                  -- lo que informó Mercado Pago
  client_id          uuid references auth.users(id) on delete set null,
  booking_ids        bigint[] not null default '{}',     -- lo que vino en external_reference
  amount             integer not null check (amount >= 0),
  fee_expected       integer not null default 0 check (fee_expected >= 0),   -- comisión calculada por la base
  fee_mp             integer check (fee_mp >= 0),                            -- la que informó Mercado Pago (application_fee)
  refunded_mp        integer not null default 0 check (refunded_mp >= 0),    -- lo devuelto según Mercado Pago
  mp_status          text not null default 'approved' check (mp_status in ('approved','refunded','cancelled','charged_back','in_mediation')),
  mp_status_detail   text check (char_length(mp_status_detail) <= 60),
  outcome            text not null default 'confirmed' check (outcome in ('confirmed','partial','refund','review')),
  review_reasons     text[] not null default '{}',
  review_resolved_at timestamptz,
  review_resolved_by uuid references auth.users(id) on delete set null,
  review_note        text check (char_length(review_note) <= 500),
  mp_responses       jsonb not null default '[]' check (jsonb_typeof(mp_responses) = 'array'),   -- últimas consultas a MP, sin datos de tarjeta
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payments_provider on public.payments (provider_id, created_at desc);
create index if not exists payments_client on public.payments (client_id, created_at desc) where client_id is not null;
create index if not exists payments_account on public.payments (mp_account_id, created_at desc);
create index if not exists payments_review on public.payments (created_at) where outcome = 'review' and review_resolved_at is null;

-- Lo que se cobró por cada turno de un pago (seña + comisión): el tope de lo que se le puede devolver.
create table if not exists public.payment_bookings (
  payment_id bigint not null references public.payments(id) on delete restrict,
  booking_id bigint not null references public.bookings(id) on delete restrict,
  amount     integer not null check (amount >= 0),
  fee        integer not null default 0 check (fee >= 0),
  result     text not null check (result in ('confirmed','refund')),
  reason     text check (char_length(reason) <= 40),
  primary key (payment_id, booking_id)
);
create index if not exists payment_bookings_booking on public.payment_bookings (booking_id);

alter table public.bookings add column if not exists payment_id bigint references public.payments(id) on delete restrict;
create index if not exists bookings_payment on public.bookings (payment_id) where payment_id is not null;

-- ---------- Devoluciones ----------
create table if not exists public.refunds (
  id               bigint generated always as identity primary key,
  payment_id       bigint references public.payments(id) on delete restrict,
  booking_id       bigint references public.bookings(id) on delete restrict,
  provider_id      bigint references public.providers(id) on delete restrict,
  mp_payment_id    text check (char_length(mp_payment_id) <= 40),   -- el de payments o, en turnos viejos, bookings.mp_payment_id
  mp_account_id    bigint references public.mp_accounts(id) on delete restrict,   -- la cuenta que cobró
  amount           integer not null check (amount > 0),
  reason           text not null check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking')),
  status           text not null default 'pending' check (status in ('pending','done','failed','resolved','cancelled')),
  attempts         smallint not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at  timestamptz,
  next_attempt_at  timestamptz not null default now(),
  last_error       text check (char_length(last_error) <= 300),
  mp_refund_id     text check (char_length(mp_refund_id) <= 40),
  done_at          timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,
  resolved_note    text check (char_length(resolved_note) <= 500),
  created_at       timestamptz not null default now(),
  check (payment_id is not null or booking_id is not null)
);
create index if not exists refunds_due on public.refunds (next_attempt_at) where status = 'pending';
create index if not exists refunds_payment on public.refunds (payment_id);
create index if not exists refunds_booking on public.refunds (booking_id);
create index if not exists refunds_account on public.refunds (mp_account_id) where status in ('pending','failed');

-- Nunca devolver más de lo cobrado: ni más que el pago, ni más que lo cobrado por cada turno.
-- Cuentan todas menos las anuladas ('cancelled'): una fallida se puede reintentar y una resuelta a mano ya se arregló.
create or replace function public.refunds_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; used int;
begin
  if new.status = 'cancelled' then return new; end if;
  if new.payment_id is not null then
    perform 1 from public.payments where id = new.payment_id for update;
    select amount into cap from public.payments where id = new.payment_id;
    select coalesce(sum(amount), 0) into used from public.refunds
     where payment_id = new.payment_id and status <> 'cancelled' and id is distinct from new.id;
    if used + new.amount > cap then raise exception 'refund_exceeds_payment' using errcode = 'check_violation'; end if;
    if new.booking_id is not null then
      select amount into cap from public.payment_bookings where payment_id = new.payment_id and booking_id = new.booking_id;
      select coalesce(sum(amount), 0) into used from public.refunds
       where payment_id = new.payment_id and booking_id = new.booking_id and status <> 'cancelled' and id is distinct from new.id;
      if cap is null or used + new.amount > cap then raise exception 'refund_exceeds_booking' using errcode = 'check_violation'; end if;
    end if;
  else
    -- turno de antes del Bloque 1: el tope es lo que se cobró por ese turno
    perform 1 from public.bookings where id = new.booking_id for update;
    select paid_mp + app_fee into cap from public.bookings where id = new.booking_id;
    select coalesce(sum(amount), 0) into used from public.refunds
     where booking_id = new.booking_id and payment_id is null and status <> 'cancelled' and id is distinct from new.id;
    if cap is null or used + new.amount > cap then raise exception 'refund_exceeds_booking' using errcode = 'check_violation'; end if;
  end if;
  return new;
end $$;
drop trigger if exists refunds_cap on public.refunds;
create trigger refunds_cap before insert or update of amount, status, payment_id, booking_id on public.refunds
  for each row execute function public.refunds_cap();

-- RLS: el cliente ve los suyos, el prestador los de su agenda, el admin todo. Solo escriben las funciones del servidor.
alter table public.payments enable row level security;
alter table public.payment_bookings enable row level security;
alter table public.refunds enable row level security;
revoke all on public.payments, public.payment_bookings, public.refunds from public, anon, authenticated;
grant select (id, mp_payment_id, provider_id, client_id, booking_ids, amount, fee_expected, refunded_mp, mp_status, outcome, created_at)
  on public.payments to authenticated;
grant select on public.payment_bookings to authenticated;
grant select (id, payment_id, booking_id, provider_id, amount, reason, status, done_at, created_at) on public.refunds to authenticated;
grant select, insert, update on public.payments, public.payment_bookings, public.refunds to service_role;
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (client_id = (select auth.uid()) or provider_id = (select public.my_provider()) or (select public.is_admin()));
drop policy if exists payment_bookings_read on public.payment_bookings;
create policy payment_bookings_read on public.payment_bookings for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id
                 and (p.client_id = (select auth.uid()) or p.provider_id = (select public.my_provider()) or (select public.is_admin()))));
drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin())
         or exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = (select auth.uid())));

-- ---------- Avisos al prestador (pagos devueltos desde Mercado Pago, contracargos, reclamos) ----------
create table if not exists public.provider_notices (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  kind        text not null check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation')),
  ref         text not null check (char_length(ref) <= 40),
  body        text not null check (char_length(body) between 1 and 600),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (provider_id, kind, ref)
);
alter table public.provider_notices enable row level security;
revoke all on public.provider_notices from public, anon, authenticated;
grant select on public.provider_notices to authenticated;
grant select, insert, update on public.provider_notices to service_role;
drop policy if exists provider_notices_read on public.provider_notices;
create policy provider_notices_read on public.provider_notices for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin()));

alter table public.client_messages drop constraint if exists client_messages_kind_check;
alter table public.client_messages add constraint client_messages_kind_check
  check (kind in ('msg','conf','r24','r2','rev','bday','cancel'));

-- ---------- Ayudas ----------
create or replace function public.money_txt(n int) returns text language sql immutable as $$
  select '$' || replace(to_char(coalesce(n, 0), 'FM999,999,999'), ',', '.')
$$;
-- "sábado 24/10 a las 17:30" en la hora del prestador
create or replace function public.booking_when(bid bigint) returns text
language sql stable security definer set search_path = public as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from lt)::int + 1] || ' ' ||
         extract(day from lt)::int || '/' || extract(month from lt)::int || ' a las ' || to_char(lt, 'HH24:MI')
  from (select b.starts_at at time zone public.provider_tz(b.provider_id) as lt from public.bookings b where b.id = bid) x
$$;
-- respuesta de Mercado Pago sin datos de tarjeta ni del documento del pagador
create or replace function public.mp_clean(p jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p) <> 'object' then null else
    (p - 'card' - 'barcode' - 'transaction_details' ||
     case when jsonb_typeof(p->'payer') = 'object' then jsonb_build_object('payer', (p->'payer') - 'identification' - 'phone' - 'first_name' - 'last_name') else '{}'::jsonb end)
  end
$$;
-- guarda la consulta en el pago (las últimas 20)
create or replace function public.payment_log(p_id bigint, p_raw jsonb) returns void
language sql security definer set search_path = public as $$
  update public.payments set
    mp_responses = (select coalesce(jsonb_agg(e order by n), '[]') from (
                      select e, n from jsonb_array_elements(mp_responses || jsonb_build_array(jsonb_build_object('at', now(), 'body', public.mp_clean(p_raw))))
                        with ordinality as t(e, n)
                      order by n desc limit 20) last20),
    updated_at = now()
  where id = p_id and p_raw is not null and jsonb_typeof(p_raw) = 'object'
$$;

-- Pide una devolución: suma al turno lo que falta devolver y crea la fila en refunds, ligada al pago y a la cuenta
-- que cobró. Turnos de antes del Bloque 1: usa bookings.mp_payment_id (el del turno o el del primero de su serie).
create or replace function public.refund_request(p_booking bigint, p_payment bigint, p_amount int, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b record; pay_id bigint := p_payment; mpid text; acct bigint; pid bigint; rid bigint;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  if p_booking is not null then
    select * into b from public.bookings where id = p_booking;
    pay_id := coalesce(pay_id, b.payment_id);
    pid := b.provider_id;
  end if;
  if pay_id is not null then
    select mp_payment_id, mp_account_id, coalesce(pid, provider_id) into mpid, acct, pid from public.payments where id = pay_id;
  elsif b.id is not null then
    mpid := coalesce(b.mp_payment_id, (select x.mp_payment_id from public.bookings x
                                        where b.series_id is not null and x.series_id = b.series_id and x.mp_payment_id is not null
                                        order by x.starts_at limit 1));
    -- la llave de antes del Bloque 1 es la que cobró esos turnos; si no está, la activa
    acct := (select a.id from public.mp_accounts a where a.provider_id = b.provider_id and a.status <> 'purged'
             order by a.legacy desc, (a.status = 'active') desc, a.connected_at desc limit 1);
  end if;
  insert into public.refunds (payment_id, booking_id, provider_id, mp_payment_id, mp_account_id, amount, reason, status, last_error)
  values (pay_id, p_booking, pid, mpid, acct, p_amount, p_reason,
          case when mpid is null then 'failed' else 'pending' end,
          case when mpid is null then 'No hay un pago de Mercado Pago ligado a este turno' end)
  returning id into rid;
  if p_booking is not null then
    update public.bookings set refund_pending = refund_pending + p_amount where id = p_booking;
  end if;
  return rid;
end $$;

-- ---------- Confirmar un pago aprobado (lo llama SOLO el webhook, con service_role) ----------
drop function if exists public.confirm_payment(bigint[], text, int);
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
  exception when others then
    -- nunca falla ante un pago aprobado: queda registrado para revisar, con el error
    pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(coalesce(p_booking_ids, '{}'))));
    insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, booking_ids, amount, outcome, review_reasons, mp_status_detail)
    values (p_payment_id, pid, p_account, left(p_collector, 40), coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review',
            array['error: ' || left(sqlerrm, 200)], left(p_status_detail, 60))
    on conflict (mp_payment_id) do nothing
    returning id into pay_id;
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'review', 'payment', pay_id, 'error', sqlerrm);
  end;
end $$;

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
        -- el turno queda como "canceló el prestador" con lo cobrado, como en la v31 (el cliente ve que se le devuelve)
        update public.bookings set status = case when why = 'slot_taken' then 'cancelled_provider' else 'expired' end,
               hold_expires_at = null, payment_id = pay_id, paid_mp = pay - fee_part, app_fee = fee_part
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

-- ---------- Cambios de estado del pago en Mercado Pago (D17, D18) ----------
-- p_status: approved (con o sin devoluciones parciales), refunded, cancelled, charged_back, in_mediation.
create or replace function public.payment_mp_update(p_payment_id text, p_status text, p_refunded int default 0,
                                                    p_status_detail text default null, p_raw jsonb default null,
                                                    p_provider bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pm record; r record; ours int; done_sum int; pend_sum int; n int := 0; reasons text[]; pay_id bigint; prov_name text; txt text;
        refd int := greatest(coalesce(p_refunded, 0), 0);
begin
  if p_status not in ('approved','refunded','cancelled','charged_back','in_mediation') then raise exception 'bad_status'; end if;
  select * into pm from public.payments where mp_payment_id = p_payment_id for update;
  if pm.id is null then
    -- aviso de un pago que no está registrado (por ejemplo, de antes del Bloque 1): queda para revisar
    if p_status = 'approved' then return jsonb_build_object('status', 'unknown_payment'); end if;
    insert into public.payments (mp_payment_id, provider_id, amount, mp_status, mp_status_detail, refunded_mp, outcome, review_reasons)
    values (p_payment_id, coalesce(p_provider, (select provider_id from public.bookings where mp_payment_id = p_payment_id)),
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

  if p_status = 'approved' then
    -- devolución parcial: tiene que coincidir con las de la app (hechas, o hechas + en curso)
    if refd > 0 and refd <> done_sum and refd <> done_sum + pend_sum and not ('partial_refund_mismatch' = any(reasons)) then
      reasons := array_append(reasons, 'partial_refund_mismatch');
    end if;
    update public.payments set refunded_mp = refd, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons,
           outcome = case when cardinality(reasons) > cardinality(pm.review_reasons) then 'review' else outcome end, updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;
  if pm.mp_status = p_status then return jsonb_build_object('status', 'already_processed', 'payment', pm.id); end if;

  if p_status = 'in_mediation' then
    reasons := array_append(reasons, 'in_mediation');
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, 'mp_in_mediation', p_payment_id,
            'El cliente abrió un reclamo en Mercado Pago por el pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) ||
            '). Respondelo desde tu cuenta de Mercado Pago. Tus turnos siguen como están.')
    on conflict do nothing;
    update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons, outcome = 'review', updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;

  -- refunded / cancelled / charged_back: Mercado Pago ya le devolvió la plata al cliente.
  -- Si la app ya había pedido devolver todo, el aviso es la confirmación de esas devoluciones.
  ours := done_sum + pend_sum;
  if p_status = 'charged_back' then reasons := array_append(reasons, 'charged_back'); end if;
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
    values (pm.provider_id, case when p_status = 'charged_back' then 'mp_charged_back' else 'mp_refunded' end, p_payment_id,
            case when p_status = 'charged_back'
                 then 'El cliente pidió un contracargo del pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') a su banco.'
                 else 'El pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') se devolvió desde Mercado Pago.' end ||
            case when n > 0 then ' Se cancel' || case when n = 1 then 'ó 1 turno futuro' else 'aron ' || n || ' turnos futuros' end || ' de ese pago.' else '' end)
    on conflict do nothing;
  end if;
  update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), refunded_mp = greatest(refd, refunded_mp),
         review_reasons = reasons, outcome = case when cardinality(reasons) > 0 then 'review' else outcome end, updated_at = now()
   where id = pm.id;
  return jsonb_build_object('status', 'ok', 'payment', pm.id, 'cancelled', n, 'ours', ours >= pm.amount);
end $$;

-- ---------- Ejecución de devoluciones (mp-refunds) ----------
-- Devoluciones que tocan ahora, con el id de pago y la cuenta que cobró (la llave la busca la función).
create or replace function public.refunds_due(p_limit int default 50)
returns table (id bigint, amount int, mp_payment_id text, mp_account_id bigint, provider_id bigint, attempts smallint)
language sql stable security definer set search_path = public as $$
  select r.id, r.amount, r.mp_payment_id, r.mp_account_id, r.provider_id, r.attempts from public.refunds r
  where r.status = 'pending' and r.next_attempt_at <= now()
  order by r.next_attempt_at, r.id limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Resultado de cada intento. Si falla, se reintenta con backoff (D19): 10 min, 30 min, 1 h, 3 h, 6 h, 12 h y después cada
-- 24 h; cuando el próximo intento caería después de los 3 días del primero, queda como fallida.
create or replace function public.refund_result(p_refund bigint, p_ok boolean, p_mp_refund_id text default null, p_error text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare r record; nxt timestamptz; first_at timestamptz;
begin
  select * into r from public.refunds where id = p_refund for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then return r.status; end if;
  if p_ok then
    update public.refunds set status = 'done', done_at = now(), mp_refund_id = left(p_mp_refund_id, 40), attempts = attempts + 1,
           first_attempt_at = coalesce(first_attempt_at, now()), last_attempt_at = now(), last_error = null
     where id = r.id;
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
    return 'done';
  end if;
  first_at := coalesce(r.first_attempt_at, now());
  nxt := now() + case r.attempts + 1 when 1 then interval '10 minutes' when 2 then interval '30 minutes' when 3 then interval '1 hour'
                                     when 4 then interval '3 hours' when 5 then interval '6 hours' when 6 then interval '12 hours'
                                     else interval '24 hours' end;
  update public.refunds set attempts = attempts + 1, first_attempt_at = first_at, last_attempt_at = now(),
         last_error = left(coalesce(p_error, 'Error sin detalle'), 300),
         next_attempt_at = nxt, status = case when nxt > first_at + interval '3 days' then 'failed' else 'pending' end
   where id = r.id;
  return case when nxt > first_at + interval '3 days' then 'failed' else 'pending' end;
end $$;

-- ---------- Conectar y desconectar Mercado Pago ----------
-- Lo llama mp-oauth al volver de Mercado Pago. La misma cuenta actualiza su llave; otra cuenta crea una fila nueva y la
-- anterior queda para devoluciones y consultas (nunca se pisa la llave de otra cuenta).
create or replace function public.mp_connect(p_provider bigint, p_mp_user_id text, p_access text, p_refresh text, p_expires_in int)
returns bigint
language plpgsql security definer set search_path = public as $$
declare acct bigint; uidtxt text := nullif(left(btrim(coalesce(p_mp_user_id, '')), 40), '');
begin
  if not exists (select 1 from public.providers where id = p_provider and status <> 'deleted') then raise exception 'not_found'; end if;
  if coalesce(p_access, '') = '' then raise exception 'bad_token'; end if;
  if uidtxt is null then raise exception 'bad_account'; end if;
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now()
   where provider_id = p_provider and status = 'active' and mp_user_id is distinct from uidtxt;
  insert into public.mp_accounts as a (provider_id, mp_user_id, status, access_token, refresh_token, expires_at, connected_at, refreshed_at)
  values (p_provider, uidtxt, 'active', p_access, p_refresh,
          case when p_expires_in > 0 then now() + make_interval(secs => p_expires_in) end, now(), now())
  on conflict (provider_id, mp_user_id) do update set status = 'active', access_token = excluded.access_token,
     refresh_token = coalesce(excluded.refresh_token, a.refresh_token), expires_at = excluded.expires_at,
     connected_at = now(), refreshed_at = now(), disconnected_at = null, purged_at = null, last_error = null
  returning id into acct;
  return acct;
end $$;

-- El prestador desconecta: deja de cobrar en el acto. Las reservas en pago que todavía no fueron a Mercado Pago se
-- liberan; las que ya tienen el cobro creado siguen hasta vencer (si se pagan, confirm_payment las procesa).
create or replace function public.mp_disconnect() returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now() where provider_id = pid and status = 'active';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'mp_not_connected'; end if;
  update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second'
   where provider_id = pid and status = 'hold' and mp_preference_id is null;
  return public.my_mp_status();
end $$;

-- Lo que ve el prestador: si puede cobrar hoy y lo que todavía depende de cuentas anteriores.
create or replace function public.my_mp_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_charge', public.provider_can_charge(x.pid),
    'account', (select a.mp_user_id from public.mp_accounts a where a.provider_id = x.pid and a.status = 'active'),
    'expired', exists (select 1 from public.mp_accounts a where a.provider_id = x.pid and a.status = 'active' and a.expires_at <= now()),
    'old_accounts', (select count(*) from public.mp_accounts a where a.provider_id = x.pid and a.status = 'refunds_only'),
    'future_paid', (select count(*) from public.bookings b where b.provider_id = x.pid and b.status = 'confirmed' and b.source = 'app'
                     and b.starts_at > now() and b.paid_mp > 0),
    'paying_now', (select count(*) from public.bookings b where b.provider_id = x.pid and b.status = 'hold'
                    and b.mp_preference_id is not null and b.hold_expires_at > now()),
    'refunds_pending', (select count(*) from public.refunds r where r.provider_id = x.pid and r.status in ('pending','failed')))
  from (select public.my_provider() as pid) x where x.pid is not null
$$;

-- Llave que venció y no se pudo renovar (lo llaman las funciones de Mercado Pago)
create or replace function public.mp_account_error(p_account bigint, p_error text, p_expired boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.mp_accounts set last_error = left(p_error, 300),
         status = case when p_expired and status = 'active' then 'refunds_only' else status end,
         disconnected_at = case when p_expired and status = 'active' then now() else disconnected_at end
  where id = p_account
$$;

-- Borra las llaves que ya no hacen falta: cuentas desconectadas (o de prestadores eliminados) sin reservas en pago,
-- sin turnos futuros pagados con esa cuenta, sin devoluciones pendientes o fallidas y sin pagos de los últimos 180 días
-- (contracargos y reclamos). La fila queda (sin llave) para saber qué cuenta cobró cada pago.
create or replace function public.purge_mp_accounts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.mp_accounts a set status = 'refunds_only', disconnected_at = now()
    from public.providers p where p.id = a.provider_id and p.status = 'deleted' and a.status = 'active';
  with gone as (
    update public.mp_accounts a set status = 'purged', access_token = null, refresh_token = null, purged_at = now()
    where a.status = 'refunds_only'
      and not exists (select 1 from public.bookings b where b.provider_id = a.provider_id and b.status = 'hold'
                      and b.mp_preference_id is not null and b.hold_expires_at > now() - interval '1 hour')
      and not exists (select 1 from public.bookings b join public.payments p on p.id = b.payment_id
                      where p.mp_account_id = a.id and b.status = 'confirmed' and b.starts_at > now() and b.paid_mp > 0)
      and not exists (select 1 from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed'))
      and not exists (select 1 from public.payments p where p.mp_account_id = a.id and p.created_at > now() - interval '180 days')
      -- turnos de antes del Bloque 1 (sin payments): los cobró la llave copiada de provider_secrets
      and not (a.legacy and exists (select 1 from public.bookings b where b.provider_id = a.provider_id and b.payment_id is null
                      and b.mp_payment_id is not null and (b.created_at > now() - interval '180 days' or b.refund_pending > 0
                           or (b.status = 'confirmed' and b.starts_at > now()))))
    returning 1)
  select count(*)::int into n from gone;
  return n;
end $$;
-- nombre viejo (lo llama el cron de 0005): desde el Bloque 1 no toca provider_secrets (D21)
create or replace function public.purge_deleted_secrets() returns int
language sql security definer set search_path = public as $$ select public.purge_mp_accounts() $$;

-- ---------- Reservar: D15 y prestador que no puede cobrar ----------
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
                      or lt::date > (now() at time zone tz)::date + st.ahead_days - 1))
       -- D15: una serie puede pasar los 31 días del turnero, pero ningún turno a más de 90 días desde hoy
       or (i > 0 and lt::date > (now() at time zone tz)::date + 90) then
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

-- ---------- Cancelación del prestador: la devolución queda registrada en refunds ----------
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int;
begin
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

-- ---------- Baja del prestador: su cuenta deja de cobrar y la llave queda para las devoluciones ----------
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
  -- la llave se borra sola (purge_mp_accounts) cuando ya no hace falta para devoluciones ni consultas
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now() where provider_id = pid and status = 'active';
  update public.provider_private set phone = null, dni_number = null, dni_paths = '{}', mp_user_id = null, mp_connected = false where provider_id = pid;
  update public.providers set status = 'deleted', owner_id = null, updated_at = now() where id = pid;
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

-- ---------- Ficha pública y listado: si el prestador no puede cobrar, no toma turnos online ----------
create or replace function public.get_provider(pid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'bio', p.bio, 'address', p.address, 'instagram', p.instagram,
    'hue', p.hue, 'photo_path', p.photo_path, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count, 'followers', p.followers,
    'dni_verified', p.dni_verified, 'tz', c.tz, 'can_charge', public.provider_can_charge(p.id),
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

-- Primer horario libre para las tarjetas del listado: sin cuenta que cobre, no hay horario para ofrecer.
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; h record; t timestamp; now_l timestamp; dd int;
begin
  select * into st from public.provider_settings where provider_id = pid;
  if st is null or not st.online or not public.provider_can_charge(pid) then return null; end if;
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

-- ---------- Mis turnos: estado de la devolución de cada turno ----------
create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
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

-- ---------- Avisos del prestador ----------
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null)
                            order by n.created_at desc), '[]')
  from (select * from public.provider_notices where provider_id = public.my_provider() order by created_at desc limit 30) n
$$;
create or replace function public.mark_provider_notices_read() returns void
language sql security definer set search_path = public as $$
  update public.provider_notices set read_at = now() where provider_id = public.my_provider() and read_at is null
$$;

-- ---------- Panel admin · "Para revisar" (D19, D20) ----------
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
             p.name as provider_name, (select min(b.client_name) from public.bookings b where b.payment_id = pm.id) as client_name
      from public.payments pm left join public.providers p on p.id = pm.provider_id
      where pm.outcome = 'review' and pm.review_resolved_at is null
      order by pm.created_at limit 200) x));
end $$;

-- "Reintentar": la devolución vuelve a la cola ya, con otros 3 días de reintentos
create or replace function public.admin_refund_retry(p_refund bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.refunds set status = 'pending', attempts = 0, first_attempt_at = null, next_attempt_at = now()
   where id = p_refund and status in ('pending','failed') and mp_payment_id is not null;
  if not found then raise exception 'cannot_retry'; end if;
end $$;

-- "Resuelto a mano": exige una nota, registra quién y cuándo, y no dispara ninguna devolución
create or replace function public.admin_resolve(p_kind text, p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare txt text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 500); r record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(txt) < 3 then raise exception 'note_required'; end if;
  if p_kind = 'refund' then
    update public.refunds set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolved_note = txt
     where id = p_id and status in ('pending','failed') returning booking_id, amount into r;
    if r is null then raise exception 'not_found'; end if;
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
  elsif p_kind = 'payment' then
    update public.payments set review_resolved_at = now(), review_resolved_by = auth.uid(), review_note = txt, updated_at = now()
     where id = p_id and outcome = 'review' and review_resolved_at is null;
    if not found then raise exception 'not_found'; end if;
  else
    raise exception 'bad_kind';
  end if;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.mp_accounts_sync(), public.provider_can_charge(bigint), public.refunds_cap(),
  public.money_txt(int), public.booking_when(bigint), public.mp_clean(jsonb), public.payment_log(bigint, jsonb),
  public.refund_request(bigint, bigint, int, text),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.confirm_payment_core(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.refunds_due(int), public.refund_result(bigint, boolean, text, text),
  public.mp_connect(bigint, text, text, text, int), public.mp_disconnect(), public.my_mp_status(), public.mp_account_error(bigint, text, boolean),
  public.purge_mp_accounts(), public.purge_deleted_secrets(), public.my_provider_notices(), public.mark_provider_notices_read(),
  public.admin_review(), public.admin_refund_retry(bigint), public.admin_resolve(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.book_slot(bigint,timestamptz,int,int,text,bigint[],jsonb), public.cancel_by_provider(bigint),
  public.get_provider(bigint), public.next_free_slot(bigint,int) to authenticated;
grant execute on function public.get_provider(bigint), public.next_free_slot(bigint,int) to anon;
grant execute on function public.my_bookings(), public.mp_disconnect(), public.my_mp_status(), public.my_provider_notices(),
  public.mark_provider_notices_read(), public.admin_review(), public.admin_refund_retry(bigint), public.admin_resolve(text, bigint, text)
  to authenticated;
-- solo las Edge Functions (service_role) y el cron
grant execute on function public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.refunds_due(int), public.refund_result(bigint, boolean, text, text),
  public.mp_connect(bigint, text, text, text, int), public.mp_account_error(bigint, text, boolean),
  public.purge_mp_accounts(), public.purge_deleted_secrets()
  to service_role;

-- 11/11 · H06: los avisos de Mercado Pago rechazados por firma.
-- - mp_webhook_events.diag: con qué se armó el texto firmado de un aviso rechazado (de dónde salió data.id, request-id,
--   ts, el texto armado, cuántos v1 trajo y sus primeros 8 caracteres, cuántas claves se probaron). Nunca la clave ni la
--   firma completa. Solo lo lee el admin (como el resto de la tabla).
-- - mp_webhook_status: la última firma válida, por prestador (0: aviso sin prestador). La escribe mp-webhook
--   (mp_webhook_ok) cada vez que una firma valida.
-- - admin_review: el aviso de "Para revisar" sigue mientras haya un rechazo posterior a la última firma válida de ese
--   prestador ('active'); se apaga solo cuando los avisos vuelven a validar. Los descartados, agrupados por motivo
--   ('webhook_groups').

-- ---------- Diagnóstico del rechazo ----------
alter table public.mp_webhook_events add column if not exists diag jsonb;
alter table public.mp_webhook_events drop constraint if exists mp_webhook_events_diag_check;
alter table public.mp_webhook_events add constraint mp_webhook_events_diag_check
  check (diag is null or (jsonb_typeof(diag) = 'object' and octet_length(diag::text) <= 2000));

drop function if exists public.mp_webhook_event(text, bigint, bigint, text, text);
create or replace function public.mp_webhook_event(p_payment_id text, p_provider bigint, p_account bigint, p_reason text,
                                                   p_detail text default null, p_diag jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare pay text := nullif(left(regexp_replace(coalesce(p_payment_id, ''), '[^A-Za-z0-9_-]', '', 'g'), 40), '');
        prov bigint := (select id from public.providers where id = p_provider);
        acc bigint := (select id from public.mp_accounts where id = p_account);
        det text := nullif(left(btrim(regexp_replace(coalesce(p_detail, ''), '[[:cntrl:]<>]', ' ', 'g')), 160), '');
        dg jsonb := case when jsonb_typeof(p_diag) = 'object' then p_diag end;
        hit bigint;
begin
  -- un diagnóstico demasiado largo no se guarda entero: queda la marca
  if dg is not null and octet_length(dg::text) > 2000 then dg := jsonb_build_object('truncated', true); end if;
  if (select count(*) from public.mp_webhook_events where last_at > now() - interval '1 hour') >= 500 then return; end if;
  update public.mp_webhook_events set hits = hits + 1, last_at = now(), detail = coalesce(det, detail), diag = coalesce(dg, diag)
   where id = (select id from public.mp_webhook_events
                where reason = p_reason and mp_payment_id is not distinct from pay and provider_id is not distinct from prov
                  and last_at > now() - interval '24 hours'
                order by last_at desc limit 1)
  returning id into hit;
  if hit is null then
    insert into public.mp_webhook_events (mp_payment_id, provider_id, mp_account_id, reason, detail, diag)
    values (pay, prov, acc, p_reason, det, dg);
  end if;
end $$;

-- ---------- Última firma válida ----------
create table if not exists public.mp_webhook_status (
  provider_key bigint primary key,                       -- providers.id, o 0 si el aviso no dice de qué prestador es
  last_ok_at   timestamptz not null default now(),
  last_ok_via  text check (char_length(last_ok_via) <= 80),   -- con qué variante validó ('principal' si es la documentada)
  ok_hits      bigint not null default 1
);
alter table public.mp_webhook_status enable row level security;
revoke all on public.mp_webhook_status from public, anon, authenticated;
grant select on public.mp_webhook_status to authenticated;
grant select, insert, update on public.mp_webhook_status to service_role;
drop policy if exists mp_webhook_status_read on public.mp_webhook_status;
create policy mp_webhook_status_read on public.mp_webhook_status for select to authenticated using ((select public.is_admin()));

create or replace function public.mp_webhook_ok(p_provider bigint, p_via text) returns void
language sql security definer set search_path = public as $$
  insert into public.mp_webhook_status as s (provider_key, last_ok_at, last_ok_via)
  values (coalesce((select id from public.providers where id = p_provider), 0), now(),
          nullif(left(regexp_replace(coalesce(p_via, ''), '[[:cntrl:]<>]', ' ', 'g'), 80), ''))
  on conflict (provider_key) do update set last_ok_at = now(), last_ok_via = excluded.last_ok_via,
                                           ok_hits = least(s.ok_hits + 1, 1000000000)
$$;
revoke execute on function public.mp_webhook_ok(bigint, text) from public, anon, authenticated;
grant execute on function public.mp_webhook_ok(bigint, text) to service_role;
revoke execute on function public.mp_webhook_event(text, bigint, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mp_webhook_event(text, bigint, bigint, text, text, jsonb) to service_role;

-- ¿un rechazo sigue sin una firma válida después? La del mismo prestador; un rechazo sin prestador, cualquiera.
create or replace function public.mp_webhook_rejected_open(p_provider bigint, p_last timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select p_last > coalesce(case when p_provider is null then (select max(last_ok_at) from public.mp_webhook_status)
                                else (select last_ok_at from public.mp_webhook_status where provider_key = p_provider) end,
                           '-infinity'::timestamptz)
$$;
revoke execute on function public.mp_webhook_rejected_open(bigint, timestamptz) from public, anon, authenticated;

-- ---------- Para revisar: igual que en 20261101120000_cobro_d30.sql, con el diagnóstico, los grupos y 'active' ----------
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
    -- los descartados de los últimos 30 días (el detalle de cada uno, con su diagnóstico)
    'webhook_events', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.detail, e.diag, e.hits, e.created_at, e.last_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.last_at > now() - interval '30 days'
      order by e.last_at desc limit 200) x),
    -- y agrupados por motivo: cuántos avisos (hits), en cuántos registros y el último
    'webhook_groups', (select coalesce(jsonb_agg(x order by x.last_at desc), '[]') from (
      select e.reason, sum(e.hits) as hits, count(*) as rows, max(e.last_at) as last_at
      from public.mp_webhook_events e
      where e.last_at > now() - interval '30 days'
      group by e.reason) x),
    -- avisos rechazados antes de procesar (casi siempre, Mercado Pago mal configurado) y pagos sin aviso, últimos 7 días.
    -- 'active': hay un rechazo sin una firma válida después (del mismo prestador): el aviso sigue hasta que vuelvan a validar.
    'webhook_alert', (select jsonb_build_object(
        'rejected', coalesce(sum(e.hits) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')), 0),
        'rejected_last', max(e.last_at) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')),
        'rejected_reason', (select e2.reason from public.mp_webhook_events e2
                             where e2.last_at > now() - interval '7 days'
                               and e2.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')
                             order by e2.last_at desc limit 1),
        'active', coalesce(bool_or(public.mp_webhook_rejected_open(e.provider_id, e.last_at))
                             filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error')), false),
        'last_ok', (select max(s.last_ok_at) from public.mp_webhook_status s),
        'recovered', count(*) filter (where e.reason = 'recovered'),
        'recovered_last', max(e.last_at) filter (where e.reason = 'recovered'))
      from public.mp_webhook_events e where e.last_at > now() - interval '7 days'));
end $$;
grant execute on function public.admin_review() to authenticated;

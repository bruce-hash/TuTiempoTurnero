-- 11/11 · H06 (causa encontrada): los avisos rechazados por firma eran los IPN (formato viejo, ?id=…&topic=payment) que
-- Mercado Pago manda a la notification_url además de los de formato Webhooks (?data.id=…&type=payment). Los IPN no se
-- firman con la clave de Webhooks. Desde ahora las preferencias piden solo Webhooks (source_news=webhooks) y un IPN que
-- llegue igual (de un cobro abierto antes) queda como 'ipn_ignored': se responde 200 (Mercado Pago no reintenta), se
-- adelanta la consulta de los cobros del prestador y no se usa para nada más. Sigue prendiendo el aviso de "Para
-- revisar" hasta que valide un aviso con formato Webhooks del mismo prestador.

alter table public.mp_webhook_events drop constraint if exists mp_webhook_events_reason_check;
alter table public.mp_webhook_events add constraint mp_webhook_events_reason_check check (reason in (
  'unknown_provider','payment_not_found','wrong_collector','bad_currency',            -- después de consultar el pago
  'bad_signature','stale_signature','no_signature','bad_request','config_error',     -- antes de procesar (rechazados)
  'ipn_ignored',                                                                      -- aviso IPN sin firma válida (11/11)
  'recovered'));                                                                      -- pago sin aviso, lo encontró mp-reconcile

-- ---------- Para revisar: igual que en 20261111000000_mp_firma.sql, con 'ipn_ignored' entre los rechazados ----------
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
        'rejected', coalesce(sum(e.hits) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error','ipn_ignored')), 0),
        'rejected_last', max(e.last_at) filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error','ipn_ignored')),
        'rejected_reason', (select e2.reason from public.mp_webhook_events e2
                             where e2.last_at > now() - interval '7 days'
                               and e2.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error','ipn_ignored')
                             order by e2.last_at desc limit 1),
        'active', coalesce(bool_or(public.mp_webhook_rejected_open(e.provider_id, e.last_at))
                             filter (where e.reason in ('bad_signature','stale_signature','no_signature','bad_request','config_error','ipn_ignored')), false),
        'last_ok', (select max(s.last_ok_at) from public.mp_webhook_status s),
        'recovered', count(*) filter (where e.reason = 'recovered'),
        'recovered_last', max(e.last_at) filter (where e.reason = 'recovered'))
      from public.mp_webhook_events e where e.last_at > now() - interval '7 days'));
end $$;
grant execute on function public.admin_review() to authenticated;

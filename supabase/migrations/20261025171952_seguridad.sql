-- =====================================================================
-- TuTiempo · Bloque 2a · Seguridad y datos (H13, H26, H29)
-- - Devoluciones automáticas: pg_cron llama a mp-refunds cada 10 minutos con pg_net. La URL del proyecto y la clave
--   del cron (CRON_SECRET) salen de Vault (vault.decrypted_secrets): no quedan escritas en el SQL ni en el repo.
-- - Limpieza diaria: intentos de conexión con Mercado Pago (mp_oauth_states) de más de 1 día y avisos descartados
--   (mp_webhook_events) de más de 180 días que no sean de un pago en revisión.
-- - mp_accounts: las llaves se guardan cifradas por las Edge Functions (formato "v<n>:<iv>:<cifrado>"); la base rechaza
--   una llave nueva en texto plano. Una cuenta activa siempre tiene mp_user_id.
-- - provider_secrets se borra (D21: sin uso desde el Bloque 1).
-- =====================================================================
set search_path = public, extensions;

-- ---------- Devoluciones automáticas (cron + Vault) ----------
-- Secretos que carga Bruno en Vault (docs/02): tt_project_url (https://<proyecto>.supabase.co) y tt_cron_secret
-- (la misma CRON_SECRET que tiene mp-refunds como secreto de la función).
create or replace function public.run_refunds() returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    raise warning 'run_refunds: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/mp-refunds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

-- ---------- Limpieza diaria (H13, H29) ----------
create or replace function public.daily_cleanup() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_states int; n_events int;
begin
  delete from public.mp_oauth_states where created_at < now() - interval '1 day';
  get diagnostics n_states = row_count;
  delete from public.mp_webhook_events e
   where e.created_at < now() - interval '180 days'
     and not exists (select 1 from public.payments p where p.mp_payment_id = e.mp_payment_id
                     and p.outcome = 'review' and p.review_resolved_at is null);
  get diagnostics n_events = row_count;
  return jsonb_build_object('oauth_states', n_states, 'webhook_events', n_events);
end $$;

-- Tareas programadas (requiere pg_cron y pg_net activos en Supabase → Database → Extensions). Si no están, este bloque
-- no hace nada y se puede volver a correr después (cron.schedule con el mismo nombre actualiza la tarea).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_extension where extname = 'pg_net') then
      perform cron.schedule('tt-refunds', '*/10 * * * *', 'select public.run_refunds()');
    end if;
    perform cron.schedule('tt-cleanup', '17 3 * * *', 'select public.daily_cleanup()');
  end if;
end $$;

-- ---------- Cuentas activas siempre con mp_user_id (H26) ----------
-- (solo si todavía no la tiene: una migración posterior puede haber sumado más tipos y esto se puede volver a correr)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'provider_notices_kind_check'
                   and pg_get_constraintdef(oid) like '%mp_reconnect%') then
    alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
    alter table public.provider_notices add constraint provider_notices_kind_check
      check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect'));
  end if;
end $$;
-- las activas sin id (llaves viejas copiadas de provider_secrets) dejan de cobrar y el prestador recibe el aviso
do $$ declare r record; begin
  for r in update public.mp_accounts set status = 'refunds_only', disconnected_at = now(),
                  last_error = 'Cuenta sin id de Mercado Pago: hay que volver a conectarla'
            where status = 'active' and mp_user_id is null returning id, provider_id loop
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (r.provider_id, 'mp_reconnect', 'cuenta-' || r.id,
            'Tenés que volver a conectar tu cuenta de Mercado Pago para seguir recibiendo reservas con seña (Perfil → Cobros).')
    on conflict do nothing;
  end loop;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mp_accounts_active_user') then
    alter table public.mp_accounts add constraint mp_accounts_active_user check (status <> 'active' or mp_user_id is not null);
  end if;
end $$;

-- ---------- Llaves cifradas (H13) ----------
-- Las cifra mp-oauth / mp-refunds (AES-256-GCM, ver supabase/functions/_shared/util.ts). La base no puede descifrarlas:
-- solo comprueba que una llave nueva no llegue en texto plano. Las viejas en texto plano se tratan como cuenta a
-- reconectar cuando una función las lee.
create or replace function public.mp_accounts_encrypted() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.access_token is not null and (tg_op = 'INSERT' or new.access_token is distinct from old.access_token)
     and new.access_token !~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' then
    raise exception 'token_not_encrypted' using errcode = 'check_violation';
  end if;
  if new.refresh_token is not null and (tg_op = 'INSERT' or new.refresh_token is distinct from old.refresh_token)
     and new.refresh_token !~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' then
    raise exception 'token_not_encrypted' using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists mp_accounts_encrypted on public.mp_accounts;
create trigger mp_accounts_encrypted before insert or update of access_token, refresh_token on public.mp_accounts
  for each row execute function public.mp_accounts_encrypted();

-- ---------- provider_secrets (D21) ----------
drop table if exists public.provider_secrets;

-- ---------- Permisos ----------
revoke execute on function public.run_refunds(), public.daily_cleanup(), public.mp_accounts_encrypted() from public, anon, authenticated;
grant execute on function public.run_refunds(), public.daily_cleanup() to service_role;

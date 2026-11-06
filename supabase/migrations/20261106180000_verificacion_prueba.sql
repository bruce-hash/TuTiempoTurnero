-- Despliegue automático a prueba (docs/10): el informe que lee la verificación ("Verificar prueba" en GitHub Actions).
-- Una sola función de lectura, security definer: los montos de la reserva que hizo la verificación (con lo que tendrían
-- que dar según la seña fija y las comisiones), el estado de las tareas programadas, lo que respondieron las Edge
-- Functions llamadas por el cron y la última migración aplicada. Nadie la puede llamar desde la app: solo el usuario
-- tt_verificador, que se crea a mano en el proyecto de prueba y recibe el permiso aparte (docs/10, paso 2).
-- Idempotente; no toca datos.

create or replace function public.verificacion_prueba(p_booking bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  out jsonb := jsonb_build_object('ahora', now());
  b record; com numeric; parts int[]; dep int; x jsonb;
begin
  -- la reserva de la verificación: lo guardado y lo esperado (seña fija sobre el precio y charge_parts)
  if p_booking is not null then
    select bk.id, bk.status, bk.source, bk.price, bk.deposit, bk.client_fee, bk.mp_fee, bk.mp_fee_pct::float as mp_pct,
           ps.deposit_pct, ps.payout_term,
           exists (select 1 from public.mp_checkouts c where bk.id = any(c.booking_ids)) as checkout
      into b
      from public.bookings bk left join public.provider_settings ps on ps.provider_id = bk.provider_id
     where bk.id = p_booking;
    if found then
      com := coalesce((select deposit_commission_pct from public.app_settings limit 1), 0);
      dep := round(b.price * b.deposit_pct / 100.0);
      parts := public.charge_parts(dep, b.price, com, b.mp_pct::numeric);
      out := out || jsonb_build_object('reserva', jsonb_build_object(
        'id', b.id, 'estado', b.status, 'origen', b.source, 'precio', b.price, 'sena_pct', b.deposit_pct, 'plazo', b.payout_term,
        'sena', b.deposit, 'comision', b.client_fee, 'costo_mp', b.mp_fee, 'mp_pct', b.mp_pct, 'cobro_abierto', b.checkout,
        'esperado', jsonb_build_object('sena', dep, 'comision', parts[1], 'costo_mp', parts[2], 'total', parts[3]),
        'comision_pct', com));
    end if;
  end if;
  -- tareas programadas (pg_cron): la última corrida de cada una
  if to_regclass('cron.job') is not null and to_regclass('cron.job_run_details') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('tarea', j.jobname, 'activa', j.active, 'cron', j.schedule,
               'estado', d.status, 'fin', d.end_time, 'mensaje', left(d.return_message, 200)) order by j.jobname), '[]')
        from cron.job j
        left join lateral (select status, end_time, return_message from cron.job_run_details r
                            where r.jobid = j.jobid order by r.runid desc limit 1) d on true
    $q$ into x;
    out := out || jsonb_build_object('tareas', x);
  end if;
  -- lo que respondieron las Edge Functions llamadas por las tareas (pg_net), las últimas 2 horas, por código
  if to_regclass('net._http_response') is not null then
    execute $q$
      select coalesce(jsonb_object_agg(k, n), '{}') from (
        select case when timed_out then 'sin_respuesta' when status_code is null then 'error' else status_code::text end k, count(*) n
          from net._http_response where created > now() - interval '2 hours' group by 1) t
    $q$ into x;
    out := out || jsonb_build_object('funciones', x);
  end if;
  -- la última migración aplicada con la CLI (supabase db push)
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select to_jsonb(max(version)) from supabase_migrations.schema_migrations' into x;
    out := out || jsonb_build_object('migracion', x);
  end if;
  return out;
end $$;

revoke execute on function public.verificacion_prueba(bigint) from public, anon, authenticated;

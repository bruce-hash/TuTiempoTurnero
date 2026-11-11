-- =====================================================================
-- TuTiempo · Diagnóstico de avisos por email y push · SOLO LECTURA
-- Pegalo entero en Supabase → SQL Editor y tocá Run. Devuelve UNA fila con UNA celda ("diagnostico"): abrila, copiá
-- todo el texto y pegalo en el chat.
-- No cambia nada: son solo SELECT (las partes que dependen de pg_cron, pg_net, Vault o de migraciones nuevas se
-- consultan solo si existen; si no, dicen "no existe"). No trae emails, nombres, teléfonos, textos de avisos,
-- endpoints ni claves: solo cantidades, estados, fechas y mensajes de error. De Vault, solo los nombres y si el
-- formato es válido (sí/no), nunca el valor.
-- =====================================================================
with q(k, ok, sql) as (values
  ('00_contexto', true, $s$
     select now() at time zone 'America/Argentina/Buenos_Aires' as ahora_ar, current_setting('server_version') as postgres,
            (select s.site_url from public.app_settings s where s.id) as site_url $s$),
  ('01_extensiones', true, $s$
     select extname, extversion from pg_extension where extname in ('pg_cron','pg_net','supabase_vault','pgsodium') order by 1 $s$),
  ('02_migraciones_registradas', coalesce(has_schema_privilege(to_regnamespace('supabase_migrations')::oid, 'usage') and has_table_privilege(to_regclass('supabase_migrations.schema_migrations')::oid, 'select'), false), $s$
     select version from supabase_migrations.schema_migrations order by version desc limit 5 $s$),
  ('03_objetos_de_cada_migracion', true, $s$
     select to_regprocedure('public.run_email_send()') is not null as emails_20261026,
            to_regprocedure('public.run_push_send(boolean)') is not null as push_20261028,
            to_regclass('public.push_gone') is not null as push_gone_20261110120000,
            exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'email_outbox' and column_name = 'notice_id') as email_profesional_20261110175000,
            to_regprocedure('public.holiday_bookings_notices(date)') is not null as feriados_20261110240000,
            to_regclass('public.mp_webhook_status') is not null as mp_firma_20261111000000 $s$),
  ('04_triggers', true, $s$
     select e.tabla, e.tg as trigger_name,
            coalesce((select case t.tgenabled when 'D' then 'DESACTIVADO' else 'activo' end
                        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'public' and c.relname = e.tabla and t.tgname = e.tg and not t.tgisinternal), 'FALTA') as estado
       from (values ('client_messages','client_messages_marketing'), ('client_messages','client_messages_email'),
                    ('client_messages','client_messages_push'), ('provider_notices','provider_notices_push'),
                    ('provider_notices','provider_notices_email'), ('bookings','bookings_push'), ('push_outbox','push_outbox_kick'),
                    ('follows','follows_notice'), ('providers','providers_status_notice'), ('refunds','refunds_expired_notice'),
                    ('refunds','refunds_late_notice')) e(tabla, tg)
      order by 1, 2 $s$),
  ('05_cron_tareas', coalesce(has_schema_privilege(to_regnamespace('cron')::oid, 'usage') and has_table_privilege(to_regclass('cron.job')::oid, 'select'), false), $s$
     select jobid, jobname, schedule, active, left(command, 90) as command, username from cron.job order by jobname $s$),
  ('06_cron_resumen_24h', coalesce(has_schema_privilege(to_regnamespace('cron')::oid, 'usage') and has_table_privilege(to_regclass('cron.job_run_details')::oid, 'select'), false), $s$
     select j.jobname,
            count(d.runid) filter (where d.status = 'succeeded') as ok,
            count(d.runid) filter (where d.status = 'failed') as fallidas,
            count(d.runid) filter (where d.status not in ('succeeded','failed')) as otras,
            max(d.start_time) filter (where d.status = 'succeeded') as ultima_ok,
            max(d.start_time) as ultima
       from cron.job j left join cron.job_run_details d on d.jobid = j.jobid and d.start_time > now() - interval '24 hours'
      group by j.jobname order by 1 $s$),
  ('07_cron_ultimas_20', coalesce(has_schema_privilege(to_regnamespace('cron')::oid, 'usage') and has_table_privilege(to_regclass('cron.job_run_details')::oid, 'select'), false), $s$
     select jobname, status, left(return_message, 200) as return_message, start_time, end_time - start_time as duracion
       from (select j.jobname, d.status, d.return_message, d.start_time, d.end_time,
                    row_number() over (partition by j.jobname order by d.start_time desc) as rn
               from cron.job j join cron.job_run_details d on d.jobid = j.jobid
              where j.jobname in ('tt-emails','tt-push','tt-notices')) x
      where rn <= 20 order by jobname, start_time desc $s$),
  ('08_cron_errores_7d', coalesce(has_schema_privilege(to_regnamespace('cron')::oid, 'usage') and has_table_privilege(to_regclass('cron.job_run_details')::oid, 'select'), false), $s$
     select j.jobname, d.status, left(d.return_message, 200) as return_message, count(*) as veces, max(d.start_time) as ultima
       from cron.job j join cron.job_run_details d on d.jobid = j.jobid
      where d.status <> 'succeeded' and d.start_time > now() - interval '7 days'
      group by 1, 2, 3 order by 5 desc limit 30 $s$),
  ('09_vault_nombres', coalesce(has_schema_privilege(to_regnamespace('vault')::oid, 'usage') and has_table_privilege(to_regclass('vault.secrets')::oid, 'select'), false), $s$
     select coalesce(s.name, '(sin nombre)') as name, s.created_at::date as creado
       from vault.secrets s order by 1 $s$),
  ('10_vault_formato', coalesce(has_schema_privilege(to_regnamespace('vault')::oid, 'usage') and has_table_privilege(to_regclass('vault.decrypted_secrets')::oid, 'select'), false), $s$
     select x.name,
            exists (select 1 from vault.decrypted_secrets d where d.name = x.name) as existe,
            (select case x.name when 'tt_project_url' then d.decrypted_secret ~ '^https://[a-z0-9-]+\.supabase\.co/?$'
                                else char_length(d.decrypted_secret) >= 32 end
               from vault.decrypted_secrets d where d.name = x.name limit 1) as formato_ok
       from (values ('tt_project_url'), ('tt_cron_secret')) x(name) $s$),
  ('11_email_cola_7d', to_regclass('public.email_outbox') is not null, $s$
     select destino, kind, status, skip_reason, count(*) as filas, max(created_at) as ultimo, max(sent_at) as ultimo_enviado
       from (select o.*, case when to_jsonb(o)->>'notice_id' is not null then 'profesional' else 'cliente' end as destino
               from public.email_outbox o where o.created_at > now() - interval '7 days') o
      group by 1, 2, 3, 4 order by 1, 2, 3, 4 $s$),
  ('12_email_estado', to_regclass('public.email_outbox') is not null, $s$
     select count(*) as total_historico,
            count(*) filter (where status = 'pending') as pendientes,
            count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '15 minutes') as pendientes_atrasados,
            min(created_at) filter (where status = 'pending') as pendiente_mas_viejo,
            max(sent_at) as ultimo_enviado,
            count(*) filter (where status = 'sent' and sent_at > now() - interval '7 days') as enviados_7d,
            count(*) filter (where status = 'failed' and created_at > now() - interval '7 days') as fallidos_7d
       from public.email_outbox $s$),
  ('13_email_errores_7d', to_regclass('public.email_outbox') is not null, $s$
     select kind, status, left(last_error, 200) as last_error, count(*) as filas, max(created_at) as ultimo
       from public.email_outbox where last_error is not null and created_at > now() - interval '7 days'
      group by 1, 2, 3 order by 5 desc limit 20 $s$),
  ('14_push_cola_7d', to_regclass('public.push_outbox') is not null, $s$
     select case when kind in ('new_booking','client_cancel','cobros','mp_reconnect','new_follower','holiday','account')
                 then 'profesional' else 'cliente' end as destino,
            kind, status, skip_reason, last_status, count(*) as filas, max(created_at) as ultimo, max(sent_at) as ultimo_enviado
       from public.push_outbox where created_at > now() - interval '7 days'
      group by 1, 2, 3, 4, 5 order by 1, 2, 3, 4, 5 $s$),
  ('15_push_estado', to_regclass('public.push_outbox') is not null, $s$
     select count(*) as total_historico,
            count(*) filter (where status = 'pending') as pendientes,
            count(*) filter (where status = 'pending' and next_attempt_at < now() - interval '5 minutes') as pendientes_atrasados,
            min(created_at) filter (where status = 'pending') as pendiente_mas_viejo,
            max(sent_at) as ultimo_enviado,
            count(*) filter (where status = 'sent' and sent_at > now() - interval '1 day') as enviados_24h,
            count(*) filter (where status = 'failed' and created_at > now() - interval '1 day') as fallidos_24h,
            count(*) filter (where last_status in (401, 403) and created_at > now() - interval '1 day') as vapid_rechazado_24h
       from public.push_outbox $s$),
  ('16_push_errores_7d', to_regclass('public.push_outbox') is not null, $s$
     select kind, status, last_status, left(last_error, 200) as last_error, count(*) as filas, max(created_at) as ultimo
       from public.push_outbox where last_error is not null and created_at > now() - interval '7 days'
      group by 1, 2, 3, 4 order by 6 desc limit 20 $s$),
  ('17_push_dispositivos', to_regclass('public.push_subscriptions') is not null, $s$
     select rol, servicio, count(distinct user_id) as cuentas, count(*) as dispositivos,
            count(*) filter (where failures > 0) as con_fallas, max(last_ok_at) as ultimo_envio_ok, max(created_at) as ultima_alta
       from (select s.user_id, s.failures, s.last_ok_at, s.created_at,
                    substring(s.endpoint from '^https://([^/]+)') as servicio,
                    case when exists (select 1 from public.app_admins a where a.user_id = s.user_id) then 'admin'
                         when exists (select 1 from public.providers p where p.owner_id = s.user_id and p.status <> 'deleted') then 'profesional'
                         else 'cliente' end as rol
               from public.push_subscriptions s) x
      group by 1, 2 order by 1, 2 $s$),
  ('18_profesionales', to_regclass('public.push_subscriptions') is not null, $s$
     select p.status, count(*) as total,
            count(*) filter (where exists (select 1 from public.push_subscriptions s where s.user_id = p.owner_id)) as con_push_en_algun_dispositivo,
            count(*) filter (where to_jsonb(pr)->>'push_bookings' = 'false') as push_reservas_apagado,
            count(*) filter (where to_jsonb(pr)->>'push_followers' = 'false') as push_seguidores_apagado,
            count(*) filter (where u.email_confirmed_at is null) as email_dueno_sin_confirmar,
            count(*) filter (where exists (select 1 from public.message_templates t where t.provider_id = p.id and t.key = 'conf' and not t.enabled)) as plantilla_conf_apagada,
            count(*) filter (where not exists (select 1 from public.message_templates t where t.provider_id = p.id and t.key = 'conf')) as plantilla_conf_falta,
            count(*) filter (where exists (select 1 from public.message_templates t where t.provider_id = p.id and t.key = 'r24' and not t.enabled)) as plantilla_r24_apagada
       from public.providers p left join public.profiles pr on pr.id = p.owner_id left join auth.users u on u.id = p.owner_id
      group by p.status order by 1 $s$),
  ('19_push_gone_30d', to_regclass('public.push_gone') is not null, $s$
     select case when exists (select 1 from public.providers p where p.owner_id = g.user_id and p.status <> 'deleted') then 'profesional' else 'cliente/otro' end as rol,
            host, status, kind, count(*) as veces, max(gone_at) as ultima
       from public.push_gone g where gone_at > now() - interval '30 days'
      group by 1, 2, 3, 4 order by 6 desc limit 30 $s$),
  ('20_avisos_cliente_7d', true, $s$
     select kind, count(*) as avisos, max(created_at) as ultimo
       from public.client_messages where created_at > now() - interval '7 days' group by 1 order by 1 $s$),
  ('21_avisos_profesional_7d', true, $s$
     select kind, count(*) as avisos, max(created_at) as ultimo
       from public.provider_notices where created_at > now() - interval '7 days' group by 1 order by 1 $s$),
  ('22_reservas_app_7d', to_regclass('public.email_outbox') is not null and to_regclass('public.push_outbox') is not null, $s$
     select b.status, count(*) as reservas,
            count(*) filter (where u.email_confirmed_at is not null) as cliente_email_confirmado,
            count(*) filter (where exists (select 1 from public.client_messages m where m.ref = b.id::text and m.kind = 'conf')) as con_aviso_conf,
            count(*) filter (where exists (select 1 from public.email_outbox e where e.booking_id = b.id and e.kind = 'conf')) as email_conf_en_cola,
            count(*) filter (where exists (select 1 from public.email_outbox e where e.booking_id = b.id and e.kind = 'conf' and e.status = 'sent')) as email_conf_enviado,
            count(*) filter (where exists (select 1 from public.providers p join public.push_subscriptions s on s.user_id = p.owner_id where p.id = b.provider_id)) as profesional_con_push,
            count(*) filter (where exists (select 1 from public.push_outbox o where o.booking_id = b.id and o.kind = 'new_booking')) as push_nueva_reserva_en_cola,
            count(*) filter (where exists (select 1 from public.push_outbox o where o.booking_id = b.id and o.kind = 'new_booking' and o.status = 'sent')) as push_nueva_reserva_enviado,
            count(*) filter (where exists (select 1 from public.payments pm where pm.id = b.payment_id and pm.created_at > b.created_at + interval '10 minutes')) as pagada_despues_de_10_min
       from public.bookings b left join auth.users u on u.id = b.client_id
      where b.source = 'app' and b.created_at > now() - interval '7 days'
      group by 1 order by 1 $s$),
  ('23_cancelaciones_recientes', to_regclass('public.push_outbox') is not null, $s$
     select b.status, count(*) as turnos,
            count(*) filter (where exists (select 1 from public.client_messages m where m.ref = b.id::text and m.kind = 'cancel')) as con_aviso_cancel_al_cliente,
            count(*) filter (where exists (select 1 from public.push_outbox o where o.booking_id = b.id and o.kind = 'client_cancel')) as push_cancelacion_al_profesional
       from public.bookings b
      where b.source = 'app' and b.status in ('cancelled_client','cancelled_provider','cancelled_refunded','expired')
        and b.starts_at > now() - interval '7 days'
      group by 1 order by 1 $s$),
  ('24_net_respuestas_24h', coalesce(has_schema_privilege(to_regnamespace('net')::oid, 'usage') and has_table_privilege(to_regclass('net._http_response')::oid, 'select'), false), $s$
     select status_code, timed_out, left(error_msg, 150) as error_msg,
            case when status_code between 200 and 299 then null else left(content, 160) end as contenido_si_fallo,
            count(*) as veces, max(created) as ultima
       from net._http_response where created > now() - interval '24 hours'
      group by 1, 2, 3, 4 order by 6 desc limit 30 $s$),
  ('25_net_ultimas_15', coalesce(has_schema_privilege(to_regnamespace('net')::oid, 'usage') and has_table_privilege(to_regclass('net._http_response')::oid, 'select'), false), $s$
     select created, status_code, timed_out, left(error_msg, 120) as error_msg, left(content, 160) as content
       from net._http_response order by created desc limit 15 $s$)
)
select json_object_agg(k,
         case when ok then
           convert_from(decode((xpath('/row/j/text()', query_to_xml(
             'select encode(convert_to(coalesce((select json_agg(t) from (' || sql || ') t), ''[]''::json)::text, ''UTF8''), ''base64'') as j',
             false, true, '')))[1]::text, 'base64'), 'UTF8')::json
         else to_json('no existe o sin permiso'::text) end
         order by k) as diagnostico
from q;

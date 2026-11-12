-- =====================================================================================================================
-- TuTiempo · paso a producción (12/11) · LIMPIEZA, PASO 1: LISTAR (no borra ni cambia nada)
-- =====================================================================================================================
-- Muestra, en una sola tabla, qué se conserva y qué se borraría con limpieza-2-borrar.sql. Se corre en el SQL Editor de
-- Supabase (pegar todo y Run). Es solo lectura: se puede correr las veces que haga falta.
--
-- ANTES DE CORRER: completá abajo el email de la cuenta que se conserva (el MISMO que en
-- limpieza-2-borrar.sql). Los admins (los de la tabla app_admins) se conservan siempre, sin escribirlos.
--
-- Columnas: orden · sección · qué · cuántos · detalle. Secciones:
--   1 SE CONSERVA · configuración       (no se toca nunca)
--   2 SE CONSERVA · cuentas              (una fila por cuenta; «NO EXISTE» si un email está mal escrito)
--   3 CUENTAS QUE SE CONSERVAN · datos   (lo que tienen; marcado si se borra con la opción por defecto)
--   4 SE BORRA                           (todo lo demás, con una fila por cuenta, profesional y pago)
--   5 ARCHIVOS                           (fotos en Storage de lo que se borra: se borran a mano, ver docs/12)
-- =====================================================================================================================
with params as (
  select array[
    lower('EMAIL-DE-LA-CUENTA-QUE-SE-CONSERVA')   -- ← completar (si son más, separadas por coma, cada una con lower('…'))
  ] as conservar
),
keep as (
  select u.id, u.email, exists (select 1 from public.app_admins a where a.user_id = u.id) as admin
    from auth.users u, params
   where lower(u.email) = any(params.conservar) or u.id in (select user_id from public.app_admins)
),
kp as (select p.id from public.providers p where p.owner_id in (select id from keep)),
filas (orden, seccion, que, cuantos, detalle) as (
  -- ---------- 0. avisos ----------
  select 0, '¡ATENCIÓN!', 'Falta el email de la cuenta que se conserva', null::bigint,
         'Completalo al principio del archivo (el mismo que en limpieza-2-borrar.sql)'
    from params where exists (select 1 from unnest(params.conservar) e where e like 'email-de-%')
  union all
  select 0, '¡ATENCIÓN!', 'No hay ningún admin en app_admins', null, 'El borrado se frena: tiene que haber al menos un admin'
   where not exists (select 1 from public.app_admins)

  -- ---------- 1. configuración: se conserva siempre ----------
  union all
  select 1, 'SE CONSERVA · configuración', 'Comisión de TuTiempo (%)', null, s.commission_pct::text || '  (producción: 4)' from public.app_settings s
  union all
  select 1, 'SE CONSERVA · configuración', 'Dirección del sitio', null, coalesce(s.site_url, '(vacía)') || '  (producción: https://tutiempo.com.ar)' from public.app_settings s
  union all
  select 1, 'SE CONSERVA · configuración', 'Exigir DNI / sellos', null,
         'DNI: ' || coalesce(s.require_dni::text, '-') || ' · sellos: ' || coalesce(s.stamps_on::text, '-') from public.app_settings s
  union all
  select 1, 'SE CONSERVA · configuración', 'Feriados cargados', count(*), 'años confirmados: ' ||
         coalesce((select string_agg(year::text, ', ' order by year) from public.holiday_years where confirmed_at is not null), 'ninguno')
    from public.holidays
  union all
  select 1, 'SE CONSERVA · configuración', 'Rubros y ciudades', (select count(*) from public.categories) + (select count(*) from public.cities), null
  union all
  select 1, 'SE CONSERVA · configuración', 'Gastos fijos de TuTiempo (Balance del admin)', count(*),
         string_agg(concept || ' $' || amount, ' · ' order by id) from public.admin_fixed_expenses

  -- ---------- 2. cuentas que se conservan ----------
  union all
  select 2, 'SE CONSERVA · cuentas', k.email, null,
         case when k.admin then 'admin' else 'cuenta' end
         || coalesce(' · negocio: ' || (select string_agg(p.name || ' (' || p.status || ', /' || coalesce(p.slug, '') || ')', ', ') from public.providers p where p.owner_id = k.id), ' · sin negocio')
         || coalesce(' · Mercado Pago: ' || (select string_agg('cuenta ' || a.mp_user_id || ' ' || a.status, ', ') from public.mp_accounts a join public.providers p on p.id = a.provider_id where p.owner_id = k.id), '')
    from keep k
  union all
  select 2, 'SE CONSERVA · cuentas', e, null, 'NO EXISTE: revisá cómo está escrito (el borrado se frena)'
    from params, unnest(params.conservar) e
   where e not like 'email-de-%' and not exists (select 1 from auth.users u where lower(u.email) = e)

  -- ---------- 3. datos de las cuentas que se conservan ----------
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Servicios, horarios, fotos y trabajos (se conservan)',
         (select count(*) from public.services where provider_id in (select id from kp)),
         (select count(*) from public.provider_hours where provider_id in (select id from kp))::text || ' franjas de horario · '
         || (select count(*) from public.media where provider_id in (select id from kp))::text || ' fotos · '
         || (select count(*) from public.posts where provider_id in (select id from kp))::text || ' publicaciones'
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Productos (se conservan; el stock vuelve a 0 si se borran los movimientos)',
         count(*), string_agg(name || ' (stock ' || stock || ')', ' · ' order by id)
    from public.products where provider_id in (select id from kp)
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Gastos fijos del negocio (se conservan)', count(*), string_agg(concept || ' $' || amount, ' · ' order by id)
    from public.fixed_expenses where provider_id in (select id from kp)
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Turnos de sus negocios (se BORRAN por defecto)', count(*),
         string_agg(distinct status, ', ') || coalesce(' · desde ' || to_char(min(starts_at) at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') || ' hasta ' || to_char(max(starts_at) at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY'), '')
    from public.bookings where provider_id in (select id from kp)
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Pagos de sus negocios (se BORRAN por defecto)', count(*),
         coalesce('$' || sum(amount) || ' cobrados · $' || sum(coalesce(refunded_mp, 0)) || ' devueltos', '')
    from public.payments where provider_id in (select id from kp)
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Caja: ventas, gastos, cierres y ajustes de stock (se BORRAN por defecto)',
         (select count(*) from public.walkins where provider_id in (select id from kp)) + (select count(*) from public.expenses where provider_id in (select id from kp))
         + (select count(*) from public.cash_closings where provider_id in (select id from kp)) + (select count(*) from public.stock_adjustments where provider_id in (select id from kp)), null
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Clientes, seguidores, reseñas y sellos de sus negocios (se BORRAN por defecto)',
         (select count(*) from public.provider_clients where provider_id in (select id from kp)) + (select count(*) from public.follows where provider_id in (select id from kp))
         + (select count(*) from public.reviews where provider_id in (select id from kp)) + (select count(*) from public.loyalty_cards where provider_id in (select id from kp)), null
  union all
  select 3, 'CUENTAS QUE SE CONSERVAN · datos', 'Saldo a favor de esas cuentas (vuelve a 0 por defecto)', count(*), coalesce('$' || sum(balance), '')
    from public.wallets where user_id in (select id from keep) and balance <> 0

  -- ---------- 4. lo que se borra ----------
  union all
  select 4, 'SE BORRA · cuentas', u.email, null,
         'creada ' || to_char(u.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY')
         || coalesce(' · último ingreso ' || to_char(u.last_sign_in_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY'), ' · nunca ingresó')
         || coalesce(' · negocio: ' || (select string_agg(p.name, ', ') from public.providers p where p.owner_id = u.id), '')
    from auth.users u where u.id not in (select id from keep)
  union all
  select 4, 'SE BORRA · profesionales', p.name, null,
         p.status || ' · /' || coalesce(p.slug, '') || ' · dueño: ' || coalesce((select email from auth.users where id = p.owner_id), '(sin dueño)')
         || coalesce(' · Mercado Pago: ' || (select string_agg('cuenta ' || a.mp_user_id || ' ' || a.status, ', ') from public.mp_accounts a where a.provider_id = p.id), ' · sin Mercado Pago')
    from public.providers p where p.id not in (select id from kp)
  union all
  select 4, 'SE BORRA · pagos', coalesce(pa.mp_payment_id, '(sin id)'), pa.amount::bigint,
         case when pa.mp_payment_id ilike 'PRUEBA-%' then 'PRUEBA · ' else '' end
         || coalesce(pa.mp_status, '?') || coalesce(' · ' || pa.outcome, '')
         || case when pa.mp_status = 'approved' and coalesce(pa.refunded_mp, 0) < pa.amount then ' · ¡APROBADO SIN DEVOLVER! $' || (pa.amount - coalesce(pa.refunded_mp, 0)) else '' end
         || ' · ' || to_char(pa.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI')
         || ' · ' || coalesce((select name from public.providers where id = pa.provider_id), '?')
         || ' · cuenta MP ' || coalesce(pa.collector_id, (select mp_user_id from public.mp_accounts where id = pa.mp_account_id), '?')
         || case when pa.provider_id in (select id from kp) then ' · (de una cuenta que se conserva)' else '' end
    from public.payments pa
  union all
  select 4, 'SE BORRA · cobros «Para revisar»', 'Pagos con algo para revisar sin resolver', count(*), null
    from public.payments where coalesce(array_length(review_reasons, 1), 0) > 0 and review_resolved_at is null
  union all
  select 4, 'SE BORRA · cobros «Para revisar»', 'Devoluciones (todas; fallidas o pendientes: ' ||
         (select count(*) from public.refunds where status <> 'done')::text || ')', count(*), null from public.refunds
  union all
  select 4, 'SE BORRA · cobros «Para revisar»', 'Avisos de Mercado Pago rechazados o raros (mp_webhook_events)', count(*), null from public.mp_webhook_events
  union all
  select 4, 'SE BORRA · turnos', 'Turnos (todos los de prueba)', count(*), string_agg(distinct status, ', ') from public.bookings
  union all
  select 4, 'SE BORRA · turnos', 'Cobros abiertos (mp_checkouts)', count(*), null from public.mp_checkouts
  union all
  select 4, 'SE BORRA · avisos', 'Avisos de clientes (campanita) y de profesionales', (select count(*) from public.client_messages) + (select count(*) from public.provider_notices), null
  union all
  select 4, 'SE BORRA · avisos', 'Cola de emails y de notificaciones', (select count(*) from public.email_outbox) + (select count(*) from public.push_outbox), null
  union all
  select 4, 'SE BORRA · avisos', 'Suscripciones push (todas: los dispositivos de prueba no sirven en el dominio nuevo)', count(*),
         string_agg(distinct coalesce(label, '?'), ', ') from public.push_subscriptions
  union all
  select 4, 'SE BORRA · otros', 'Caja, gastos y stock de los profesionales que se borran',
         (select count(*) from public.walkins where provider_id not in (select id from kp)) + (select count(*) from public.expenses where provider_id not in (select id from kp)), null
  union all
  select 4, 'SE BORRA · otros', 'Balance del admin: cierres y gastos cargados (los fijos se conservan)',
         (select count(*) from public.admin_closings) + (select count(*) from public.admin_expenses), null
  union all
  select 4, 'SE BORRA · otros', 'Notas del admin, seguidos, reseñas, ofertas, lista de espera',
         (select count(*) from public.admin_notes) + (select count(*) from public.follows) + (select count(*) from public.reviews)
         + (select count(*) from public.slot_offers) + (select count(*) from public.waitlist), null

  -- ---------- 5. archivos en Storage de lo que se borra ----------
  union all
  select 5, 'ARCHIVOS · borrar a mano en Storage', o.bucket_id || '/' || split_part(o.name, '/', 1), count(*),
         case o.bucket_id when 'dni' then 'los borra sola la tarea diaria dni-cleanup (03:37)' else 'Storage → ' || o.bucket_id || ' → carpeta ' || split_part(o.name, '/', 1) || ' → borrar' end
    from storage.objects o
   where (o.bucket_id = 'media' and split_part(o.name, '/', 1) not in (select id::text from kp))
      or (o.bucket_id in ('avatars', 'dni') and split_part(o.name, '/', 1) not in (select id::text from keep))
   group by o.bucket_id, split_part(o.name, '/', 1)
)
select orden, seccion, que, cuantos, detalle from filas order by orden, seccion, que;

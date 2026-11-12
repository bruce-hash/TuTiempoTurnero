-- =====================================================================================================================
-- TuTiempo · paso a producción (12/11) · LIMPIEZA, PASO 2: BORRAR (en una sola transacción)
-- =====================================================================================================================
-- Borra los datos de prueba. Correlo recién después de revisar la lista de limpieza-1-listar.sql, y DESPUÉS del backup
-- (docs/12-dia-del-cambio.md, paso 1). Se corre en el SQL Editor de Supabase: pegar todo y Run.
--
-- Todo o nada: si algo falla o no se cumple un control, no se borra nada y el error dice por qué. Al terminar muestra
-- una tabla con lo que borró cada paso. Correrlo dos veces no hace daño (la segunda no encuentra nada).
--
-- SE CONSERVA SIEMPRE:
--   - la cuenta de abajo (con su perfil, su negocio, sus servicios, horarios, fotos, productos, gastos fijos, su
--     conexión de Mercado Pago y sus datos de cuenta) y las de los admins (tabla app_admins);
--   - la configuración: comisión y % de Mercado Pago (app_settings), feriados, rubros, ciudades, gastos fijos de TuTiempo.
-- SE BORRA: todas las demás cuentas y profesionales; turnos, pagos, devoluciones, cobros «Para revisar», avisos, colas
--   de email y push, suscripciones push, caja y gastos cargados, seguidos, reseñas, sellos.
--   Por defecto también los turnos, pagos y caja de las cuentas que se conservan (son de prueba). Para conservarlos,
--   conservar_movimientos := true.
-- NO TOCA los archivos de Storage (fotos): limpieza-1-listar.sql dice cuáles borrar a mano.
-- =====================================================================================================================
begin;

create temp table tt_limpieza (paso serial, que text, filas bigint) on commit drop;

do $$
declare
  -- ↓↓↓ COMPLETAR: el mismo email que en limpieza-1-listar.sql ↓↓↓
  conservar text[] := array[
    lower('EMAIL-DE-LA-CUENTA-QUE-SE-CONSERVA')   -- si son más, separadas por coma, cada una con lower('…')
  ];
  -- false (recomendado): también se borran los turnos, pagos y caja de prueba de las cuentas que se conservan
  conservar_movimientos boolean := false;
  -- Si la lista mostró «¡APROBADO SIN DEVOLVER!» en un pago que se borra, el borrado se frena: un pago aprobado nunca
  -- queda sin registro. Si revisaste que son de prueba (dinero de prueba o ya devuelto por fuera), poné true.
  borrar_pagos_aprobados boolean := false;
  -- ------------------------------------------------------------------------------------------------------------------
  keep uuid[]; kp bigint[]; e text; n bigint; pend bigint;
begin
  -- ---------- controles ----------
  if exists (select 1 from unnest(conservar) x where x like 'email-de-%') then
    raise exception 'Completá el email de la cuenta que se conserva (al principio del bloque).';
  end if;
  foreach e in array conservar loop
    if not exists (select 1 from auth.users where lower(email) = e) then
      raise exception 'No existe ninguna cuenta con el email %: revisá cómo está escrito.', e;
    end if;
  end loop;
  if not exists (select 1 from public.app_admins) then
    raise exception 'No hay ningún admin en app_admins: no borro nada.';
  end if;
  select array_agg(id) into keep from auth.users
   where lower(email) = any(conservar) or id in (select user_id from public.app_admins);
  select coalesce(array_agg(id), '{}') into kp from public.providers where owner_id = any(keep);

  select count(*) into pend from public.payments p
   where p.mp_status = 'approved' and coalesce(p.refunded_mp, 0) < p.amount
     and (not conservar_movimientos or p.provider_id <> all(kp));
  if pend > 0 and not borrar_pagos_aprobados then
    raise exception 'Hay % pago(s) aprobado(s) sin devolver entre lo que se borra (ver «¡APROBADO SIN DEVOLVER!» en la lista). Revisalos y, si son de prueba, poné borrar_pagos_aprobados := true.', pend;
  end if;

  -- ---------- 1. colas y suscripciones (todo: son de prueba y del dominio viejo) ----------
  delete from public.push_outbox;             get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cola de notificaciones', n);
  delete from public.email_outbox;            get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cola de emails', n);
  delete from public.push_subscriptions;      get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('suscripciones push', n);
  delete from public.push_gone;               get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('suscripciones vencidas (push_gone)', n);

  -- ---------- 2. avisos, ofertas y lista de espera (todo) ----------
  delete from public.client_messages;         get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('avisos de clientes', n);
  delete from public.provider_notices;        get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('avisos de profesionales', n);
  delete from public.slot_offers;             get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('turnos ofrecidos', n);
  delete from public.waitlist;                get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('lista de espera', n);

  -- ---------- 3. cobros: devoluciones, pagos, cobros abiertos, avisos de Mercado Pago ----------
  delete from public.refunds where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('devoluciones', n);
  delete from public.payment_bookings pb using public.payments p
   where p.id = pb.payment_id and (not conservar_movimientos or p.provider_id <> all(kp));
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('pagos ↔ turnos', n);
  delete from public.mp_checkouts where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cobros abiertos', n);
  delete from public.mp_webhook_events;       get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('avisos de Mercado Pago («Para revisar»)', n);
  delete from public.mp_webhook_status;       get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('estado de la firma del webhook', n);
  delete from public.mp_oauth_states;         get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('conexiones a Mercado Pago a medio hacer', n);

  -- ---------- 4. lo que cuelga de los turnos ----------
  delete from public.reviews where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('reseñas', n);
  delete from public.loyalty_events where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('movimientos de sellos', n);
  delete from public.loyalty_cards where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('tarjetas de sellos', n);
  delete from public.wallet_movements where not conservar_movimientos or user_id <> all(keep);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('movimientos de saldo a favor', n);
  if not conservar_movimientos then
    update public.wallets set balance = 0 where user_id = any(keep) and balance <> 0;
    get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('saldos a favor puestos en 0 (cuentas que se conservan)', n);
  end if;

  -- ---------- 5. turnos y pagos ----------
  delete from public.bookings where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('turnos', n);
  delete from public.payments where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('pagos', n);

  -- ---------- 6. caja, gastos, stock, clientes y seguidores ----------
  delete from public.walkins where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('ventas y cobros en el local', n);
  delete from public.expenses where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('gastos cargados', n);
  delete from public.stock_adjustments where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('ajustes de stock', n);
  delete from public.cash_closings where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cierres de caja', n);
  delete from public.cash_day_log where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('registro de cajas reabiertas', n);
  if not conservar_movimientos then
    update public.products set stock = 0 where provider_id = any(kp) and stock <> 0;
    get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('productos con el stock en 0 (cuentas que se conservan)', n);
  end if;
  delete from public.provider_clients where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('fichas de clientes', n);
  delete from public.client_blocks where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('clientes bloqueados', n);
  delete from public.follows where not conservar_movimientos or provider_id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('seguidos', n);

  -- ---------- 7. admin: cierres y gastos cargados, notas, marcas (los gastos fijos de TuTiempo se conservan) ----------
  delete from public.admin_closings;          get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cierres del Balance', n);
  delete from public.admin_expenses;          get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('gastos cargados del Balance', n);
  delete from public.admin_notes where provider_id <> all(kp) or not conservar_movimientos;
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('notas del admin', n);
  delete from public.admin_alert_marks;       get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('alertas vistas del admin', n);

  -- ---------- 8. profesionales y cuentas que no se conservan ----------
  -- (en cascada: servicios, horarios, fotos, productos, gastos fijos, cuentas de Mercado Pago, datos privados y DNI)
  delete from public.providers where id <> all(kp);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('profesionales', n);
  -- (en cascada: perfil, saldo, seguidos, sesiones e identidades de Google)
  delete from auth.users where id <> all(keep);
  get diagnostics n = row_count; insert into tt_limpieza (que, filas) values ('cuentas', n);

  -- ---------- control final ----------
  if (select count(*) from auth.users) <> cardinality(keep) then
    raise exception 'Control: quedaron % cuentas y se esperaban %. No se borró nada.', (select count(*) from auth.users), cardinality(keep);
  end if;
  insert into tt_limpieza (que, filas) values ('== quedan: cuentas', (select count(*) from auth.users));
  insert into tt_limpieza (que, filas) values ('== quedan: profesionales', (select count(*) from public.providers));
  insert into tt_limpieza (que, filas) values ('== quedan: conexiones de Mercado Pago', (select count(*) from public.mp_accounts));
  insert into tt_limpieza (que, filas) values ('== quedan: turnos', (select count(*) from public.bookings));
  insert into tt_limpieza (que, filas) values ('== quedan: pagos', (select count(*) from public.payments));
  insert into tt_limpieza (que, filas) values ('== quedan: feriados (configuración)', (select count(*) from public.holidays));
  insert into tt_limpieza (que, filas) values ('== comisión de TuTiempo (%), sin cambios', (select commission_pct::bigint from public.app_settings limit 1));
end $$;

select paso, que, filas from tt_limpieza order by paso;

commit;

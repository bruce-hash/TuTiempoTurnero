-- =====================================================================
-- 12/11 · Borrar un profesional (admin: admin_delete_provider; el propio: delete_my_provider) fallaba con day_closed
-- (o day_too_old / month_closed) si tenía alguna caja del día cerrada: provider_teardown borra lo cargado sin turno, las
-- ventas y los cierres de caja, y los guardias de la Caja de los 7 días (D42, 20261110220000_caja_7_dias.sql) no dejan
-- tocar un día cerrado. Ahora provider_teardown marca primero al profesional como borrado y los guardias dejan pasar lo
-- de un profesional borrado (nadie más puede tocarlo: queda sin dueño). Lo demás del borrado no cambia.
-- Idempotente.
-- =====================================================================
set search_path = public, extensions;

create or replace function public.walkins_cash_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text; pid bigint := case when tg_op = 'DELETE' then old.provider_id else new.provider_id end;
begin
  if auth.uid() is null then return case when tg_op = 'DELETE' then old else new end; end if;
  -- 12/11: el borrado del profesional (provider_teardown) se lleva todo, también los días cerrados
  if tg_op = 'DELETE' and exists (select 1 from public.providers p where p.id = pid and p.status = 'deleted') then
    return old;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    st := public.cash_day_state(old.provider_id, public.cash_day_of(old.provider_id, old.at));
    if st <> 'open' then raise exception '%', st; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    st := public.cash_day_state(new.provider_id, public.cash_day_of(new.provider_id, new.at));
    if st <> 'open' then raise exception '%', st; end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create or replace function public.cash_closings_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null or old.kind <> 'day' then return old; end if;
  -- 12/11: el borrado del profesional (provider_teardown) se lleva también los cierres viejos
  if exists (select 1 from public.providers p where p.id = old.provider_id and p.status = 'deleted') then return old; end if;
  st := public.cash_day_state(old.provider_id, old.period);
  -- reabrir un día: solo de los últimos 7 y con su mes abierto (day_closed es justamente lo que se está deshaciendo)
  if st in ('day_too_old', 'month_closed') then raise exception '%', st; end if;
  return old;
end $$;

-- lo mismo que antes (20261023215124_cobros.sql), con el profesional marcado como borrado antes de borrar sus datos
create or replace function public.provider_teardown(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if pid is null or not public.owns_provider(pid) then raise exception 'not_found'; end if;
  for r in select id from public.bookings where provider_id = pid and status in ('confirmed','hold') and source = 'app' and starts_at > now() loop
    perform public.cancel_by_provider(r.id); n := n + 1;
  end loop;
  update public.providers set status = 'deleted', owner_id = null, updated_at = now() where id = pid;
  delete from public.bookings where provider_id = pid and source in ('manual','block') and starts_at > now();
  delete from public.provider_clients where provider_id = pid;
  delete from public.walkins where provider_id = pid;
  delete from public.expenses where provider_id = pid;
  delete from public.cash_closings where provider_id = pid;
  delete from public.products where provider_id = pid;
  -- la llave se borra sola (purge_mp_accounts) cuando ya no hace falta para devoluciones ni consultas
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now() where provider_id = pid and status = 'active';
  update public.provider_private set phone = null, dni_number = null, dni_paths = '{}', mp_user_id = null, mp_connected = false where provider_id = pid;
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

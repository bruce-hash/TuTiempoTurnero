-- =====================================================================
-- TuTiempo · V5 resto · C29 · Interruptor global de los sellos
--   - app_settings.stamps_on (por defecto encendido, como hasta ahora) y admin_set_stamps(on) para el panel de TuTiempo.
--   - Apagado: no se suman sellos (ni al marcar "Asistió" ni a mano) y no se canjea el premio (stamps_off); la app no
--     muestra nada de sellos. Los datos quedan: tarjetas, sellos y premios ganados siguen guardados y al volver a
--     encenderlo vuelven como estaban (los premios ya ganados se pueden canjear al reactivar, como propuso el cliente).
--     Si se cancela un turno pagado con el premio, los sellos vuelven igual (refund), aunque esté apagado.
--   - Todo pasa por stamp_add: la misma función de siempre, con el control al principio.
-- Idempotente y sin borrar datos.
-- =====================================================================

alter table public.app_settings add column if not exists stamps_on boolean not null default true;

create or replace function public.stamps_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.stamps_on from public.app_settings s where s.id), true)
$$;

create or replace function public.stamp_add(pid bigint, uid uuid, sid bigint, d int, k text, bid bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  -- C29: con los sellos apagados no se suma (la visita se marca igual) y no se canjea; la devolución sí
  if not public.stamps_enabled() then
    if k = 'earn' then
      return null;
    end if;
    if k in ('manual', 'redeem') then
      raise exception 'stamps_off';
    end if;
  end if;
  insert into public.loyalty_events (provider_id, user_id, service_id, kind, delta, booking_id) values (pid, uid, sid, k, d, bid);
  insert into public.loyalty_cards as lc (provider_id, user_id, service_id, stamps, earned, redeemed)
  values (pid, uid, sid, greatest(d, 0), case when k in ('earn','manual') then d else 0 end, 0)
  on conflict (provider_id, user_id, service_id) do update set
    stamps   = lc.stamps + d,
    earned   = lc.earned + case when k in ('earn','manual') then d else 0 end,
    redeemed = lc.redeemed + case when k = 'redeem' then -d when k = 'refund' then -d else 0 end,
    updated_at = now()
  returning stamps into n;
  return n;
end $$;

create or replace function public.admin_set_stamps(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.app_settings set stamps_on = coalesce(p_on, true), updated_at = now() where id;
  return coalesce(p_on, true);
end $$;

revoke execute on function public.stamp_add(bigint, uuid, bigint, int, text, bigint) from public, anon, authenticated;
revoke execute on function public.stamps_enabled(), public.admin_set_stamps(boolean) from public, anon;
grant execute on function public.stamps_enabled() to anon, authenticated;
grant execute on function public.admin_set_stamps(boolean) to authenticated;

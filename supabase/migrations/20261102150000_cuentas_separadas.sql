-- =====================================================================
-- TuTiempo · D33 · Cuentas separadas (cambia lo decidido en C13/C14)
-- Una cuenta es de cliente o de negocio, nunca las dos:
--   - una cuenta de negocio (dueña de un prestador que no está eliminado) no reserva, no sigue, no deja reseñas y no se
--     anota para que le avisen si se libera un turno: error "business_account";
--   - una cuenta con historial de cliente (turnos reservados por la app, prestadores que sigue o reseñas) no puede
--     registrar un negocio: error "client_history" (el negocio va en una cuenta aparte);
--   - las cuentas admin siguen como hoy.
-- Se hace con triggers, así vale para book_slot, el alta y cualquier camino que inserte. No cambia ni borra datos: si ya
-- hay alguna cuenta que es las dos cosas, sigue igual (docs/02 trae la consulta para listarlas).
-- Idempotente.
-- =====================================================================

create or replace function public.is_business_account(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null
     and exists (select 1 from public.providers p where p.owner_id = p_uid and p.status <> 'deleted')
     and not exists (select 1 from public.app_admins a where a.user_id = p_uid)
$$;

-- historial de cliente: turnos que reservó por la app (los que no quedaron en un cobro abandonado), seguidos y reseñas
create or replace function public.has_client_history(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    exists (select 1 from public.bookings b where b.client_id = p_uid and b.source = 'app' and b.status not in ('hold','expired'))
    or exists (select 1 from public.follows f where f.user_id = p_uid)
    or exists (select 1 from public.reviews r where r.client_id = p_uid))
$$;

-- lo que hace un cliente (reservar por la app, seguir, reseñar, la lista de espera): una cuenta de negocio no puede
create or replace function public.block_business_client() returns trigger
language plpgsql security definer set search_path = public as $$
declare row_json jsonb := to_jsonb(new); uid uuid;
begin
  if tg_table_name = 'bookings' and row_json->>'source' <> 'app' then
    return new;
  end if;
  uid := coalesce(row_json->>'client_id', row_json->>'user_id')::uuid;
  if public.is_business_account(uid) then
    raise exception 'business_account';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['bookings','follows','reviews','waitlist'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_business', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.block_business_client()', t || '_no_business', t);
  end loop;
end $$;

-- el negocio va en una cuenta sin historial de cliente (o en una cuenta admin)
create or replace function public.block_client_history_provider() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is not null and public.has_client_history(new.owner_id)
     and not exists (select 1 from public.app_admins a where a.user_id = new.owner_id) then
    raise exception 'client_history';
  end if;
  return new;
end $$;
drop trigger if exists providers_no_client_history on public.providers;
create trigger providers_no_client_history before insert on public.providers
  for each row execute function public.block_client_history_provider();

-- para la app: ¿la cuenta que llama tiene historial de cliente? (Registrá tu negocio con sesión de cliente)
create or replace function public.my_client_history() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then null else jsonb_build_object(
    'bookings', (select count(*) from public.bookings b where b.client_id = auth.uid() and b.source = 'app' and b.status not in ('hold','expired')),
    'follows', (select count(*) from public.follows f where f.user_id = auth.uid()),
    'reviews', (select count(*) from public.reviews r where r.client_id = auth.uid()),
    'any', public.has_client_history(auth.uid())) end
$$;

revoke execute on function public.is_business_account(uuid), public.has_client_history(uuid), public.block_business_client(),
  public.block_client_history_provider(), public.my_client_history() from public, anon, authenticated;
grant execute on function public.my_client_history() to authenticated;

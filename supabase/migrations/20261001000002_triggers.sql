-- =====================================================================
-- TuTiempo · 0002 · Funciones auxiliares y triggers
-- =====================================================================
set search_path = public, extensions;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- Id del prestador del usuario logueado (o null).
create or replace function public.my_provider() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.providers where owner_id = auth.uid() and status <> 'deleted' limit 1
$$;

create or replace function public.owns_provider(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select pid is not null and (pid = public.my_provider() or public.is_admin())
$$;

-- Al crearse un usuario de Auth: perfil + billetera en cero.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- nombre y celular vienen del formulario "Crear cuenta" (o de Google); se limpian y recortan acá
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          left(coalesce(nullif(btrim(regexp_replace(new.raw_user_meta_data->>'full_name', '[<>]', '', 'g')), ''),
                        new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 120),
          nullif(btrim(left(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''), '[^0-9+ ()-]', '', 'g'), 40)), ''))
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Búsqueda: nombre, dirección, bio y nombres de servicios, sin acentos.
create or replace function public.refresh_provider_search(pid bigint) returns void
language sql security definer set search_path = public, extensions as $$
  update public.providers p set search =
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.name,''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce((select string_agg(s.name,' ') from public.services s where s.provider_id = p.id and s.active),''))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.address,'') || ' ' || coalesce(p.bio,''))), 'C')
  where p.id = pid
$$;

create or replace function public.providers_biu() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.search :=
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.name,''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.address,'') || ' ' || coalesce(new.bio,''))), 'C');
  return new;
end $$;
drop trigger if exists providers_biu on public.providers;
create trigger providers_biu before insert or update of name, bio, address on public.providers
  for each row execute function public.providers_biu();

create or replace function public.providers_sync_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.provider_categories
     set active = (new.status = 'active'), city_id = new.city_id, shuffle_key = new.shuffle_key, rank_key = new.shuffle_key - new.activity
   where provider_id = new.id;
  if tg_op = 'UPDATE' and (new.name is distinct from old.name or new.bio is distinct from old.bio or new.address is distinct from old.address) then
    perform public.refresh_provider_search(new.id);
  end if;
  return null;
end $$;
drop trigger if exists providers_sync on public.providers;
create trigger providers_sync after update of status, city_id, shuffle_key, activity, name, bio, address on public.providers
  for each row execute function public.providers_sync_categories();

create or replace function public.pc_bi() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select city_id, status, shuffle_key, activity into p from public.providers where id = new.provider_id;
  new.city_id := p.city_id; new.active := (p.status = 'active'); new.shuffle_key := p.shuffle_key; new.rank_key := p.shuffle_key - p.activity;
  -- el primer rubro de cada prestador es el principal (para el listado "Todos" sin duplicados)
  if not exists (select 1 from public.provider_categories where provider_id = new.provider_id and is_primary) then
    new.is_primary := true;
  elsif new.is_primary then
    new.is_primary := false;
  end if;
  return new;
end $$;
drop trigger if exists pc_bi on public.provider_categories;
create trigger pc_bi before insert on public.provider_categories
  for each row execute function public.pc_bi();

create or replace function public.services_aiud() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  perform public.refresh_provider_search(pid);
  -- cada servicio pertenece a un rubro del prestador: se agrega el rubro si faltaba
  if tg_op <> 'DELETE' then
    insert into public.provider_categories (provider_id, category_id) values (new.provider_id, new.category_id)
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists services_aiud on public.services;
create trigger services_aiud after insert or update or delete on public.services
  for each row execute function public.services_aiud();

-- Billetera: el saldo es la suma de movimientos; la restricción balance >= 0 impide saldo negativo.
create or replace function public.wallet_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id, balance) values (new.user_id, 0) on conflict do nothing;
  update public.wallets set balance = balance + new.amount where user_id = new.user_id;
  return null;
end $$;
drop trigger if exists wallet_apply on public.wallet_movements;
create trigger wallet_apply after insert on public.wallet_movements
  for each row execute function public.wallet_apply();

-- Puntaje y seguidores denormalizados (lectura rápida en listados).
create or replace function public.reviews_agg() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  update public.providers set
    rating_count = (select count(*) from public.reviews where provider_id = pid),
    rating_avg   = coalesce((select round(avg(stars)::numeric, 2) from public.reviews where provider_id = pid), 0)
  where id = pid;
  return null;
end $$;
drop trigger if exists reviews_agg on public.reviews;
create trigger reviews_agg after insert or delete or update of stars on public.reviews
  for each row execute function public.reviews_agg();

create or replace function public.follows_agg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.providers set followers = followers + 1 where id = new.provider_id;
  else update public.providers set followers = greatest(followers - 1, 0) where id = old.provider_id; end if;
  return null;
end $$;
drop trigger if exists follows_agg on public.follows;
create trigger follows_agg after insert or delete on public.follows
  for each row execute function public.follows_agg();

-- Adicionales: el prestador se toma del servicio (no se puede colgar un adicional de un servicio ajeno).
create or replace function public.addons_biu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select provider_id into new.provider_id from public.services where id = new.service_id;
  if new.provider_id is null then raise exception 'service_not_found'; end if;
  return new;
end $$;
drop trigger if exists addons_biu on public.service_addons;
create trigger addons_biu before insert or update of service_id on public.service_addons
  for each row execute function public.addons_biu();

-- Turnos agendados a mano: llevan el mismo descanso que configuró el prestador.
create or replace function public.bookings_bi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'manual' then
      new.buffer_min := coalesce((select buffer_min from public.provider_settings where provider_id = new.provider_id), 0);
    elsif new.source = 'block' then
      new.buffer_min := 0;
    end if;
  end if;
  new.busy_until := new.ends_at + make_interval(mins => new.buffer_min);
  return new;
end $$;
drop trigger if exists bookings_bi on public.bookings;
create trigger bookings_bi before insert or update of starts_at, ends_at, buffer_min on public.bookings for each row execute function public.bookings_bi();

-- ---------- Versión 28: actividad (servicios hechos por la app en 30 días) ----------
-- Cada turno de la app que pasa a "Asistió" suma 1 al prestador (y resta si se corrige). Cada noche se recalcula exacto.
create or replace function public.bookings_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source <> 'app' or new.status is not distinct from old.status then return null; end if;
  if new.status = 'done' and new.starts_at >= now() - interval '30 days' then
    update public.providers set activity = activity + 1 where id = new.provider_id;
  elsif old.status = 'done' then
    update public.providers set activity = greatest(activity - 1, 0) where id = new.provider_id;
  end if;
  return null;
end $$;
drop trigger if exists bookings_activity on public.bookings;
create trigger bookings_activity after update of status on public.bookings for each row execute function public.bookings_activity();
-- completar rank_key en bases que ya tenían prestadores
update public.provider_categories pc set rank_key = p.shuffle_key - p.activity
  from public.providers p where p.id = pc.provider_id and pc.rank_key is distinct from p.shuffle_key - p.activity;

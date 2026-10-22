-- =====================================================================
-- TuTiempo · 0003 · Seguridad: RLS en TODAS las tablas + permisos mínimos
-- Regla general: el navegador usa la clave pública (anon). Lo que no está
-- permitido acá, no se puede hacer aunque alguien manipule la app.
-- Las operaciones con dinero (reservar, cancelar, pagar) son funciones
-- del servidor (0004); los clientes no pueden insertar turnos directo.
-- =====================================================================
set search_path = public, extensions;

-- Arrancar de cero: nadie puede nada.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['cities','categories','profiles','app_admins','providers','provider_private','provider_secrets',
    'provider_categories','services','service_addons','provider_settings','provider_hours','bookings','waitlist','provider_clients','products',
    'walkins','expenses','message_templates','follows','reviews','media','posts','wallets','wallet_movements','client_messages','loyalty_cards','loyalty_events','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Los helpers de las políticas sí se pueden ejecutar.
-- Patrón recomendado por Supabase: (select función()) se evalúa UNA vez por consulta, no por fila.
grant execute on function public.is_admin(), public.my_provider(), public.owns_provider(bigint) to anon, authenticated;

-- ---------- Lectura pública ----------
grant select on public.cities, public.categories to anon, authenticated;
drop policy if exists cities_read on public.cities;
create policy cities_read on public.cities for select using (true);
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (active);

-- Prestadores: solo columnas públicas, solo activos (el dueño y admin ven el suyo en cualquier estado).
grant select (id, slug, name, bio, address, city_id, lat, lng, instagram, hue, status, dni_verified,
              rating_avg, rating_count, followers, created_at, photo_path) on public.providers to anon, authenticated;
drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers for select
  using (status = 'active' or owner_id = (select auth.uid()) or (select public.is_admin()));
-- Alta: queda 'pending' hasta que TuTiempo verifica el DNI.
grant insert (slug, name, bio, address, city_id, instagram, hue) on public.providers to authenticated;
drop policy if exists providers_insert on public.providers;
create policy providers_insert on public.providers for insert to authenticated
  with check (owner_id = auth.uid() and status = 'pending' and public.my_provider() is null);
-- Edición: el dueño cambia solo datos de vitrina (no estado, verificación ni puntajes).
grant update (name, bio, address, lat, lng, instagram, hue, photo_path) on public.providers to authenticated;
drop policy if exists providers_update on public.providers;
create policy providers_update on public.providers for update to authenticated
  using (owner_id = auth.uid() and status <> 'deleted') with check (owner_id = auth.uid());

-- owner_id se completa solo (el cliente no lo puede elegir).
create or replace function public.providers_set_owner() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() then new.owner_id := auth.uid(); new.status := 'pending'; new.dni_verified := false; end if;
  return new;
end $$;
drop trigger if exists providers_set_owner on public.providers;
create trigger providers_set_owner before insert on public.providers for each row execute function public.providers_set_owner();

-- El dueño lee sus datos privados y solo puede cambiar su teléfono y su meta. mp_connected, DNI y Mercado Pago los escriben el servidor.
grant select, update (phone, monthly_goal) on public.provider_private to authenticated;
drop policy if exists pp_read on public.provider_private;
create policy pp_read on public.provider_private for select to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pp_update on public.provider_private;
create policy pp_update on public.provider_private for update to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
-- provider_secrets: sin políticas = solo service_role (Edge Functions).

grant select on public.provider_categories to anon, authenticated;
grant insert, delete on public.provider_categories to authenticated;
drop policy if exists pc_read on public.provider_categories;
create policy pc_read on public.provider_categories for select using (active or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pc_write on public.provider_categories;
create policy pc_write on public.provider_categories for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pc_delete on public.provider_categories;
create policy pc_delete on public.provider_categories for delete to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;
drop policy if exists services_read on public.services;
create policy services_read on public.services for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.status = 'active') or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists services_write on public.services;
create policy services_write on public.services for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.service_addons to anon, authenticated;
grant insert, update, delete on public.service_addons to authenticated;
drop policy if exists addons_read on public.service_addons;
create policy addons_read on public.service_addons for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.status = 'active') or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists addons_write on public.service_addons;
create policy addons_write on public.service_addons for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.provider_settings, public.provider_hours to anon, authenticated;
grant insert, update, delete on public.provider_settings, public.provider_hours to authenticated;
drop policy if exists ps_read on public.provider_settings;
create policy ps_read on public.provider_settings for select using (true);
drop policy if exists ps_write on public.provider_settings;
create policy ps_write on public.provider_settings for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists ph_read on public.provider_hours;
create policy ph_read on public.provider_hours for select using (true);
drop policy if exists ph_write on public.provider_hours;
create policy ph_write on public.provider_hours for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

-- ---------- Personas ----------
grant select, update (full_name, phone, avatar_path) on public.profiles to authenticated;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- app_admins: sin políticas (se gestiona desde el panel de Supabase).

grant select on public.wallets, public.wallet_movements to authenticated;
drop policy if exists wallets_self on public.wallets;
create policy wallets_self on public.wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists wmov_self on public.wallet_movements;
create policy wmov_self on public.wallet_movements for select to authenticated using (user_id = auth.uid());

-- ---------- Turnos ----------
-- Cliente: ve los suyos. Prestador: ve los de su agenda. Nadie más.
grant select on public.bookings to authenticated;
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using (client_id = (select auth.uid()) or (provider_id = (select public.my_provider()) or (select public.is_admin())));
-- El prestador agenda a mano y bloquea horarios (sin dinero de por medio).
grant insert (provider_id, service_id, client_name, client_phone, service_name, source, status, starts_at, ends_at, price)
  on public.bookings to authenticated;
drop policy if exists bookings_manual on public.bookings;
create policy bookings_manual on public.bookings for insert to authenticated
  with check ((provider_id = (select public.my_provider()) or (select public.is_admin())) and source in ('manual','block') and status = 'confirmed'
              and paid_mp = 0 and paid_wallet = 0 and cashback = 0 and client_id is null);
-- Cambios de estado y dinero: solo por funciones (0004). Desbloquear un horario propio:
grant delete on public.bookings to authenticated;
drop policy if exists bookings_unblock on public.bookings;
create policy bookings_unblock on public.bookings for delete to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())) and source = 'block');

grant select, insert, delete on public.waitlist to authenticated;
drop policy if exists waitlist_self on public.waitlist;
create policy waitlist_self on public.waitlist for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and day between current_date - 1 and current_date + 120);

-- ---------- Panel del prestador (solo el dueño) ----------
do $$ declare t text; begin
  foreach t in array array['provider_clients','products','walkins','expenses','message_templates'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t||'_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())))', t||'_owner', t);
  end loop;
end $$;

-- ---------- Comunidad ----------
grant select on public.reviews, public.media, public.posts to anon, authenticated;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select using (true);
-- Reseña: solo quien fue atendido por ese prestador, una por turno.
grant insert (provider_id, booking_id, author, stars, body) on public.reviews to authenticated;
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated
  with check (client_id = auth.uid() and exists (
    select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid()
      and b.provider_id = reviews.provider_id and b.status = 'done'));
create or replace function public.reviews_set_client() returns trigger language plpgsql as $$
begin
  new.client_id := auth.uid();
  -- el nombre visible lo pone el sistema (nombre + inicial del apellido), no el usuario
  select coalesce(nullif(split_part(trim(full_name),' ',1),''),'Cliente') || coalesce(' ' || nullif(left(split_part(trim(full_name),' ',2),1),'') || '.','')
    into new.author from public.profiles where id = auth.uid();
  new.author := coalesce(new.author, 'Cliente');
  new.reply := null;
  return new;
end $$;
drop trigger if exists reviews_set_client on public.reviews;
create trigger reviews_set_client before insert on public.reviews for each row execute function public.reviews_set_client();
-- El prestador solo puede responder.
grant update (reply) on public.reviews to authenticated;
drop policy if exists reviews_reply on public.reviews;
create policy reviews_reply on public.reviews for update to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

drop policy if exists media_read on public.media;

create policy media_read on public.media for select using (true);
grant insert, delete on public.media to authenticated;
drop policy if exists media_write on public.media;
create policy media_write on public.media for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin()))
  and storage_path ~ ('^' || provider_id::text || '/[A-Za-z0-9._-]{1,120}$') and storage_path !~ '\.\.');
drop policy if exists media_delete on public.media;
create policy media_delete on public.media for delete to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin())));

drop policy if exists posts_read on public.posts;

create policy posts_read on public.posts for select using (true);
grant insert on public.posts to authenticated;
drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select, insert, delete on public.follows to authenticated;
drop policy if exists follows_self on public.follows;
create policy follows_self on public.follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Secuencias de identidad que usan los inserts permitidos.
grant usage on all sequences in schema public to authenticated;

-- ---------- Mensajes a clientes ----------
-- Se crean SOLO con la función send_client_messages (valida que sean clientes del prestador y limita la cantidad).
grant select on public.client_messages to authenticated;
drop policy if exists cm_read on public.client_messages;
create policy cm_read on public.client_messages for select to authenticated
  using (user_id = auth.uid() or provider_id = (select public.my_provider()));

-- ---------- Fotos: cada uno solo puede usar archivos de SU carpeta ----------
create or replace function public.avatar_owner_check() returns trigger language plpgsql as $$
begin
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then raise exception 'bad_photo_path'; end if;
  return new;
end $$;
create or replace function public.photo_owner_check() returns trigger language plpgsql as $$
begin
  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> coalesce(new.owner_id::text, '-') then raise exception 'bad_photo_path'; end if;
  return new;
end $$;
drop trigger if exists profiles_photo_check on public.profiles;
create trigger profiles_photo_check before insert or update of avatar_path on public.profiles for each row execute function public.avatar_owner_check();
drop trigger if exists providers_photo_check on public.providers;
create trigger providers_photo_check before insert or update of photo_path on public.providers for each row execute function public.photo_owner_check();

-- ---------- Tarjeta de sellos: cada uno ve lo suyo; solo se modifica con funciones del servidor ----------
grant select on public.loyalty_cards, public.loyalty_events to authenticated;
drop policy if exists lc_read on public.loyalty_cards;
create policy lc_read on public.loyalty_cards for select to authenticated
  using (user_id = (select auth.uid()) or provider_id = (select public.my_provider()));
drop policy if exists le_read on public.loyalty_events;
create policy le_read on public.loyalty_events for select to authenticated
  using (user_id = (select auth.uid()) or provider_id = (select public.my_provider()));

-- ---------- Configuración general: todos leen la comisión; solo un admin la cambia (con admin_set_commission) ----------
grant select on public.app_settings to anon, authenticated;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);

-- ---------- Cierres de caja: solo el dueño ----------
alter table public.cash_closings enable row level security;
grant select, insert, update, delete on public.cash_closings to authenticated;
drop policy if exists cash_closings_owner on public.cash_closings;
create policy cash_closings_owner on public.cash_closings for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())))
  with check ((provider_id = (select public.my_provider()) or (select public.is_admin())) and period between current_date - 800 and current_date + 1);

-- ---------- Panel admin: notas, gastos y cierres. Sin acceso directo desde la app (solo funciones de admin) ----------
alter table public.admin_notes enable row level security;
alter table public.admin_expenses enable row level security;
alter table public.admin_closings enable row level security;
revoke all on public.admin_notes, public.admin_expenses, public.admin_closings from anon, authenticated;

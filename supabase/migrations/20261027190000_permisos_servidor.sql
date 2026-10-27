-- =====================================================================
-- TuTiempo · Permisos explícitos para las Edge Functions (H32)
-- Desde el 30/05/2026 los proyectos nuevos de Supabase no dan permisos por defecto sobre las tablas nuevas de public a
-- anon, authenticated ni service_role (y desde el 30/10/2026 tampoco los existentes para las tablas que se creen). Las
-- migraciones ya daban explícitos los de anon y authenticated; los de service_role (la clave secreta de las funciones)
-- se daban solo en las tablas de cobros. En un proyecto nuevo, mp-oauth no podía leer providers y respondía
-- "not_a_provider"; mp-create-preference tampoco podía leer bookings.
-- Acá, solo lo que las funciones leen o escriben directo (lo demás lo hacen con funciones security definer):
--   - providers:        mp-oauth (el prestador del usuario) y mp-create-preference (el nombre)
--   - bookings:         mp-create-preference (las reservas a pagar y mp_preference_id)
--   - mp_oauth_states:  mp-oauth (state y PKCE del OAuth)
-- En un proyecto viejo ya los tenía: no cambia nada. No cambia datos.
-- =====================================================================
set search_path = public, extensions;

grant select on public.providers to service_role;
grant select, update on public.bookings to service_role;
grant select, insert, delete on public.mp_oauth_states to service_role;

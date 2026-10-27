-- SOLO PARA PRUEBAS LOCALES: un proyecto de Supabase creado antes del 30/05/2026, que da todos los permisos sobre las
-- tablas nuevas de public a anon, authenticated y service_role (la RLS y los revoke de las migraciones los cierran).
-- Se carga después de supabase_emulation.sql (lo usa test_mudanza, que parte de una base de la versión 31).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

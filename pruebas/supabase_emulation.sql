-- SOLO PARA PRUEBAS LOCALES: imita lo que Supabase ya trae (roles, schema auth, storage, extensions).
-- En Supabase real NO se ejecuta este archivo.
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'authpass'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
-- Como un proyecto NUEVO de Supabase (desde el 30/05/2026): las tablas nuevas de public no traen permisos para anon,
-- authenticated ni service_role; cada migración los da explícitos. Los proyectos viejos sí los traían: test_mudanza
-- carga además pruebas/supabase_emulation_proyecto_viejo.sql.
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant all on schema public to anon, authenticated, service_role;

create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
-- como Supabase: fecha en que se confirmó el email (Bloque 3: solo se manda email a direcciones confirmadas)
alter table auth.users add column if not exists email_confirmed_at timestamptz;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt()->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(auth.jwt()->>'role','anon') $$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid default auth.uid(), created_at timestamptz default now());
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

-- Vault y pg_net (Bloque 2a): lo mínimo para probar el cron de devoluciones. En Supabase vienen con el proyecto.
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, created_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, created_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$ insert into vault.secrets (name, secret) values (new_name, new_secret) returning id $$;
revoke all on schema vault from public, anon, authenticated;
revoke all on all tables in schema vault from public, anon, authenticated;
create schema if not exists net;
create table if not exists net.requests (id bigserial primary key, url text, headers jsonb, body jsonb, timeout_milliseconds int, created_at timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.requests (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id $$;
revoke all on schema net from public, anon, authenticated;

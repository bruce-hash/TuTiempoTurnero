-- =====================================================================
-- TuTiempo · 0006 · Soporte para Mercado Pago (OAuth de prestadores)
-- Solo lo usan las Edge Functions con service_role. Sin políticas = nadie más lo ve.
-- =====================================================================
create table if not exists public.mp_oauth_states (
  state       text primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.mp_oauth_states enable row level security;
revoke all on public.mp_oauth_states from anon, authenticated;

-- v31: PKCE (código verificador por cada intento de conexión; solo lo leen las Edge Functions)
alter table public.mp_oauth_states add column if not exists code_verifier text;

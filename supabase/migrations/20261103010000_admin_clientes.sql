-- =====================================================================
-- TuTiempo · V6 resto · C44 · "Clientes" en el Resumen del panel de TuTiempo
-- El indicador "Clientes" contaba todas las cuentas (profiles), también las de negocio y las admin. Desde D33 una
-- cuenta es de cliente o de negocio: admin_client_counts() cuenta solo las de cliente (sin negocio vigente y que no
-- son admin) y las nuevas del mes (Buenos Aires). Los turnos ya tienen su indicador ("Turnos del mes").
-- Idempotente y sin borrar datos.
-- =====================================================================

create or replace function public.admin_client_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m0 timestamptz := date_trunc('month', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires';
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (
    with c as (
      select pr.created_at from public.profiles pr
       where not exists (select 1 from public.providers p where p.owner_id = pr.id and p.status <> 'deleted')
         and not exists (select 1 from public.app_admins a where a.user_id = pr.id))
    select jsonb_build_object('clients', (select count(*) from c), 'new_clients_month', (select count(*) from c where created_at >= m0)));
end $$;

revoke execute on function public.admin_client_counts() from public, anon;
grant execute on function public.admin_client_counts() to authenticated;

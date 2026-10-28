-- =====================================================================
-- TuTiempo · Bloque D · "Exigir DNI para aprobar prestadores" (D26)
-- La verificación por DNI (H10, D23, D24) queda detrás de una opción del panel admin, hoy activada: si TuTiempo decide
-- no pedir más el DNI, se apaga desde Comisión → Verificación y no hace falta cambiar código.
--   - app_settings.require_dni (por defecto true: todo sigue como hasta ahora).
--   - admin_set_provider: con la opción activada, activar sigue pidiendo número y fotos (o una verificación anterior con
--     fecha) y deja quién y cuándo verificó; apagada, activa sin DNI y no marca "Identidad verificada" (dni_verified
--     queda como estaba: el perfil público solo muestra el sello a quien se verificó de verdad).
--   - admin_set_require_dni(on): solo el admin.
--   - my_provider_status(): el estado del perfil propio (pending, active, suspended) para los pasos del panel.
-- El navegador lee la opción con el permiso de lectura de app_settings que ya tenía (grant select en la tabla).
-- No cambia datos.
-- =====================================================================
set search_path = public, extensions;

alter table public.app_settings add column if not exists require_dni boolean not null default true;

create or replace function public.admin_set_require_dni(p_on boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.app_settings set require_dni = coalesce(p_on, true), updated_at = now() where id;
  return coalesce(p_on, true);
end $$;

-- Igual que en 20261026025356_dni_retencion.sql, salvo el DNI: solo se exige con require_dni.
create or replace function public.admin_set_provider(pid bigint, p_status text, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p record; ph jsonb; need_dni boolean := coalesce((select s.require_dni from public.app_settings s where s.id), true);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  select pr.id, pr.owner_id, pr.dni_verified, pp.dni_number, pp.dni_verified_at into p
    from public.providers pr left join public.provider_private pp on pp.provider_id = pr.id
   where pr.id = pid and pr.status <> 'deleted' for update of pr;
  if p.id is null then return; end if;
  if p_status = 'active' and not need_dni then
    -- sin DNI exigido: se activa y el sello de identidad queda como estaba
    update public.providers set status = 'active', updated_at = now() where id = pid;
  elsif p_status = 'active' then
    if not (p.dni_verified and p.dni_verified_at is not null) then
      if p.dni_number is null then raise exception 'dni_missing'; end if;
      ph := public.dni_photos(p.owner_id);
      if not ((ph->>'front')::boolean and (ph->>'back')::boolean) then raise exception 'dni_photos_missing'; end if;
    end if;
    update public.providers set status = 'active', dni_verified = true, updated_at = now() where id = pid;
    -- verificar con las fotos deja quién y cuándo (también a uno verificado antes del 2b, sin fecha)
    if not (p.dni_verified and p.dni_verified_at is not null) then
      update public.provider_private set dni_verified_at = now(), dni_verified_by = auth.uid() where provider_id = pid;
    end if;
  else
    update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid;
  end if;
end $$;

-- estado del perfil del prestador que llama (los pasos del panel: "Aprobación de TuTiempo" cuando no se exige DNI)
create or replace function public.my_provider_status() returns text
language sql stable security definer set search_path = public as $$
  select p.status from public.providers p where p.owner_id = auth.uid() and p.status <> 'deleted' limit 1
$$;

revoke execute on function public.admin_set_require_dni(boolean) from public, anon, authenticated;
grant execute on function public.admin_set_require_dni(boolean) to authenticated;
revoke execute on function public.admin_set_provider(bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_provider(bigint, text, boolean) to authenticated;
revoke execute on function public.my_provider_status() from public, anon, authenticated;
grant execute on function public.my_provider_status() to authenticated;

-- =====================================================================
-- TuTiempo · Bloque 2b · Dirección del sitio: solo https:// y el dominio (H24)
-- admin_set_site_url aceptaba http://, un puerto y quitaba la barra final en silencio. Ahora la dirección es https:// y
-- un dominio (etiquetas de letras, números y guiones, con un punto como mínimo), sin puerto, carpeta, parámetros ni barra
-- al final; si no, 'bad_site_url'. Es la misma regla que src/lib/sitio.js (lo verifica pruebas/unidad.mjs).
-- No cambia datos: si la dirección guardada no cumple la regla nueva, la migración sigue y avisa (docs/02).
-- =====================================================================
set search_path = public, extensions;

create or replace function public.site_url_ok(p_url text) returns boolean
language sql immutable set search_path = public as $$
  select p_url is not null and char_length(p_url) <= 100
     and p_url ~ '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
$$;

-- la misma regla en la tabla: también la frena una escritura que no pase por la función
alter table public.app_settings drop constraint if exists app_settings_site_url_check;
alter table public.app_settings add constraint app_settings_site_url_check check (public.site_url_ok(site_url)) not valid;
do $$ begin
  alter table public.app_settings validate constraint app_settings_site_url_check;
exception when check_violation then
  raise warning 'site_url: la dirección guardada no es https:// y un dominio; cambiala en Comisión → Dirección del sitio (docs/02)';
end $$;

-- el admin cambia la dirección del sitio (en minúsculas; sin barra al final ni nada después del dominio)
create or replace function public.admin_set_site_url(p_url text) returns text
language plpgsql security definer set search_path = public as $$
declare url text := lower(btrim(coalesce(p_url, '')));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not public.site_url_ok(url) then raise exception 'bad_site_url'; end if;
  update public.app_settings set site_url = url, updated_at = now() where id;
  return url;
end $$;

revoke execute on function public.admin_set_site_url(text) from public, anon, authenticated;
grant execute on function public.admin_set_site_url(text) to authenticated;

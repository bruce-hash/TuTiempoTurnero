-- =====================================================================
-- TuTiempo · Bloque 2b · Retención de las fotos del DNI (D24)
-- Las fotos (bucket privado "dni", carpeta <usuario>/) se borran:
--   - prestador verificado: a los 30 días de la verificación (quedan el número, la fecha y quién verificó);
--   - alta no aprobada o abandonada: a los 90 días de la última foto subida;
--   - baja del prestador: en el momento (y las de una carpeta que ya no es de ningún prestador).
-- Las borra la Edge Function dni-cleanup con la API de Storage (un DELETE en storage.objects deja el archivo huérfano):
-- pide la lista a dni_photos_due(), borra y avisa con dni_photos_deleted(). La llama pg_cron una vez por día y la baja
-- del prestador en el momento (run_dni_cleanup, con la misma URL y CRON_SECRET de Vault que run_refunds).
-- Un prestador ya verificado se puede volver a activar (después de suspenderlo) sin las fotos.
-- No cambia datos al correr: el borrado lo hace la función.
-- =====================================================================
set search_path = public, extensions;

alter table public.provider_private add column if not exists dni_photos_deleted_at timestamptz;

-- ---------- Qué fotos ya hay que borrar ----------
-- Una fila por carpeta y motivo, con las rutas (dentro del bucket) a borrar.
create or replace function public.dni_photos_due(p_limit int default 100)
returns table (folder text, reason text, paths text[])
language sql stable security definer set search_path = public as $$
  with files as (
    select split_part(o.name, '/', 1) as folder, o.name, o.created_at
      from storage.objects o where o.bucket_id = 'dni'
  ), owner_of as (
    select f.folder, max(f.created_at) as last_upload, lp.id as provider_id, lp.dni_verified, lp.dni_verified_at
      from files f
      left join lateral (
        select p.id, p.dni_verified, pp.dni_verified_at
          from public.providers p left join public.provider_private pp on pp.provider_id = p.id
         where p.owner_id::text = f.folder and p.status <> 'deleted'
         order by p.created_at desc limit 1) lp on true
     group by f.folder, lp.id, lp.dni_verified, lp.dni_verified_at
  ), due as (
    select f.folder, f.name,
           case
             -- baja: la carpeta ya no es de ningún prestador (provider_teardown deja owner_id en null)
             when w.provider_id is null then 'baja'
             -- verificado: 30 días después de verificar (sin fecha, de antes del 2b: desde la última foto)
             when w.dni_verified and coalesce(w.dni_verified_at, w.last_upload) <= now() - interval '30 days' then 'verificado'
             -- sin aprobar: 90 días desde la última foto subida
             when not w.dni_verified and w.last_upload <= now() - interval '90 days' then 'sin_aprobar'
           end as reason
      from files f join owner_of w on w.folder = f.folder
  )
  select d.folder, d.reason, array_agg(d.name order by d.name)
    from due d where d.reason is not null
   group by d.folder, d.reason
   order by d.folder, d.reason
   limit greatest(coalesce(p_limit, 100), 1)
$$;

-- ---------- La función avisa qué borró ----------
-- Devuelve cuántas de esas rutas siguen en el bucket (0 = borradas). Cuando la carpeta queda vacía, el prestador queda
-- con dni_paths vacío y la fecha del borrado.
create or replace function public.dni_photos_deleted(p_folder text, p_paths text[]) returns int
language plpgsql security definer set search_path = public as $$
declare left_n int;
begin
  select count(*) into left_n from storage.objects o where o.bucket_id = 'dni' and o.name = any(coalesce(p_paths, '{}'));
  if not exists (select 1 from storage.objects o where o.bucket_id = 'dni' and split_part(o.name, '/', 1) = p_folder) then
    update public.provider_private pp set dni_paths = '{}', dni_photos_deleted_at = now()
      from public.providers p
     where p.id = pp.provider_id and p.owner_id::text = p_folder and p.status <> 'deleted';
  end if;
  return left_n;
end $$;

-- ---------- Llamar a dni-cleanup (cron y baja) ----------
create or replace function public.run_dni_cleanup() returns bigint
language plpgsql security definer set search_path = public as $$
declare url text; key text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'tt_project_url';
  select decrypted_secret into key from vault.decrypted_secrets where name = 'tt_cron_secret';
  if coalesce(url, '') = '' or coalesce(key, '') = '' then
    raise warning 'run_dni_cleanup: faltan tt_project_url o tt_cron_secret en Vault (ver docs/02)';
    return null;
  end if;
  return net.http_post(
    url := rtrim(url, '/') || '/functions/v1/dni-cleanup',
    headers := jsonb_build_object('Authorization', 'Bearer ' || key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
end $$;

-- baja del prestador: las fotos se borran en el momento. pg_net manda el pedido después del commit, así que la función
-- ya ve al prestador dado de baja. Si algo falla acá, la baja sigue igual (la tarea diaria las borra después).
create or replace function public.provider_deleted_dni() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = 'net' and f.proname = 'http_post') then
    begin
      perform public.run_dni_cleanup();
    exception when others then
      raise warning 'provider_deleted_dni: no se pudo pedir el borrado de las fotos (%): queda para la tarea diaria', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists provider_deleted_dni on public.providers;
create trigger provider_deleted_dni after update of status on public.providers
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.provider_deleted_dni();

-- tarea diaria (como tt-refunds: requiere pg_cron y pg_net; si no están, no hace nada y se puede volver a correr)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.schedule('tt-dni-cleanup', '37 3 * * *', 'select public.run_dni_cleanup()');
  end if;
end $$;

-- ---------- Activar = verificar, una sola vez ----------
-- Igual que en 20261025194744_dni.sql, salvo que un prestador ya verificado (por ejemplo, suspendido y vuelto a
-- activar) no necesita las fotos: a los 30 días de verificarlo ya no están (D24).
create or replace function public.admin_set_provider(pid bigint, p_status text, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p record; ph jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  select pr.id, pr.owner_id, pr.dni_verified, pp.dni_number into p
    from public.providers pr left join public.provider_private pp on pp.provider_id = pr.id
   where pr.id = pid and pr.status <> 'deleted' for update of pr;
  if p.id is null then return; end if;
  if p_status = 'active' then
    if not p.dni_verified then
      if p.dni_number is null then raise exception 'dni_missing'; end if;
      ph := public.dni_photos(p.owner_id);
      if not ((ph->>'front')::boolean and (ph->>'back')::boolean) then raise exception 'dni_photos_missing'; end if;
    end if;
    update public.providers set status = 'active', dni_verified = true, updated_at = now() where id = pid;
    if not p.dni_verified then
      update public.provider_private set dni_verified_at = now(), dni_verified_by = auth.uid() where provider_id = pid;
    end if;
  else
    update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid;
  end if;
end $$;

-- ---------- Permisos ----------
revoke execute on function public.dni_photos_due(int), public.dni_photos_deleted(text, text[]), public.run_dni_cleanup(),
  public.provider_deleted_dni() from public, anon, authenticated;
grant execute on function public.dni_photos_due(int), public.dni_photos_deleted(text, text[]), public.run_dni_cleanup() to service_role;

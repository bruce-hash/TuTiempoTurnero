-- =====================================================================
-- TuTiempo · 0005 · Archivos (Storage), datos base y tareas programadas
-- =====================================================================
set search_path = public, extensions;

-- Fotos y videos de trabajos: lectura pública, escritura solo del dueño en su carpeta /<provider_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 15728640, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict (id) do nothing;
-- DNI: privado. Sube el dueño en /<user_id>/..., lo ve solo un admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dni', 'dni', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists media_upload on storage.objects;
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_provider()::text);
drop policy if exists media_remove on storage.objects;
create policy media_remove on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_provider()::text);
drop policy if exists media_public on storage.objects;
create policy media_public on storage.objects for select using (bucket_id = 'media');
drop policy if exists dni_upload on storage.objects;
create policy dni_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dni' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists dni_admin on storage.objects;
create policy dni_admin on storage.objects for select to authenticated
  using (bucket_id = 'dni' and public.is_admin());

-- Ciudad y rubros
insert into public.cities (slug, name) values ('olavarria', 'Olavarría') on conflict (slug) do nothing;
insert into public.categories (id, slug, name, sort) values
  ('b','barberias','Barberías',1), ('p','peluquerias','Peluquerías',2), ('m','masajes','Masajes',3),
  ('l','pestanas','Pestañas',4), ('u','unas','Uñas',5), ('d','depilacion','Depilación',6)
on conflict (id) do update set name = excluded.name, sort = excluded.sort;

-- Tareas programadas (requiere activar la extensión pg_cron en Supabase → Database → Extensions).
-- Si pg_cron no está activo, este bloque no hace nada y se puede correr después.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tt-expire-holds', '* * * * *', 'select public.expire_holds(null)');
    perform cron.schedule('tt-reshuffle', '5 3 * * *', 'select public.reshuffle_providers(); select public.purge_deleted_secrets();');   -- también recalcula la actividad
    perform cron.schedule('tt-notices', '*/10 * * * *', 'select public.send_scheduled_notices()'); -- recordatorios y cumpleaños en la app
  end if;
end $$;

-- ---------- Fotos de perfil (clientes y prestadores) ----------
-- Público para mostrarlas; cada usuario solo escribe en su carpeta (su id). Solo imágenes, máximo 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists avatars_public on storage.objects;
create policy avatars_public on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_upload on storage.objects;
create policy avatars_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
drop policy if exists avatars_remove on storage.objects;
create policy avatars_remove on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- TuTiempo · Bloque 2b (ajuste) · Fotos del DNI: solo las sube el dueño de un prestador
-- La política dni_upload dejaba subir a cualquier usuario con sesión (en su carpeta). dni-cleanup (D24) borra en el
-- momento las fotos de una carpeta que no es de ningún prestador, así que una foto subida sin prestador se borraba
-- enseguida. Ahora para subir hay que ser dueño de un prestador no eliminado (my_provider()): toda foto que entra es de
-- un prestador, y "carpeta sin prestador" es solo una baja. En el alta, el perfil se crea antes de subir las fotos.
-- No cambia datos.
-- =====================================================================
set search_path = public, extensions;

drop policy if exists dni_upload on storage.objects;
create policy dni_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dni' and public.my_provider() is not null
              and name ~ ('^' || auth.uid()::text || '/(frente|dorso)-[0-9]{1,15}\.(jpg|jpeg|png|webp|pdf)$'));

-- =====================================================================
-- TuTiempo · Bloque 2b · DNI del prestador (H10)
-- - El DNI ya no viaja en los metadatos de la cuenta (auth.users): lo guarda el dueño con set_my_dni() (o el alta,
--   register_provider, cuando ya hay sesión). Se borra el que haya quedado en raw_user_meta_data.
-- - Número: 7 u 8 dígitos, único entre prestadores no eliminados (los eliminados ya no lo guardan: provider_teardown).
-- - Fotos: frente y dorso en el bucket privado "dni", en la carpeta del dueño (<usuario>/frente-<n>.<ext> y
--   <usuario>/dorso-<n>.<ext>). Sube solo el dueño, las ve solo el admin (URL firmada, ver m-admin.js).
-- - Activar = verificar: admin_set_provider(…, 'active') exige número y las dos fotos, marca dni_verified y guarda
--   quién y cuándo (provider_private.dni_verified_by / dni_verified_at).
-- =====================================================================
set search_path = public, extensions;

-- ---------- Quién y cuándo verificó ----------
alter table public.provider_private add column if not exists dni_verified_at timestamptz;
alter table public.provider_private add column if not exists dni_verified_by uuid references auth.users(id) on delete set null;

-- ---------- DNI único entre prestadores no eliminados ----------
-- los eliminados no conservan el DNI (provider_teardown lo borra); por las dudas, los que hayan quedado
update public.provider_private pp set dni_number = null
  from public.providers p where p.id = pp.provider_id and p.status = 'deleted' and pp.dni_number is not null;
do $$
declare dup text;
begin
  select string_agg(format('DNI terminado en %s (prestadores %s)', right(dni_number, 3), ids), '; ') into dup
    from (select dni_number, string_agg(provider_id::text, ', ' order by provider_id) as ids
            from public.provider_private where dni_number is not null group by dni_number having count(*) > 1) d;
  if dup is not null then
    raise exception 'dni_duplicado: hay prestadores con el mismo DNI (%). Resolverlo a mano antes de esta migración (docs/02).', dup;
  end if;
end $$;
create unique index if not exists provider_private_dni_unique on public.provider_private (dni_number) where dni_number is not null;

-- ---------- Fotos cargadas (frente y dorso) ----------
create or replace function public.dni_photos(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'front', exists (select 1 from storage.objects o where o.bucket_id = 'dni' and o.name like p_owner::text || '/frente-%'),
    'back',  exists (select 1 from storage.objects o where o.bucket_id = 'dni' and o.name like p_owner::text || '/dorso-%'))
$$;

-- solo el dueño sube, en su carpeta y con el nombre de frente o dorso; solo el admin lee (ya estaba: dni_admin)
drop policy if exists dni_upload on storage.objects;
create policy dni_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dni' and name ~ ('^' || auth.uid()::text || '/(frente|dorso)-[0-9]{1,15}\.(jpg|jpeg|png|webp|pdf)$'));

-- ---------- El dueño carga su número ----------
create or replace function public.set_my_dni(p_dni text) returns void
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); verified boolean;
begin
  if pid is null then raise exception 'not_provider'; end if;
  select dni_verified into verified from public.providers where id = pid;
  if verified then raise exception 'dni_locked'; end if;   -- ya verificado: lo cambia solo TuTiempo
  if coalesce(p_dni, '') !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
  begin
    update public.provider_private set dni_number = p_dni where provider_id = pid;
  exception when unique_violation then
    raise exception 'dni_taken';
  end;
end $$;

-- estado de la verificación para el panel del prestador (sin mostrar el número)
create or replace function public.my_dni_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider(); r jsonb;
begin
  if pid is null then raise exception 'not_provider'; end if;
  select jsonb_build_object('number', pp.dni_number is not null, 'verified', p.dni_verified, 'verified_at', pp.dni_verified_at)
         || public.dni_photos(p.owner_id)
    into r
    from public.providers p join public.provider_private pp on pp.provider_id = p.id where p.id = pid;
  return r;
end $$;

-- ---------- Alta: el DNI es opcional (sin sesión todavía no se puede guardar; lo carga después con set_my_dni) ----------
create or replace function public.register_provider(p_name text, p_address text, p_categories text[], p_phone text,
                                                    p_dni text, p_instagram text default null, p_city text default 'olavarria')
returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pid bigint; cid smallint; base text; sl text; n int := 0; c text; d int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if exists (select 1 from public.providers where owner_id = uid) then raise exception 'already_registered'; end if;
  if p_categories is null or array_length(p_categories,1) is null then raise exception 'category_required'; end if;
  if array_length(p_categories,1) > 6 then raise exception 'too_many_categories'; end if;
  if p_dni is not null and p_dni !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
  if p_dni is not null and exists (select 1 from public.provider_private where dni_number = p_dni) then raise exception 'dni_taken'; end if;
  select id into cid from public.cities where slug = p_city;
  if cid is null then raise exception 'bad_city'; end if;
  base := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(base) < 3 then base := 'prestador'; end if;
  base := left(base, 50); sl := base;
  -- Bloque B: las palabras reservadas se tratan como un slug ocupado (llevan sufijo: panel → panel-1)
  while exists (select 1 from public.providers where slug = sl) or public.is_reserved_slug(sl) loop
    n := n + 1; sl := base || '-' || n;
  end loop;
  insert into public.providers (owner_id, slug, name, address, city_id, instagram, hue, status)
  values (uid, sl, left(p_name, 80), left(p_address, 160), cid, left(p_instagram, 60), (abs(hashtext(sl)) % 360), 'pending')
  returning id into pid;
  begin
    insert into public.provider_private (provider_id, phone, dni_number) values (pid, left(p_phone, 40), p_dni);
  exception when unique_violation then
    raise exception 'dni_taken';
  end;
  insert into public.provider_settings (provider_id) values (pid);
  foreach c in array p_categories loop
    insert into public.provider_categories (provider_id, category_id) values (pid, c) on conflict do nothing;
  end loop;
  for d in 1 .. 5 loop
    insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00');
  end loop;
  insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
  insert into public.message_templates (provider_id, key, enabled, body) values
   (pid,'conf',true,'¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.'),
   (pid,'r24',true,'{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¿Venís? Confirmá acá: {link}'),
   (pid,'r2',true,'¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}'),
   (pid,'rev',true,'¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? {link}'),
   (pid,'back',true,'{nombre}, ya te toca tu próximo turno. ¿Te reservo? Elegí tu horario: {link}'),
   (pid,'bday',false,'¡Feliz cumpleaños, {nombre}! Este mes tenés 15% off. Reservá: {link}');
  return pid;
end $$;

-- ---------- Activar = verificar ----------
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
    if p.dni_number is null then raise exception 'dni_missing'; end if;
    ph := public.dni_photos(p.owner_id);
    if not ((ph->>'front')::boolean and (ph->>'back')::boolean) then raise exception 'dni_photos_missing'; end if;
    update public.providers set status = 'active', dni_verified = true, updated_at = now() where id = pid;
    if not p.dni_verified then
      update public.provider_private set dni_verified_at = now(), dni_verified_by = auth.uid() where provider_id = pid;
    end if;
  else
    update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid;
  end if;
end $$;

-- el listado del admin muestra el número, las fotos cargadas y quién verificó
create or replace function public.admin_providers(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(x order by x.pending desc, x.activity desc, x.created_at desc), '[]') from (
    select p.id, p.name, p.slug, p.status, p.dni_verified, p.owner_id, p.created_at, p.rating_avg, p.rating_count, p.activity, (p.status = 'pending') as pending,
           (select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from public.provider_categories pc where pc.provider_id = p.id) as categories,
           (select count(*) from public.bookings b where b.provider_id = p.id and b.source = 'app' and b.status in ('confirmed','done') and b.starts_at >= date_trunc('month', now())) as bookings_month,
           pp.mp_connected, pp.dni_number, pp.dni_verified_at,
           (select pr.full_name from public.profiles pr where pr.id = pp.dni_verified_by) as dni_verified_by,
           public.dni_photos(p.owner_id) as dni_photos,
           (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at) order by n.created_at desc), '[]')
              from (select * from public.admin_notes an where an.provider_id = p.id order by an.created_at desc limit 30) n) as notes
    from public.providers p left join public.provider_private pp on pp.provider_id = p.id
    where p.status <> 'deleted' and (p_status is null or p.status = p_status)
    order by (p.status = 'pending') desc, p.activity desc, p.created_at desc limit 500) x);
end $$;

-- ---------- Ningún DNI en los metadatos de la cuenta ----------
update auth.users set raw_user_meta_data = (raw_user_meta_data - 'dni') #- '{provider_reg,dni}'
 where raw_user_meta_data ? 'dni' or raw_user_meta_data #> '{provider_reg,dni}' is not null;
do $$ begin
  if to_regclass('auth.identities') is not null then
    execute $q$update auth.identities set identity_data = (identity_data - 'dni') #- '{provider_reg,dni}'
                where identity_data ? 'dni' or identity_data #> '{provider_reg,dni}' is not null$q$;
  end if;
end $$;

-- ---------- Permisos ----------
-- el dueño lee de provider_private solo lo que usa el panel: ni el DNI ni quién lo verificó viajan al navegador
-- (en 0003, "grant select, update (phone, monthly_goal)" daba select sobre toda la fila)
revoke select on public.provider_private from anon, authenticated;
grant select (provider_id, phone, monthly_goal, mp_connected, mp_user_id) on public.provider_private to authenticated;
revoke execute on function public.dni_photos(uuid), public.set_my_dni(text), public.my_dni_status() from public, anon, authenticated;
grant execute on function public.set_my_dni(text), public.my_dni_status() to authenticated;

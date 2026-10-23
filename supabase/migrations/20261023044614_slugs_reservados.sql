-- =====================================================================
-- TuTiempo · Bloque B · Slugs reservados
-- Las direcciones de la app (/panel, /admin, /cuenta…) no pueden ser el slug de un prestador. La lista es la misma que
-- src/lib/rutas.js (RESERVED_SLUGS); pruebas/test_db.py verifica que coincidan.
-- No cambia ningún dato: los prestadores que ya tengan un slug reservado siguen igual (la app los muestra en /p/<id>).
-- =====================================================================
create or replace function public.reserved_slugs() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'admin', 'api', 'assets', 'auth', 'ayuda', 'blog', 'buscar', 'contacto',
    'crear-cuenta', 'cuenta', 'demo', 'fonts', 'functions', 'ingresar', 'legal', 'login',
    'manifest', 'mis-turnos', 'nueva-contrasena', 'p', 'panel', 'prestadores', 'privacidad', 'registro',
    'reservar', 'rubro', 'sitemap', 'soporte', 'sumate', 'terminos', 'turno', 'turnos',
    'vendor', 'www'
  ]::text[]
$$;

create or replace function public.is_reserved_slug(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_slug, '')) = any(public.reserved_slugs())
$$;

revoke execute on function public.reserved_slugs(), public.is_reserved_slug(text) from public;
grant execute on function public.reserved_slugs(), public.is_reserved_slug(text) to anon, authenticated;

-- Alta de prestador: igual que en 0004, salvo que saltea los slugs reservados.
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
  if p_dni !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
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
  insert into public.provider_private (provider_id, phone, dni_number) values (pid, left(p_phone, 40), p_dni);
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

-- El alta directa en la tabla (permitida al dueño, ver 0003) tampoco puede usar un slug reservado.
-- "not valid": no revisa las filas que ya existen (no se toca ningún dato), solo las nuevas.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'providers_slug_not_reserved') then
    alter table public.providers add constraint providers_slug_not_reserved check (not public.is_reserved_slug(slug)) not valid;
  end if;
end $$;

do $$ declare r record; begin
  for r in select id, slug from public.providers where public.is_reserved_slug(slug) loop
    raise notice 'Prestador % tiene el slug reservado "%": la app lo muestra en /p/%', r.id, r.slug, r.id;
  end loop;
end $$;

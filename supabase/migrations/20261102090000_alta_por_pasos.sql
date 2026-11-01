-- =====================================================================
-- TuTiempo · Ingreso y registro (rediseño aprobado el 1/11) · Alta del negocio en 5 pasos
--   - provider_settings.setup_done: los pasos de "Registrá tu negocio" que el prestador ya guardó (1 Tu negocio,
--     2 Servicios, 3 Horarios, 4 Seña y cobro, 5 Verificación). Hace falta guardarlo aparte porque horarios y seña
--     tienen valores por defecto: no alcanza con mirar si hay datos. Los prestadores que ya existen quedan con los 5
--     pasos hechos (no ven nada nuevo).
--   - setup_step(n): marca un paso como guardado (solo el dueño del negocio).
--   - my_setup(): qué le falta al prestador que llama para recibir reservas: pasos sin guardar, servicios, Mercado Pago,
--     DNI (solo si "Exigir DNI" está activado, D26) y la aprobación de TuTiempo.
--   - "registrar-negocio" pasa a ser una palabra reservada (la dirección del alta; la misma lista en src/lib/rutas.js).
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- Pasos guardados ----------
alter table public.provider_settings add column if not exists setup_done smallint[];
-- los que ya existen (antes de esta migración): los 5 pasos hechos. En una segunda corrida ya no hay nulos.
update public.provider_settings set setup_done = '{1,2,3,4,5}' where setup_done is null;
alter table public.provider_settings alter column setup_done set default '{}';
alter table public.provider_settings alter column setup_done set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'provider_settings_setup_done_ok') then
    alter table public.provider_settings add constraint provider_settings_setup_done_ok
      check (setup_done <@ '{1,2,3,4,5}'::smallint[]);
  end if;
end $$;

create or replace function public.setup_step(p_step int) returns smallint[]
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); r smallint[];
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_step is null or p_step not between 1 and 5 then raise exception 'bad_step'; end if;
  update public.provider_settings
     set setup_done = (select array_agg(distinct x order by x) from unnest(setup_done || p_step::smallint) x)
   where provider_id = pid
  returning setup_done into r;
  return r;
end $$;

create or replace function public.my_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider(); p record; ph jsonb;
        need_dni boolean := coalesce((select s.require_dni from public.app_settings s where s.id), true);
begin
  if pid is null then return null; end if;
  -- sin fila de configuración (prestadores de antes, de la versión 31): ya estaban dados de alta, los 5 pasos hechos
  select pr.status, pr.owner_id, pr.dni_verified, pp.dni_number, coalesce(st.setup_done, '{1,2,3,4,5}') as steps,
         (select count(*) from public.services sv where sv.provider_id = pr.id and sv.active) as svcs
    into p
    from public.providers pr
    left join public.provider_private pp on pp.provider_id = pr.id
    left join public.provider_settings st on st.provider_id = pr.id
   where pr.id = pid;
  ph := public.dni_photos(p.owner_id);
  return jsonb_build_object(
    'steps', to_jsonb(p.steps),
    'services', p.svcs,
    'mp', public.provider_can_charge(pid),
    'dni_required', need_dni,
    -- ya tiene número y las dos fotos (o lo verificaron antes)
    'dni_ok', p.dni_verified or (p.dni_number is not null and (ph->>'front')::boolean and (ph->>'back')::boolean),
    'status', p.status);
end $$;

revoke execute on function public.setup_step(int), public.my_setup() from public, anon;
grant execute on function public.setup_step(int), public.my_setup() to authenticated;

-- ---------- Palabras reservadas (+ registrar-negocio) ----------
create or replace function public.reserved_slugs() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'admin', 'api', 'assets', 'auth', 'ayuda', 'blog', 'buscar', 'contacto',
    'crear-cuenta', 'cuenta', 'demo', 'fonts', 'functions', 'ingresar', 'legal', 'login',
    'manifest', 'mis-turnos', 'nueva-contrasena', 'p', 'panel', 'prestadores', 'privacidad', 'registrar-negocio', 'registro',
    'reservar', 'rubro', 'sitemap', 'soporte', 'sumate', 'terminos', 'turno', 'turnos',
    'vendor', 'www'
  ]::text[]
$$;

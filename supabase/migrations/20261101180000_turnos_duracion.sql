-- =====================================================================
-- TuTiempo · V3 · Agenda y horarios
--   - D31 (C23): los horarios de un servicio empiezan en la apertura y se suceden cada "duración del servicio". Si un
--     turno ya tomado (o un bloqueo) corta la secuencia, vuelve a arrancar donde termina ese turno. Vale para todos los
--     prestadores (no es una opción) y se calcula contra todos los turnos del día, de cualquier servicio. El "paso" de
--     antes (step_min) deja de usarse para la reserva online. La misma cuenta que slotsFor en src/lib/turnero.js.
--   - C39: sin descanso entre turnos. Todos los prestadores pasan a 0 y los turnos que vienen lo pierden (el horario que
--     ocupaba el descanso queda libre). Los turnos pasados no cambian.
--   - C24: el recordatorio de 24 h ya no dice "¿Venís? Confirmá acá". Los que tienen el texto de fábrica pasan al nuevo;
--     los que lo editaron conservan el suyo.
-- No borra datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- D31: los comienzos posibles de un servicio de p_dur minutos en un día (hora local del prestador) ----------
-- Recorre cada franja desde la apertura: si [p, p + duración) no se pisa con nada, es un horario y sigue en p + duración;
-- si se pisa, salta al final de lo que lo pisa (el más tardío). p_ignore: un turno que no cuenta (el que se reprograma).
create or replace function public.slot_starts(pid bigint, p_day date, p_dur int, p_ignore bigint default null)
returns setof timestamp
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); h record; p timestamp; e timestamptz;
begin
  if pid is null or p_day is null or coalesce(p_dur, 0) <= 0 then return; end if;
  for h in select opens, closes from public.provider_hours
           where provider_id = pid and dow = extract(dow from p_day)::int order by opens loop
    p := p_day + h.opens;
    while p + make_interval(mins => p_dur) <= p_day + h.closes loop
      select max(b.busy_until) into e from public.bookings b
       where b.provider_id = pid and b.status in ('hold','confirmed','done') and b.id is distinct from p_ignore
         and b.during && tstzrange(p at time zone tz, (p + make_interval(mins => p_dur)) at time zone tz, '[)');
      if e is null then
        return next p;
        p := p + make_interval(mins => p_dur);
      else
        p := greatest(e at time zone tz, p + interval '1 minute');
      end if;
    end loop;
  end loop;
end $$;

-- un comienzo es válido si está en la secuencia del día (D31), además de entrar en el horario
create or replace function public.slot_fits(pid bigint, local_start timestamp, dur int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.slot_starts(pid, local_start::date, dur) s where s = local_start)
$$;

-- primer horario libre en la ventana de reserva (para las tarjetas del listado), con la misma regla
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; t timestamp; now_l timestamp; dd int; day date;
begin
  select * into st from public.provider_settings where provider_id = pid;
  if st is null or not st.online or not public.provider_can_charge(pid) then return null; end if;
  dd := coalesce(dur, (select min(duration_min) from public.services where provider_id = pid and active));
  if dd is null then return null; end if;
  now_l := (now() at time zone tz) + make_interval(mins => st.notice_min);
  for d in 0 .. st.ahead_days - 1 loop
    day := (now() at time zone tz)::date + d;
    select min(s) into t from public.slot_starts(pid, day, dd) s where s >= now_l;
    if t is not null then return t at time zone tz; end if;
  end loop;
  return null;
end $$;

-- ---------- C39: sin descanso entre turnos ----------
update public.provider_settings set buffer_min = 0 where buffer_min <> 0;
update public.bookings set buffer_min = 0 where buffer_min <> 0 and starts_at > now() and status in ('hold','confirmed');
alter table public.provider_settings drop constraint if exists provider_settings_sin_descanso;
alter table public.provider_settings add constraint provider_settings_sin_descanso check (buffer_min = 0);

-- ---------- C24: recordatorio de 24 h sin "¿Venís? Confirmá acá" ----------
update public.message_templates
   set body = '{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. Te esperamos en {direccion}.'
 where key = 'r24' and body = '{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¿Venís? Confirmá acá: {link}';
-- el alta de prestador crea el texto nuevo
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
  if p_dni is not null and exists (select 1 from public.provider_private pp join public.providers pr on pr.id = pp.provider_id
                                    where pp.dni_number = p_dni and pr.status <> 'deleted') then raise exception 'dni_taken'; end if;
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
   (pid,'r24',true,'{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. Te esperamos en {direccion}.'),
   (pid,'r2',true,'¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}'),
   (pid,'rev',true,'¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? {link}'),
   (pid,'back',true,'{nombre}, ya te toca tu próximo turno. ¿Te reservo? Elegí tu horario: {link}'),
   (pid,'bday',false,'¡Feliz cumpleaños, {nombre}! Este mes tenés 15% off. Reservá: {link}');
  return pid;
end $$;


-- ---------- Permisos ----------
revoke execute on function public.slot_starts(bigint, date, int, bigint) from public, anon, authenticated;
grant execute on function public.slot_starts(bigint, date, int, bigint) to service_role;

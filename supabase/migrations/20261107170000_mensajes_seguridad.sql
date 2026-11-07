-- =====================================================================
-- TuTiempo · 8/11 · punto 9 · mensajes a clientes y seguidores (auditoría S19 y S01)
--   - S19 (regla de Bruno, 8/11): un profesional suspendido no puede mandar novedades ni ofertas a sus seguidores.
--     offer_slot y notify_followers piden el negocio activo (not_active); también send_client_messages (S01). Un
--     negocio pendiente todavía no se ve en la app, así que tampoco tiene seguidores ni clientes de la app a quienes
--     escribir: la misma regla lo cubre.
--   - S01: el prestador ligaba cualquier usuario a su lista de clientes (provider_clients tenía insert/update en todas
--     sus columnas, user_id incluida) y le mandaba mensajes. Ahora:
--       · la app escribe solo los datos de la ficha: insert (provider_id, name, phone, notes, birthday, profile) y
--         update (name, phone, notes, birthday, profile, contacted_at). user_id, visits, no_shows, total_spent,
--         last_visit y created_at los escriben solo las funciones (link_client al reservar, mark_booking, etc.);
--       · send_client_messages manda solo a clientes con al menos un turno con ese prestador.
--     Las fichas ya ligadas no se tocan (no se borra nada): sin un turno con ese prestador no reciben mensajes.
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ¿el negocio está activo (aprobado y no suspendido)?
create or replace function public.provider_is_active(p_provider bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from public.providers where id = p_provider), false)
$$;
revoke execute on function public.provider_is_active(bigint) from public, anon, authenticated;

-- ---------- S01 · columnas de la ficha que escribe la app ----------
revoke insert, update on public.provider_clients from authenticated;
grant insert (provider_id, name, phone, notes, birthday, profile) on public.provider_clients to authenticated;
grant update (name, phone, notes, birthday, profile, contacted_at) on public.provider_clients to authenticated;

-- ---------- S19 · ofrecer un turno libre (Agenda y Seguidores) ----------
create or replace function public.offer_slot(p_starts timestamptz, p_ends timestamptz, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; oid bigint; n int := 0; today int; cap int; msg text; lt timestamp; le timestamp;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if not public.provider_is_active(pid) then raise exception 'not_active'; end if;
  if p_starts is null or p_ends is null or p_ends <= p_starts or p_ends - p_starts > interval '14 hours'
     or p_starts > now() + interval '120 days' then
    raise exception 'bad_offer';
  end if;
  if p_starts <= now() then raise exception 'offer_past'; end if;
  -- el hueco tiene que seguir libre (ni turnos, ni reservas en pago, ni bloqueos)
  if exists (select 1 from public.bookings b where b.provider_id = pid and b.status in ('hold','confirmed','done')
               and b.during && tstzrange(p_starts, p_ends, '[)')) then
    raise exception 'offer_taken';
  end if;
  tz := coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires');
  -- de a una por prestador, para que los límites no se pasen con dos toques seguidos
  perform pg_advisory_xact_lock(hashtext('tt-offer'), pid::int);
  if p_user is null then
    if exists (select 1 from public.slot_offers where provider_id = pid and starts_at = p_starts and target_user is null) then
      raise exception 'offer_repeated';
    end if;
  else
    if not exists (select 1 from public.follows where provider_id = pid and user_id = p_user) then
      raise exception 'not_follower';
    end if;
    if exists (select 1 from public.slot_offers where provider_id = pid and starts_at = p_starts and target_user = p_user) then
      raise exception 'offer_repeated';
    end if;
  end if;
  select count(*) into today from public.slot_offers
   where provider_id = pid and (target_user is null) = (p_user is null)
     and (created_at at time zone tz)::date = (now() at time zone tz)::date;
  -- a todos: las ofertas y las novedades ("Avisar a tus seguidores") comparten el tope de 5 por día
  if p_user is null then
    today := today + public.follower_posts_today(pid, tz);
  end if;
  cap := case when p_user is null then 5 else 10 end;
  if today >= cap then raise exception 'offer_limit'; end if;

  insert into public.slot_offers (provider_id, starts_at, ends_at, target_user) values (pid, p_starts, p_ends, p_user)
  returning id into oid;
  lt := p_starts at time zone tz;
  le := p_ends at time zone tz;
  msg := 'Tengo un turno libre el ' || (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from lt)::int + 1]
         || ' ' || to_char(lt, 'DD/MM') || ' de ' || to_char(lt, 'HH24:MI') || ' a ' || to_char(le, 'HH24:MI') || '. ¿Lo querés?';
  insert into public.client_messages (provider_id, user_id, kind, ref, body)
  select pid, f.user_id, 'offer', oid::text, msg
    from public.follows f
   where f.provider_id = pid and (p_user is null or f.user_id = p_user)
  on conflict do nothing;
  get diagnostics n = row_count;
  update public.slot_offers set recipients = n where id = oid;
  return jsonb_build_object('id', oid, 'sent', n);
end $$;

-- ---------- S19 · avisar a los seguidores ----------
create or replace function public.notify_followers(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; b text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g'));
        post bigint; n int := 0; today int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if not public.provider_is_active(pid) then raise exception 'not_active'; end if;
  if char_length(b) < 2 or char_length(b) > 400 then raise exception 'bad_message'; end if;
  tz := coalesce(public.provider_tz(pid), 'America/Argentina/Buenos_Aires');
  perform pg_advisory_xact_lock(hashtext('tt-offer'), pid::int);
  select count(*) into today from public.slot_offers
   where provider_id = pid and target_user is null and (created_at at time zone tz)::date = (now() at time zone tz)::date;
  if today + public.follower_posts_today(pid, tz) >= 5 then raise exception 'offer_limit'; end if;
  insert into public.posts (provider_id, body) values (pid, b) returning id into post;
  insert into public.client_messages (provider_id, user_id, kind, ref, body)
  select pid, f.user_id, 'news', post::text, b from public.follows f where f.provider_id = pid
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('id', post, 'sent', n);
end $$;

-- ---------- S01 + S19 · mensajes a clientes ----------
create or replace function public.send_client_messages(p_client_ids bigint[], p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); b text := btrim(regexp_replace(coalesce(p_body,''), '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g'));
        n int := 0; today int; ids bigint[] := array(select distinct x from unnest(coalesce(p_client_ids,'{}')) x where x is not null);
begin
  if pid is null then raise exception 'not_provider'; end if;
  if not public.provider_is_active(pid) then raise exception 'not_active'; end if;
  if char_length(b) < 2 or char_length(b) > 500 then raise exception 'bad_message'; end if;
  if cardinality(ids) = 0 or cardinality(ids) > 300 then raise exception 'bad_recipients'; end if;
  select count(*) into today from public.client_messages where provider_id = pid and created_at > now() - interval '24 hours';
  if today + cardinality(ids) > 600 then raise exception 'too_many_messages'; end if;
  insert into public.client_messages (provider_id, user_id, body)
  select pid, c.user_id, left(replace(b, '{nombre}', split_part(c.name, ' ', 1)), 600)
  from public.provider_clients c
  where c.provider_id = pid and c.id = any(ids) and c.user_id is not null
    -- S01: solo a quien reservó alguna vez con este prestador (la ficha la liga la base al reservar, no la app)
    and exists (select 1 from public.bookings b where b.provider_id = pid and b.client_id = c.user_id);
  get diagnostics n = row_count;
  update public.provider_clients set contacted_at = now() where provider_id = pid and id = any(ids);
  return jsonb_build_object('sent', n, 'without_app', cardinality(ids) - n);
end $$;

-- =====================================================================
-- TuTiempo · 4/11 · Bloque 3 · Seguidores
--   - "Ofrecer" de la Agenda llegaba a nadie: guardaba un texto en posts que nadie lee. Ahora offer_slot le deja a cada
--     seguidor un aviso en la app (client_messages kind 'offer', con el día y la hora del hueco y un botón para
--     reservar) y un push, que respeta "Recordatorios y avisos" (profiles.push_notices). No va por email.
--   - A un seguidor puntual (Clientes → Seguidores → "Ofrecer turno"): el mismo aviso, solo a esa persona.
--   - Límites (respuesta del 4/11): cada hueco se ofrece una sola vez a todos (y una vez a cada seguidor puntual), y por
--     día del prestador (hora de su ciudad) hasta 5 ofertas a todos y 10 a seguidores puntuales.
--   - provider_followers: la lista de quienes siguen al prestador, para la pestaña Seguidores. De cada persona, el
--     nombre de pila y la inicial del apellido ("Ana G."), la foto, desde cuándo lo sigue y, si ya es cliente, su ficha.
--     Nada más (ni email ni teléfono).
--   - my_messages devuelve también el horario ofrecido (slot) y la dirección del perfil (slug), para "Reservar".
--   - Trabajos → "Avisar a tus seguidores" (un mensaje libre) tampoco le llegaba a nadie (lo mismo: un insert en posts).
--     Ahora notify_followers lo guarda en posts y a cada seguidor le deja el aviso (kind 'news', con "Ver perfil") y un
--     push "Novedad de <negocio>" (respeta "Recordatorios y avisos"). Comparte el límite con las ofertas a todos: hasta 5
--     por día entre las dos. posts deja de aceptar inserts directos (así no se saltea el límite).
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- Ofertas de horarios ----------
create table if not exists public.slot_offers (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  target_user uuid references auth.users(id) on delete cascade,   -- null = a todos los seguidores
  recipients  integer not null default 0 check (recipients >= 0),
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create unique index if not exists slot_offers_once on public.slot_offers (provider_id, starts_at) where target_user is null;
create unique index if not exists slot_offers_once_user on public.slot_offers (provider_id, starts_at, target_user) where target_user is not null;
create index if not exists slot_offers_recent on public.slot_offers (provider_id, created_at desc);
alter table public.slot_offers enable row level security;
revoke all on public.slot_offers from public, anon, authenticated;
-- el prestador ve las suyas (la Agenda marca "✓ Ofrecido"); se escriben solo con offer_slot
grant select on public.slot_offers to authenticated;
drop policy if exists slot_offers_owner on public.slot_offers;
create policy slot_offers_owner on public.slot_offers for select to authenticated
  using (provider_id = (select public.my_provider()));

-- el aviso al seguidor
alter table public.client_messages drop constraint if exists client_messages_kind_check;
alter table public.client_messages add constraint client_messages_kind_check
  check (kind in ('msg','conf','r24','r2','rev','bday','cancel','offer','news'));
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect','new_follower','offer','news'));

-- el push de una oferta se apaga con "Recordatorios y avisos", como los recordatorios
create or replace function public.push_optional(p_kind text) returns boolean
language sql immutable set search_path = public as $$ select p_kind in ('r24','r2','rev','bday','offer','news') $$;

-- "Ana G.": el nombre de pila y la inicial del apellido (la última palabra), con mayúscula
create or replace function public.follower_label(p_full text) returns text
language sql immutable set search_path = public as $$
  select case when first is null then 'Alguien'
              else upper(left(first, 1)) || substr(first, 2) || coalesce(' ' || upper(left(last, 1)) || '.', '') end
  from (select left(nullif(split_part(btrim(coalesce(p_full, '')), ' ', 1), ''), 30) as first,
               nullif(regexp_replace(btrim(coalesce(p_full, '')), '^.*\s', ''), btrim(coalesce(p_full, ''))) as last) x
$$;

-- ---------- Seguidores del prestador ----------
create or replace function public.provider_followers() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', (select count(*) from public.follows where provider_id = public.my_provider()),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.user_id, 'name', x.label, 'photo', x.avatar_path,
                                                           'since', x.created_at, 'client', x.client_id)
                                        order by x.created_at desc)
                         from (select f.user_id, f.created_at, p.avatar_path, public.follower_label(p.full_name) as label,
                                      (select c.id from public.provider_clients c
                                        where c.provider_id = f.provider_id and c.user_id = f.user_id) as client_id
                                 from public.follows f left join public.profiles p on p.id = f.user_id
                                where f.provider_id = public.my_provider()
                                order by f.created_at desc limit 500) x), '[]'))
$$;

-- las novedades de hoy (posts) de un prestador, en el día de su ciudad
create or replace function public.follower_posts_today(p_pid bigint, p_tz text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.posts
   where provider_id = p_pid and (created_at at time zone p_tz)::date = (now() at time zone p_tz)::date
$$;

-- ---------- Ofrecer un hueco ----------
-- p_user null: a todos los seguidores; si no, a ese seguidor. Devuelve {id, sent}.
create or replace function public.offer_slot(p_starts timestamptz, p_ends timestamptz, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; oid bigint; n int := 0; today int; cap int; msg text; lt timestamp; le timestamp;
begin
  if pid is null then raise exception 'not_provider'; end if;
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

-- ---------- Push de los avisos del cliente ----------
create or replace function public.client_messages_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare bid bigint; starts timestamptz;
begin
  if new.kind not in ('conf','r24','r2','rev','bday','cancel','offer','news') then return null; end if;
  if new.kind = 'news' then
    perform public.push_enqueue(new.user_id, 'news', 'message', new.id, null, now() + interval '2 days');
    return null;
  end if;
  if new.kind = 'offer' then
    -- la oferta vale hasta que empieza el horario
    select o.starts_at into starts from public.slot_offers o where o.id = new.ref::bigint;
    if starts is null then return null; end if;
    perform public.push_enqueue(new.user_id, 'offer', 'message', new.id, null, starts);
    return null;
  end if;
  if new.kind <> 'bday' and new.ref ~ '^[0-9]{1,18}$' then
    select id, starts_at into bid, starts from public.bookings where id = new.ref::bigint;
  end if;
  perform public.push_enqueue(new.user_id, new.kind, 'message', new.id, bid,
    -- un recordatorio vale hasta que empieza el turno; el resto, dos días
    case when new.kind in ('r24','r2') and starts is not null then starts else now() + interval '2 days' end);
  return null;
end $$;
drop trigger if exists client_messages_push on public.client_messages;
create trigger client_messages_push after insert on public.client_messages
  for each row execute function public.client_messages_push();

-- lo que la función de push manda (igual que antes, más la oferta: "Turno libre en <prestador>", al perfil ese día)
create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
        o_start timestamptz; o_pid bigint; o_slug text; o_body text;
begin
  for r in select o.id, o.kind, o.source, o.source_id, o.booking_id, o.expires_at, s.endpoint, s.p256dh, s.auth,
                  coalesce(pr.push_notices, true) as wants, coalesce(pr.push_bookings, true) as wants_bookings,
                  coalesce(pr.push_followers, true) as wants_followers
             from public.push_outbox o
             join public.push_subscriptions s on s.id = o.subscription_id
             left join public.profiles pr on pr.id = o.user_id
            where o.status = 'pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.id
            limit greatest(coalesce(p_limit, 100), 1)
            for update of o skip locked loop
    b_status := null; b_start := null; b_pid := null; b_svc := null; b_client := null;
    o_start := null; o_pid := null; o_slug := null; o_body := null;
    if r.booking_id is not null then
      select bb.status, bb.starts_at, bb.provider_id, bb.service_name, bb.client_name into b_status, b_start, b_pid, b_svc, b_client
        from public.bookings bb where bb.id = r.booking_id;
    end if;
    if r.kind = 'offer' then
      select so.starts_at, so.provider_id, p.slug, m.body into o_start, o_pid, o_slug, o_body
        from public.client_messages m
        join public.slot_offers so on so.id = m.ref::bigint
        join public.providers p on p.id = so.provider_id
       where m.id = r.source_id and m.kind = 'offer';
    end if;
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings)
                   or (r.kind = 'new_follower' and not r.wants_followers) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
                 when r.kind = 'offer' and (o_start is null or o_start <= now()) then 'stale'
            end;
    if skip is not null then
      update public.push_outbox set status = 'skipped', skip_reason = skip where push_outbox.id = r.id;
      continue;
    end if;
    t := null; b := null; u := null;
    if r.source = 'message' then
      select p.name into pname from public.client_messages m join public.providers p on p.id = m.provider_id where m.id = r.source_id;
      lt := b_start at time zone public.provider_tz(b_pid);
      case r.kind
        when 'conf' then t := 'Turno confirmado'; b := pname || ' · ' || public.push_when(b_start, b_pid);
        when 'r24'  then t := 'Mañana tenés turno'; b := pname || ' a las ' || to_char(lt, 'HH24:MI');
        when 'r2'   then t := 'Hoy a las ' || to_char(lt, 'HH24:MI') || ' tenés turno'; b := pname || coalesce(' · ' || nullif(b_svc, ''), '');
        when 'rev'  then t := '¿Qué tal tu turno?'; b := 'Contale a ' || pname || ' cómo te fue';
        when 'bday' then t := '¡Feliz cumpleaños!'; b := 'De parte de ' || pname;
        when 'offer' then t := 'Turno libre en ' || pname; b := o_body;
        when 'news' then t := 'Novedad de ' || pname; select m.body into b from public.client_messages m where m.id = r.source_id;
        else t := case when b_status = 'expired' then 'No pudimos confirmar tu turno' else 'Se canceló tu turno' end;
             b := pname || '. Abrí TuTiempo para ver el detalle.';
      end case;
      u := case when r.kind = 'news' then '/' || (select p.slug from public.client_messages m join public.providers p on p.id = m.provider_id where m.id = r.source_id)
                when r.kind = 'offer' then '/' || o_slug || '?dia=' || to_char(o_start at time zone public.provider_tz(o_pid), 'YYYY-MM-DD')
                when r.booking_id is not null and r.kind in ('conf','r24','r2','cancel','rev') then '/turno/' || r.booking_id
                else '/mis-turnos' end;
    elsif r.source = 'booking' then
      -- del cliente, solo el nombre de pila (sin apellido ni teléfono)
      who := left(coalesce(nullif(split_part(trim(b_client), ' ', 1), ''), 'Un cliente'), 30);
      svc := coalesce(nullif(b_svc, ''), 'Turno');
      t := case r.kind when 'new_booking' then 'Nueva reserva' else 'Se canceló una reserva' end;
      b := who || ' · ' || svc || ' · ' || public.push_when(b_start, b_pid);
      u := '/panel/agenda?dia=' || to_char(b_start at time zone public.provider_tz(b_pid), 'YYYY-MM-DD');
    else
      -- C06 (V8): un seguidor nuevo, con su nombre de pila (lo guarda el aviso; nada más). 4/11: a la pestaña Seguidores
      if r.kind = 'new_follower' then
        select n.body into b from public.provider_notices n where n.id = r.source_id;
        t := 'Nuevo seguidor'; b := left(coalesce(b, 'Alguien empezó a seguirte'), 120); u := '/panel/clientes?ver=seguidores';
      -- C41/C42 (V6): el aviso de TuTiempo para conectar Mercado Pago por primera vez ("Avisarle" en el admin)
      elsif r.kind = 'mp_reconnect' and (select n.kind from public.provider_notices n where n.id = r.source_id) = 'mp_connect' then
        t := 'Conectá Mercado Pago'; b := 'Sin Mercado Pago no podés cobrar señas ni recibir reservas online. Conectalo desde tu perfil.';
        u := '/panel/perfil';
      else
        t := case r.kind when 'mp_reconnect' then 'Volvé a conectar Mercado Pago' else 'Novedad en tus cobros' end;
        b := case r.kind when 'mp_reconnect' then 'Hoy no podés cobrar señas. Conectalo desde tu perfil.' else 'Abrí tu panel para ver el detalle.' end;
        u := case r.kind when 'mp_reconnect' then '/panel/perfil' else '/panel/agenda' end;
      end if;
    end if;
    if t is null or b is null then
      update public.push_outbox set status = 'skipped', skip_reason = 'stale' where push_outbox.id = r.id;
      continue;
    end if;
    update public.push_outbox set next_attempt_at = now() + interval '2 minutes' where push_outbox.id = r.id;
    id := r.id; endpoint := r.endpoint; p256dh := r.p256dh; auth := r.auth; title := left(t, 80); body := left(b, 160); url := u;
    -- los avisos de un mismo turno se reemplazan entre sí en la pantalla (el recordatorio pisa a la confirmación)
    tag := case when r.booking_id is not null then 'turno-' || r.booking_id else r.kind || '-' || r.source_id end;
    -- cuánto la guarda el servicio de push si el dispositivo está apagado: hasta que vence, y nunca después del turno
    ttl := greatest(60, least(2419200, extract(epoch from (least(r.expires_at, case when r.kind in ('conf','r24','r2','new_booking') then b_start end) - now()))::int));
    urgency := case when r.kind in ('conf','cancel','r2','new_booking','client_cancel','mp_reconnect') then 'high' else 'normal' end;
    return next;
  end loop;
end $$;

-- ---------- Avisos del cliente: el horario de la oferta ----------
create or replace function public.my_messages() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select m.id, m.provider_id, p.name as provider_name, p.photo_path, p.hue, m.body, m.created_at,
           m.read_at is not null as read, m.kind, m.ref, p.slug,
           case when m.kind = 'offer' then (select jsonb_build_object('starts', so.starts_at, 'ends', so.ends_at)
                                              from public.slot_offers so where so.id = m.ref::bigint) end as slot
    from public.client_messages m join public.providers p on p.id = m.provider_id
    where m.user_id = auth.uid() and m.dismissed_at is null
    order by m.created_at desc limit 50) x
$$;

-- ---------- Avisar a tus seguidores (Trabajos) ----------
create or replace function public.notify_followers(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; b text := btrim(regexp_replace(coalesce(p_body, ''), '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g'));
        post bigint; n int := 0; today int;
begin
  if pid is null then raise exception 'not_provider'; end if;
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
-- las novedades se mandan solo con notify_followers (con el límite)
revoke insert on public.posts from authenticated;
drop policy if exists posts_write on public.posts;

revoke execute on function public.provider_followers(), public.offer_slot(timestamptz, timestamptz, uuid), public.notify_followers(text) from public, anon;
grant execute on function public.provider_followers(), public.offer_slot(timestamptz, timestamptz, uuid), public.notify_followers(text) to authenticated;
revoke execute on function public.follower_posts_today(bigint, text) from public, anon, authenticated;
revoke execute on function public.follower_label(text) from public, anon, authenticated;
revoke execute on function public.push_due(int) from public, anon, authenticated;
grant execute on function public.push_due(int) to service_role;

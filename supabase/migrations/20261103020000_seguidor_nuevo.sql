-- =====================================================================
-- TuTiempo · V8 · C06 · Seguidor nuevo
--   - Cuando alguien empieza a seguir a un prestador, al prestador le llega un aviso en la app ("Avisos" del panel) y
--     por push, con el nombre de pila de quien lo sigue (nada más: ni apellido, ni email, ni teléfono): "Ana empezó a
--     seguirte". Una sola vez por persona: dejar de seguir y volver a seguir no lo repite (provider_notices
--     new_follower, ref 'seg-<cuenta>').
--   - Interruptor propio del prestador: "Nuevos seguidores" (profiles.push_followers, prendido por defecto), aparte de
--     "Nuevas reservas y cancelaciones de clientes": apagarlo no silencia las reservas. Apaga el push; el aviso en la
--     app queda igual.
-- Idempotente y sin borrar datos.
-- =====================================================================

alter table public.profiles add column if not exists push_followers boolean not null default true;
grant select (push_followers), update (push_followers) on public.profiles to authenticated;   -- su fila (profiles_self/update)

alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost','mp_connect','new_follower')) not valid;  -- la migración más nueva la vuelve a crear validada (TODO_EN_UNO.sql se puede volver a correr)
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect','new_follower'));

-- el aviso al prestador cuando alguien lo empieza a seguir (una vez por persona)
create or replace function public.follows_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select left(nullif(split_part(btrim(coalesce(p.full_name, '')), ' ', 1), ''), 30) into who from public.profiles p where p.id = new.user_id;
  -- con mayúscula la primera letra ("ana" → "Ana"; el resto como lo escribió)
  who := upper(left(who, 1)) || substr(who, 2);
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (new.provider_id, 'new_follower', 'seg-' || new.user_id, coalesce(who, 'Alguien') || ' empezó a seguirte.')
  on conflict (provider_id, kind, ref) do nothing;
  return null;
end $$;
drop trigger if exists follows_notice on public.follows;
create trigger follows_notice after insert on public.follows
  for each row execute function public.follows_notice();

-- encolar: también respeta "Nuevos seguidores"
create or replace function public.push_enqueue(p_user uuid, p_kind text, p_source text, p_source_id bigint, p_booking bigint, p_expires timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if p_user is null or p_expires <= now() then return; end if;
  select push_notices, push_bookings, push_followers into pr from public.profiles where id = p_user;
  if (public.push_optional(p_kind) and not coalesce(pr.push_notices, true))
     or (public.push_booking_kind(p_kind) and not coalesce(pr.push_bookings, true))
     or (p_kind = 'new_follower' and not coalesce(pr.push_followers, true)) then
    return;
  end if;
  insert into public.push_outbox (subscription_id, user_id, kind, source, source_id, booking_id, expires_at)
  select s.id, p_user, p_kind, p_source, p_source_id, p_booking, p_expires from public.push_subscriptions s where s.user_id = p_user
  on conflict do nothing;
end $$;

-- los avisos del prestador por push: el de seguidor nuevo con su tipo (vale un día)
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind in ('mp_reconnect','mp_connect') then 'mp_reconnect' when new.kind = 'new_follower' then 'new_follower' else 'cobros' end,
    'notice', new.id, null, now() + case when new.kind = 'new_follower' then interval '1 day' else interval '3 days' end);
  return null;
end $$;

create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
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
    if r.booking_id is not null then
      select bb.status, bb.starts_at, bb.provider_id, bb.service_name, bb.client_name into b_status, b_start, b_pid, b_svc, b_client
        from public.bookings bb where bb.id = r.booking_id;
    end if;
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings)
                   or (r.kind = 'new_follower' and not r.wants_followers) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
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
        else t := case when b_status = 'expired' then 'No pudimos confirmar tu turno' else 'Se canceló tu turno' end;
             b := pname || '. Abrí TuTiempo para ver el detalle.';
      end case;
      u := case when r.booking_id is not null and r.kind in ('conf','r24','r2','cancel','rev') then '/turno/' || r.booking_id else '/mis-turnos' end;
    elsif r.source = 'booking' then
      -- del cliente, solo el nombre de pila (sin apellido ni teléfono)
      who := left(coalesce(nullif(split_part(trim(b_client), ' ', 1), ''), 'Un cliente'), 30);
      svc := coalesce(nullif(b_svc, ''), 'Turno');
      t := case r.kind when 'new_booking' then 'Nueva reserva' else 'Se canceló una reserva' end;
      b := who || ' · ' || svc || ' · ' || public.push_when(b_start, b_pid);
      u := '/panel/agenda?dia=' || to_char(b_start at time zone public.provider_tz(b_pid), 'YYYY-MM-DD');
    else
      -- C06 (V8): un seguidor nuevo, con su nombre de pila (lo guarda el aviso; nada más)
      if r.kind = 'new_follower' then
        select n.body into b from public.provider_notices n where n.id = r.source_id;
        t := 'Nuevo seguidor'; b := left(coalesce(b, 'Alguien empezó a seguirte'), 120); u := '/panel/trabajos';
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


revoke execute on function public.follows_notice(), public.push_enqueue(uuid, text, text, bigint, bigint, timestamptz) from public, anon, authenticated;
revoke execute on function public.push_due(int) from public, anon, authenticated;
grant execute on function public.push_due(int) to service_role;

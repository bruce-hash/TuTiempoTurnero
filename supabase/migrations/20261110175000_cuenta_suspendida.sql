-- =====================================================================
-- TuTiempo · 10/11 · punto 11 · aviso de cuenta suspendida (D43)
--   - Al suspender, el admin puede escribir un motivo (opcional, hasta 280 letras) que ve el profesional: queda en
--     provider_private.suspended_reason (con suspended_at), aparte de las notas privadas del admin (admin_notes, que el
--     profesional sigue sin ver). Nadie lo lee directo de la tabla (no tiene grant de select): el profesional lo recibe con
--     my_setup (solo el suyo) y el admin con admin_providers. Al reactivarlo, el motivo se borra.
--   - admin_set_provider(pid, p_status, p_verified, p_reason default null): reemplaza a la de tres parámetros (se borra
--     esa firma para que una llamada con tres no sea ambigua). Lo demás, igual que en 20261028120000_exigir_dni.sql.
--   - Al pasar a 'suspended' y al volver de 'suspended' a 'active' (por cualquier camino: trigger providers_status_notice)
--     le queda un aviso en la campanita (provider_notices 'suspended' / 'reactivated'), un push (tipo 'account') y un
--     email (email_outbox, ahora también con avisos del profesional: notice_id). Son avisos del servicio: llegan siempre,
--     sin interruptor (como la confirmación y las cancelaciones del cliente, D25). Suspender a uno ya suspendido no
--     manda nada de nuevo.
--   - No cambia lo que pasa con los turnos ya reservados ni con los cobros (ver el informe del punto 11).
-- Idempotente y sin borrar datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- El motivo (lo ve el profesional) ----------
alter table public.provider_private add column if not exists suspended_reason text;
alter table public.provider_private add column if not exists suspended_at timestamptz;
alter table public.provider_private drop constraint if exists provider_private_suspended_reason_check;
alter table public.provider_private add constraint provider_private_suspended_reason_check
  check (suspended_reason is null or char_length(suspended_reason) between 1 and 280);
-- sin grant de select para authenticated: el dueño lee solo las columnas que ya tenía (20261025194744_dni.sql)

-- ---------- Tipos nuevos de aviso ----------
-- el de cuenta suspendida lleva lo que significa, el motivo (hasta 280 letras) y el contacto: hasta 800 letras (antes 600)
alter table public.provider_notices drop constraint if exists provider_notices_body_check;
alter table public.provider_notices add constraint provider_notices_body_check check (char_length(body) between 1 and 800);
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost','mp_connect','new_follower','mp_term','holiday',
                  'suspended','reactivated')) not valid;  -- not valid (11/11): la migración más nueva la vuelve a crear validada (TODO_EN_UNO.sql se puede volver a correr)
alter table public.push_outbox drop constraint if exists push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','new_booking','client_cancel','cobros','mp_reconnect','new_follower','offer','news','holiday',
                  'account'));

-- ---------- La cola de emails, también para avisos del profesional ----------
-- cada fila es de un aviso al cliente (message_id) o de un aviso al profesional (notice_id), nunca de los dos
alter table public.email_outbox alter column message_id drop not null;
alter table public.email_outbox add column if not exists notice_id bigint references public.provider_notices(id) on delete cascade;
create unique index if not exists email_outbox_notice on public.email_outbox (notice_id) where notice_id is not null;
alter table public.email_outbox drop constraint if exists email_outbox_source_check;
alter table public.email_outbox add constraint email_outbox_source_check check (num_nonnulls(message_id, notice_id) = 1);
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check check (kind in ('conf','r24','r2','rev','bday','cancel','account')) not valid;  -- not valid (11/11): la migración más nueva la vuelve a crear validada (TODO_EN_UNO.sql se puede volver a correr)

-- ---------- Suspender (con motivo) y reactivar ----------
drop function if exists public.admin_set_provider(bigint, text, boolean);
create or replace function public.admin_set_provider(pid bigint, p_status text, p_verified boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p record; ph jsonb; need_dni boolean := coalesce((select s.require_dni from public.app_settings s where s.id), true);
        why text := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g')), '');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  if char_length(why) > 280 then raise exception 'reason_too_long'; end if;
  select pr.id, pr.owner_id, pr.status, pr.dni_verified, pp.dni_number, pp.dni_verified_at into p
    from public.providers pr left join public.provider_private pp on pp.provider_id = pr.id
   where pr.id = pid and pr.status <> 'deleted' for update of pr;
  if p.id is null then return; end if;
  if p_status = 'active' and not need_dni then
    -- sin DNI exigido: se activa y el sello de identidad queda como estaba
    update public.providers set status = 'active', updated_at = now() where id = pid;
  elsif p_status = 'active' then
    if not (p.dni_verified and p.dni_verified_at is not null) then
      if p.dni_number is null then raise exception 'dni_missing'; end if;
      ph := public.dni_photos(p.owner_id);
      if not ((ph->>'front')::boolean and (ph->>'back')::boolean) then raise exception 'dni_photos_missing'; end if;
    end if;
    update public.providers set status = 'active', dni_verified = true, updated_at = now() where id = pid;
    -- verificar con las fotos deja quién y cuándo (también a uno verificado antes del 2b, sin fecha)
    if not (p.dni_verified and p.dni_verified_at is not null) then
      update public.provider_private set dni_verified_at = now(), dni_verified_by = auth.uid() where provider_id = pid;
    end if;
  else
    -- 10/11: el motivo, antes de cambiar el estado (el aviso lo lleva). A uno ya suspendido solo se le cambia si se
    -- escribe uno nuevo (y no se le avisa de nuevo)
    if p_status = 'suspended' and (p.status <> 'suspended' or why is not null) then
      insert into public.provider_private (provider_id, suspended_reason) values (pid, why)
      on conflict (provider_id) do update set suspended_reason = excluded.suspended_reason;
    end if;
    update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid;
  end if;
end $$;

-- el aviso al profesional cuando cambia su estado (desde el admin o desde cualquier otro lado)
create or replace function public.providers_status_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text; v_ref text := to_char(clock_timestamp() at time zone 'UTC', 'YYYYMMDDHH24MISSUS');
begin
  if new.status = 'suspended' and old.status is distinct from 'suspended' then
    update public.provider_private set suspended_at = now() where provider_id = new.id returning suspended_reason into why;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (new.id, 'suspended', v_ref,
            left('TuTiempo suspendió tu cuenta: no aparecés en el listado, no recibís reservas nuevas y no podés mandar avisos ' ||
                 'ni ofertas a tus seguidores.' || coalesce(' Motivo: ' || why || '.', '') ||
                 -- 10/11 (Bruno): lo que pasa con los turnos ya reservados (el mismo texto que el aviso fijo del panel)
                 ' Tus turnos ya reservados siguen en pie: atendelos como siempre (o cancelalos desde la Agenda, con devolución al cliente).' ||
                 ' Para resolverlo, escribinos por WhatsApp (2284 722825) o a contacto@tutiempo.com.ar.', 800))
    on conflict (provider_id, kind, ref) do nothing;
    -- el aviso de "activa de nuevo" anterior ya no corre
    update public.provider_notices set read_at = coalesce(read_at, now()) where provider_id = new.id and kind = 'reactivated';
  elsif old.status = 'suspended' and new.status = 'active' then
    update public.provider_private set suspended_reason = null, suspended_at = null where provider_id = new.id;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (new.id, 'reactivated', v_ref,
            'Tu cuenta está activa de nuevo: ya aparecés en el listado de TuTiempo, podés recibir reservas y escribirles a tus seguidores.')
    on conflict (provider_id, kind, ref) do nothing;
    update public.provider_notices set read_at = coalesce(read_at, now()) where provider_id = new.id and kind = 'suspended';
  end if;
  return null;
end $$;
drop trigger if exists providers_status_notice on public.providers;
create trigger providers_status_notice after update of status on public.providers
  for each row execute function public.providers_status_notice();

-- los avisos del prestador por push: igual que en 20261106210000_feriados.sql, más los de la cuenta (account)
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind in ('mp_reconnect','mp_connect') then 'mp_reconnect' when new.kind in ('new_follower','holiday') then new.kind
         when new.kind in ('suspended','reactivated') then 'account' else 'cobros' end,
    'notice', new.id, null,
    case when new.kind = 'new_follower' then now() + interval '1 day'
         when new.kind = 'holiday' and new.ref ~ '^\d{4}-\d{2}-\d{2}$' then least(now() + interval '8 days', (new.ref::date)::timestamp at time zone 'America/Argentina/Buenos_Aires')
         else now() + interval '3 days' end);
  return null;
end $$;

-- y por email (solo los de la cuenta; vale tres días)
create or replace function public.provider_notices_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.kind not in ('suspended','reactivated') then return null; end if;
  select owner_id into owner from public.providers where id = new.provider_id;
  if owner is null then return null; end if;
  insert into public.email_outbox (notice_id, user_id, kind, expires_at)
  values (new.id, owner, 'account', now() + interval '3 days')
  on conflict do nothing;
  return null;
end $$;
drop trigger if exists provider_notices_email on public.provider_notices;
create trigger provider_notices_email after insert on public.provider_notices
  for each row execute function public.provider_notices_email();

-- ---------- Lo que manda email-send ----------
-- Igual que en 20261026033854_emails.sql, más los avisos del profesional (notice_id): el asunto según el aviso, el nombre
-- del negocio arriba y for_provider (el botón lleva al panel, no a Mis turnos). Un aviso de cuenta que ya no corresponde
-- (lo reactivaron antes de mandarlo, o al revés) no sale.
drop function if exists public.emails_due(int);
create or replace function public.emails_due(p_limit int default 50)
returns table (id bigint, to_email text, subject text, body text, provider_name text, site_url text, optional boolean, for_provider boolean)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; subj text; site text := (select s.site_url from public.app_settings s where s.id);
begin
  for r in select o.id, o.kind, o.expires_at, o.user_id, coalesce(m.body, n.body) as body, coalesce(pm.name, pn.name) as pname,
                  n.kind as nkind, pn.status as pstatus, (o.notice_id is not null) as to_provider,
                  u.email, u.email_confirmed_at, coalesce(pr.email_notices, true) as wants, b.status as bstatus, b.starts_at,
                  b.starts_at at time zone public.provider_tz(b.provider_id) as lt
             from public.email_outbox o
             left join public.client_messages m on m.id = o.message_id
             left join public.providers pm on pm.id = m.provider_id
             left join public.provider_notices n on n.id = o.notice_id
             left join public.providers pn on pn.id = n.provider_id
             join auth.users u on u.id = o.user_id
             left join public.profiles pr on pr.id = o.user_id
             left join public.bookings b on b.id = o.booking_id
            where o.status = 'pending' and o.next_attempt_at <= now()
            order by o.next_attempt_at, o.id
            limit greatest(coalesce(p_limit, 50), 1)
            for update of o skip locked loop
    skip := case when not r.wants and public.email_optional(r.kind) then 'opt_out'
                 when r.email is null or r.email_confirmed_at is null then 'no_email'
                 when r.expires_at <= now() then 'stale'
                 when r.body is null or r.pname is null then 'stale'
                 when r.kind in ('r24','r2','conf') and (r.bstatus is distinct from 'confirmed' or r.starts_at <= now()) then 'stale'
                 when r.kind = 'account' and (r.pstatus = 'deleted' or (r.nkind = 'suspended') <> (r.pstatus = 'suspended')) then 'stale'
            end;
    if skip is not null then
      update public.email_outbox set status = 'skipped', skip_reason = skip where email_outbox.id = r.id;
      continue;
    end if;
    subj := case r.kind
      when 'account' then case r.nkind when 'suspended' then 'Tu cuenta de TuTiempo está suspendida' else 'Tu cuenta de TuTiempo está activa de nuevo' end
      when 'conf' then 'Tu turno en ' || r.pname || ' quedó confirmado'
      when 'r24'  then 'Mañana tenés turno en ' || r.pname
      when 'r2'   then 'Hoy a las ' || to_char(r.lt, 'HH24:MI') || ' tenés turno en ' || r.pname
      when 'rev'  then '¿Qué tal tu turno en ' || r.pname || '?'
      when 'bday' then '¡Feliz cumpleaños de parte de ' || r.pname || '!'
      else case r.bstatus
             when 'cancelled_provider' then r.pname || ' canceló tu turno'
             when 'expired' then 'No pudimos confirmar tu turno en ' || r.pname
             else 'Tu turno en ' || r.pname || ' quedó cancelado' end
    end;
    update public.email_outbox set next_attempt_at = now() + interval '15 minutes' where email_outbox.id = r.id;
    id := r.id; to_email := r.email; subject := left(subj, 200); body := r.body; provider_name := r.pname; site_url := site;
    optional := public.email_optional(r.kind); for_provider := r.to_provider;
    return next;
  end loop;
end $$;


-- push_due: igual que en 20261110120000_avisos_seguidores.sql (feriados + 'unfollowed'), más los avisos de la cuenta (account: suspendida / activa de nuevo).
-- Un aviso de cuenta que ya no corresponde (lo reactivaron antes de mandarlo, o al revés) no sale.
create or replace function public.push_due(p_limit int default 100)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, url text, tag text, ttl int, urgency text)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; t text; b text; u text; who text; svc text; pname text; lt timestamp;
        b_status text; b_start timestamptz; b_pid bigint; b_svc text; b_client text;
        o_start timestamptz; o_pid bigint; o_slug text; o_body text; a_kind text; a_status text;
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
    o_start := null; o_pid := null; o_slug := null; o_body := null; a_kind := null; a_status := null;
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
    if r.kind = 'account' then
      select n.kind, p.status into a_kind, a_status
        from public.provider_notices n join public.providers p on p.id = n.provider_id where n.id = r.source_id;
    end if;
    skip := case when (public.push_optional(r.kind) and not r.wants) or (public.push_booking_kind(r.kind) and not r.wants_bookings)
                   or (r.kind = 'new_follower' and not r.wants_followers) then 'opt_out'
                 when r.expires_at <= now() then 'stale'
                 when r.kind in ('conf','r24','r2','new_booking') and (b_status is distinct from 'confirmed' or b_start <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (b_start is null or b_start <= now()) then 'stale'
                 -- 10/11 (20261110120000_avisos_seguidores.sql): dejó de seguir al profesional → lo que quedaba en la cola de ese profesional ya no le llega
                 when r.kind in ('offer','news') and not exists (
                        select 1 from public.client_messages m join public.follows f on f.provider_id = m.provider_id and f.user_id = m.user_id
                         where m.id = r.source_id) then 'unfollowed'
                 when r.kind = 'offer' and (o_start is null or o_start <= now()) then 'stale'
                 -- 7/11 · feriados: ya eligió Abro o Cierro
                 when r.kind = 'holiday' and exists (select 1 from public.provider_notices n join public.provider_holidays d
                                                       on d.provider_id = n.provider_id and d.day::text = n.ref where n.id = r.source_id) then 'stale'
                 -- 10/11 · cuenta: el aviso de suspendida solo mientras lo esté; el de activa, solo si no la volvieron a suspender
                 when r.kind = 'account' and (a_kind is null or a_status = 'deleted' or (a_kind = 'suspended') <> (a_status = 'suspended')) then 'stale'
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
      if r.kind = 'account' then
        -- 10/11 · cuenta suspendida (D43): llega siempre (aviso del servicio), a la Agenda, donde está el aviso fijo
        t := case a_kind when 'suspended' then 'Tu cuenta está suspendida' else 'Tu cuenta está activa de nuevo' end;
        b := case a_kind when 'suspended' then 'No aparecés en TuTiempo ni recibís reservas nuevas. Abrí tu panel para ver cómo resolverlo.'
                         else 'Ya aparecés en TuTiempo y podés recibir reservas nuevas.' end;
        u := '/panel/agenda';
      elsif r.kind = 'holiday' then
        -- 7/11 · feriados: «El lunes 24/11 es feriado (…). ¿Abrís?», a Horarios (Próximos feriados)
        select n.body into b from public.provider_notices n where n.id = r.source_id;
        t := 'Feriado: ¿abrís?'; u := '/panel/horarios';
      elsif r.kind = 'new_follower' then
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
    urgency := case when r.kind in ('conf','cancel','r2','new_booking','client_cancel','mp_reconnect','account') then 'high' else 'normal' end;
    return next;
  end loop;
end $$;

-- ---------- Lo que lee el panel del profesional ----------
-- Igual que en 20261102090000_alta_por_pasos.sql, más la suspensión: {reason, since} solo mientras está suspendido
create or replace function public.my_setup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pid bigint := public.my_provider(); p record; ph jsonb;
        need_dni boolean := coalesce((select s.require_dni from public.app_settings s where s.id), true);
begin
  if pid is null then return null; end if;
  -- sin fila de configuración (prestadores de antes, de la versión 31): ya estaban dados de alta, los 5 pasos hechos
  select pr.status, pr.owner_id, pr.dni_verified, pp.dni_number, coalesce(st.setup_done, '{1,2,3,4,5}') as steps,
         (select count(*) from public.services sv where sv.provider_id = pr.id and sv.active) as svcs,
         pp.suspended_reason, pp.suspended_at
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
    'status', p.status,
    -- 10/11 (D43): el motivo que escribió el admin al suspenderlo (no las notas privadas)
    'suspension', case when p.status = 'suspended' then jsonb_build_object('reason', p.suspended_reason, 'since', p.suspended_at) end);
end $$;

-- ---------- El admin ve el motivo en la ficha ----------
-- Igual que en 20261025194744_dni.sql, más suspended_reason
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
              from (select * from public.admin_notes an where an.provider_id = p.id order by an.created_at desc limit 30) n) as notes,
           case when p.status = 'suspended' then pp.suspended_reason end as suspended_reason
    from public.providers p left join public.provider_private pp on pp.provider_id = p.id
    where p.status <> 'deleted' and (p_status is null or p.status = p_status)
    order by (p.status = 'pending') desc, p.activity desc, p.created_at desc limit 500) x);
end $$;

-- ---------- Permisos ----------
revoke execute on function public.admin_set_provider(bigint, text, boolean, text), public.providers_status_notice(),
  public.provider_notices_push(), public.provider_notices_email(), public.emails_due(int), public.push_due(int),
  public.my_setup(), public.admin_providers(text) from public, anon, authenticated;
grant execute on function public.admin_set_provider(bigint, text, boolean, text), public.my_setup(), public.admin_providers(text) to authenticated;
grant execute on function public.emails_due(int), public.push_due(int) to service_role;


-- =====================================================================
-- 10/11 · decisión de Bruno sobre D43: un pago de seña que llega con el profesional suspendido (o no activo) SE DEVUELVE
--   - refunds.reason suma 'provider_suspended'.
--   - confirm_payment_core: igual que en 20261106150000_profesional_4_11.sql, más ese caso (después de booking_past):
--     el turno queda 'expired' con lo cobrado y se pide la devolución de todo, como los otros motivos. Lo usan el webhook,
--     mp-reconcile y Reprocesar (por confirm_payment).
--   - refunds_expired_notice: el aviso al cliente (app, push y email), con texto neutro y sin el link al perfil (no se ve).
--   - refunds_late_notice: el aviso al profesional (mp_refunded) también para este motivo.
--   - mp-create-preference ya no crea el cobro de un profesional no activo (provider_not_available).
-- =====================================================================
alter table public.refunds drop constraint if exists refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check
  check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking','admin','booking_past','provider_suspended'));

create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; mpf_part int; short boolean; why text;
        mp_pct numeric; cost_exp int; cost_mp int; mp_id text; cur_term text; got_term text; new_term text;
        reasons text[] := '{}'; ok int := 0; back int := 0; first_ok bigint;
begin
  pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(ids)));
  acct := coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active'));
  -- lo que se debía: seña + comisión + costo de Mercado Pago (D30) de los turnos de ESTE prestador que vinieron en el pago
  select sum(deposit + client_fee + mp_fee - paid_wallet), sum(client_fee), min(client_id::text)::uuid, min(client_name), max(mp_fee_pct)
    into due, fee_exp, uid, nm, mp_pct
    from public.bookings where id = any(ids) and provider_id = pid and source = 'app';
  due := coalesce(due, 0); fee_exp := coalesce(fee_exp, 0);
  -- D30: la comisión de Mercado Pago esperada (% del plazo sobre el total) y la que informa (fee_details, mercadopago_fee).
  -- Solo se compara si al cliente se le sumó un costo de Mercado Pago (% del plazo > 0).
  if coalesce(mp_pct, 0) > 0 then cost_exp := round(due * mp_pct / 100); end if;
  select round(sum((f->>'amount')::numeric))::int into cost_mp
    from jsonb_array_elements(case when jsonb_typeof(p_raw->'fee_details') = 'array' then p_raw->'fee_details' else '[]'::jsonb end) f
   where f->>'type' = 'mercadopago_fee' and (f->>'amount') ~ '^[0-9]+(\.[0-9]+)?$';
  -- 4/11 · Bloque 4 (cambia el plazo automático de D30): el plazo lo elige el profesional en Horarios. Si la comisión que
  -- informa Mercado Pago es la de OTRO plazo de la tabla del admin (con o sin IVA, $2 de margen), ya no se le cambia
  -- solo: el pago queda para revisar (mp_term_mismatch) y se le avisa cuál parece ser el plazo de su cuenta. Si no es la
  -- de ningún plazo, para revisar como antes (mp_cost_mismatch). Con todos los % en 0 no se detecta nada.
  if cost_mp is not null and due > 0 and pid is not null then
    cur_term := coalesce((select payout_term from public.provider_settings where provider_id = pid), 'instant');
    got_term := public.mp_term_match(due, cost_mp, cur_term);
    if got_term is not null and got_term <> cur_term then
      new_term := got_term;
      reasons := array_append(reasons, 'mp_term_mismatch');
    elsif got_term is null and cost_exp is not null then
      reasons := array_append(reasons, 'mp_cost_mismatch');
    end if;
  end if;
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.bookings b where b.id = x and b.provider_id = pid and b.source = 'app')) then
    reasons := array_append(reasons, 'other_provider');      -- turnos de otro prestador o que no existen: no se tocan
  end if;
  -- comisión: la que informa Mercado Pago tiene que ser la calculada por la base
  if fee_exp > 0 and p_fee_mp is null then reasons := array_append(reasons, 'fee_missing');
  elsif p_fee_mp is not null and p_fee_mp <> fee_exp then reasons := array_append(reasons, 'fee_mismatch'); end if;
  short := left_amt < due;                       -- D16: llegó menos → no se confirma nada y se devuelve todo
  if left_amt > due and due > 0 then reasons := array_append(reasons, 'amount_over'); end if;   -- D16: llegó más → se confirma y la diferencia se revisa

  insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, client_id, booking_ids, amount, fee_expected, fee_mp,
                               mp_status_detail, mp_cost, mp_cost_expected)
  values (p_payment_id, pid, acct, left(p_collector, 40), uid, ids, left_amt, fee_exp, p_fee_mp, left(p_status_detail, 60), cost_mp, cost_exp)
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);

  for r in select * from public.bookings where id = any(ids) and provider_id = pid and source = 'app' order by starts_at for update loop
    pay := least(left_amt, r.deposit + r.client_fee + r.mp_fee - r.paid_wallet); left_amt := left_amt - pay;
    fee_part := least(pay, r.client_fee);
    mpf_part := least(pay - fee_part, r.mp_fee);   -- D30: lo que se sumó por Mercado Pago (no es del prestador ni de TuTiempo)
    why := null;
    if short then
      why := 'amount_short';
    elsif r.status not in ('hold', 'expired') or r.payment_id is not null then
      why := 'booking_unavailable';             -- cancelado (por el prestador, un bloqueo, una baja) o ya pagado por otro pago
    elsif r.starts_at <= now() then
      why := 'booking_past';                    -- D29: el pago llegó cuando el turno ya había empezado: se devuelve
    elsif not public.provider_is_active(r.provider_id) then
      why := 'provider_suspended';              -- D43 (10/11): el profesional no está activo (suspendido): se devuelve
    else
      begin
        update public.bookings set status = 'confirmed', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part - mpf_part, app_fee = fee_part, paid_mp_fee = mpf_part
         where id = r.id;
        ok := ok + 1; first_ok := coalesce(first_ok, r.id);
      exception when exclusion_violation then
        why := 'slot_taken';                     -- el hold venció y otro tomó el horario
      end;
    end if;
    insert into public.payment_bookings (payment_id, booking_id, amount, fee, result, reason)
    values (pay_id, r.id, pay, fee_part, case when why is null then 'confirmed' else 'refund' end, why);
    if why is not null and pay > 0 then
      if r.status in ('hold', 'expired') and r.payment_id is null then
        -- lo canceló el sistema, no el prestador: 'expired' con lo cobrado (el cliente ve que se le devuelve y por qué)
        update public.bookings set status = 'expired', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part - mpf_part, app_fee = fee_part, paid_mp_fee = mpf_part
         where id = r.id;
      end if;
      perform public.refund_request(r.id, pay_id, pay, why);
      back := back + 1;
    end if;
  end loop;
  -- nada de este prestador en el pago: se devuelve todo lo cobrado (sin turno)
  if not exists (select 1 from public.payment_bookings where payment_id = pay_id) and left_amt > 0 then
    perform public.refund_request(null, pay_id, left_amt, 'unknown_booking');
    left_amt := 0;
  end if;

  update public.payments set
    outcome = case when cardinality(reasons) > 0 then 'review' when ok > 0 and back = 0 then 'confirmed' when ok > 0 then 'partial' else 'refund' end,
    review_reasons = reasons, updated_at = now()
   where id = pay_id;
  -- D30: el prestador se entera si Mercado Pago le cobró otro % que el del plazo de su perfil (con los dos números)
  if 'mp_cost_mismatch' = any(reasons) and pid is not null then
    select mp_payment_id into mp_id from public.payments where id = pay_id;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pid, 'mp_cost', left('costo-' || mp_id, 40),
            'Mercado Pago te cobró ' || public.pct_txt(cost_mp * 100.0 / nullif(due, 0)) || '% (' || public.money_txt(cost_mp) ||
            ') en vez de ' || public.pct_txt(mp_pct) || '% (' || public.money_txt(cost_exp) || ') en el pago n° ' || mp_id ||
            '. Si tu cuenta tiene otras tasas, avisanos.')
    on conflict (provider_id, kind, ref) do update set body = excluded.body;
  end if;
  -- 4/11: el plazo que parece tener su cuenta NO se cambia solo: se le avisa (con los dos plazos) para que lo revise
  if new_term is not null then
    select mp_payment_id into mp_id from public.payments where id = pay_id;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pid, 'mp_term', left('plazo-' || new_term || '-' || mp_id, 40),
            'Mercado Pago te cobró la comisión de acreditar ' || public.term_txt(new_term) || ' (' || public.money_txt(cost_mp) ||
            ') y en Horarios tenés elegido ' || public.term_txt(cur_term) || ' (pago n° ' || mp_id || '). Si tu cuenta de ' ||
            'Mercado Pago acredita ' || public.term_txt(new_term) || ', cambiá el plazo en Horarios: así tus clientes pagan lo que corresponde.')
    on conflict (provider_id, kind, ref) do nothing;
  end if;
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;

-- igual que en 20261031160000_pago_tarde.sql, más 'provider_suspended'
create or replace function public.refunds_late_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare total int; who text; why text; mp_id text;
begin
  if new.payment_id is null or new.reason not in ('slot_taken','booking_unavailable','amount_short','unknown_booking','booking_past','provider_suspended') then
    return new;
  end if;
  select coalesce(sum(amount), 0) into total from public.refunds
   where payment_id = new.payment_id and reason in ('slot_taken','booking_unavailable','amount_short','unknown_booking','booking_past','provider_suspended') and status <> 'cancelled';
  select coalesce((select b.client_name from public.bookings b where b.id = new.booking_id),
                  (select min(b.client_name) from public.bookings b where b.id = any(pm.booking_ids))), pm.mp_payment_id
    into who, mp_id from public.payments pm where pm.id = new.payment_id;
  why := case new.reason
           when 'slot_taken' then 'llegó cuando el horario ya no estaba libre'
           when 'booking_unavailable' then 'llegó cuando el turno ya no estaba disponible (cancelado o pagado por otro pago)'
           when 'amount_short' then 'llegó con un monto menor al de la reserva'
           when 'booking_past' then 'llegó después de la hora del turno'
           when 'provider_suspended' then 'llegó con tu cuenta suspendida'
           else 'no corresponde a ningún turno tuyo' end;
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (new.provider_id, 'mp_refunded', left('tarde-' || coalesce(mp_id, new.payment_id::text), 40),
          'El pago ' || coalesce('de ' || nullif(who, ''), 'n° ' || mp_id) || ' ' || why || ': se le devuelve ' ||
          public.money_txt(total) || ' desde tu cuenta de Mercado Pago. No tenés que hacer nada.')
  on conflict (provider_id, kind, ref) do update set body = excluded.body;
  return new;
end $$;

-- igual que en 20261031160000_pago_tarde.sql, más 'provider_suspended' (sin el link al perfil)
create or replace function public.refunds_expired_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare b record; why text;
begin
  why := case new.reason when 'slot_taken' then 'el horario ya no estaba libre cuando se acreditó tu pago'
                         when 'booking_unavailable' then 'el turno ya no estaba disponible cuando se acreditó tu pago'
                         when 'amount_short' then 'el pago no alcanzó para el turno'
                         when 'booking_past' then 'tu pago se acreditó después de la hora del turno'
                         when 'provider_suspended' then 'por ahora no está tomando reservas' end;
  if why is null or new.booking_id is null then return null; end if;
  select bk.id, bk.provider_id, bk.client_id, bk.status, p.id as pid, p.name, p.slug into b
    from public.bookings bk join public.providers p on p.id = bk.provider_id where bk.id = new.booking_id;
  if b.id is null or b.client_id is null or b.status <> 'expired' then return null; end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id,
          left(case when new.reason = 'provider_suspended'
                    -- D43: el perfil no se ve mientras está suspendido: sin el link para reservar de nuevo
                    then 'No pudimos confirmar tu turno del ' || public.booking_when(b.id) || ' en ' || b.name || ': ' || why ||
                         '. Te devolvemos todo lo que pagaste (' || public.money_txt(new.amount) || '). Podés buscar otro profesional en TuTiempo.'
                    else 'No pudimos confirmar tu turno del ' || public.booking_when(b.id) || ' en ' || b.name || ': ' || why ||
                         '. Te devolvemos ' || public.money_txt(new.amount) || '. Si querés, reservá de nuevo: ' || public.provider_link(b.pid, b.slug) end, 600),
          'cancel', b.id::text)
  on conflict do nothing;
  return null;
end $$;

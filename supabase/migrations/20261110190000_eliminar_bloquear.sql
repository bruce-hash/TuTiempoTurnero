-- =====================================================================
-- TuTiempo · 10/11 · punto 10 · eliminar clientes y bloquear (D45)
--   Eliminar de la lista (Clientes del panel):
--     · contacto cargado a mano (sin cuenta): se borra su ficha (nombre, celular, cumpleaños, notas). Los turnos
--       pasados quedan con el nombre escrito (Agenda, Finanzas y Estadísticas no cambian);
--     · cliente de la app: provider_clients.hidden_at. Sale de Clientes, su historial no se toca y vuelve a aparecer
--       cuando confirma un turno nuevo (trigger bookings_unhide). No lo saca de Seguidores (D45.1).
--     · con turnos futuros, la app pregunta: cancelarlos (con la devolución de siempre, D08: cancel_by_provider) o
--       dejarlos. Sin elegir, la base no deja seguir (has_upcoming).
--   Bloquear (solo a quien tiene cuenta, D45.6): client_blocks (profesional, cuenta, desde cuándo).
--     · deja de seguirlo (sin avisar nada), sale de la lista de espera y no puede volver a seguirlo (follows_blocked);
--     · no puede reservar: book_slot y la lista de espera lo rechazan con 'no_slots' (el mismo mensaje neutro que
--       ve en el perfil); get_provider le da no_slots = true y sin horarios, y next_free_slot (las tarjetas) nada;
--     · no le llegan mensajes, novedades, ofertas ni el saludo de cumpleaños de ese profesional
--       (client_messages_marketing); lo que ya estaba en la cola de push o email de esos tipos no sale. Los avisos
--       de un turno que se le dejó (confirmación, recordatorios, cancelación, reseña) sí le llegan;
--     · si el profesional le cancela un turno, el aviso no dice «Reprogramalo cuando quieras» (D45.5) y en Mis
--       turnos no aparece «Reprogramar» (my_bookings: no_slots);
--     · si asiste a un turno que se le dejó puede dejar la reseña (no se toca); los sellos quedan (D45.3).
--   Lo que ve el bloqueado nunca dice «bloqueo»: la tabla no la puede leer y las respuestas usan no_slots.
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- Tablas ----------
create table if not exists public.client_blocks (
  provider_id bigint not null references public.providers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (provider_id, user_id)
);
create index if not exists client_blocks_user on public.client_blocks (user_id);
alter table public.client_blocks enable row level security;
-- el profesional lee los suyos; se escribe solo con las funciones de abajo. El bloqueado no lee nada.
revoke all on public.client_blocks from public, anon, authenticated;
grant select on public.client_blocks to authenticated;
grant select on public.client_blocks to service_role;
drop policy if exists client_blocks_owner on public.client_blocks;
create policy client_blocks_owner on public.client_blocks for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin()));

-- cliente de la app sacado de la lista (lo escriben solo las funciones: no está en los grants de columna de S01)
alter table public.provider_clients add column if not exists hidden_at timestamptz;

-- ---------- Ayuda interna ----------
create or replace function public.client_blocked(p_provider bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_provider is not null and p_user is not null
     and exists (select 1 from public.client_blocks where provider_id = p_provider and user_id = p_user)
$$;
revoke execute on function public.client_blocked(bigint, uuid) from public, anon, authenticated;

-- ---------- Cumplimiento en la base ----------
-- seguir: no a un profesional que te bloqueó (mensaje neutro)
create or replace function public.follows_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.client_blocked(new.provider_id, new.user_id) then raise exception 'follow_unavailable'; end if;
  return new;
end $$;
drop trigger if exists follows_blocked on public.follows;
create trigger follows_blocked before insert on public.follows
  for each row execute function public.follows_blocked();

-- lista de espera: tampoco
create or replace function public.waitlist_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.client_blocked(new.provider_id, new.user_id) then raise exception 'no_slots'; end if;
  return new;
end $$;
drop trigger if exists waitlist_blocked on public.waitlist;
create trigger waitlist_blocked before insert on public.waitlist
  for each row execute function public.waitlist_blocked();

-- reservar: el turno que pide el propio cliente (book_slot corre con su sesión). Lo que registra un pago (webhook,
-- sin sesión de cliente) no se frena: un pago aprobado nunca queda sin turno ni sin devolución.
create or replace function public.bookings_blocked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'app' and new.client_id is not null and new.client_id = auth.uid()
     and public.client_blocked(new.provider_id, new.client_id) then
    raise exception 'no_slots';
  end if;
  return new;
end $$;
drop trigger if exists bookings_blocked on public.bookings;
create trigger bookings_blocked before insert on public.bookings
  for each row execute function public.bookings_blocked();

-- vuelve a la lista (Clientes) quien confirma un turno nuevo por la app después de que lo sacaron
create or replace function public.bookings_unhide() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'app' and new.client_id is not null and new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    update public.provider_clients set hidden_at = null
     where provider_id = new.provider_id and user_id = new.client_id and hidden_at is not null;
  end if;
  return null;
end $$;
drop trigger if exists bookings_unhide on public.bookings;
create trigger bookings_unhide after insert or update of status on public.bookings
  for each row execute function public.bookings_unhide();

-- mensajes del profesional (los que manda él, novedades, ofertas y cumpleaños): no le llegan al bloqueado. El saludo
-- de cumpleaños tampoco a quien sacó de su lista (sale de la lista de clientes a la que se le manda). Los avisos de
-- un turno (conf, r24, r2, rev, cancel) sí.
create or replace function public.client_messages_marketing() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('msg','bday','offer','news') and public.client_blocked(new.provider_id, new.user_id) then return null; end if;
  if new.kind = 'bday' and exists (select 1 from public.provider_clients c where c.provider_id = new.provider_id
                                     and c.user_id = new.user_id and c.hidden_at is not null) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists client_messages_marketing on public.client_messages;
create trigger client_messages_marketing before insert on public.client_messages
  for each row execute function public.client_messages_marketing();

-- ---------- Perfil público: con sesión del bloqueado, sin horarios (no_slots); sin sesión u otra cuenta, normal ----------
create or replace function public.get_provider(pid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'bio', p.bio, 'address', p.address, 'instagram', p.instagram,
    'hue', p.hue, 'photo_path', p.photo_path, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count, 'followers', p.followers,
    'dni_verified', p.dni_verified, 'tz', c.tz, 'can_charge', public.provider_can_charge(p.id),
    'categories', (select coalesce(jsonb_agg(pc.category_id order by pc.is_primary desc, pc.category_id), '[]') from public.provider_categories pc where pc.provider_id = p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_min, 'price', s.price, 'category', s.category_id,
                   'repeat_days', s.repeat_days, 'prep_note', s.prep_note, 'stamp_goal', s.stamp_goal,
                   'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'duration', a.duration_min) order by a.sort, a.id), '[]')
                              from public.service_addons a where a.service_id = s.id and a.active)) order by s.category_id, s.sort, s.price), '[]')
                 from public.services s where s.provider_id = p.id and s.active),
    'settings', (select to_jsonb(st) from public.provider_settings st where st.provider_id = p.id),
    'hours', case when x.no_slots then '[]'::jsonb else
              (select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'shift', h.shift, 'opens', to_char(h.opens,'HH24:MI'), 'closes', to_char(h.closes,'HH24:MI'))), '[]')
               from public.provider_hours h where h.provider_id = p.id) end,
    'reviews', (select coalesce(jsonb_agg(r), '[]') from (select id, author, stars, body, reply, created_at from public.reviews where provider_id = p.id order by created_at desc limit 20) r),
    'media', (select coalesce(jsonb_agg(m), '[]') from (select id, storage_path, kind, label from public.media where provider_id = p.id order by created_at desc limit 24) m),
    'following', exists (select 1 from public.follows f where f.provider_id = p.id and f.user_id = auth.uid()),
    'my_stamps', coalesce((select jsonb_object_agg(lc.service_id::text, lc.stamps) from public.loyalty_cards lc where lc.provider_id = p.id and lc.user_id = auth.uid()), '{}'::jsonb),
    'no_slots', x.no_slots
  ) end
  from public.providers p join public.cities c on c.id = p.city_id
  cross join lateral (select public.client_blocked(p.id, auth.uid()) as no_slots) x
  where p.id = pid and (p.status = 'active' or p.owner_id = auth.uid() or public.is_admin())
$$;

-- primer horario libre de las tarjetas (list_providers): el bloqueado ve «Sin turnos libres esta semana»
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; t timestamp; now_l timestamp; dd int; day date;
begin
  if public.client_blocked(pid, auth.uid()) then return null; end if;
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

-- ---------- Aviso de cancelación: al bloqueado, sin «Reprogramalo cuando quieras» (D45.5) ----------
create or replace function public.notify_booking(bid bigint, k text) returns void
language plpgsql security definer set search_path = public as $$
declare b record; t record; p record; lt timestamp; body text;
        dias text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
begin
  if bid is null then return; end if;
  select * into b from public.bookings where id = bid;
  if b is null or b.client_id is null or b.source <> 'app' then return; end if;
  if k = 'cancel' then
    if b.settle_by_provider then
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}. {barberia} se va a comunicar con vos para devolverte la seña ($' ||
             replace(to_char(b.paid_mp + b.paid_wallet, 'FM999,999,999'), ',', '.') || ') o pasarte el turno a otro día.' as body into t;
    else
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}.' ||
             case when b.paid_mp > 0 then ' Te devolvemos todo lo que pagaste ($' || replace(to_char(b.paid_mp + least(b.client_fee, b.app_fee) + b.paid_mp_fee, 'FM999,999,999'), ',', '.') || ').' else '' end ||
             case when public.client_blocked(b.provider_id, b.client_id) then '' else ' Reprogramalo cuando quieras desde Mis turnos: {link}' end as body into t;
    end if;
  else
    select enabled, mt.body into t from public.message_templates mt where provider_id = b.provider_id and key = k;
    if t is null or not t.enabled then return; end if;
  end if;
  select id, name, address, slug into p from public.providers where id = b.provider_id;
  lt := b.starts_at at time zone public.provider_tz(b.provider_id);
  body := replace(replace(replace(replace(replace(replace(t.body,
            '{nombre}', split_part(coalesce(b.client_name, ''), ' ', 1)), '{barberia}', p.name),
            '{dia}', dias[extract(dow from lt)::int + 1] || ' ' || extract(day from lt)::int || '/' || extract(month from lt)::int),
            '{hora}', to_char(lt, 'HH24:MI')), '{direccion}', coalesce(p.address, '')), '{link}', public.provider_link(p.id, p.slug));
  if k = 'rev' and exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'earn') then
    body := body || ' 🎟️ Sumaste 1 sello en tu tarjeta de ' || coalesce(b.service_name, 'este servicio') || '.';
  end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id, left(body, 600), k, bid::text) on conflict do nothing;
end $$;

-- ---------- Mis turnos: no_slots (sin «Reprogramar» ni «Reservar de nuevo» con ese profesional) ----------
create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.paid_mp_fee, b.mp_fee, b.mp_fee_pct, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
           exists (select 1 from public.reviews r where r.booking_id = b.id) as reviewed, b.pay_method, p.photo_path,
           exists (select 1 from public.loyalty_events le where le.booking_id = b.id and le.kind = 'earn') as stamped,
           rf.amount as refund_amount, rf.done_at as refund_done_at, rf.reason as refund_reason,
           case when rf.amount is null then null when rf.open then 'pending' else 'done' end as refund_status,
           public.client_blocked(b.provider_id, b.client_id) as no_slots
    from public.bookings b join public.providers p on p.id = b.provider_id join public.cities c on c.id = p.city_id
    left join public.services sv on sv.id = b.service_id
    left join lateral (select sum(r.amount)::int as amount, max(r.done_at) as done_at, min(r.reason) as reason,
                              bool_or(r.status in ('pending','failed')) as open
                       from public.refunds r where r.booking_id = b.id and r.status <> 'cancelled' having count(*) > 0) rf on true
    where b.client_id = auth.uid() and b.source = 'app'
    order by b.starts_at desc limit 200) x
$$;

-- ---------- Panel del profesional ----------
-- los turnos que vienen de una ficha (cliente de la app: por su cuenta; contacto a mano: por el nombre escrito)
create or replace function public.client_upcoming(p_provider bigint, p_user uuid, p_name text) returns setof bigint
language sql stable security definer set search_path = public as $$
  select b.id from public.bookings b
   where b.provider_id = p_provider and b.starts_at > now() and b.status in ('confirmed','hold') and b.source <> 'block'
     and ((p_user is not null and b.client_id = p_user)
          or (p_user is null and b.client_id is null and b.source = 'manual' and lower(b.client_name) = lower(p_name)))
   order by b.starts_at
$$;
revoke execute on function public.client_upcoming(bigint, uuid, text) from public, anon, authenticated;

-- cancela esos turnos con la regla de siempre (D08: se devuelve todo lo que pagó). Devuelve {cancelled, refund}.
create or replace function public.client_cancel_upcoming(p_provider bigint, p_user uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bid bigint; r jsonb; n int := 0; back int := 0;
begin
  for bid in select * from public.client_upcoming(p_provider, p_user, p_name) loop
    r := public.cancel_by_provider(bid);
    n := n + 1;
    back := back + coalesce((r->>'refund_mp')::int, 0);
  end loop;
  return jsonb_build_object('cancelled', n, 'refund', back);
end $$;
revoke execute on function public.client_cancel_upcoming(bigint, uuid, text) from public, anon, authenticated;

-- Eliminar de la lista. p_cancel: con turnos futuros, true los cancela (con devolución) y false los deja; null no hace
-- nada y avisa (has_upcoming). Contacto a mano: se borra. Cliente de la app: sale de Clientes (hidden_at).
create or replace function public.remove_client(p_client bigint, p_cancel boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); c record; res jsonb := jsonb_build_object('cancelled', 0, 'refund', 0);
begin
  if pid is null then raise exception 'not_provider'; end if;
  select * into c from public.provider_clients where id = p_client and provider_id = pid for update;
  if c is null then raise exception 'not_found'; end if;
  if exists (select 1 from public.client_upcoming(pid, c.user_id, c.name)) then
    if p_cancel is null then raise exception 'has_upcoming'; end if;
    if p_cancel then res := public.client_cancel_upcoming(pid, c.user_id, c.name); end if;
  end if;
  if c.user_id is null then
    delete from public.provider_clients where id = c.id;
  else
    update public.provider_clients set hidden_at = now() where id = c.id;
  end if;
  return res || jsonb_build_object('deleted', c.user_id is null);
end $$;

-- Bloquear a una cuenta que reservó o que lo sigue. Mismo p_cancel que remove_client.
create or replace function public.block_client(p_user uuid, p_cancel boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); res jsonb := jsonb_build_object('cancelled', 0, 'refund', 0);
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_user is null or p_user = auth.uid()
     or not (exists (select 1 from public.follows where provider_id = pid and user_id = p_user)
             or exists (select 1 from public.provider_clients where provider_id = pid and user_id = p_user)
             or exists (select 1 from public.bookings where provider_id = pid and client_id = p_user)) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.client_upcoming(pid, p_user, null)) and p_cancel is null then
    raise exception 'has_upcoming';
  end if;
  -- primero el bloqueo: el aviso de cancelación ya sale sin «Reprogramalo»
  insert into public.client_blocks (provider_id, user_id) values (pid, p_user) on conflict do nothing;
  if p_cancel then res := public.client_cancel_upcoming(pid, p_user, null); end if;
  delete from public.follows where provider_id = pid and user_id = p_user;
  delete from public.waitlist where provider_id = pid and user_id = p_user;
  -- lo que ya estaba en la cola y no salió (mensajes, novedades, ofertas, cumpleaños de este profesional)
  update public.push_outbox o set status = 'skipped', skip_reason = 'opt_out'
    from public.client_messages m
   where o.source = 'message' and o.source_id = m.id and o.status = 'pending' and o.user_id = p_user
     and m.provider_id = pid and m.kind in ('msg','bday','offer','news');
  update public.email_outbox e set status = 'skipped', skip_reason = 'opt_out'
    from public.client_messages m
   where e.message_id = m.id and e.status = 'pending' and m.provider_id = pid and m.user_id = p_user
     and m.kind in ('msg','bday','offer','news');
  return res;
end $$;

-- Desbloquear: vuelve a poder reservar y seguir (no se lo vuelve a seguir solo) y, si ya era cliente, vuelve a Clientes
create or replace function public.unblock_client(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  delete from public.client_blocks where provider_id = pid and user_id = p_user;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- Clientes → Bloqueados: nombre como en Clientes (o «Ana G.» si nunca reservó) y desde cuándo
create or replace function public.my_blocked() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.user_id, 'name', x.name, 'photo', x.avatar_path, 'since', x.created_at,
                                               'client', x.client_id) order by x.created_at desc), '[]')
  from (select k.user_id, k.created_at, pf.avatar_path, pc.id as client_id,
               coalesce(pc.name, public.follower_label(pf.full_name)) as name
          from public.client_blocks k
          left join public.profiles pf on pf.id = k.user_id
          left join public.provider_clients pc on pc.provider_id = k.provider_id and pc.user_id = k.user_id
         where k.provider_id = public.my_provider()
         order by k.created_at desc limit 500) x
$$;

-- ---------- Permisos ----------
revoke execute on function public.follows_blocked(), public.waitlist_blocked(), public.bookings_blocked(), public.bookings_unhide(),
  public.client_messages_marketing() from public, anon, authenticated;
revoke execute on function public.remove_client(bigint, boolean), public.block_client(uuid, boolean), public.unblock_client(uuid),
  public.my_blocked() from public, anon;
grant execute on function public.remove_client(bigint, boolean), public.block_client(uuid, boolean), public.unblock_client(uuid),
  public.my_blocked() to authenticated;
grant execute on function public.get_provider(bigint), public.next_free_slot(bigint, int) to anon, authenticated;
grant execute on function public.my_bookings() to authenticated;

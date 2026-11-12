-- 11/11 · D25 (decisión de Bruno): el profesional también recibe por EMAIL y en la CAMPANITA cada reserva nueva de la app y
-- cada cancelación de un cliente. Hasta ahora solo le llegaba un push (si lo tenía activado en ese dispositivo) y nada más.
-- - provider_notices 'new_booking' / 'client_cancel' (ref = id del turno): las deja el trigger bookings_provider_notice con
--   las mismas condiciones que el push (bookings_push): turno de la app, que no empezó; confirmado (también con un pago
--   tardío, expired → confirmed) o cancelado por el cliente estando confirmado.
-- - El push de esos avisos lo sigue mandando bookings_push (con su interruptor «Nuevas reservas y cancelaciones»):
--   provider_notices_push no manda otro.
-- - Email: provider_notices_email los encola (email_outbox con notice_id y booking_id) y emails_due los manda salvo que el
--   profesional apague «Emails de reservas y cancelaciones» (profiles.email_bookings, prendido por defecto). Una reserva
--   que ya no está confirmada (o ya empezó) no se manda; una cancelación de un turno que ya empezó, tampoco.
-- - my_provider_notices: el día del turno (para «Ver la Agenda» desde la campanita).

-- ---------- El interruptor ----------
alter table public.profiles add column if not exists email_bookings boolean not null default true;
grant select (email_bookings), update (email_bookings) on public.profiles to authenticated;   -- su fila (profiles_self/update)

-- ---------- Los tipos nuevos ----------
alter table public.provider_notices drop constraint if exists provider_notices_kind_check;
alter table public.provider_notices add constraint provider_notices_kind_check
  check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation','mp_reconnect','mp_cost','mp_connect','new_follower','mp_term','holiday',
                  'suspended','reactivated','holiday_bookings','new_booking','client_cancel'));
alter table public.email_outbox drop constraint if exists email_outbox_kind_check;
alter table public.email_outbox add constraint email_outbox_kind_check
  check (kind in ('conf','r24','r2','rev','bday','cancel','account','new_booking','client_cancel'));

-- el nombre que dejó el cliente, sin < > ni caracteres de control (el profesional lo ve igual en su Agenda; sin datos de
-- contacto); vacío: "Un cliente"
create or replace function public.booking_who(p_name text) returns text
language sql immutable set search_path = public as $$
  select left(coalesce(nullif(btrim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g')), ''), 'Un cliente'), 60)
$$;

-- ---------- El aviso ----------
create or replace function public.bookings_provider_notice() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text; txt text; svc text := coalesce(nullif(btrim(new.service_name), ''), 'un turno');
begin
  if new.source <> 'app' or new.starts_at <= now() then return null; end if;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status in ('hold','expired')) then
    k := 'new_booking';
    txt := public.booking_who(new.client_name) || ' reservó ' || svc || ' para el ' || public.push_when(new.starts_at, new.provider_id) || ' h.';
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled_client' then
    k := 'client_cancel';
    txt := public.booking_who(new.client_name) || ' canceló su turno de ' || svc || ' del ' || public.push_when(new.starts_at, new.provider_id)
           || ' h. Ese horario volvió a quedar libre.';
  else
    return null;
  end if;
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (new.provider_id, k, new.id::text, left(txt, 600))
  on conflict (provider_id, kind, ref) do nothing;
  return null;
end $$;
drop trigger if exists bookings_provider_notice on public.bookings;
create trigger bookings_provider_notice after insert or update of status on public.bookings
  for each row execute function public.bookings_provider_notice();

-- el push de los avisos del prestador: igual que en 20261110240000_feriados_cerrados.sql; las reservas y cancelaciones ya
-- tienen su push (bookings_push), así que no se manda otro
create or replace function public.provider_notices_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('new_booking','client_cancel') then return null; end if;
  perform public.push_enqueue((select owner_id from public.providers where id = new.provider_id),
    case when new.kind in ('mp_reconnect','mp_connect') then 'mp_reconnect' when new.kind = 'new_follower' then new.kind
         when new.kind in ('holiday','holiday_bookings') then 'holiday'
         when new.kind in ('suspended','reactivated') then 'account' else 'cobros' end,
    'notice', new.id, null,
    case when new.kind = 'new_follower' then now() + interval '1 day'
         when new.kind in ('holiday','holiday_bookings') and new.ref ~ '^\d{4}-\d{2}-\d{2}$'
           then greatest(now() + interval '1 hour', least(now() + interval '8 days', (new.ref::date)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
         else now() + interval '3 days' end);
  return null;
end $$;

-- y por email: los de la cuenta (igual que en 20261110175000_cuenta_suspendida.sql) y las reservas y cancelaciones (valen
-- hasta que empieza el turno, a lo sumo tres días)
create or replace function public.provider_notices_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; bk record;
begin
  if new.kind not in ('suspended','reactivated','new_booking','client_cancel') then return null; end if;
  select owner_id into owner from public.providers where id = new.provider_id;
  if owner is null then return null; end if;
  if new.kind in ('new_booking','client_cancel') then
    select b.id, b.starts_at into bk from public.bookings b where b.id = new.ref::bigint and b.provider_id = new.provider_id;
    if bk.id is null then return null; end if;
    insert into public.email_outbox (notice_id, user_id, kind, booking_id, expires_at)
    values (new.id, owner, new.kind, bk.id, least(now() + interval '3 days', bk.starts_at))
    on conflict do nothing;
  else
    insert into public.email_outbox (notice_id, user_id, kind, expires_at)
    values (new.id, owner, 'account', now() + interval '3 days')
    on conflict do nothing;
  end if;
  return null;
end $$;

-- ---------- Lo que manda email-send ----------
-- Igual que en 20261110175000_cuenta_suspendida.sql, más las reservas y cancelaciones al profesional (con su interruptor,
-- 'optional': el email dice dónde apagarlas)
create or replace function public.emails_due(p_limit int default 50)
returns table (id bigint, to_email text, subject text, body text, provider_name text, site_url text, optional boolean, for_provider boolean)
language plpgsql security definer set search_path = public as $$
declare r record; skip text; subj text; site text := (select s.site_url from public.app_settings s where s.id);
begin
  for r in select o.id, o.kind, o.expires_at, o.user_id, coalesce(m.body, n.body) as body, coalesce(pm.name, pn.name) as pname,
                  n.kind as nkind, pn.status as pstatus, (o.notice_id is not null) as to_provider,
                  u.email, u.email_confirmed_at, coalesce(pr.email_notices, true) as wants, coalesce(pr.email_bookings, true) as wants_bk,
                  b.status as bstatus, b.starts_at, b.provider_id as bpid, b.client_name,
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
                 when r.kind in ('new_booking','client_cancel') and not r.wants_bk then 'opt_out'
                 when r.kind = 'new_booking' and (r.bstatus is distinct from 'confirmed' or r.starts_at <= now()) then 'stale'
                 when r.kind = 'client_cancel' and (r.bstatus is distinct from 'cancelled_client' or r.starts_at <= now()) then 'stale'
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
      when 'new_booking' then 'Nueva reserva: ' || public.booking_who(r.client_name) || ' · ' || public.push_when(r.starts_at, r.bpid)
      when 'client_cancel' then 'Se canceló una reserva: ' || public.booking_who(r.client_name) || ' · ' || public.push_when(r.starts_at, r.bpid)
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
    optional := public.email_optional(r.kind) or r.kind in ('new_booking','client_cancel'); for_provider := r.to_provider;
    return next;
  end loop;
end $$;


-- la campanita: igual que en 20261110240000_feriados_cerrados.sql, más el día del turno de las reservas y cancelaciones
-- (y su propio tope)
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null,
                                               'ref', case when n.kind in ('holiday','holiday_bookings') then n.ref
                                                           when n.kind in ('new_booking','client_cancel') then
                                                             (select to_char(b.starts_at at time zone public.provider_tz(b.provider_id), 'YYYY-MM-DD')
                                                                from public.bookings b where b.id::text = n.ref and b.provider_id = n.provider_id) end,
                                               'open', case when n.kind in ('holiday','holiday_bookings') then (select d.open from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref) end)
                            order by n.created_at desc), '[]')
  -- los últimos 30 de los demás tipos y, aparte, las últimas 20 reservas y cancelaciones: en un día de mucho trabajo las
  -- reservas no tapan un aviso de cobros, de la cuenta o de un feriado
  from ((select * from public.provider_notices where provider_id = public.my_provider() and dismissed_at is null
           and kind not in ('new_booking','client_cancel') order by created_at desc limit 30)
        union all
        (select * from public.provider_notices where provider_id = public.my_provider() and dismissed_at is null
           and kind in ('new_booking','client_cancel') order by created_at desc limit 20)) n
$$;

revoke execute on function public.bookings_provider_notice(), public.booking_who(text) from public, anon, authenticated;

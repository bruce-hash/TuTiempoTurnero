-- =====================================================================
-- TuTiempo · Bloque 2b · Links de los avisos con la dirección del sitio (H24)
-- Los avisos que arma la base (notify_booking y send_scheduled_notices, {link}) usaban 'tutiempo.com.ar/' || slug escrito
-- a mano: en el subdominio de prueba llevaban al sitio equivocado. Ahora salen de app_settings.site_url (la cambia solo
-- el admin, desde Comisión → Dirección del sitio) + '/' || slug, o /p/<id> si el slug es una palabra reservada.
-- Las funciones son las de 0004 con ese único cambio.
-- =====================================================================
set search_path = public, extensions;

alter table public.app_settings add column if not exists site_url text not null default 'https://tutiempo.com.ar';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_site_url_check') then
    alter table public.app_settings add constraint app_settings_site_url_check
      check (site_url ~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' and char_length(site_url) <= 100);
  end if;
end $$;

-- dirección pública del perfil de un prestador (la misma que arma el frontend: router/direcciones.js)
create or replace function public.provider_link(p_id bigint, p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select (select site_url from public.app_settings where id)
         || case when p_slug is null or public.is_reserved_slug(p_slug) then '/p/' || p_id else '/' || p_slug end
$$;

-- el admin cambia la dirección del sitio (sin barra al final, con https://)
create or replace function public.admin_set_site_url(p_url text) returns text
language plpgsql security definer set search_path = public as $$
declare url text := lower(rtrim(btrim(coalesce(p_url, '')), '/'));
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if url !~ '^https?://[a-z0-9.-]+(:[0-9]{1,5})?$' or char_length(url) > 100 then raise exception 'bad_site_url'; end if;
  update public.app_settings set site_url = url, updated_at = now() where id;
  return url;
end $$;

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
             case when b.paid_mp > 0 then ' Te devolvemos todo lo que pagaste ($' || replace(to_char(b.paid_mp + least(b.client_fee, b.app_fee), 'FM999,999,999'), ',', '.') || ').' else '' end ||
             ' Reprogramalo cuando quieras desde Mis turnos: {link}' as body into t;
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

-- Recordatorios (24 h y 2 h antes) y cumpleaños. Lo corre pg_cron cada 10 minutos.
create or replace function public.send_scheduled_notices() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; tz text := 'America/Argentina/Buenos_Aires';
begin
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() + interval '2 hours' and b.starts_at <= now() + interval '24 hours' and b.created_at < b.starts_at - interval '24 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r24' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r24'); n := n + 1;
  end loop;
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() and b.starts_at <= now() + interval '2 hours' and b.created_at < b.starts_at - interval '2 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r2' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r2'); n := n + 1;
  end loop;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  select c.provider_id, c.user_id,
         left(replace(replace(replace(t.body, '{nombre}', split_part(c.name, ' ', 1)), '{barberia}', p.name), '{link}', public.provider_link(p.id, p.slug)), 600),
         'bday', to_char(now() at time zone tz, 'YYYY')
  from public.provider_clients c
  join public.message_templates t on t.provider_id = c.provider_id and t.key = 'bday' and t.enabled
  join public.providers p on p.id = c.provider_id and p.status = 'active'
  where c.user_id is not null and c.birthday = to_char(now() at time zone tz, 'MM-DD')
  on conflict do nothing;
  return n;
end $$;

revoke execute on function public.provider_link(bigint, text), public.admin_set_site_url(text) from public, anon, authenticated;
grant execute on function public.admin_set_site_url(text) to authenticated;

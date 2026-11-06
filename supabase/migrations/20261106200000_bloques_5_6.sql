-- 7/11 · Bloques 5 y 6 (docs/01: D10, D24, D25). Idempotente; no borra datos.
--
-- Bloque 5 · cliente: el recordatorio de 2 h antes del turno y el saludo de cumpleaños dejan de mandarse, para todos
-- (en la app, por email y por notificación). Queda el recordatorio del día anterior (r24). Los avisos viejos de esos
-- tipos, las plantillas de cada profesional y el cumpleaños de sus clientes quedan en la base; lo que estaba en la cola
-- sin mandar se marca como salteado.
--
-- Bloque 6 · admin: las fotos del DNI se borran en el momento en que el admin verifica al profesional (ya no a los 30
-- días). Las borra la misma Edge Function dni-cleanup, con la API de Storage. Lo demás de D24 sigue igual (alta sin
-- aprobar: 90 días después de la última foto; baja: en el momento; verificado sin fecha, de antes del 2b: las conserva).

-- ---------- Bloque 5: solo el recordatorio del día anterior ----------
create or replace function public.send_scheduled_notices() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() + interval '2 hours' and b.starts_at <= now() + interval '24 hours' and b.created_at < b.starts_at - interval '24 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r24' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r24'); n := n + 1;
  end loop;
  -- 7/11 · Bloque 5: sin el recordatorio de 2 h (r2) ni el saludo de cumpleaños (bday)
  return n;
end $$;
revoke execute on function public.send_scheduled_notices() from public, anon, authenticated;

-- lo que quedó en la cola sin mandar
update public.email_outbox set status = 'skipped', skip_reason = 'stale'
 where status = 'pending' and kind in ('r2', 'bday');
update public.push_outbox set status = 'skipped', skip_reason = 'stale'
 where status = 'pending' and kind in ('r2', 'bday');

-- ---------- Bloque 6: las fotos del DNI se borran al verificar ----------
create or replace function public.dni_photos_due(p_limit int default 100)
returns table (folder text, reason text, paths text[])
language sql stable security definer set search_path = public as $$
  with files as (
    select split_part(o.name, '/', 1) as folder, o.name, o.created_at
      from storage.objects o where o.bucket_id = 'dni'
  ), owner_of as (
    select f.folder, max(f.created_at) as last_upload, lp.id as provider_id, lp.dni_verified, lp.dni_verified_at
      from files f
      left join lateral (
        select p.id, p.dni_verified, pp.dni_verified_at
          from public.providers p left join public.provider_private pp on pp.provider_id = p.id
         where p.owner_id::text = f.folder and p.status <> 'deleted'
         order by p.created_at desc limit 1) lp on true
     group by f.folder, lp.id, lp.dni_verified, lp.dni_verified_at
  ), due as (
    select f.folder, f.name,
           case
             -- baja: la carpeta ya no es de ningún prestador (provider_teardown deja owner_id en null)
             when w.provider_id is null then 'baja'
             -- verificado (con fecha): en el momento (7/11 · Bloque 6; antes, a los 30 días). Sin fecha, de antes del 2b,
             -- no: necesita las fotos para reactivarse
             when w.dni_verified and w.dni_verified_at is not null then 'verificado'
             -- sin aprobar: 90 días desde la última foto subida
             when not w.dni_verified and w.last_upload <= now() - interval '90 days' then 'sin_aprobar'
           end as reason
      from files f join owner_of w on w.folder = f.folder
  )
  select d.folder, d.reason, array_agg(d.name order by d.name)
    from due d where d.reason is not null
   group by d.folder, d.reason
   order by d.folder, d.reason
   limit greatest(coalesce(p_limit, 100), 1)
$$;
revoke execute on function public.dni_photos_due(int) from public, anon, authenticated;
grant execute on function public.dni_photos_due(int) to service_role;

-- al verificar (admin_set_provider deja dni_verified_at), se pide el borrado ya, igual que en la baja. pg_net manda el
-- pedido después del commit, así que dni-cleanup ve al profesional verificado. Si algo falla acá, la verificación sigue
-- igual y la tarea diaria (tt-dni-cleanup) las borra después.
create or replace function public.provider_verified_dni() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace where n.nspname = 'net' and f.proname = 'http_post') then
    begin
      perform public.run_dni_cleanup();
    exception when others then
      raise warning 'provider_verified_dni: no se pudo pedir el borrado de las fotos (%): queda para la tarea diaria', sqlerrm;
    end;
  end if;
  return null;
end $$;
drop trigger if exists provider_verified_dni on public.provider_private;
create trigger provider_verified_dni after update of dni_verified_at on public.provider_private
  for each row when (new.dni_verified_at is not null and old.dni_verified_at is null)
  execute function public.provider_verified_dni();
revoke execute on function public.provider_verified_dni() from public, anon, authenticated;

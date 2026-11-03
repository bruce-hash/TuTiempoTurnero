-- v2 · Cliente (3/11): "Avisos y mensajes de tus profesionales" en Mis turnos.
-- - Cada aviso lleva la acción que corresponde a lo que dice (ver el turno, dejar la reseña, ver el perfil): my_messages
--   devuelve también ref (el turno de conf, r24, r2, rev y cancel; el año de bday).
-- - El cliente borra un aviso (✕) o todos los leídos ("Borrar los leídos"). No se eliminan: quedan con dismissed_at y
--   dejan de salir en su lista. Así el límite diario de mensajes de cada profesional (send_client_messages cuenta los
--   que mandó en 24 h) sigue igual y no se pierde ningún dato.
-- Idempotente.

alter table public.client_messages add column if not exists dismissed_at timestamptz;

create or replace function public.my_messages() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select m.id, m.provider_id, p.name as provider_name, p.photo_path, p.hue, m.body, m.created_at,
           m.read_at is not null as read, m.kind, m.ref
    from public.client_messages m join public.providers p on p.id = m.provider_id
    where m.user_id = auth.uid() and m.dismissed_at is null
    order by m.created_at desc limit 50) x
$$;

-- p_ids: los avisos a borrar (hasta 100); null = todos los leídos. Solo los del cliente que llama.
create or replace function public.dismiss_messages(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_ids is not null and cardinality(p_ids) > 100 then raise exception 'too_many'; end if;
  update public.client_messages set dismissed_at = now()
   where user_id = auth.uid() and dismissed_at is null
     and (case when p_ids is null then read_at is not null else id = any(p_ids) end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.dismiss_messages(bigint[]) from public, anon;
grant execute on function public.dismiss_messages(bigint[]) to authenticated;

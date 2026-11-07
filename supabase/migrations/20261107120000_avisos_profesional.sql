-- 7/11 · Revisión del cliente (punto 2): los avisos del profesional funcionan igual que los del cliente. Al abrir la
-- campanita quedan leídos (mark_provider_notices_read, como antes), y ahora además se borran: uno con la ✕ o todos los
-- leídos con «Borrar los leídos». No se borran filas: queda dismissed_at, así un aviso que sale una sola vez (el de un
-- feriado, el de un seguidor nuevo: unique (provider_id, kind, ref)) no vuelve a aparecer. Idempotente; no borra datos.

alter table public.provider_notices add column if not exists dismissed_at timestamptz;

-- p_ids null: todos los leídos; si no, esos (hasta 100), siempre del negocio de quien llama
create or replace function public.dismiss_provider_notices(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_ids is not null and cardinality(p_ids) > 100 then raise exception 'too_many'; end if;
  update public.provider_notices set dismissed_at = now(), read_at = coalesce(read_at, now())
   where provider_id = pid and dismissed_at is null
     and (case when p_ids is null then read_at is not null else id = any(p_ids) end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.dismiss_provider_notices(bigint[]) from public, anon;
grant execute on function public.dismiss_provider_notices(bigint[]) to authenticated;

-- la lista de la campanita: sin los borrados (igual que en 20261106210000_feriados.sql, más ese filtro)
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null,
                                               'ref', case when n.kind = 'holiday' then n.ref end,
                                               'open', case when n.kind = 'holiday' then (select d.open from public.provider_holidays d where d.provider_id = n.provider_id and d.day::text = n.ref) end)
                            order by n.created_at desc), '[]')
  from (select * from public.provider_notices where provider_id = public.my_provider() and dismissed_at is null
         order by created_at desc limit 30) n
$$;
revoke execute on function public.my_provider_notices() from public, anon;
grant execute on function public.my_provider_notices() to authenticated;

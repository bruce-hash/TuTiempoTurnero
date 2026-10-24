-- =====================================================================
-- TuTiempo · Bloque 1 · Slugs reservados con trigger (reemplaza el check de 20261023044614)
-- Un check "not valid" no revisa las filas viejas al crearse, pero Postgres lo vuelve a revisar en cada UPDATE de la
-- fila, aunque no cambie el slug: un prestador que ya tuviera un slug reservado no podría actualizar su puntaje,
-- seguidores ni actividad. El trigger mira el slug solo cuando se crea o se cambia.
-- No cambia ningún dato.
-- =====================================================================
create or replace function public.providers_slug_not_reserved() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' or new.slug is distinct from old.slug) and public.is_reserved_slug(new.slug) then
    raise exception 'reserved_slug' using errcode = 'check_violation', detail = new.slug;
  end if;
  return new;
end $$;
revoke execute on function public.providers_slug_not_reserved() from public;

drop trigger if exists providers_slug_not_reserved on public.providers;
create trigger providers_slug_not_reserved before insert or update of slug on public.providers
  for each row execute function public.providers_slug_not_reserved();

alter table public.providers drop constraint if exists providers_slug_not_reserved;

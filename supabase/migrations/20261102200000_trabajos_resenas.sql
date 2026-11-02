-- =====================================================================
-- TuTiempo · V5 · Trabajos y reseñas
--   - C26: el prestador le pone nombre a cada trabajo (media.label, hasta 80 letras; vacío = sin nombre). Hasta ahora
--     solo podía subir y borrar: se abre la actualización de la columna label, solo de sus propios trabajos.
--   - C28: el pedido de reseña sale del panel (el prestador ya no lo apaga ni lo edita): es uno de los avisos automáticos
--     de D25/D27 y queda encendido para todos. Los que lo habían apagado lo vuelven a tener encendido; el texto que
--     hubieran escrito queda como estaba. El cliente sigue pudiendo dejar de recibirlo por email desde Mi perfil.
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- C26 · nombre de los trabajos ----------
-- espacios de más afuera y vacío = sin nombre
create or replace function public.media_clean_label() returns trigger
language plpgsql set search_path = public as $$
begin
  new.label := nullif(btrim(new.label), '');
  return new;
end $$;
drop trigger if exists media_clean_label on public.media;
create trigger media_clean_label before insert or update of label on public.media
  for each row execute function public.media_clean_label();

grant update (label) on public.media to authenticated;
drop policy if exists media_update on public.media;
create policy media_update on public.media for update to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())))
  with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

-- ---------- C28 · el pedido de reseña, siempre encendido ----------
update public.message_templates set enabled = true where key = 'rev' and not enabled;

-- y no se puede volver a apagar desde la app (el panel ya no lo muestra)
create or replace function public.keep_review_request() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.key = 'rev' then
    new.enabled := true;
  end if;
  return new;
end $$;
drop trigger if exists message_templates_keep_rev on public.message_templates;
create trigger message_templates_keep_rev before insert or update on public.message_templates
  for each row execute function public.keep_review_request();

revoke execute on function public.media_clean_label(), public.keep_review_request() from public, anon, authenticated;

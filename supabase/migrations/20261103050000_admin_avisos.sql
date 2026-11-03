-- =====================================================================
-- TuTiempo · v2 (3/11) · Admin
--   - Avisos del panel de TuTiempo que se pueden borrar: los del Resumen (profesionales sin Mercado Pago, pendientes de
--     aprobar, faltas altas, el sitio sin .htaccess) y los de Para revisar que son solo informativos (avisos de Mercado
--     Pago rechazados o recuperados). Cada aviso tiene una clave que cambia si cambia lo que dice (por ejemplo, la lista
--     de profesionales sin Mercado Pago): uno borrado no vuelve, salvo que haya algo nuevo. admin_alert_marks guarda, por
--     admin, cuándo vio cada aviso y cuándo lo borró. Los pagos y devoluciones para resolver NO se borran: salen solos al
--     resolverlos.
--   - «Avisarle» con el mensaje editable: admin_nudge_mp(profesional, texto); sin texto, el de siempre.
-- Idempotente y sin borrar datos.
-- =====================================================================
set search_path = public, extensions;

create table if not exists public.admin_alert_marks (
  admin_id     uuid not null references auth.users(id) on delete cascade,
  key          text not null check (char_length(key) between 1 and 200),
  seen_at      timestamptz not null default now(),
  dismissed_at timestamptz,
  primary key (admin_id, key)
);
alter table public.admin_alert_marks enable row level security;
revoke all on public.admin_alert_marks from public, anon, authenticated;   -- solo por las funciones de abajo

-- lo que ya vio y borró este admin (las marcas de más de 120 días no se usan: un aviso tan viejo con la misma clave vuelve)
create or replace function public.admin_alert_marks_get() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_object_agg(key, jsonb_build_object('seen', seen_at, 'dismissed', dismissed_at))
                     from public.admin_alert_marks where admin_id = auth.uid() and seen_at > now() - interval '120 days'), '{}'::jsonb);
end $$;

-- marca avisos como vistos (p_dismiss false) o los borra (true). Hasta 100 claves por llamada.
create or replace function public.admin_alert_mark(p_keys text[], p_dismiss boolean) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_keys is null or cardinality(p_keys) = 0 then return 0; end if;
  if cardinality(p_keys) > 100 then raise exception 'too_many'; end if;
  insert into public.admin_alert_marks as m (admin_id, key, seen_at, dismissed_at)
  select auth.uid(), k, now(), case when p_dismiss then now() end
    from (select distinct left(btrim(x), 200) k from unnest(p_keys) x where x is not null and btrim(x) <> '') q
  on conflict (admin_id, key) do update
    set dismissed_at = case when p_dismiss then coalesce(m.dismissed_at, now()) else m.dismissed_at end;
  get diagnostics n = row_count;
  return n;
end $$;

-- «Avisarle»: el admin puede cambiar el texto (entre 10 y 500 letras); el aviso llega al panel del profesional y por push
create or replace function public.admin_nudge_mp(p_provider bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p record; today text := to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'YYYY-MM-DD'); n int;
        msg text := nullif(btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if msg is not null and char_length(msg) not between 10 and 500 then raise exception 'bad_body'; end if;
  select id, status into p from public.providers where id = p_provider;
  if p.id is null or p.status <> 'active' then raise exception 'not_active'; end if;
  if public.provider_can_charge(p.id) then raise exception 'already_connected'; end if;
  insert into public.provider_notices (provider_id, kind, ref, body)
  values (p.id, 'mp_connect', 'aviso-' || today,
          coalesce(msg, 'TuTiempo te recuerda: conectá tu cuenta de Mercado Pago para cobrar las señas y recibir reservas online. Entrá a Perfil → Mercado Pago → Conectar.'))
  on conflict (provider_id, kind, ref) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('sent', n > 0);
end $$;
create or replace function public.admin_nudge_mp(p_provider bigint) returns jsonb
language sql security definer set search_path = public as $$ select public.admin_nudge_mp(p_provider, null::text) $$;

revoke execute on function public.admin_alert_marks_get(), public.admin_alert_mark(text[], boolean),
  public.admin_nudge_mp(bigint, text), public.admin_nudge_mp(bigint) from public, anon;
grant execute on function public.admin_alert_marks_get(), public.admin_alert_mark(text[], boolean),
  public.admin_nudge_mp(bigint, text), public.admin_nudge_mp(bigint) to authenticated;

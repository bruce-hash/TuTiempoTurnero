-- =====================================================================
-- TuTiempo · Bloque 2a · Ninguna llave en texto plano en mp_accounts
-- Las llaves copiadas de provider_secrets en el Bloque 1 (legacy) están sin cifrar y la base no las puede cifrar (la
-- clave la tienen solo las Edge Functions). Se borran: access_token y refresh_token en null, con el motivo en
-- last_error. Si la cuenta cobraba, pasa a "solo devoluciones" y el prestador recibe el aviso para volver a conectar
-- (al reconectar la misma cuenta de Mercado Pago, la fila recupera llaves cifradas y vuelve a cobrar).
-- Idempotente: una segunda corrida no encuentra llaves sin cifrar.
-- =====================================================================
do $$ declare r record; begin
  for r in
    with plain as (
      select id, status as was from public.mp_accounts
       where (access_token is not null and access_token !~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$')
          or (refresh_token is not null and refresh_token !~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$')
       for update)
    update public.mp_accounts a
       set access_token = null, refresh_token = null, refreshing_until = null,
           last_error = 'Llave sin cifrar: hay que reconectar',
           status = case when a.status = 'active' then 'refunds_only' else a.status end,
           disconnected_at = case when a.status = 'active' then now() else a.disconnected_at end
      from plain where a.id = plain.id
    returning a.id, a.provider_id, plain.was
  loop
    if r.was = 'active' then
      insert into public.provider_notices (provider_id, kind, ref, body)
      values (r.provider_id, 'mp_reconnect', 'cuenta-' || r.id,
              'Tenés que volver a conectar tu cuenta de Mercado Pago para seguir recibiendo reservas con seña (Perfil → Cobros).')
      on conflict do nothing;
    end if;
  end loop;
end $$;

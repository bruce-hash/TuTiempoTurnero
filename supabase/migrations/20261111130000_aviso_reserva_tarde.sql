-- 11/11 · avisos: una reserva de la app que se confirma con un pago que llegó después de que venció la espera de 10
-- minutos (expired → confirmed, confirm_payment_core) no le avisaba al profesional por push: bookings_push solo miraba
-- hold → confirmed. Pasa sobre todo cuando el pago lo registra la consulta automática (mp-reconcile) porque el aviso de
-- Mercado Pago no llegó o se rechazó (H06). Igual que en 20261028160000_push.sql, con 'expired' también.
create or replace function public.bookings_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.source <> 'app' or new.starts_at <= now() then return null; end if;
  select owner_id into owner from public.providers where id = new.provider_id;
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status in ('hold','expired')) then
    perform public.push_enqueue(owner, 'new_booking', 'booking', new.id, new.id, new.starts_at);
  elsif tg_op = 'UPDATE' and old.status = 'confirmed' and new.status = 'cancelled_client' then
    perform public.push_enqueue(owner, 'client_cancel', 'booking', new.id, new.id, new.starts_at);
  end if;
  return null;
end $$;

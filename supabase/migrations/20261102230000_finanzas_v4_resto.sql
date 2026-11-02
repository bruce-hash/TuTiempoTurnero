-- =====================================================================
-- TuTiempo · V4 (lo que esperaba la respuesta del cliente)
--   - C31 · Gastos fijos: cada prestador tiene sus gastos fijos (fixed_expenses), precargados alquiler, luz, gas,
--     internet y monotributo (sin monto: los completa él). Se repiten solos cada mes: fixed_expenses_sync() carga en
--     expenses el gasto de cada mes que falte (desde el mes en que se creó, salvo meses cerrados, una fila por gasto y
--     mes: expenses.fixed_id + fixed_month). Se editan "desde este mes en adelante" (fixed_expense_save): cambia el
--     monto de ese mes y de los siguientes que no estén cerrados; los meses cerrados no se tocan. fixed_expense_stop
--     deja de repetirlo desde un mes (borra solo las filas de ese mes en adelante que no estén cerradas).
--   - C36 · Productos: precio de compra (products.cost, opcional) además del de venta. La venta en el local ya entra
--     en la Caja del día (walkins kind 'product'); ahora también desde Productos ("Vendí uno"), en la app.
--   - C30 · Cerrar el día: lo pendiente lo arma la app con los turnos de hoy (sin marcar y cobros sin medio); no cambia
--     la base.
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- C36 · precio de compra ----------
alter table public.products add column if not exists cost integer;
alter table public.products drop constraint if exists products_cost_check;
alter table public.products add constraint products_cost_check check (cost is null or cost >= 0);

-- ---------- C31 · gastos fijos ----------
create table if not exists public.fixed_expenses (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  concept     text not null check (char_length(concept) between 1 and 80),
  category    text not null check (category in ('Alquiler','Insumos','Servicios','Otros')),
  amount      integer not null default 0 check (amount >= 0),   -- 0 = todavía sin monto: no se carga
  since       date not null,                                   -- el 1° del mes desde el que se repite
  until_month date,                                            -- el 1° del último mes (null = sigue)
  created_at  timestamptz not null default now(),
  check (extract(day from since) = 1),
  check (until_month is null or (extract(day from until_month) = 1 and until_month >= since))
);
create index if not exists fixed_expenses_provider on public.fixed_expenses (provider_id);
alter table public.fixed_expenses enable row level security;
revoke all on public.fixed_expenses from public, anon, authenticated;
grant select on public.fixed_expenses to authenticated;   -- los cambios, solo por las funciones de abajo
drop policy if exists fixed_expenses_owner on public.fixed_expenses;
create policy fixed_expenses_owner on public.fixed_expenses for select to authenticated
  using (provider_id = (select public.my_provider()));

alter table public.expenses add column if not exists fixed_id bigint references public.fixed_expenses(id) on delete set null;
alter table public.expenses add column if not exists fixed_month date;
create unique index if not exists expenses_fixed_month on public.expenses (fixed_id, fixed_month) where fixed_id is not null;

-- el 1° del mes de hoy (Buenos Aires)
create or replace function public.month_start_ba() returns date
language sql stable set search_path = public as $$
  select date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires'))::date
$$;
create or replace function public.month_closed(p_provider bigint, p_month date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cash_closings c where c.provider_id = p_provider and c.kind = 'month' and c.period = p_month)
$$;

-- carga los gastos fijos que falten hasta este mes (y los precargados, la primera vez). Idempotente: la app la llama al
-- abrir el panel.
create or replace function public.fixed_expenses_sync() returns int
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); m0 date := public.month_start_ba(); f record; m date; n int := 0;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if not exists (select 1 from public.fixed_expenses where provider_id = pid) then
    insert into public.fixed_expenses (provider_id, concept, category, since)
    values (pid, 'Alquiler', 'Alquiler', m0), (pid, 'Luz', 'Servicios', m0), (pid, 'Gas', 'Servicios', m0),
           (pid, 'Internet', 'Servicios', m0), (pid, 'Monotributo', 'Otros', m0);
  end if;
  for f in select * from public.fixed_expenses where provider_id = pid and amount > 0 loop
    m := f.since;
    while m <= least(m0, coalesce(f.until_month, m0)) loop
      if not public.month_closed(pid, m) then
        insert into public.expenses (provider_id, concept, amount, category, spent_on, fixed_id, fixed_month)
        values (pid, f.concept, f.amount, f.category, m, f.id, m)
        on conflict (fixed_id, fixed_month) where fixed_id is not null do nothing;
        if found then n := n + 1; end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
  return n;
end $$;

-- crea un gasto fijo (p_id null) o lo cambia desde un mes en adelante: el monto, el nombre y el rubro de ese mes y los
-- siguientes que no estén cerrados. Un mes cerrado no se puede tocar (month_closed).
create or replace function public.fixed_expense_save(p_id bigint, p_concept text, p_category text, p_amount int, p_from date)
returns bigint language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); fid bigint; mfrom date := date_trunc('month', p_from)::date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'bad_amount'; end if;
  if p_concept is null or char_length(btrim(p_concept)) not between 1 and 80 then raise exception 'bad_concept'; end if;
  if p_category is null or p_category not in ('Alquiler','Insumos','Servicios','Otros') then raise exception 'bad_category'; end if;
  if mfrom is null or mfrom > public.month_start_ba() then raise exception 'bad_month'; end if;
  if public.month_closed(pid, mfrom) then raise exception 'month_closed'; end if;
  if p_id is null then
    insert into public.fixed_expenses (provider_id, concept, category, amount, since)
    values (pid, btrim(p_concept), p_category, p_amount, mfrom) returning id into fid;
  else
    select id into fid from public.fixed_expenses where id = p_id and provider_id = pid for update;
    if fid is null then raise exception 'forbidden'; end if;
    update public.fixed_expenses set concept = btrim(p_concept), category = p_category, amount = p_amount,
           since = least(since, mfrom), until_month = null
     where id = fid;
    -- los meses desde mfrom que no están cerrados: el monto nuevo (o afuera si queda en 0)
    delete from public.expenses e where e.fixed_id = fid and e.fixed_month >= mfrom and p_amount = 0
       and not public.month_closed(pid, e.fixed_month);
    update public.expenses e set amount = p_amount, concept = btrim(p_concept), category = p_category
     where e.fixed_id = fid and e.fixed_month >= mfrom and p_amount > 0 and not public.month_closed(pid, e.fixed_month);
  end if;
  perform public.fixed_expenses_sync();
  return fid;
end $$;

-- deja de repetirlo desde un mes (ese mes y los siguientes que no estén cerrados salen de los gastos)
create or replace function public.fixed_expense_stop(p_id bigint, p_from date) returns void
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); f record; mfrom date := date_trunc('month', p_from)::date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  select * into f from public.fixed_expenses where id = p_id and provider_id = pid for update;
  if f.id is null then raise exception 'forbidden'; end if;
  if mfrom is null or mfrom > public.month_start_ba() then raise exception 'bad_month'; end if;
  if public.month_closed(pid, mfrom) then raise exception 'month_closed'; end if;
  if mfrom <= f.since then
    update public.fixed_expenses set amount = 0, until_month = null where id = f.id;
  else
    update public.fixed_expenses set until_month = (mfrom - interval '1 month')::date where id = f.id;
  end if;
  delete from public.expenses e where e.fixed_id = f.id and e.fixed_month >= mfrom and not public.month_closed(pid, e.fixed_month);
end $$;

-- un gasto que viene de un gasto fijo se cambia desde "Gastos fijos" (no se borra suelto)
create or replace function public.expenses_fixed_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- desde la app (authenticated) no; las funciones de arriba corren como su dueño y sí pueden
  if old.fixed_id is not null and current_user in ('authenticated', 'anon') then
    raise exception 'fixed_expense';
  end if;
  return old;
end $$;
drop trigger if exists expenses_fixed_guard on public.expenses;
create trigger expenses_fixed_guard before delete on public.expenses
  for each row execute function public.expenses_fixed_guard();

revoke execute on function public.month_start_ba(), public.month_closed(bigint, date), public.expenses_fixed_guard()
  from public, anon, authenticated;
revoke execute on function public.fixed_expenses_sync(), public.fixed_expense_save(bigint, text, text, int, date),
  public.fixed_expense_stop(bigint, date) from public, anon;
grant execute on function public.fixed_expenses_sync(), public.fixed_expense_save(bigint, text, text, int, date),
  public.fixed_expense_stop(bigint, date) to authenticated;

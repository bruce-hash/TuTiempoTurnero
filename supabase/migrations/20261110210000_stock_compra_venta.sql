-- =====================================================================
-- TuTiempo · 10/11 · punto 9 · Productos: el stock solo cambia por una compra o por una venta
--   - Antes la app escribía products.stock directo (los botones + y − de Productos, «Compré más» y «Vender producto»
--     mandaban el número nuevo desde el navegador). Ahora el stock lo lleva la base:
--       · sube solo con una compra: product_buy (suma al stock y carga el gasto de productos del mes en la misma
--         transacción, ligado al producto y con la cantidad). Con el mes actual cerrado, no entra (month_closed), como
--         los gastos fijos;
--       · baja solo con una venta: el trigger walkins_stock descuenta la cantidad al guardar una venta (walkins de tipo
--         'product' con producto) y falla con no_stock si no alcanza; borrar la venta la devuelve y cambiar el producto o
--         la cantidad ajusta la diferencia;
--       · el producto nuevo con su stock inicial: product_add (el producto y, con precio de compra, el gasto «Stock
--         inicial» en la misma transacción). El insert directo sigue permitido (con stock inicial).
--   - La app ya no puede cambiar products.stock por update: la columna sale de los permisos de la app y el trigger
--     products_stock_guard lo frena igual (stock_locked) si alguna vez vuelve a tener el permiso. Las funciones de
--     arriba corren como su dueño y sí pueden; las tareas sin sesión (cron, SQL Editor) tampoco pasan por la regla.
--   - Las ventas viejas sin producto (product_id null) no tocan el stock, como antes.
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- columnas que la app puede cambiar en un producto (stock no) ----------
revoke update on public.products from authenticated;
grant update (name, price, cost, min_stock) on public.products to authenticated;

-- ---------- stock: nadie lo cambia por update desde la app ----------
create or replace function public.products_stock_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- desde la app (authenticated/anon) no; las funciones security definer corren como su dueño y sí pueden
  if new.stock is distinct from old.stock and current_user in ('authenticated', 'anon') then
    raise exception 'stock_locked';
  end if;
  return new;
end $$;
drop trigger if exists products_stock_guard on public.products;
create trigger products_stock_guard before update of stock on public.products
  for each row execute function public.products_stock_guard();

-- ---------- la venta baja el stock; borrarla lo devuelve ----------
create or replace function public.walkins_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_on boolean := tg_op <> 'INSERT' and old.kind = 'product' and old.product_id is not null;
  new_on boolean := tg_op <> 'DELETE' and new.kind = 'product' and new.product_id is not null;
  n int;
begin
  -- un cambio que no toca el producto ni la cantidad no mueve el stock
  if tg_op = 'UPDATE' and old_on = new_on and old.product_id is not distinct from new.product_id
     and coalesce(old.qty, 1) = coalesce(new.qty, 1) then
    return null;
  end if;
  -- lo vendido antes vuelve al stock (si el producto ya no existe, no hay nada que devolver)
  if old_on then
    update public.products set stock = stock + coalesce(old.qty, 1) where id = old.product_id;
  end if;
  if new_on then
    n := coalesce(new.qty, 1);
    if not exists (select 1 from public.products p where p.id = new.product_id and p.provider_id = new.provider_id) then
      raise exception 'product_not_found';
    end if;
    update public.products set stock = stock - n where id = new.product_id and stock >= n;
    if not found then raise exception 'no_stock'; end if;
  end if;
  return null;
end $$;
drop trigger if exists walkins_stock on public.walkins;
create trigger walkins_stock after insert or update of kind, product_id, qty or delete on public.walkins
  for each row execute function public.walkins_stock();

-- ---------- la compra: suma al stock y carga el gasto del mes, todo junto ----------
-- p_cost es lo que pagó por todas las unidades (entero, en pesos). Devuelve el stock nuevo y el gasto cargado.
create or replace function public.product_buy(p_product bigint, p_qty int, p_cost int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pid bigint := public.my_provider();
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  pr record; st int; eid bigint;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'bad_qty'; end if;
  if p_cost is null or p_cost < 1 then raise exception 'bad_amount'; end if;
  select p.id, p.name into pr from public.products p where p.id = p_product and p.provider_id = pid for update;
  if not found then raise exception 'product_not_found'; end if;
  if public.month_closed(pid, public.month_start_ba()) then raise exception 'month_closed'; end if;
  update public.products set stock = stock + p_qty where id = pr.id returning stock into st;
  insert into public.expenses (provider_id, concept, amount, category, spent_on, product_id, qty)
  values (pid, left('Compra: ' || pr.name || ' × ' || p_qty, 80), p_cost, 'Productos', today, pr.id, p_qty)
  returning id into eid;
  return jsonb_build_object('stock', st, 'expense_id', eid, 'spent_on', today);
end $$;

-- ---------- el producto nuevo con su stock inicial (y, con precio de compra, su gasto) ----------
create or replace function public.product_add(p_name text, p_price int, p_cost int, p_stock int, p_min int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  pid bigint := public.my_provider();
  today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
  nm text := btrim(coalesce(p_name, ''));
  st int := coalesce(p_stock, 0);
  spent int; prid bigint; eid bigint;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if st < 0 or coalesce(p_min, 0) < 0 then raise exception 'bad_qty'; end if;
  if p_price is null or p_price < 0 or (p_cost is not null and p_cost < 0) then raise exception 'bad_amount'; end if;
  spent := case when coalesce(p_cost, 0) > 0 and st > 0 then st * p_cost else 0 end;   -- stock × precio de compra
  if spent > 0 and public.month_closed(pid, public.month_start_ba()) then raise exception 'month_closed'; end if;
  insert into public.products (provider_id, name, price, cost, stock, min_stock)
  values (pid, left(nm, 80), p_price, p_cost, st, coalesce(p_min, 0))
  returning id into prid;
  if spent > 0 then
    insert into public.expenses (provider_id, concept, amount, category, spent_on, product_id, qty)
    values (pid, left('Stock inicial: ' || left(nm, 80) || ' × ' || st, 80), spent, 'Productos', today, prid, st)
    returning id into eid;
  end if;
  return jsonb_build_object('id', prid, 'expense_id', eid, 'spent_on', today);
end $$;

-- ---------- «Ajustar stock» (aprobado por el dueño, 10/11): lo que sale sin venderse ----------
-- Solo resta: un producto roto, vencido o usado en el local. No es venta (no va a la caja) ni gasto (no va a los gastos
-- del mes): queda anotado acá, con su motivo. La app lo lee; lo escribe solo product_adjust.
create table if not exists public.stock_adjustments (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  product_id  bigint references public.products(id) on delete set null,
  at          timestamptz not null default now(),
  qty         integer not null check (qty > 0),
  reason      text not null check (reason in ('broken', 'expired', 'in_use'))
);
create index if not exists stock_adjustments_product on public.stock_adjustments (product_id, at desc);
create index if not exists stock_adjustments_provider on public.stock_adjustments (provider_id, at desc);
alter table public.stock_adjustments enable row level security;
revoke all on public.stock_adjustments from public, anon, authenticated;
grant select on public.stock_adjustments to authenticated;   -- escribir, solo product_adjust
grant all on public.stock_adjustments to service_role;
drop policy if exists stock_adjustments_owner on public.stock_adjustments;
create policy stock_adjustments_owner on public.stock_adjustments for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin()));

-- resta p_qty del stock (sin pasar de lo que hay) y lo anota con su motivo. Devuelve el stock nuevo y el ajuste.
create or replace function public.product_adjust(p_product bigint, p_qty int, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); st int; aid bigint; at_ timestamptz;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_reason is null or p_reason not in ('broken', 'expired', 'in_use') then raise exception 'bad_reason'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'bad_qty'; end if;
  perform 1 from public.products p where p.id = p_product and p.provider_id = pid for update;
  if not found then raise exception 'product_not_found'; end if;
  update public.products set stock = stock - p_qty where id = p_product and stock >= p_qty returning stock into st;
  if not found then raise exception 'no_stock'; end if;
  insert into public.stock_adjustments (provider_id, product_id, qty, reason) values (pid, p_product, p_qty, p_reason)
  returning id, at into aid, at_;
  return jsonb_build_object('stock', st, 'id', aid, 'at', at_);
end $$;

-- al dar de baja un negocio (status 'deleted': las funciones de baja borran sus ventas, gastos y productos), sus ajustes
-- también se borran. Borrar un solo producto no: sus ajustes quedan, sin producto, como sus ventas y compras.
create or replace function public.stock_adjustments_purge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.stock_adjustments where provider_id = new.id;
  return null;
end $$;
drop trigger if exists stock_adjustments_purge on public.providers;
create trigger stock_adjustments_purge after update of status on public.providers
  for each row when (new.status = 'deleted' and old.status is distinct from 'deleted')
  execute function public.stock_adjustments_purge();
revoke execute on function public.stock_adjustments_purge() from public, anon, authenticated;

revoke execute on function public.products_stock_guard(), public.walkins_stock() from public, anon, authenticated;
revoke execute on function public.product_buy(bigint, int, int), public.product_add(text, int, int, int, int),
  public.product_adjust(bigint, int, text) from public, anon;
grant execute on function public.product_buy(bigint, int, int), public.product_add(text, int, int, int, int),
  public.product_adjust(bigint, int, text) to authenticated;

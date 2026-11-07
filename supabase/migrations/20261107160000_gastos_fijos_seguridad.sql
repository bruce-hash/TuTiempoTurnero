-- =====================================================================
-- TuTiempo · 8/11 · punto 7 · gastos fijos (auditoría S16 y S17)
--   - S16: un prestador cargaba gastos con el fixed_id de un gasto fijo de otro (la tabla expenses tenía insert/update
--     en todas sus columnas para la app y la FK no miraba de quién es el gasto fijo). Le ocupaba los meses al otro
--     (que dejaban de cargarse en sus Finanzas) y leía el monto cuando el otro lo editaba. Ahora:
--       · la app escribe expenses solo en sus columnas propias: fixed_id y fixed_month, solo las funciones de abajo;
--       · FK compuesta (fixed_id, provider_id) → fixed_expenses (id, provider_id): un gasto solo puede venir de un gasto
--         fijo del mismo prestador, también desde las funciones;
--       · las filas que ya apuntaban a un gasto fijo de otro dejan de estar ligadas (quedan como gasto suelto de quien
--         las cargó; no se borra nada) y el dueño recupera esos meses en la próxima sincronización;
--       · fixed_expense_save y fixed_expense_stop tocan solo las filas del mismo prestador.
--   - S17 (regla de Bruno, 8/11): los gastos fijos se editan desde el mes actual en adelante; los meses cerrados nunca
--     se tocan. fixed_expense_save y fixed_expense_stop aceptan solo el mes actual (Buenos Aires): un mes pasado o
--     futuro es bad_month. Así un gasto fijo nunca empieza antes del mes en que se crea (ya no hay "desde 1900").
-- Idempotente y sin borrar datos.
-- =====================================================================

-- ---------- S16 · columnas que escribe la app ----------
revoke insert, update on public.expenses from authenticated;
grant insert (provider_id, concept, amount, category, spent_on, product_id, qty) on public.expenses to authenticated;
grant update (concept, amount, category, spent_on, product_id, qty) on public.expenses to authenticated;

-- ---------- S16 · un gasto viene solo de un gasto fijo del mismo prestador ----------
-- las filas ya cargadas con el gasto fijo de otro prestador: dejan de estar ligadas (antes de la FK compuesta)
update public.expenses e set fixed_id = null, fixed_month = null
 where e.fixed_id is not null
   and not exists (select 1 from public.fixed_expenses f where f.id = e.fixed_id and f.provider_id = e.provider_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fixed_expenses_id_provider'
                  and conrelid = 'public.fixed_expenses'::regclass) then
    alter table public.fixed_expenses add constraint fixed_expenses_id_provider unique (id, provider_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_fixed_same_provider'
                  and conrelid = 'public.expenses'::regclass) then
    -- si el gasto fijo se borra, el gasto queda suelto (solo fixed_id a null: provider_id no se toca)
    alter table public.expenses add constraint expenses_fixed_same_provider
      foreign key (fixed_id, provider_id) references public.fixed_expenses (id, provider_id) on delete set null (fixed_id);
  end if;
end $$;

-- ---------- S16 + S17 · fixed_expense_save ----------
-- crea un gasto fijo (p_id null) o lo cambia desde el mes actual en adelante: el monto, el nombre y el rubro de este
-- mes y los siguientes que no estén cerrados. Un mes pasado o futuro no (bad_month) y un mes cerrado nunca.
create or replace function public.fixed_expense_save(p_id bigint, p_concept text, p_category text, p_amount int, p_from date)
returns bigint language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); fid bigint; mfrom date := date_trunc('month', p_from)::date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'bad_amount'; end if;
  if p_concept is null or char_length(btrim(p_concept)) not between 1 and 80 then raise exception 'bad_concept'; end if;
  if p_category is null or p_category not in ('Alquiler','Insumos','Servicios','Otros') then raise exception 'bad_category'; end if;
  -- S17: solo desde el mes actual
  if mfrom is distinct from public.month_start_ba() then raise exception 'bad_month'; end if;
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
    -- los meses desde mfrom que no están cerrados: el monto nuevo (o afuera si queda en 0); solo los de este prestador
    delete from public.expenses e where e.fixed_id = fid and e.provider_id = pid and e.fixed_month >= mfrom and p_amount = 0
       and not public.month_closed(pid, e.fixed_month);
    update public.expenses e set amount = p_amount, concept = btrim(p_concept), category = p_category
     where e.fixed_id = fid and e.provider_id = pid and e.fixed_month >= mfrom and p_amount > 0
       and not public.month_closed(pid, e.fixed_month);
  end if;
  perform public.fixed_expenses_sync();
  return fid;
end $$;

-- ---------- S16 + S17 · fixed_expense_stop ----------
-- deja de repetirlo desde el mes actual (este mes y los siguientes que no estén cerrados salen de los gastos)
create or replace function public.fixed_expense_stop(p_id bigint, p_from date) returns void
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); f record; mfrom date := date_trunc('month', p_from)::date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  select * into f from public.fixed_expenses where id = p_id and provider_id = pid for update;
  if f.id is null then raise exception 'forbidden'; end if;
  if mfrom is distinct from public.month_start_ba() then raise exception 'bad_month'; end if;
  if public.month_closed(pid, mfrom) then raise exception 'month_closed'; end if;
  if mfrom <= f.since then
    update public.fixed_expenses set amount = 0, until_month = null where id = f.id;
  else
    update public.fixed_expenses set until_month = (mfrom - interval '1 month')::date where id = f.id;
  end if;
  delete from public.expenses e where e.fixed_id = f.id and e.provider_id = pid and e.fixed_month >= mfrom
     and not public.month_closed(pid, e.fixed_month);
end $$;

revoke execute on function public.fixed_expense_save(bigint, text, text, int, date), public.fixed_expense_stop(bigint, date)
  from public, anon;
grant execute on function public.fixed_expense_save(bigint, text, text, int, date), public.fixed_expense_stop(bigint, date)
  to authenticated;

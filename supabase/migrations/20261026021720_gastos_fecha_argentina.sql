-- =====================================================================
-- TuTiempo · Bloque 2b · Fecha por defecto de un gasto en el día de Buenos Aires
-- expenses.spent_on tomaba current_date, que en la sesión de Supabase es el día en UTC: un gasto cargado sin fecha
-- después de las 21 de Argentina quedaba en el día siguiente (y el último día del mes, en el mes siguiente). La app
-- siempre manda la fecha; esto cubre lo que se cargue sin ella. No cambia datos.
-- =====================================================================
alter table public.expenses alter column spent_on set default ((now() at time zone 'America/Argentina/Buenos_Aires')::date);

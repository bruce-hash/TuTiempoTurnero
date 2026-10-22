-- =====================================================================
-- TuTiempo · 0001 · Esquema
-- Turnos online multirrubro. Pensado para escalar: todo lo que se lista
-- tiene índice, la disponibilidad se calcula en el servidor y las reservas
-- no pueden superponerse (restricción EXCLUDE a nivel base de datos).
-- Ejecutar en orden: 0001, 0002, 0003, 0004 (y 0005 storage).
-- =====================================================================
set search_path = public, extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists unaccent  with schema extensions;

-- ---------- Catálogos ----------
create table if not exists public.cities (
  id        smallint generated always as identity primary key,
  slug      text not null unique,
  name      text not null,
  tz        text not null default 'America/Argentina/Buenos_Aires'
);

create table if not exists public.categories (
  id        text primary key check (id ~ '^[a-z]{1,12}$'),   -- b, p, m, l, u, d …
  slug      text not null unique,
  name      text not null,
  sort      smallint not null default 0,
  active    boolean not null default true
);

-- ---------- Personas ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text check (char_length(full_name) <= 120),
  phone      text check (char_length(phone) <= 40),
  created_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ---------- Prestadores ----------
create table if not exists public.providers (
  id            bigint generated always as identity primary key,
  owner_id      uuid unique references auth.users(id) on delete set null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name          text not null check (char_length(name) between 2 and 80),
  bio           text check (char_length(bio) <= 600),
  address       text check (char_length(address) <= 160),
  city_id       smallint not null references public.cities(id),
  lat           double precision,
  lng           double precision,
  instagram     text check (char_length(instagram) <= 60),
  hue           smallint not null default 220 check (hue between 0 and 359),
  status        text not null default 'pending' check (status in ('pending','active','suspended','deleted')),
  dni_verified  boolean not null default false,
  rating_avg    numeric(3,2) not null default 0,
  rating_count  integer not null default 0,
  followers     integer not null default 0,
  shuffle_key   double precision not null default random(),   -- orden rotativo justo, se re-sortea cada noche
  search        tsvector,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists providers_search_idx on public.providers using gin (search);
create index if not exists providers_name_trgm  on public.providers using gin (name gin_trgm_ops);
create index if not exists providers_name_knn   on public.providers using gist (name gist_trgm_ops);
create index if not exists providers_city_status on public.providers (city_id, status);

-- Datos privados del prestador: nunca se exponen al público.
create table if not exists public.provider_private (
  provider_id   bigint primary key references public.providers(id) on delete cascade,
  phone         text check (char_length(phone) <= 40),
  dni_number    text check (dni_number ~ '^[0-9]{7,8}$'),
  dni_paths     text[] not null default '{}',
  mp_user_id    text,
  mp_connected  boolean not null default false,
  monthly_goal  integer not null default 0 check (monthly_goal between 0 and 1000000000)
);
-- Tokens de Mercado Pago: solo los lee service_role (Edge Functions).
create table if not exists public.provider_secrets (
  provider_id      bigint primary key references public.providers(id) on delete cascade,
  mp_access_token  text,
  mp_refresh_token text,
  mp_expires_at    timestamptz
);

-- Rubros de cada prestador (una misma persona puede estar en varios).
-- city_id, active y shuffle_key se copian aquí (trigger) para listar por rubro con un índice.
create table if not exists public.provider_categories (
  provider_id  bigint not null references public.providers(id) on delete cascade,
  category_id  text   not null references public.categories(id),
  is_primary   boolean not null default false,
  city_id      smallint not null,
  active       boolean not null default false,
  shuffle_key  double precision not null default 0,
  primary key (provider_id, category_id)
);
create index if not exists pc_listing on public.provider_categories (category_id, city_id, shuffle_key, provider_id) where active;
create index if not exists pc_listing_all on public.provider_categories (city_id, shuffle_key, provider_id) where active and is_primary;

create table if not exists public.services (
  id           bigint generated always as identity primary key,
  provider_id  bigint not null references public.providers(id) on delete cascade,
  category_id  text not null references public.categories(id),
  name         text not null check (char_length(name) between 2 and 80),
  duration_min smallint not null check (duration_min between 5 and 480),
  price        integer not null check (price between 0 and 100000000),
  active       boolean not null default true,
  sort         smallint not null default 0,
  repeat_days  smallint not null default 0 check (repeat_days between 0 and 365),   -- retoque recomendado
  prep_note    text check (char_length(prep_note) <= 300)                          -- indicaciones antes del turno
);
-- Adicionales de cada servicio (retiro de esmaltado, zonas extra, aromaterapia…): suman precio y minutos.
create table if not exists public.service_addons (
  id           bigint generated always as identity primary key,
  service_id   bigint not null references public.services(id) on delete cascade,
  provider_id  bigint not null references public.providers(id) on delete cascade,
  name         text not null check (char_length(name) between 2 and 60),
  price        integer not null default 0 check (price between 0 and 10000000),
  duration_min smallint not null default 0 check (duration_min between 0 and 240),
  active       boolean not null default true,
  sort         smallint not null default 0
);
create index if not exists addons_service on public.service_addons (service_id) where active;
create index if not exists services_provider on public.services (provider_id) where active;
create index if not exists services_min_price on public.services (provider_id, price) where active;

-- ---------- Agenda ----------
create table if not exists public.provider_settings (
  provider_id     bigint primary key references public.providers(id) on delete cascade,
  online          boolean not null default false,
  step_min        smallint not null default 30 check (step_min in (10,15,20,30,45,60)),
  ahead_days      smallint not null default 31 check (ahead_days between 1 and 90),
  notice_min      smallint not null default 60 check (notice_min between 0 and 2880),
  pay_mode        text not null default 'deposit' check (pay_mode in ('deposit','full')),
  deposit_pct     smallint not null default 50 check (deposit_pct between 10 and 100),
  strict_no_show  boolean not null default true,
  happy_on        boolean not null default false,
  happy_pct       smallint not null default 10 check (happy_pct between 1 and 90),
  happy_days      smallint[] not null default '{1,2,3,4}',
  happy_from      time not null default '09:00',
  happy_to        time not null default '12:00',
  buffer_min      smallint not null default 0 check (buffer_min between 0 and 60)   -- descanso entre turnos (preparar camilla, limpiar)
);

-- Doble jornada: shift 1 = mañana, 2 = tarde. dow 0 = domingo.
create table if not exists public.provider_hours (
  provider_id  bigint not null references public.providers(id) on delete cascade,
  dow          smallint not null check (dow between 0 and 6),
  shift        smallint not null check (shift in (1,2)),
  opens        time not null,
  closes       time not null,
  primary key (provider_id, dow, shift),
  check (closes > opens)
);

create table if not exists public.bookings (
  id                bigint generated always as identity primary key,
  provider_id       bigint not null references public.providers(id) on delete cascade,
  service_id        bigint references public.services(id) on delete set null,
  client_id         uuid references auth.users(id) on delete set null,
  client_name       text check (char_length(client_name) <= 80),
  client_phone      text check (char_length(client_phone) <= 40),
  service_name      text check (char_length(service_name) <= 80),
  source            text not null check (source in ('app','manual','block')),
  status            text not null check (status in ('hold','confirmed','done','no_show','cancelled_client','cancelled_provider','expired')),
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  buffer_min        smallint not null default 0 check (buffer_min between 0 and 60),
  busy_until        timestamptz not null,   -- fin + descanso del prestador (lo completa un trigger)
  -- el rango ocupado incluye el descanso del prestador después del turno
  during            tstzrange generated always as (tstzrange(starts_at, busy_until, '[)')) stored,
  addons            jsonb not null default '[]' check (jsonb_typeof(addons) = 'array' and jsonb_array_length(addons) <= 10),
  intake            jsonb not null default '{}' check (jsonb_typeof(intake) = 'object' and octet_length(intake::text) <= 2000),
  price             integer not null default 0 check (price >= 0),
  discount_pct      smallint not null default 0,
  deposit           integer not null default 0 check (deposit >= 0),
  paid_mp           integer not null default 0 check (paid_mp >= 0),
  paid_wallet       integer not null default 0 check (paid_wallet >= 0),
  cashback          integer not null default 0 check (cashback >= 0),
  refund_pending    integer not null default 0 check (refund_pending >= 0),
  series_id         uuid,
  hold_expires_at   timestamptz,
  mp_preference_id  text,
  mp_payment_id     text unique,
  attendance_ok     boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Ningún turno puede pisarse con otro del mismo prestador (incluye bloqueos y reservas en pago).
  constraint bookings_no_overlap exclude using gist (provider_id with =, during with &&)
    where (status in ('hold','confirmed','done'))
);
create index if not exists bookings_provider_time on public.bookings (provider_id, starts_at);
create index if not exists bookings_client on public.bookings (client_id, starts_at desc) where client_id is not null;
create index if not exists bookings_holds on public.bookings (hold_expires_at) where status = 'hold';
create index if not exists bookings_series on public.bookings (series_id) where series_id is not null;

create table if not exists public.waitlist (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider_id bigint not null references public.providers(id) on delete cascade,
  day         date not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, provider_id, day)
);
create index if not exists waitlist_provider_day on public.waitlist (provider_id, day);

-- ---------- Panel del prestador ----------
create table if not exists public.provider_clients (
  id           bigint generated always as identity primary key,
  provider_id  bigint not null references public.providers(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  name         text not null check (char_length(name) between 1 and 80),
  phone        text check (char_length(phone) <= 40),
  notes        text check (char_length(notes) <= 1000),
  birthday     text check (birthday ~ '^[0-1][0-9]-[0-3][0-9]$'),
  visits       integer not null default 0,
  no_shows     integer not null default 0,
  total_spent  integer not null default 0,
  last_visit   date,
  contacted_at timestamptz,
  profile      jsonb not null default '{}' check (jsonb_typeof(profile) = 'object' and octet_length(profile::text) <= 4000),   -- ficha por rubro
  created_at   timestamptz not null default now()
);
create unique index if not exists provider_clients_name on public.provider_clients (provider_id, lower(name));
create unique index if not exists provider_clients_user on public.provider_clients (provider_id, user_id) where user_id is not null;

create table if not exists public.products (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  price       integer not null check (price >= 0),
  stock       integer not null default 0 check (stock >= 0),
  min_stock   integer not null default 0 check (min_stock >= 0)
);
create unique index if not exists products_name on public.products (provider_id, lower(name));

create table if not exists public.walkins (
  id           bigint generated always as identity primary key,
  provider_id  bigint not null references public.providers(id) on delete cascade,
  at           timestamptz not null default now(),
  kind         text not null check (kind in ('service','product')),
  description  text not null check (char_length(description) between 1 and 80),
  amount       integer not null check (amount >= 0),
  tip          integer not null default 0 check (tip >= 0),
  method       text not null check (method in ('cash','mp')),
  client_name  text check (char_length(client_name) <= 80),
  product_id   bigint references public.products(id) on delete set null
);
create index if not exists walkins_provider_at on public.walkins (provider_id, at);

create table if not exists public.expenses (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  concept     text not null check (char_length(concept) between 1 and 80),
  amount      integer not null check (amount > 0),
  category    text not null check (category in ('Alquiler','Productos','Insumos','Servicios','Otros')),
  spent_on    date not null default current_date,
  product_id  bigint references public.products(id) on delete set null,
  qty         integer check (qty > 0)
);
create index if not exists expenses_provider_date on public.expenses (provider_id, spent_on);

create table if not exists public.message_templates (
  provider_id bigint not null references public.providers(id) on delete cascade,
  key         text not null check (key in ('conf','r24','r2','rev','back','bday')),
  enabled     boolean not null default true,
  body        text not null check (char_length(body) between 1 and 600),
  primary key (provider_id, key)
);

-- ---------- Comunidad ----------
create table if not exists public.follows (
  user_id     uuid not null references auth.users(id) on delete cascade,
  provider_id bigint not null references public.providers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, provider_id)
);
create index if not exists follows_provider on public.follows (provider_id);

create table if not exists public.reviews (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  booking_id  bigint unique references public.bookings(id) on delete set null,
  client_id   uuid references auth.users(id) on delete set null,
  author      text not null check (char_length(author) <= 40),
  stars       smallint not null check (stars between 1 and 5),
  body        text check (char_length(body) <= 600),
  reply       text check (char_length(reply) <= 600),
  created_at  timestamptz not null default now()
);
create index if not exists reviews_provider on public.reviews (provider_id, created_at desc);

create table if not exists public.media (
  id           bigint generated always as identity primary key,
  provider_id  bigint not null references public.providers(id) on delete cascade,
  storage_path text not null,
  kind         text not null check (kind in ('image','video')),
  label        text check (char_length(label) <= 80),
  created_at   timestamptz not null default now()
);
create index if not exists media_provider on public.media (provider_id, created_at desc);

create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 400),
  created_at  timestamptz not null default now()
);
create index if not exists posts_provider on public.posts (provider_id, created_at desc);

-- ---------- Saldo TuTiempo (cashback) ----------
create table if not exists public.wallets (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  balance  integer not null default 0 check (balance >= 0)   -- nunca negativo
);
create table if not exists public.wallet_movements (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('cashback','spend','refund','reversal','adjust')),
  amount      integer not null,           -- positivo suma, negativo resta
  booking_id  bigint references public.bookings(id) on delete set null,
  note        text check (char_length(note) <= 160),
  created_at  timestamptz not null default now()
);
create index if not exists wallet_mov_user on public.wallet_movements (user_id, created_at desc);

-- ---------- Versión 25: efectivo, fotos y mensajes ----------
-- Pagos: solo Mercado Pago (seña o total por la app) o efectivo en el local. No hay saldo ni cashback.
alter table public.provider_settings add column if not exists cash_ok boolean not null default true;  -- acepta "pago en efectivo en el local"
alter table public.bookings add column if not exists pay_method text not null default 'mp' check (pay_method in ('mp','cash'));
-- Fotos de perfil (bucket público "avatars", carpeta = id del usuario dueño)
alter table public.profiles  add column if not exists avatar_path text check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
alter table public.providers add column if not exists photo_path  text check (photo_path  ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
-- Mensajes del prestador a sus clientes (los ven en la app, en Mis turnos)
create table if not exists public.client_messages (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 600),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists client_messages_user on public.client_messages (user_id, created_at desc);
create index if not exists client_messages_provider_day on public.client_messages (provider_id, created_at);

-- ---------- Versión 26: tarjeta de sellos (por prestador y por cliente) ----------
-- Cada servicio atendido suma 1 sello. Con stamps_goal sellos (15 a 20, lo elige el prestador) el cliente
-- canjea gratis el servicio stamps_reward. Los sellos no se pasan de un prestador a otro.
alter table public.provider_settings add column if not exists stamps_on boolean not null default false;
alter table public.provider_settings add column if not exists stamps_goal smallint not null default 15 check (stamps_goal between 15 and 20);
alter table public.provider_settings add column if not exists stamps_reward bigint references public.services(id) on delete set null;
alter table public.bookings drop constraint if exists bookings_pay_method_check;
alter table public.bookings add constraint bookings_pay_method_check check (pay_method in ('mp','cash','reward'));
create table if not exists public.loyalty_cards (
  provider_id bigint not null references public.providers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  stamps      integer not null default 0 check (stamps >= 0),
  earned      integer not null default 0,
  redeemed    integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (provider_id, user_id)
);
create index if not exists loyalty_cards_user on public.loyalty_cards (user_id);
create table if not exists public.loyalty_events (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('earn','manual','redeem','refund')),
  delta       integer not null,
  booking_id  bigint references public.bookings(id) on delete set null,
  created_at  timestamptz not null default now()
);
-- un turno suma, canjea o devuelve sellos UNA sola vez
create unique index if not exists loyalty_events_once on public.loyalty_events (booking_id, kind) where booking_id is not null;
create index if not exists loyalty_events_manual on public.loyalty_events (provider_id, user_id, created_at) where kind = 'manual';

-- ---------- Versión 27 ----------
-- Comisión de TuTiempo configurable desde el panel de administración (una sola fila).
create table if not exists public.app_settings (
  id             boolean primary key default true check (id),
  commission_pct numeric(4,2) not null default 10 check (commission_pct between 0 and 30),
  updated_at     timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;
-- Tarjeta de sellos: qué servicios suman sello (null = todos)
alter table public.provider_settings add column if not exists stamps_services bigint[] check (stamps_services is null or cardinality(stamps_services) <= 100);

-- ---------- Versión 28 ----------
-- Turnero de 31 días exactos (hoy + 30), igual para todos.
alter table public.provider_settings alter column ahead_days set default 31;
update public.provider_settings set ahead_days = 31 where ahead_days <> 31;
-- Orden del listado: primero los más activos (servicios hechos por la app en los últimos 30 días).
-- rank_key = shuffle_key - activity: a más actividad, antes aparece; entre iguales, el orden rotativo diario.
alter table public.providers add column if not exists activity integer not null default 0 check (activity >= 0);
alter table public.provider_categories add column if not exists rank_key double precision not null default 0;
drop index if exists public.pc_listing;
drop index if exists public.pc_listing_all;
create index if not exists pc_rank on public.provider_categories (category_id, city_id, rank_key, provider_id) where active;
create index if not exists pc_rank_all on public.provider_categories (city_id, rank_key, provider_id) where active and is_primary;
create index if not exists bookings_done_recent on public.bookings (provider_id, starts_at) where status = 'done' and source = 'app';
-- Comisión de TuTiempo cobrada en cada turno (la usa el panel de administración)
alter table public.bookings add column if not exists app_fee integer not null default 0 check (app_fee >= 0);

-- Tarjetas de sellos POR SERVICIO: services.stamp_goal = sellos para que ESE servicio salga gratis (null = sin tarjeta).
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'services' and column_name = 'stamp_goal') then
    alter table public.services add column stamp_goal smallint check (stamp_goal is null or stamp_goal between 15 and 20);
    -- una sola vez: la configuración anterior (una tarjeta por prestador) pasa a cada servicio que sumaba sello
    update public.services s set stamp_goal = st.stamps_goal from public.provider_settings st
     where st.provider_id = s.provider_id and st.stamps_on and (st.stamps_services is null or s.id = any(st.stamps_services));
  end if;
end $$;
alter table public.loyalty_cards  add column if not exists service_id bigint references public.services(id) on delete cascade;
alter table public.loyalty_events add column if not exists service_id bigint references public.services(id) on delete set null;
do $$ begin
  -- tarjetas anteriores: pasan al servicio que era el premio (si no había premio, no se pueden asignar y se descartan)
  update public.loyalty_cards lc set service_id = st.stamps_reward from public.provider_settings st
   where lc.service_id is null and st.provider_id = lc.provider_id and st.stamps_reward is not null;
  delete from public.loyalty_cards where service_id is null;
  if (select count(*) from information_schema.key_column_usage
      where table_schema = 'public' and table_name = 'loyalty_cards' and constraint_name = 'loyalty_cards_pkey') = 2 then
    alter table public.loyalty_cards drop constraint loyalty_cards_pkey;
    alter table public.loyalty_cards alter column service_id set not null;
    alter table public.loyalty_cards add constraint loyalty_cards_pkey primary key (provider_id, user_id, service_id);
  end if;
end $$;
create index if not exists loyalty_events_manual_svc on public.loyalty_events (provider_id, user_id, service_id, created_at) where kind = 'manual';

-- Avisos automáticos dentro de la app (reemplazan a WhatsApp: sin costo por mensaje).
alter table public.client_messages add column if not exists kind text not null default 'msg' check (kind in ('msg','conf','r24','r2','rev','bday'));
alter table public.client_messages add column if not exists ref text check (char_length(ref) <= 40);
create unique index if not exists client_messages_once on public.client_messages (provider_id, user_id, kind, ref) where kind <> 'msg';

-- ---------- Versión 29 ----------
-- Cierre de caja del prestador: por día (lo que entró, efectivo, Mercado Pago y lo que contó) y por mes (ingresos, gastos).
create table if not exists public.cash_closings (
  provider_id bigint not null references public.providers(id) on delete cascade,
  kind        text not null check (kind in ('day','month')),
  period      date not null,                       -- el día, o el 1° del mes
  income      integer not null default 0 check (income between 0 and 2000000000),
  expenses    integer not null default 0 check (expenses between 0 and 2000000000),
  cash        integer not null default 0 check (cash between 0 and 2000000000),
  mp          integer not null default 0 check (mp between 0 and 2000000000),
  counted     integer check (counted between 0 and 2000000000),
  closed_at   timestamptz not null default now(),
  primary key (provider_id, kind, period),
  check (kind = 'day' or extract(day from period) = 1)
);
-- Aviso al cliente cuando el profesional le cancela el turno (con opción de reprogramar en la app)
alter table public.client_messages drop constraint if exists client_messages_kind_check;
alter table public.client_messages add constraint client_messages_kind_check check (kind in ('msg','conf','r24','r2','rev','bday','cancel'));
-- El que falta pierde su seña y listo: ya no se le cobra el total en las próximas reservas.
alter table public.provider_settings alter column strict_no_show set default false;
update public.provider_settings set strict_no_show = false where strict_no_show;

-- ---------- Versión 30 ----------
-- La comisión de TuTiempo la paga el CLIENTE aparte, junto con la seña: el prestador recibe su seña completa.
-- client_fee = comisión que se le cobra al cliente encima de la seña (0 en turnos viejos, donde la comisión salía de la seña).
alter table public.bookings add column if not exists client_fee integer not null default 0 check (client_fee >= 0);
-- Notas privadas del administrador sobre cada prestador (solo las ven los admins, por función del servidor)
create table if not exists public.admin_notes (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  author      uuid references auth.users(id) on delete set null,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists admin_notes_provider on public.admin_notes (provider_id, created_at desc);
-- Gastos de TuTiempo (para el balance: comisiones − gastos = resultado)
create table if not exists public.admin_expenses (
  id         bigint generated always as identity primary key,
  day        date not null,
  concept    text not null check (char_length(concept) between 1 and 80),
  amount     integer not null check (amount between 1 and 2000000000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists admin_expenses_day on public.admin_expenses (day);
-- Cierres del balance de TuTiempo: mes a mes y año a año (foto de los números al cerrar)
create table if not exists public.admin_closings (
  kind        text not null check (kind in ('month','year')),
  period      date not null,                      -- 1° del mes, o 1° de enero
  bookings    integer not null default 0,
  charged     bigint not null default 0,          -- cobrado a los clientes por Mercado Pago (señas + comisión)
  deposits    bigint not null default 0,          -- señas que van a los prestadores
  commission  bigint not null default 0,          -- ingreso de TuTiempo
  expenses    bigint not null default 0,          -- gastos de TuTiempo
  closed_at   timestamptz not null default now(),
  closed_by   uuid references auth.users(id) on delete set null,
  primary key (kind, period),
  check (extract(day from period) = 1 and (kind = 'month' or extract(month from period) = 1))
);

-- ---------- Versión 31 ----------
-- Turnos cancelados por bloquear días: TuTiempo NO devuelve la seña; el prestador llama al cliente y se la devuelve o le da otro turno.
alter table public.bookings add column if not exists settle_by_provider boolean not null default false;

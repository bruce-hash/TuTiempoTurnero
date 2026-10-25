-- TuTiempo · esquema completo en un solo archivo (pegar en Supabase → SQL Editor → Run)

-- ===================== 20261001000001_schema.sql =====================
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

-- ===================== 20261001000002_triggers.sql =====================
-- =====================================================================
-- TuTiempo · 0002 · Funciones auxiliares y triggers
-- =====================================================================
set search_path = public, extensions;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid())
$$;

-- Id del prestador del usuario logueado (o null).
create or replace function public.my_provider() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.providers where owner_id = auth.uid() and status <> 'deleted' limit 1
$$;

create or replace function public.owns_provider(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select pid is not null and (pid = public.my_provider() or public.is_admin())
$$;

-- Al crearse un usuario de Auth: perfil + billetera en cero.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- nombre y celular vienen del formulario "Crear cuenta" (o de Google); se limpian y recortan acá
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          left(coalesce(nullif(btrim(regexp_replace(new.raw_user_meta_data->>'full_name', '[<>]', '', 'g')), ''),
                        new.raw_user_meta_data->>'name', split_part(new.email,'@',1)), 120),
          nullif(btrim(left(regexp_replace(coalesce(new.raw_user_meta_data->>'phone',''), '[^0-9+ ()-]', '', 'g'), 40)), ''))
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Búsqueda: nombre, dirección, bio y nombres de servicios, sin acentos.
create or replace function public.refresh_provider_search(pid bigint) returns void
language sql security definer set search_path = public, extensions as $$
  update public.providers p set search =
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.name,''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce((select string_agg(s.name,' ') from public.services s where s.provider_id = p.id and s.active),''))), 'B') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(p.address,'') || ' ' || coalesce(p.bio,''))), 'C')
  where p.id = pid
$$;

create or replace function public.providers_biu() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.search :=
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.name,''))), 'A') ||
    setweight(to_tsvector('simple', extensions.unaccent(coalesce(new.address,'') || ' ' || coalesce(new.bio,''))), 'C');
  return new;
end $$;
drop trigger if exists providers_biu on public.providers;
create trigger providers_biu before insert or update of name, bio, address on public.providers
  for each row execute function public.providers_biu();

create or replace function public.providers_sync_categories() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.provider_categories
     set active = (new.status = 'active'), city_id = new.city_id, shuffle_key = new.shuffle_key, rank_key = new.shuffle_key - new.activity
   where provider_id = new.id;
  if tg_op = 'UPDATE' and (new.name is distinct from old.name or new.bio is distinct from old.bio or new.address is distinct from old.address) then
    perform public.refresh_provider_search(new.id);
  end if;
  return null;
end $$;
drop trigger if exists providers_sync on public.providers;
create trigger providers_sync after update of status, city_id, shuffle_key, activity, name, bio, address on public.providers
  for each row execute function public.providers_sync_categories();

create or replace function public.pc_bi() returns trigger
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select city_id, status, shuffle_key, activity into p from public.providers where id = new.provider_id;
  new.city_id := p.city_id; new.active := (p.status = 'active'); new.shuffle_key := p.shuffle_key; new.rank_key := p.shuffle_key - p.activity;
  -- el primer rubro de cada prestador es el principal (para el listado "Todos" sin duplicados)
  if not exists (select 1 from public.provider_categories where provider_id = new.provider_id and is_primary) then
    new.is_primary := true;
  elsif new.is_primary then
    new.is_primary := false;
  end if;
  return new;
end $$;
drop trigger if exists pc_bi on public.provider_categories;
create trigger pc_bi before insert on public.provider_categories
  for each row execute function public.pc_bi();

create or replace function public.services_aiud() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  perform public.refresh_provider_search(pid);
  -- cada servicio pertenece a un rubro del prestador: se agrega el rubro si faltaba
  if tg_op <> 'DELETE' then
    insert into public.provider_categories (provider_id, category_id) values (new.provider_id, new.category_id)
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists services_aiud on public.services;
create trigger services_aiud after insert or update or delete on public.services
  for each row execute function public.services_aiud();

-- Billetera: el saldo es la suma de movimientos; la restricción balance >= 0 impide saldo negativo.
create or replace function public.wallet_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallets (user_id, balance) values (new.user_id, 0) on conflict do nothing;
  update public.wallets set balance = balance + new.amount where user_id = new.user_id;
  return null;
end $$;
drop trigger if exists wallet_apply on public.wallet_movements;
create trigger wallet_apply after insert on public.wallet_movements
  for each row execute function public.wallet_apply();

-- Puntaje y seguidores denormalizados (lectura rápida en listados).
create or replace function public.reviews_agg() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  update public.providers set
    rating_count = (select count(*) from public.reviews where provider_id = pid),
    rating_avg   = coalesce((select round(avg(stars)::numeric, 2) from public.reviews where provider_id = pid), 0)
  where id = pid;
  return null;
end $$;
drop trigger if exists reviews_agg on public.reviews;
create trigger reviews_agg after insert or delete or update of stars on public.reviews
  for each row execute function public.reviews_agg();

create or replace function public.follows_agg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then update public.providers set followers = followers + 1 where id = new.provider_id;
  else update public.providers set followers = greatest(followers - 1, 0) where id = old.provider_id; end if;
  return null;
end $$;
drop trigger if exists follows_agg on public.follows;
create trigger follows_agg after insert or delete on public.follows
  for each row execute function public.follows_agg();

-- Adicionales: el prestador se toma del servicio (no se puede colgar un adicional de un servicio ajeno).
create or replace function public.addons_biu() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select provider_id into new.provider_id from public.services where id = new.service_id;
  if new.provider_id is null then raise exception 'service_not_found'; end if;
  return new;
end $$;
drop trigger if exists addons_biu on public.service_addons;
create trigger addons_biu before insert or update of service_id on public.service_addons
  for each row execute function public.addons_biu();

-- Turnos agendados a mano: llevan el mismo descanso que configuró el prestador.
create or replace function public.bookings_bi() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'manual' then
      new.buffer_min := coalesce((select buffer_min from public.provider_settings where provider_id = new.provider_id), 0);
    elsif new.source = 'block' then
      new.buffer_min := 0;
    end if;
  end if;
  new.busy_until := new.ends_at + make_interval(mins => new.buffer_min);
  return new;
end $$;
drop trigger if exists bookings_bi on public.bookings;
create trigger bookings_bi before insert or update of starts_at, ends_at, buffer_min on public.bookings for each row execute function public.bookings_bi();

-- ---------- Versión 28: actividad (servicios hechos por la app en 30 días) ----------
-- Cada turno de la app que pasa a "Asistió" suma 1 al prestador (y resta si se corrige). Cada noche se recalcula exacto.
create or replace function public.bookings_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source <> 'app' or new.status is not distinct from old.status then return null; end if;
  if new.status = 'done' and new.starts_at >= now() - interval '30 days' then
    update public.providers set activity = activity + 1 where id = new.provider_id;
  elsif old.status = 'done' then
    update public.providers set activity = greatest(activity - 1, 0) where id = new.provider_id;
  end if;
  return null;
end $$;
drop trigger if exists bookings_activity on public.bookings;
create trigger bookings_activity after update of status on public.bookings for each row execute function public.bookings_activity();
-- completar rank_key en bases que ya tenían prestadores
update public.provider_categories pc set rank_key = p.shuffle_key - p.activity
  from public.providers p where p.id = pc.provider_id and pc.rank_key is distinct from p.shuffle_key - p.activity;

-- ===================== 20261001000003_security.sql =====================
-- =====================================================================
-- TuTiempo · 0003 · Seguridad: RLS en TODAS las tablas + permisos mínimos
-- Regla general: el navegador usa la clave pública (anon). Lo que no está
-- permitido acá, no se puede hacer aunque alguien manipule la app.
-- Las operaciones con dinero (reservar, cancelar, pagar) son funciones
-- del servidor (0004); los clientes no pueden insertar turnos directo.
-- =====================================================================
set search_path = public, extensions;

-- Arrancar de cero: nadie puede nada.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['cities','categories','profiles','app_admins','providers','provider_private','provider_secrets',
    'provider_categories','services','service_addons','provider_settings','provider_hours','bookings','waitlist','provider_clients','products',
    'walkins','expenses','message_templates','follows','reviews','media','posts','wallets','wallet_movements','client_messages','loyalty_cards','loyalty_events','app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Los helpers de las políticas sí se pueden ejecutar.
-- Patrón recomendado por Supabase: (select función()) se evalúa UNA vez por consulta, no por fila.
grant execute on function public.is_admin(), public.my_provider(), public.owns_provider(bigint) to anon, authenticated;

-- ---------- Lectura pública ----------
grant select on public.cities, public.categories to anon, authenticated;
drop policy if exists cities_read on public.cities;
create policy cities_read on public.cities for select using (true);
drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (active);

-- Prestadores: solo columnas públicas, solo activos (el dueño y admin ven el suyo en cualquier estado).
grant select (id, slug, name, bio, address, city_id, lat, lng, instagram, hue, status, dni_verified,
              rating_avg, rating_count, followers, created_at, photo_path) on public.providers to anon, authenticated;
drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers for select
  using (status = 'active' or owner_id = (select auth.uid()) or (select public.is_admin()));
-- Alta: queda 'pending' hasta que TuTiempo verifica el DNI.
grant insert (slug, name, bio, address, city_id, instagram, hue) on public.providers to authenticated;
drop policy if exists providers_insert on public.providers;
create policy providers_insert on public.providers for insert to authenticated
  with check (owner_id = auth.uid() and status = 'pending' and public.my_provider() is null);
-- Edición: el dueño cambia solo datos de vitrina (no estado, verificación ni puntajes).
grant update (name, bio, address, lat, lng, instagram, hue, photo_path) on public.providers to authenticated;
drop policy if exists providers_update on public.providers;
create policy providers_update on public.providers for update to authenticated
  using (owner_id = auth.uid() and status <> 'deleted') with check (owner_id = auth.uid());

-- owner_id se completa solo (el cliente no lo puede elegir).
create or replace function public.providers_set_owner() returns trigger language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() then new.owner_id := auth.uid(); new.status := 'pending'; new.dni_verified := false; end if;
  return new;
end $$;
drop trigger if exists providers_set_owner on public.providers;
create trigger providers_set_owner before insert on public.providers for each row execute function public.providers_set_owner();

-- El dueño lee sus datos privados y solo puede cambiar su teléfono y su meta. mp_connected, DNI y Mercado Pago los escriben el servidor.
grant select, update (phone, monthly_goal) on public.provider_private to authenticated;
drop policy if exists pp_read on public.provider_private;
create policy pp_read on public.provider_private for select to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pp_update on public.provider_private;
create policy pp_update on public.provider_private for update to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
-- provider_secrets: sin políticas = solo service_role (Edge Functions).

grant select on public.provider_categories to anon, authenticated;
grant insert, delete on public.provider_categories to authenticated;
drop policy if exists pc_read on public.provider_categories;
create policy pc_read on public.provider_categories for select using (active or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pc_write on public.provider_categories;
create policy pc_write on public.provider_categories for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists pc_delete on public.provider_categories;
create policy pc_delete on public.provider_categories for delete to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.services to anon, authenticated;
grant insert, update, delete on public.services to authenticated;
drop policy if exists services_read on public.services;
create policy services_read on public.services for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.status = 'active') or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists services_write on public.services;
create policy services_write on public.services for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.service_addons to anon, authenticated;
grant insert, update, delete on public.service_addons to authenticated;
drop policy if exists addons_read on public.service_addons;
create policy addons_read on public.service_addons for select
  using (exists (select 1 from public.providers p where p.id = provider_id and p.status = 'active') or (provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists addons_write on public.service_addons;
create policy addons_write on public.service_addons for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select on public.provider_settings, public.provider_hours to anon, authenticated;
grant insert, update, delete on public.provider_settings, public.provider_hours to authenticated;
drop policy if exists ps_read on public.provider_settings;
create policy ps_read on public.provider_settings for select using (true);
drop policy if exists ps_write on public.provider_settings;
create policy ps_write on public.provider_settings for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));
drop policy if exists ph_read on public.provider_hours;
create policy ph_read on public.provider_hours for select using (true);
drop policy if exists ph_write on public.provider_hours;
create policy ph_write on public.provider_hours for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

-- ---------- Personas ----------
grant select, update (full_name, phone, avatar_path) on public.profiles to authenticated;
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- app_admins: sin políticas (se gestiona desde el panel de Supabase).

grant select on public.wallets, public.wallet_movements to authenticated;
drop policy if exists wallets_self on public.wallets;
create policy wallets_self on public.wallets for select to authenticated using (user_id = auth.uid());
drop policy if exists wmov_self on public.wallet_movements;
create policy wmov_self on public.wallet_movements for select to authenticated using (user_id = auth.uid());

-- ---------- Turnos ----------
-- Cliente: ve los suyos. Prestador: ve los de su agenda. Nadie más.
grant select on public.bookings to authenticated;
drop policy if exists bookings_read on public.bookings;
create policy bookings_read on public.bookings for select to authenticated
  using (client_id = (select auth.uid()) or (provider_id = (select public.my_provider()) or (select public.is_admin())));
-- El prestador agenda a mano y bloquea horarios (sin dinero de por medio).
grant insert (provider_id, service_id, client_name, client_phone, service_name, source, status, starts_at, ends_at, price)
  on public.bookings to authenticated;
drop policy if exists bookings_manual on public.bookings;
create policy bookings_manual on public.bookings for insert to authenticated
  with check ((provider_id = (select public.my_provider()) or (select public.is_admin())) and source in ('manual','block') and status = 'confirmed'
              and paid_mp = 0 and paid_wallet = 0 and cashback = 0 and client_id is null);
-- Cambios de estado y dinero: solo por funciones (0004). Desbloquear un horario propio:
grant delete on public.bookings to authenticated;
drop policy if exists bookings_unblock on public.bookings;
create policy bookings_unblock on public.bookings for delete to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())) and source = 'block');

grant select, insert, delete on public.waitlist to authenticated;
drop policy if exists waitlist_self on public.waitlist;
create policy waitlist_self on public.waitlist for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and day between current_date - 1 and current_date + 120);

-- ---------- Panel del prestador (solo el dueño) ----------
do $$ declare t text; begin
  foreach t in array array['provider_clients','products','walkins','expenses','message_templates'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t||'_owner', t);
    execute format('create policy %I on public.%I for all to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())))', t||'_owner', t);
  end loop;
end $$;

-- ---------- Comunidad ----------
grant select on public.reviews, public.media, public.posts to anon, authenticated;
drop policy if exists reviews_read on public.reviews;
create policy reviews_read on public.reviews for select using (true);
-- Reseña: solo quien fue atendido por ese prestador, una por turno.
grant insert (provider_id, booking_id, author, stars, body) on public.reviews to authenticated;
drop policy if exists reviews_insert on public.reviews;
create policy reviews_insert on public.reviews for insert to authenticated
  with check (client_id = auth.uid() and exists (
    select 1 from public.bookings b where b.id = booking_id and b.client_id = auth.uid()
      and b.provider_id = reviews.provider_id and b.status = 'done'));
create or replace function public.reviews_set_client() returns trigger language plpgsql as $$
begin
  new.client_id := auth.uid();
  -- el nombre visible lo pone el sistema (nombre + inicial del apellido), no el usuario
  select coalesce(nullif(split_part(trim(full_name),' ',1),''),'Cliente') || coalesce(' ' || nullif(left(split_part(trim(full_name),' ',2),1),'') || '.','')
    into new.author from public.profiles where id = auth.uid();
  new.author := coalesce(new.author, 'Cliente');
  new.reply := null;
  return new;
end $$;
drop trigger if exists reviews_set_client on public.reviews;
create trigger reviews_set_client before insert on public.reviews for each row execute function public.reviews_set_client();
-- El prestador solo puede responder.
grant update (reply) on public.reviews to authenticated;
drop policy if exists reviews_reply on public.reviews;
create policy reviews_reply on public.reviews for update to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin()))) with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

drop policy if exists media_read on public.media;

create policy media_read on public.media for select using (true);
grant insert, delete on public.media to authenticated;
drop policy if exists media_write on public.media;
create policy media_write on public.media for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin()))
  and storage_path ~ ('^' || provider_id::text || '/[A-Za-z0-9._-]{1,120}$') and storage_path !~ '\.\.');
drop policy if exists media_delete on public.media;
create policy media_delete on public.media for delete to authenticated using ((provider_id = (select public.my_provider()) or (select public.is_admin())));

drop policy if exists posts_read on public.posts;

create policy posts_read on public.posts for select using (true);
grant insert on public.posts to authenticated;
drop policy if exists posts_write on public.posts;
create policy posts_write on public.posts for insert to authenticated with check ((provider_id = (select public.my_provider()) or (select public.is_admin())));

grant select, insert, delete on public.follows to authenticated;
drop policy if exists follows_self on public.follows;
create policy follows_self on public.follows for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Secuencias de identidad que usan los inserts permitidos.
grant usage on all sequences in schema public to authenticated;

-- ---------- Mensajes a clientes ----------
-- Se crean SOLO con la función send_client_messages (valida que sean clientes del prestador y limita la cantidad).
grant select on public.client_messages to authenticated;
drop policy if exists cm_read on public.client_messages;
create policy cm_read on public.client_messages for select to authenticated
  using (user_id = auth.uid() or provider_id = (select public.my_provider()));

-- ---------- Fotos: cada uno solo puede usar archivos de SU carpeta ----------
create or replace function public.avatar_owner_check() returns trigger language plpgsql as $$
begin
  if new.avatar_path is not null and split_part(new.avatar_path, '/', 1) <> new.id::text then raise exception 'bad_photo_path'; end if;
  return new;
end $$;
create or replace function public.photo_owner_check() returns trigger language plpgsql as $$
begin
  if new.photo_path is not null and split_part(new.photo_path, '/', 1) <> coalesce(new.owner_id::text, '-') then raise exception 'bad_photo_path'; end if;
  return new;
end $$;
drop trigger if exists profiles_photo_check on public.profiles;
create trigger profiles_photo_check before insert or update of avatar_path on public.profiles for each row execute function public.avatar_owner_check();
drop trigger if exists providers_photo_check on public.providers;
create trigger providers_photo_check before insert or update of photo_path on public.providers for each row execute function public.photo_owner_check();

-- ---------- Tarjeta de sellos: cada uno ve lo suyo; solo se modifica con funciones del servidor ----------
grant select on public.loyalty_cards, public.loyalty_events to authenticated;
drop policy if exists lc_read on public.loyalty_cards;
create policy lc_read on public.loyalty_cards for select to authenticated
  using (user_id = (select auth.uid()) or provider_id = (select public.my_provider()));
drop policy if exists le_read on public.loyalty_events;
create policy le_read on public.loyalty_events for select to authenticated
  using (user_id = (select auth.uid()) or provider_id = (select public.my_provider()));

-- ---------- Configuración general: todos leen la comisión; solo un admin la cambia (con admin_set_commission) ----------
grant select on public.app_settings to anon, authenticated;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);

-- ---------- Cierres de caja: solo el dueño ----------
alter table public.cash_closings enable row level security;
grant select, insert, update, delete on public.cash_closings to authenticated;
drop policy if exists cash_closings_owner on public.cash_closings;
create policy cash_closings_owner on public.cash_closings for all to authenticated
  using ((provider_id = (select public.my_provider()) or (select public.is_admin())))
  with check ((provider_id = (select public.my_provider()) or (select public.is_admin())) and period between current_date - 800 and current_date + 1);

-- ---------- Panel admin: notas, gastos y cierres. Sin acceso directo desde la app (solo funciones de admin) ----------
alter table public.admin_notes enable row level security;
alter table public.admin_expenses enable row level security;
alter table public.admin_closings enable row level security;
revoke all on public.admin_notes, public.admin_expenses, public.admin_closings from anon, authenticated;

-- ===================== 20261001000004_functions.sql =====================
-- =====================================================================
-- TuTiempo · 0004 · Funciones del servidor (RPC)
-- Todo lo que mueve dinero o valida horarios se hace acá, nunca en el navegador.
-- Los precios, señas, descuentos y cashback los calcula la base: el cliente
-- solo dice "servicio + horario".
-- =====================================================================
set search_path = public, extensions;

-- Comisión de TuTiempo (por defecto 10%), la cambia un admin desde el panel.
create or replace function public.commission() returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select commission_pct / 100 from public.app_settings where id), 0.10)::numeric
$$;
-- Sin cashback: TuTiempo no acumula dinero de los clientes (queda en 0 por compatibilidad).
create or replace function public.cashback_rate() returns numeric language sql immutable as $$ select 0::numeric $$;

create or replace function public.provider_tz(pid bigint) returns text
language sql stable security definer set search_path = public as $$
  select c.tz from public.providers p join public.cities c on c.id = p.city_id where p.id = pid
$$;

-- ¿El horario local cae dentro de una jornada y respeta el intervalo?
create or replace function public.slot_fits(pid bigint, local_start timestamp, dur int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.provider_hours h, public.provider_settings st
    where h.provider_id = pid and st.provider_id = pid
      and h.dow = extract(dow from local_start)::int
      and local_start::time >= h.opens
      and (local_start + make_interval(mins => dur))::time <= h.closes
      and (local_start + make_interval(mins => dur))::date = local_start::date
      and (extract(epoch from (local_start::time - h.opens))::int / 60) % st.step_min = 0)
$$;

create or replace function public.happy_disc(pid bigint, local_start timestamp) returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce((select st.happy_pct from public.provider_settings st
    where st.provider_id = pid and st.happy_on
      and extract(dow from local_start)::smallint = any(st.happy_days)
      and local_start::time >= st.happy_from and local_start::time < st.happy_to), 0)::smallint
$$;

-- Primer horario libre en la ventana de reserva (para las tarjetas del listado).
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; h record; t timestamp; now_l timestamp; dd int;
begin
  select * into st from public.provider_settings where provider_id = pid;
  if st is null or not st.online then return null; end if;
  dd := coalesce(dur, (select min(duration_min) from public.services where provider_id = pid and active));
  if dd is null then return null; end if;
  now_l := (now() at time zone tz) + make_interval(mins => st.notice_min);
  for d in 0 .. st.ahead_days - 1 loop
    for h in select opens, closes from public.provider_hours
             where provider_id = pid and dow = extract(dow from (now() at time zone tz)::date + d)::int order by opens loop
      t := ((now() at time zone tz)::date + d) + h.opens;
      while t + make_interval(mins => dd) <= ((now() at time zone tz)::date + d) + h.closes loop
        if t >= now_l and not exists (select 1 from public.bookings b where b.provider_id = pid
             and b.status in ('hold','confirmed','done')
             and b.during && tstzrange(t at time zone tz, (t + make_interval(mins => dd + st.buffer_min)) at time zone tz, '[)')) then
          return t at time zone tz;
        end if;
        t := t + make_interval(mins => st.step_min);
      end loop;
    end loop;
  end loop;
  return null;
end $$;

-- Listado paginado por cursor (no por offset): rinde igual con 100 o con millones de prestadores.
-- Sin búsqueda: primero los más activos (rank_key = shuffle_key - activity); entre iguales, orden rotativo diario.
-- Con búsqueda: por relevancia, máximo 200 resultados.
drop function if exists public.list_providers(text,text,text,double precision,bigint,int);
create or replace function public.list_providers(
  p_city text default 'olavarria', p_category text default null, p_q text default null,
  p_after_key double precision default null, p_after_id bigint default null, p_limit int default 12)
returns table (id bigint, slug text, name text, address text, hue smallint, photo_path text, rating_avg numeric, rating_count int,
               categories text[], min_price int, min_service text, happy_pct smallint, next_free timestamptz,
               sort_key double precision, activity int)
language plpgsql stable security definer set search_path = public, extensions as $$
declare cid smallint; lim int := least(greatest(coalesce(p_limit,12),1),48); q text := left(nullif(trim(p_q),''), 60);
        tsq tsquery := websearch_to_tsquery('simple', unaccent(coalesce(left(nullif(trim(p_q),''), 60),'')));
begin
  select c.id into cid from public.cities c where c.slug = p_city;
  if cid is null then return; end if;
  return query
  with base as (
    select pc.provider_id, pc.rank_key as k
    from public.provider_categories pc
    where q is null and pc.active and pc.city_id = cid
      and (case when p_category is null then pc.is_primary else pc.category_id = p_category end)
      and (p_after_key is null or (pc.rank_key, pc.provider_id) > (p_after_key, p_after_id))
    order by pc.rank_key, pc.provider_id
    limit lim
  ), fts as (
    -- 1) búsqueda de texto (nombre, servicios, dirección) o coincidencia parcial del nombre
    select p.id as provider_id, (1 - ts_rank(p.search, tsq))::double precision as k
    from public.providers p
    where q is not null and p.status = 'active' and p.city_id = cid
      and (p.search @@ tsq or p.name ilike '%' || q || '%')
      and (p_category is null or exists (select 1 from public.provider_categories pc2 where pc2.provider_id = p.id and pc2.category_id = p_category))
    order by k, p.id
    limit 200
  ), fuzzy as (
    -- 2) si no hubo nada: tolerancia a errores de tipeo (trigramas)
    select x.provider_id, x.k from (
      select p.id as provider_id, (1 + (p.name <-> q))::double precision as k   -- índice GiST: vecinos más parecidos
      from public.providers p
      where q is not null and not exists (select 1 from fts) and p.status = 'active' and p.city_id = cid
        and (p_category is null or exists (select 1 from public.provider_categories pc2 where pc2.provider_id = p.id and pc2.category_id = p_category))
      order by p.name <-> q
      limit 50) x
    where x.k < 1.7
  ), found as (
    select * from fts union all select * from fuzzy
  ), pick as (
    select * from base
    union all
    select f.provider_id, f.k from found f
      where (p_after_key is null or (f.k, f.provider_id) > (p_after_key, p_after_id))
  )
  select p.id, p.slug, p.name, p.address, p.hue, p.photo_path, p.rating_avg, p.rating_count,
         (select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from public.provider_categories pc where pc.provider_id = p.id),
         ms.price, ms.name,
         (select case when st.online and st.happy_on then st.happy_pct else 0::smallint end from public.provider_settings st where st.provider_id = p.id),
         public.next_free_slot(p.id),
         pick.k, p.activity
  from (select * from pick order by k, provider_id limit lim) pick
  join public.providers p on p.id = pick.provider_id
  left join lateral (select s.price, s.name from public.services s where s.provider_id = p.id and s.active
                     and (p_category is null or s.category_id = p_category) order by s.price limit 1) ms on true
  order by pick.k, p.id;
end $$;

create or replace function public.category_counts(p_city text default 'olavarria')
returns table (category_id text, providers bigint)
language sql stable security definer set search_path = public as $$
  select pc.category_id, count(*) from public.provider_categories pc
  join public.cities c on c.id = pc.city_id and c.slug = p_city
  where pc.active group by pc.category_id
  union all
  select 'todos', count(*) from public.provider_categories pc
  join public.cities c on c.id = pc.city_id and c.slug = p_city
  where pc.active and pc.is_primary
$$;

-- Ficha completa del prestador en una sola llamada.
create or replace function public.get_provider(pid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'bio', p.bio, 'address', p.address, 'instagram', p.instagram,
    'hue', p.hue, 'photo_path', p.photo_path, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count, 'followers', p.followers,
    'dni_verified', p.dni_verified, 'tz', c.tz,
    'categories', (select coalesce(jsonb_agg(pc.category_id order by pc.is_primary desc, pc.category_id), '[]') from public.provider_categories pc where pc.provider_id = p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_min, 'price', s.price, 'category', s.category_id,
                   'repeat_days', s.repeat_days, 'prep_note', s.prep_note, 'stamp_goal', s.stamp_goal,
                   'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'duration', a.duration_min) order by a.sort, a.id), '[]')
                              from public.service_addons a where a.service_id = s.id and a.active)) order by s.category_id, s.sort, s.price), '[]')
                 from public.services s where s.provider_id = p.id and s.active),
    'settings', (select to_jsonb(st) from public.provider_settings st where st.provider_id = p.id),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'shift', h.shift, 'opens', to_char(h.opens,'HH24:MI'), 'closes', to_char(h.closes,'HH24:MI'))), '[]')
              from public.provider_hours h where h.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(r), '[]') from (select id, author, stars, body, reply, created_at from public.reviews where provider_id = p.id order by created_at desc limit 20) r),
    'media', (select coalesce(jsonb_agg(m), '[]') from (select id, storage_path, kind, label from public.media where provider_id = p.id order by created_at desc limit 24) m),
    'following', exists (select 1 from public.follows f where f.provider_id = p.id and f.user_id = auth.uid()),
    'my_stamps', coalesce((select jsonb_object_agg(lc.service_id::text, lc.stamps) from public.loyalty_cards lc where lc.provider_id = p.id and lc.user_id = auth.uid()), '{}'::jsonb)
  ) end
  from public.providers p join public.cities c on c.id = p.city_id
  where p.id = pid and (p.status = 'active' or p.owner_id = auth.uid() or public.is_admin())
$$;

-- Horarios ocupados (sin nombres ni datos de clientes) para pintar el turnero.
drop function if exists public.provider_busy(bigint, date, date);
create or replace function public.provider_busy(pid bigint, p_from date, p_to date)
returns table (starts_at timestamptz, ends_at timestamptz, day_block boolean)
language sql stable security definer set search_path = public as $$
  -- ends_at incluye el descanso del prestador: ese tiempo tampoco se puede reservar. day_block = día bloqueado (vacaciones)
  select b.starts_at, b.busy_until, (b.source = 'block' and coalesce(b.service_name, '') like '🏖️%') from public.bookings b
  where b.provider_id = pid and b.status in ('hold','confirmed','done')
    and b.starts_at >= p_from::timestamp at time zone public.provider_tz(pid)
    and b.starts_at <  (least(p_to, p_from + 140) + 1)::timestamp at time zone public.provider_tz(pid)
  order by b.starts_at
  limit 5000
$$;

-- Vincula (o crea) la ficha del cliente en la agenda del prestador.
create or replace function public.link_client(pid bigint, uid uuid, nm text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid is null then return; end if;
  update public.provider_clients set user_id = uid where provider_id = pid and user_id is null and lower(name) = lower(nm)
    and not exists (select 1 from public.provider_clients x where x.provider_id = pid and x.user_id = uid);
  if not exists (select 1 from public.provider_clients where provider_id = pid and user_id = uid) then
    insert into public.provider_clients (provider_id, user_id, name)
    values (pid, uid, coalesce(nm, 'Cliente') || case when exists (select 1 from public.provider_clients where provider_id = pid and lower(name) = lower(coalesce(nm,'Cliente'))) then ' (' || left(uid::text, 4) || ')' else '' end);
  end if;
end $$;

-- ---------- RESERVAR ----------
-- Crea el turno (y los repetidos) en estado 'hold' por 10 minutos mientras se paga.
-- Si el saldo TuTiempo cubre todo, queda confirmado al instante.
drop function if exists public.book_slot(bigint,timestamptz,int,int,boolean);
drop function if exists public.book_slot(bigint,timestamptz,int,int,boolean,bigint[],jsonb);
create or replace function public.book_slot(p_service bigint, p_start timestamptz, p_repeat_weeks int default 0,
                                            p_extra int default 0, p_pay text default 'mp',
                                            p_addons bigint[] default '{}', p_intake jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s record; p record; st record; tz text; nm text;
  i int; t timestamptz; lt timestamp; disc smallint; v_price int; dep int; v_fee int; v_full boolean;
  ids bigint[] := '{}'; deps int[] := '{}'; total int := 0; bal int; w int := 0; left_w int; pay int;
  sid uuid := case when coalesce(p_extra,0) > 0 then gen_random_uuid() end; bid bigint; skipped int := 0;
  ad_ids bigint[] := array(select distinct x from unnest(coalesce(p_addons,'{}')) x where x is not null);
  ad_price int := 0; ad_min int := 0; ad_json jsonb := '[]'; ad_n int := 0; dur int; v_intake jsonb := '{}';
  v_cash boolean := coalesce(p_pay,'mp') = 'cash'; v_reward boolean := coalesce(p_pay,'mp') = 'reward'; v_have int;
begin
  if uid is null then raise exception 'login_required' using errcode = '28000'; end if;
  if coalesce(p_pay,'mp') not in ('mp','cash','reward') then raise exception 'bad_pay'; end if;
  if coalesce(p_repeat_weeks,0) not in (0,1,2,3,4,6) or coalesce(p_extra,0) not between 0 and 3
     or (coalesce(p_extra,0) > 0 and coalesce(p_repeat_weeks,0) = 0) then raise exception 'bad_repeat'; end if;
  if cardinality(ad_ids) > 10 then raise exception 'bad_addon'; end if;
  select * into s from public.services where id = p_service and active;
  if s is null then raise exception 'service_not_found'; end if;
  select * into p from public.providers where id = s.provider_id and status = 'active';
  if p is null then raise exception 'provider_not_available'; end if;
  select * into st from public.provider_settings where provider_id = p.id;
  if st is null or not st.online then raise exception 'online_booking_off'; end if;
  -- anti-abuso: nadie puede "acaparar" horarios con reservas sin pagar
  if (select count(*) from public.bookings where client_id = uid and status = 'hold' and hold_expires_at > now()) >= 5 then
    raise exception 'too_many_holds';
  end if;
  if (select count(*) from public.bookings where client_id = uid and source = 'app' and status in ('hold','expired') and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_attempts';
  end if;
  -- adicionales: solo los de ESTE servicio; precio y minutos salen de la base
  if cardinality(ad_ids) > 0 then
    select count(*), coalesce(sum(price),0), coalesce(sum(duration_min),0),
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'min', duration_min) order by sort, id), '[]')
      into ad_n, ad_price, ad_min, ad_json
      from public.service_addons where id = any(ad_ids) and service_id = s.id and active;
    if ad_n <> cardinality(ad_ids) then raise exception 'bad_addon'; end if;
  end if;
  dur := s.duration_min + ad_min;
  if dur > 480 then raise exception 'bad_addon'; end if;
  -- preguntas previas: solo texto corto, claves simples, máximo 12
  if jsonb_typeof(coalesce(p_intake,'{}')) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}') into v_intake from (
      select key as k, left(regexp_replace(value #>> '{}', '[[:cntrl:]]', ' ', 'g'), 200) as v
      from jsonb_each(p_intake)
      where key ~ '^[a-z_]{1,20}$' and jsonb_typeof(value) in ('string','number','boolean')
      limit 12) x;
  end if;
  tz := public.provider_tz(p.id);
  select coalesce(nullif(full_name,''),'Cliente') into nm from public.profiles where id = uid;
  perform public.expire_holds(p.id);
  v_full := false;   -- el que faltó perdió su seña: no se le cobra el total en las próximas reservas
  -- premio de la tarjeta de sellos: ese mismo servicio gratis, con SU tarjeta llena, sin repetir
  if v_reward then
    if coalesce(p_extra,0) > 0 or cardinality(ad_ids) > 0 then raise exception 'bad_repeat'; end if;
    if not st.stamps_on or s.stamp_goal is null then raise exception 'reward_not_available'; end if;
    select stamps into v_have from public.loyalty_cards where provider_id = p.id and user_id = uid and service_id = s.id for update;
    if coalesce(v_have,0) < s.stamp_goal then raise exception 'not_enough_stamps'; end if;
  end if;
  -- la seña se paga SIEMPRE con Mercado Pago; 'cash' = el resto en efectivo en el local (si el prestador lo acepta y el cliente no tiene faltas)
  if v_cash then
    if not st.cash_ok or v_full then raise exception 'cash_not_allowed'; end if;
  end if;

  for i in 0 .. coalesce(p_extra,0) loop
    t := p_start + make_interval(days => 7 * coalesce(p_repeat_weeks,0) * i);
    lt := t at time zone tz;
    if not public.slot_fits(p.id, lt, dur)
       or (i = 0 and (t < now() + make_interval(mins => st.notice_min)
                      or lt::date > (now() at time zone tz)::date + st.ahead_days - 1)) then
      if i = 0 then raise exception 'slot_not_available'; end if;
      skipped := skipped + 1; continue;
    end if;
    disc := public.happy_disc(p.id, lt);
    v_price := case when v_reward then 0 else round((s.price + ad_price) * (100 - disc) / 100.0) end;
    dep := case when v_reward then 0 when st.pay_mode = 'full' or v_full then v_price else round(v_price * st.deposit_pct / 100.0) end;
    -- comisión de TuTiempo: % del precio, la paga el cliente APARTE de la seña (el prestador recibe la seña completa)
    v_fee := case when v_reward then 0 else round(v_price * public.commission())::int end;
    begin
      insert into public.bookings (provider_id, service_id, client_id, client_name, service_name, source, status,
                                   starts_at, ends_at, buffer_min, price, discount_pct, deposit, client_fee, series_id, hold_expires_at, addons, intake, pay_method)
      values (p.id, s.id, uid, nm, s.name, 'app', 'hold', t, t + make_interval(mins => dur), st.buffer_min,
              v_price, disc, dep, v_fee, sid, now() + interval '10 minutes', ad_json, v_intake, case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end)
      returning id into bid;
    exception when exclusion_violation then
      if i = 0 then raise exception 'slot_taken'; end if;
      skipped := skipped + 1; continue;
    end;
    ids := ids || bid; deps := deps || dep; total := total + dep + v_fee;
  end loop;

  -- sin saldo TuTiempo: se paga con Mercado Pago o en efectivo en el local
  if v_reward then perform public.stamp_add(p.id, uid, s.id, -s.stamp_goal, 'redeem', ids[1]); end if;
  if total - w = 0 then
    update public.bookings set status = 'confirmed', hold_expires_at = null where id = any(ids);
    perform public.link_client(p.id, uid, nm);
    perform public.notify_booking(ids[1], 'conf');
    return jsonb_build_object('status','confirmed','booking_ids', to_jsonb(ids), 'amount_due', 0, 'pay', case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end,
                              'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur);
  end if;
  return jsonb_build_object('status','pending_payment','booking_ids', to_jsonb(ids), 'amount_due', total - w,
                            'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur,
                            'hold_expires_at', now() + interval '10 minutes');
end $$;

-- Libera reservas en pago que vencieron y devuelve el saldo usado.
create or replace function public.expire_holds(pid bigint default null) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in update public.bookings set status = 'expired'
           where status = 'hold' and hold_expires_at < now() and (pid is null or provider_id = pid)
           returning id, client_id, paid_wallet loop
    n := n + 1;
    if r.paid_wallet > 0 and r.client_id is not null then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note)
      values (r.client_id, 'refund', r.paid_wallet, r.id, 'Devolución: no se completó el pago');
      update public.bookings set paid_wallet = 0 where id = r.id;
    end if;
  end loop;
  return n;
end $$;

-- Lo llama SOLO la Edge Function del webhook de Mercado Pago (service_role), después de verificar el pago.
create or replace function public.confirm_payment(p_booking_ids bigint[], p_payment_id text, p_amount int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare due int; uid uuid; pid bigint; r record; cb int; left_amt int := p_amount; pay int; total_cb int := 0; ok int := 0; failed int := 0; nm text;
begin
  if exists (select 1 from public.bookings where mp_payment_id = p_payment_id) then
    return jsonb_build_object('status','already_processed');
  end if;
  select sum(deposit + client_fee - paid_wallet), min(client_id::text)::uuid, min(provider_id), min(client_name)
    into due, uid, pid, nm from public.bookings where id = any(p_booking_ids) and status in ('hold','expired') and source = 'app';
  if due is null then raise exception 'bookings_not_found'; end if;
  if p_amount < due then raise exception 'amount_mismatch'; end if;
  for r in select * from public.bookings where id = any(p_booking_ids) order by starts_at loop
    -- pay = lo que se cobró por este turno (seña + comisión); paid_mp = la seña (del prestador); app_fee = la comisión
    pay := least(left_amt, r.deposit + r.client_fee - r.paid_wallet); left_amt := left_amt - pay;
    cb := floor(greatest(pay - r.client_fee, 0) * public.cashback_rate());
    begin
      update public.bookings set status = 'confirmed', hold_expires_at = null, paid_mp = greatest(pay - r.client_fee, 0), cashback = cb,
             app_fee = least(pay, r.client_fee),
             mp_payment_id = case when ok + failed = 0 then p_payment_id else null end
       where id = r.id;
      ok := ok + 1; total_cb := total_cb + cb;
    exception when exclusion_violation then
      -- el hold venció y otro tomó el horario: se devuelve lo pagado
      update public.bookings set status = 'cancelled_provider', paid_mp = greatest(pay - r.client_fee, 0), app_fee = least(pay, r.client_fee), refund_pending = pay where id = r.id;
      if r.paid_wallet > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (uid, 'refund', r.paid_wallet, r.id, 'Devolución: el horario ya no estaba libre');
      end if;
      failed := failed + 1;
    end;
  end loop;
  if total_cb > 0 then
    insert into public.wallet_movements (user_id, kind, amount, booking_id, note)
    values (uid, 'cashback', total_cb, p_booking_ids[1], 'Cashback 5%');
  end if;
  perform public.link_client(pid, uid, nm);
  perform public.notify_booking((select min(id) from public.bookings where id = any(p_booking_ids) and status = 'confirmed'), 'conf');
  return jsonb_build_object('status','confirmed','confirmed', ok, 'refunded', failed, 'cashback', total_cb);
end $$;

-- Cliente avisa que no va: lo pagado queda para el prestador (regla de negocio). Un hold se libera y devuelve saldo.
create or replace function public.cancel_by_client(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; waiting int;
begin
  select * into b from public.bookings where id = p_booking and client_id = auth.uid() for update;
  if b is null then raise exception 'not_found'; end if;
  if b.status = 'hold' then
    update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second' where id = b.id;
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: reserva sin pagar');
      update public.bookings set paid_wallet = 0 where id = b.id;
    end if;
    return jsonb_build_object('status','released');
  end if;
  if b.status <> 'confirmed' or b.starts_at <= now() then raise exception 'cannot_cancel'; end if;
  update public.bookings set status = 'cancelled_client' where id = b.id;
  perform public.stamp_refund(b.id);
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','kept_by_provider', b.paid_mp + b.paid_wallet, 'waitlist', waiting);
end $$;

-- Prestador cancela: al cliente se le devuelve todo (saldo al saldo, MP queda pendiente de reembolso).
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  update public.bookings set status = 'cancelled_provider', refund_pending = b.paid_mp + least(b.client_fee, b.app_fee), hold_expires_at = null where id = b.id;
  perform public.stamp_refund(b.id);
  if b.status = 'confirmed' then perform public.notify_booking(b.id, 'cancel'); end if;
  if b.client_id is not null then
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: el prestador canceló');
    end if;
    if b.cashback > 0 then
      select balance into bal from public.wallets where user_id = b.client_id for update;
      rev := least(coalesce(bal,0), b.cashback);
      if rev > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'reversal', -rev, b.id, 'Se descuenta el cashback del turno cancelado');
      end if;
    end if;
  end if;
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','refund_mp', b.paid_mp + least(b.client_fee, b.app_fee), 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;

-- Asistió / No vino (actualiza la ficha del cliente).
create or replace function public.mark_booking(p_booking bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; tz text; v_st int;
begin
  if p_status not in ('done','no_show') then raise exception 'bad_status'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status <> 'confirmed' or b.source = 'block' then raise exception 'bad_state'; end if;
  if b.starts_at > now() + interval '12 hours' then raise exception 'too_early'; end if;
  tz := public.provider_tz(b.provider_id);
  update public.bookings set status = p_status where id = b.id;
  if b.client_id is not null then perform public.link_client(b.provider_id, b.client_id, b.client_name); end if;
  update public.provider_clients c set
     visits = visits + (p_status = 'done')::int,
     no_shows = no_shows + (p_status = 'no_show')::int,
     total_spent = total_spent + case when p_status = 'done' then b.price else 0 end,
     last_visit = case when p_status = 'done' then (b.starts_at at time zone tz)::date else last_visit end
   where c.provider_id = b.provider_id
     and ((b.client_id is not null and c.user_id = b.client_id) or (b.client_id is null and lower(c.name) = lower(b.client_name)));
  -- tarjeta de sellos: cada servicio atendido de un cliente de la app suma 1 (el premio no suma)
  if p_status = 'done' and b.client_id is not null and b.source = 'app' and b.pay_method <> 'reward'
     and exists (select 1 from public.provider_settings where provider_id = b.provider_id and stamps_on)
     and exists (select 1 from public.services where id = b.service_id and provider_id = b.provider_id and stamp_goal is not null) then
    v_st := public.stamp_add(b.provider_id, b.client_id, b.service_id, 1, 'earn', b.id);
  end if;
  if p_status = 'done' then perform public.notify_booking(b.id, 'rev'); end if;
  return jsonb_build_object('status', p_status, 'to_collect', greatest(b.price - b.paid_mp - b.paid_wallet, 0), 'stamps', v_st);
end $$;

create or replace function public.confirm_attendance(p_booking bigint) returns void
language sql security definer set search_path = public as $$
  update public.bookings set attendance_ok = true where id = p_booking and client_id = auth.uid() and status = 'confirmed'
$$;

-- Teléfono del prestador: solo para quien tiene un turno pago con él.
create or replace function public.provider_contact(pid bigint) returns text
language sql stable security definer set search_path = public as $$
  select pp.phone from public.provider_private pp
  where pp.provider_id = pid and (public.owns_provider(pid) or exists (
    select 1 from public.bookings b where b.provider_id = pid and b.client_id = auth.uid() and b.status in ('confirmed','done')))
$$;

create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
           exists (select 1 from public.reviews r where r.booking_id = b.id) as reviewed, b.pay_method, p.photo_path,
           exists (select 1 from public.loyalty_events le where le.booking_id = b.id and le.kind = 'earn') as stamped
    from public.bookings b join public.providers p on p.id = b.provider_id join public.cities c on c.id = p.city_id
    left join public.services sv on sv.id = b.service_id
    where b.client_id = auth.uid() and b.source = 'app'
    order by b.starts_at desc limit 200) x
$$;

-- ---------- Alta de prestador (todo junto, en una transacción) ----------
create or replace function public.register_provider(p_name text, p_address text, p_categories text[], p_phone text,
                                                    p_dni text, p_instagram text default null, p_city text default 'olavarria')
returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pid bigint; cid smallint; base text; sl text; n int := 0; c text; d int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if exists (select 1 from public.providers where owner_id = uid) then raise exception 'already_registered'; end if;
  if p_categories is null or array_length(p_categories,1) is null then raise exception 'category_required'; end if;
  if array_length(p_categories,1) > 6 then raise exception 'too_many_categories'; end if;
  if p_dni !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
  select id into cid from public.cities where slug = p_city;
  if cid is null then raise exception 'bad_city'; end if;
  base := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(base) < 3 then base := 'prestador'; end if;
  base := left(base, 50); sl := base;
  while exists (select 1 from public.providers where slug = sl) loop n := n + 1; sl := base || '-' || n; end loop;
  insert into public.providers (owner_id, slug, name, address, city_id, instagram, hue, status)
  values (uid, sl, left(p_name, 80), left(p_address, 160), cid, left(p_instagram, 60), (abs(hashtext(sl)) % 360), 'pending')
  returning id into pid;
  insert into public.provider_private (provider_id, phone, dni_number) values (pid, left(p_phone, 40), p_dni);
  insert into public.provider_settings (provider_id) values (pid);
  foreach c in array p_categories loop
    insert into public.provider_categories (provider_id, category_id) values (pid, c) on conflict do nothing;
  end loop;
  for d in 1 .. 5 loop
    insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00');
  end loop;
  insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
  insert into public.message_templates (provider_id, key, enabled, body) values
   (pid,'conf',true,'¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.'),
   (pid,'r24',true,'{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¿Venís? Confirmá acá: {link}'),
   (pid,'r2',true,'¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}'),
   (pid,'rev',true,'¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? {link}'),
   (pid,'back',true,'{nombre}, ya te toca tu próximo turno. ¿Te reservo? Elegí tu horario: {link}'),
   (pid,'bday',false,'¡Feliz cumpleaños, {nombre}! Este mes tenés 15% off. Reservá: {link}');
  return pid;
end $$;

-- ---------- Bajas ----------
create or replace function public.provider_teardown(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if pid is null or not public.owns_provider(pid) then raise exception 'not_found'; end if;
  for r in select id from public.bookings where provider_id = pid and status in ('confirmed','hold') and source = 'app' and starts_at > now() loop
    perform public.cancel_by_provider(r.id); n := n + 1;
  end loop;
  delete from public.bookings where provider_id = pid and source in ('manual','block') and starts_at > now();
  delete from public.provider_clients where provider_id = pid;
  delete from public.walkins where provider_id = pid;
  delete from public.expenses where provider_id = pid;
  delete from public.cash_closings where provider_id = pid;
  delete from public.products where provider_id = pid;
  -- la llave de Mercado Pago se borra recién cuando se hicieron todas las devoluciones (las hace mp-refunds con esa llave)
  delete from public.provider_secrets where provider_id = pid
     and not exists (select 1 from public.bookings where provider_id = pid and refund_pending > 0);
  update public.provider_private set phone = null, dni_number = null, dni_paths = '{}', mp_user_id = null, mp_connected = false where provider_id = pid;
  update public.providers set status = 'deleted', owner_id = null, updated_at = now() where id = pid;
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

create or replace function public.delete_my_provider() returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider();
begin
  if pid is null then raise exception 'not_found'; end if;
  return public.provider_teardown(pid);
end $$;

-- Borra la llave de Mercado Pago de los prestadores eliminados cuando ya no quedan devoluciones pendientes (mp-refunds / cron).
create or replace function public.purge_deleted_secrets() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.provider_secrets s using public.providers p
             where p.id = s.provider_id and p.status = 'deleted'
               and not exists (select 1 from public.bookings b where b.provider_id = p.id and b.refund_pending > 0) returning 1)
  select count(*)::int from d
$$;

-- El cliente borra su cuenta: sus turnos futuros se cancelan (lo pagado no se devuelve) y pierde el saldo.
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if public.my_provider() is not null then raise exception 'delete_provider_first'; end if;
  update public.bookings set status = case when status = 'hold' then 'expired' else 'cancelled_client' end, client_name = 'Cliente eliminado', client_phone = null
   where client_id = uid and status in ('confirmed','hold') and starts_at > now();
  get diagnostics n = row_count;
  update public.bookings set client_name = 'Cliente eliminado', client_phone = null where client_id = uid;
  update public.provider_clients set user_id = null, phone = null where user_id = uid;
  delete from auth.users where id = uid;   -- en cascada: perfil, billetera, seguidos, lista de espera
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

-- ---------- Reportes del panel ----------
create or replace function public.provider_finance(p_from date, p_to date)
returns table (day date, app int, man int, walk int, prod int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  days as (select generate_series(p_from, least(p_to, p_from + 400), interval '1 day')::date as day)
  select d.day,
    coalesce((select sum(round(b.price * (1 - public.commission())))::int from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'app' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(b.price)::int from public.bookings b, tz where b.provider_id = (select id from pid)
              and b.source = 'manual' and b.status = 'done' and (b.starts_at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount + w.tip)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'service' and (w.at at time zone tz.z)::date = d.day), 0),
    coalesce((select sum(w.amount)::int from public.walkins w, tz where w.provider_id = (select id from pid)
              and w.kind = 'product' and (w.at at time zone tz.z)::date = d.day), 0)
  from days d where (select id from pid) is not null order by d.day
$$;

create or replace function public.provider_month_totals(p_year int)
returns table (month int, income int, expenses int)
language sql stable security definer set search_path = public as $$
  with f as (select * from public.provider_finance(make_date(p_year,1,1), make_date(p_year,12,31)))
  select m, coalesce((select sum(app+man+walk+prod)::int from f where extract(month from f.day) = m), 0),
         coalesce((select sum(e.amount)::int from public.expenses e where e.provider_id = public.my_provider()
                   and extract(year from e.spent_on) = p_year and extract(month from e.spent_on) = m), 0)
  from generate_series(1,12) m
$$;

-- Minutos ocupados por día y hora (para el mapa de calor de ocupación).
create or replace function public.provider_occupancy(p_from date, p_to date)
returns table (day date, hour int, busy_min int)
language sql stable security definer set search_path = public as $$
  with pid as (select public.my_provider() as id), tz as (select public.provider_tz((select id from pid)) as z),
  b as (select (bk.starts_at at time zone tz.z) as s, (bk.ends_at at time zone tz.z) as e
        from public.bookings bk, tz where bk.provider_id = (select id from pid) and bk.source <> 'block'
          and bk.status in ('confirmed','done','no_show')
          and bk.starts_at >= p_from::timestamp at time zone tz.z and bk.starts_at < (least(p_to, p_from + 400) + 1)::timestamp at time zone tz.z),
  h as (select b.*, gs as hs from b, generate_series(date_trunc('hour', b.s), b.e - interval '1 second', interval '1 hour') gs)
  select hs::date, extract(hour from hs)::int,
         sum(extract(epoch from (least(e, hs + interval '1 hour') - greatest(s, hs))) / 60)::int
  from h group by 1, 2 order by 1, 2
$$;

-- ---------- Mantenimiento (pg_cron) ----------
create or replace function public.refresh_activity() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with c as (select provider_id, count(*)::int as k from public.bookings
             where source = 'app' and status = 'done' and starts_at >= now() - interval '30 days' group by 1)
  update public.providers p set activity = coalesce(c.k, 0)
    from public.providers p2 left join c on c.provider_id = p2.id
   where p.id = p2.id and p.activity is distinct from coalesce(c.k, 0);
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function public.reshuffle_providers() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_activity();
  update public.providers set shuffle_key = random() where status = 'active';
end $$;

-- ---------- Mensajes del prestador a sus clientes ----------
-- Solo a clientes propios que tienen cuenta en la app. {nombre} se reemplaza por el nombre de cada uno.
-- Límites: 300 destinatarios por envío y 600 mensajes por día por prestador (anti-spam).
create or replace function public.send_client_messages(p_client_ids bigint[], p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); b text := btrim(regexp_replace(coalesce(p_body,''), '[\x01-\x09\x0b-\x1f\x7f]', ' ', 'g'));
        n int := 0; today int; ids bigint[] := array(select distinct x from unnest(coalesce(p_client_ids,'{}')) x where x is not null);
begin
  if pid is null then raise exception 'not_provider'; end if;
  if char_length(b) < 2 or char_length(b) > 500 then raise exception 'bad_message'; end if;
  if cardinality(ids) = 0 or cardinality(ids) > 300 then raise exception 'bad_recipients'; end if;
  select count(*) into today from public.client_messages where provider_id = pid and created_at > now() - interval '24 hours';
  if today + cardinality(ids) > 600 then raise exception 'too_many_messages'; end if;
  insert into public.client_messages (provider_id, user_id, body)
  select pid, c.user_id, left(replace(b, '{nombre}', split_part(c.name, ' ', 1)), 600)
  from public.provider_clients c
  where c.provider_id = pid and c.id = any(ids) and c.user_id is not null;
  get diagnostics n = row_count;
  update public.provider_clients set contacted_at = now() where provider_id = pid and id = any(ids);
  return jsonb_build_object('sent', n, 'without_app', cardinality(ids) - n);
end $$;

create or replace function public.my_messages() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select m.id, m.provider_id, p.name as provider_name, p.photo_path, p.hue, m.body, m.created_at, m.read_at is not null as read, m.kind
    from public.client_messages m join public.providers p on p.id = m.provider_id
    where m.user_id = auth.uid() order by m.created_at desc limit 50) x
$$;

create or replace function public.mark_messages_read() returns void
language sql security definer set search_path = public as $$
  update public.client_messages set read_at = now() where user_id = auth.uid() and read_at is null
$$;

-- ---------- Tarjeta de sellos (una por servicio) ----------
drop function if exists public.stamp_add(bigint,uuid,int,text,bigint);
drop function if exists public.give_stamp(bigint);
drop function if exists public.redeem_stamps(bigint);
-- Interno: mueve sellos de la tarjeta de un servicio y deja el registro (no se puede llamar desde la app).
create or replace function public.stamp_add(pid bigint, uid uuid, sid bigint, d int, k text, bid bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.loyalty_events (provider_id, user_id, service_id, kind, delta, booking_id) values (pid, uid, sid, k, d, bid);
  insert into public.loyalty_cards as lc (provider_id, user_id, service_id, stamps, earned, redeemed)
  values (pid, uid, sid, greatest(d, 0), case when k in ('earn','manual') then d else 0 end, 0)
  on conflict (provider_id, user_id, service_id) do update set
    stamps   = lc.stamps + d,
    earned   = lc.earned + case when k in ('earn','manual') then d else 0 end,
    redeemed = lc.redeemed + case when k = 'redeem' then -d when k = 'refund' then -d else 0 end,
    updated_at = now()
  returning stamps into n;
  return n;
end $$;

-- Interno: si se cancela un turno pagado con el premio, vuelven los sellos a esa tarjeta (una sola vez).
create or replace function public.stamp_refund(bid bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from public.loyalty_events where booking_id = bid and kind = 'redeem';
  if e is null or e.service_id is null or exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'refund') then return; end if;
  perform public.stamp_add(e.provider_id, e.user_id, e.service_id, -e.delta, 'refund', bid);
end $$;

-- Los servicios de las tarjetas viejas tienen que ser del mismo prestador (compatibilidad).
create or replace function public.settings_reward_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stamps_reward is not null and not exists (select 1 from public.services where id = new.stamps_reward and provider_id = new.provider_id) then
    raise exception 'bad_reward';
  end if;
  if new.stamps_services is not null and exists (select 1 from unnest(new.stamps_services) x
       where not exists (select 1 from public.services s where s.id = x and s.provider_id = new.provider_id)) then
    raise exception 'bad_reward';
  end if;
  return new;
end $$;
drop trigger if exists ps_reward_check on public.provider_settings;
create trigger ps_reward_check before insert or update of stamps_reward, stamps_services on public.provider_settings
  for each row execute function public.settings_reward_check();

-- Valida que el servicio sea del prestador y tenga tarjeta.
create or replace function public.stamp_service(pid bigint, sid bigint) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare g smallint;
begin
  if not exists (select 1 from public.provider_settings where provider_id = pid and stamps_on) then raise exception 'stamps_off'; end if;
  select stamp_goal into g from public.services where id = sid and provider_id = pid and active;
  if g is null then raise exception 'no_stamp_card'; end if;
  return g;
end $$;

-- Prestador: sello a mano (cliente con la app; máximo 1 por día, por cliente y por servicio).
create or replace function public.give_stamp(p_client bigint, p_service bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); c record; g smallint; n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  g := public.stamp_service(pid, p_service);
  select * into c from public.provider_clients where id = p_client and provider_id = pid;
  if c is null then raise exception 'not_found'; end if;
  if c.user_id is null then raise exception 'client_without_app'; end if;
  if exists (select 1 from public.loyalty_events where provider_id = pid and user_id = c.user_id and service_id = p_service
             and kind = 'manual' and created_at > now() - interval '20 hours') then
    raise exception 'stamp_today';
  end if;
  n := public.stamp_add(pid, c.user_id, p_service, 1, 'manual', null);
  return jsonb_build_object('stamps', n, 'goal', g);
end $$;

-- Prestador: canjea el premio en el local (descuenta los sellos de esa tarjeta llena).
create or replace function public.redeem_stamps(p_client bigint, p_service bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); c record; g smallint; have int; n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  g := public.stamp_service(pid, p_service);
  select * into c from public.provider_clients where id = p_client and provider_id = pid;
  if c is null or c.user_id is null then raise exception 'not_found'; end if;
  select stamps into have from public.loyalty_cards where provider_id = pid and user_id = c.user_id and service_id = p_service for update;
  if coalesce(have,0) < g then raise exception 'not_enough_stamps'; end if;
  n := public.stamp_add(pid, c.user_id, p_service, -g, 'redeem', null);
  return jsonb_build_object('stamps', n, 'goal', g);
end $$;

-- Cliente: sus tarjetas, una por servicio, con cuántas veces se lo hizo en cada una.
create or replace function public.my_stamps() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.updated_at desc), '[]') from (
    select lc.provider_id, lc.service_id, sv.name as service_name, sv.stamp_goal, p.name as provider_name, p.photo_path, p.hue,
           lc.stamps, lc.earned, lc.redeemed, lc.updated_at, coalesce(st.stamps_on, false) and sv.stamp_goal is not null and sv.active as stamps_on,
           sv.category_id as category,
           (select count(*) from public.bookings b where b.provider_id = lc.provider_id and b.client_id = auth.uid() and b.service_id = lc.service_id and b.status = 'done')::int as done
    from public.loyalty_cards lc
    join public.providers p on p.id = lc.provider_id and p.status = 'active'
    join public.services sv on sv.id = lc.service_id
    left join public.provider_settings st on st.provider_id = lc.provider_id
    where lc.user_id = auth.uid()
    limit 200) x
$$;

-- ---------- Avisos automáticos en la app (sin WhatsApp) ----------
-- Arma el aviso con la plantilla del prestador ({nombre}, {barberia}, {dia}, {hora}, {direccion}, {link}).
-- Cada turno recibe cada aviso una sola vez (índice client_messages_once).
create or replace function public.notify_booking(bid bigint, k text) returns void
language plpgsql security definer set search_path = public as $$
declare b record; t record; p record; lt timestamp; body text;
        dias text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
begin
  if bid is null then return; end if;
  select * into b from public.bookings where id = bid;
  if b is null or b.client_id is null or b.source <> 'app' then return; end if;
  if k = 'cancel' then
    if b.settle_by_provider then
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}. {barberia} se va a comunicar con vos para devolverte la seña ($' ||
             replace(to_char(b.paid_mp + b.paid_wallet, 'FM999,999,999'), ',', '.') || ') o pasarte el turno a otro día.' as body into t;
    else
      select true as enabled, '{barberia} tuvo que cancelar tu turno del {dia} a las {hora}.' ||
             case when b.paid_mp > 0 then ' Te devolvemos todo lo que pagaste ($' || replace(to_char(b.paid_mp + least(b.client_fee, b.app_fee), 'FM999,999,999'), ',', '.') || ').' else '' end ||
             ' Reprogramalo cuando quieras desde Mis turnos: {link}' as body into t;
    end if;
  else
    select enabled, mt.body into t from public.message_templates mt where provider_id = b.provider_id and key = k;
    if t is null or not t.enabled then return; end if;
  end if;
  select name, address, slug into p from public.providers where id = b.provider_id;
  lt := b.starts_at at time zone public.provider_tz(b.provider_id);
  body := replace(replace(replace(replace(replace(replace(t.body,
            '{nombre}', split_part(coalesce(b.client_name, ''), ' ', 1)), '{barberia}', p.name),
            '{dia}', dias[extract(dow from lt)::int + 1] || ' ' || extract(day from lt)::int || '/' || extract(month from lt)::int),
            '{hora}', to_char(lt, 'HH24:MI')), '{direccion}', coalesce(p.address, '')), '{link}', 'tutiempo.com.ar/' || p.slug);
  if k = 'rev' and exists (select 1 from public.loyalty_events where booking_id = bid and kind = 'earn') then
    body := body || ' 🎟️ Sumaste 1 sello en tu tarjeta de ' || coalesce(b.service_name, 'este servicio') || '.';
  end if;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  values (b.provider_id, b.client_id, left(body, 600), k, bid::text) on conflict do nothing;
end $$;

-- Recordatorios (24 h y 2 h antes) y cumpleaños. Lo corre pg_cron cada 10 minutos.
create or replace function public.send_scheduled_notices() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; tz text := 'America/Argentina/Buenos_Aires';
begin
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() + interval '2 hours' and b.starts_at <= now() + interval '24 hours' and b.created_at < b.starts_at - interval '24 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r24' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r24'); n := n + 1;
  end loop;
  for r in select b.id from public.bookings b
           where b.source = 'app' and b.status = 'confirmed' and b.client_id is not null
             and b.starts_at > now() and b.starts_at <= now() + interval '2 hours' and b.created_at < b.starts_at - interval '2 hours'
             and not exists (select 1 from public.client_messages m where m.provider_id = b.provider_id and m.user_id = b.client_id and m.kind = 'r2' and m.ref = b.id::text)
           limit 5000 loop
    perform public.notify_booking(r.id, 'r2'); n := n + 1;
  end loop;
  insert into public.client_messages (provider_id, user_id, body, kind, ref)
  select c.provider_id, c.user_id,
         left(replace(replace(replace(t.body, '{nombre}', split_part(c.name, ' ', 1)), '{barberia}', p.name), '{link}', 'tutiempo.com.ar/' || p.slug), 600),
         'bday', to_char(now() at time zone tz, 'YYYY')
  from public.provider_clients c
  join public.message_templates t on t.provider_id = c.provider_id and t.key = 'bday' and t.enabled
  join public.providers p on p.id = c.provider_id and p.status = 'active'
  where c.user_id is not null and c.birthday = to_char(now() at time zone tz, 'MM-DD')
  on conflict do nothing;
  return n;
end $$;

-- ---------- Bloquear días o semanas (vacaciones) ----------
-- En una sola transacción: cancela los turnos de esos días (a los de la app les llega el aviso), deja cada día bloqueado
-- y devuelve la lista de clientes cancelados con su teléfono y la seña que pagaron. TuTiempo NO devuelve la seña:
-- el prestador llama a cada cliente y se la devuelve o le da otro turno (settle_by_provider).
create or replace function public.block_days(p_from date, p_to date, p_reason text default 'Vacaciones') returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); tz text; d date; o time; c time; r record; why text; lst jsonb := '[]'; nb int := 0; today date;
begin
  if pid is null then raise exception 'not_provider'; end if;
  tz := public.provider_tz(pid); today := (now() at time zone tz)::date;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_range'; end if;
  if p_from < today then raise exception 'past_days'; end if;
  if p_to - p_from > 92 then raise exception 'range_too_long'; end if;
  why := '🏖️ ' || left(coalesce(nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]<>]', '', 'g')), ''), 'Día libre'), 40);
  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    select min(opens), max(closes) into o, c from public.provider_hours where provider_id = pid and dow = extract(dow from d)::int;
    if o is null then continue; end if;                                   -- ese día no atiende
    if exists (select 1 from public.bookings where provider_id = pid and source = 'block' and coalesce(service_name, '') like '🏖️%'
               and starts_at >= d::timestamp at time zone tz and starts_at < (d + 1)::timestamp at time zone tz) then continue; end if;
    for r in select b.id, b.client_id, b.client_name, b.service_name, b.starts_at, b.source, b.status, b.paid_mp + b.paid_wallet as paid,
                    coalesce(nullif(b.client_phone, ''), (select nullif(pc.phone, '') from public.provider_clients pc where pc.provider_id = pid and pc.user_id = b.client_id limit 1),
                             (select nullif(pf.phone, '') from public.profiles pf where pf.id = b.client_id)) as tel
             from public.bookings b
             where b.provider_id = pid and b.source in ('app','manual') and b.status in ('confirmed','hold')
               and b.starts_at >= d::timestamp at time zone tz and b.starts_at < (d + 1)::timestamp at time zone tz
             order by b.starts_at loop
      if r.status = 'hold' then
        update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second' where id = r.id;   -- no estaba pagado
        continue;
      end if;
      -- sin devolución automática: el prestador se encarga (devuelve la seña o reprograma)
      update public.bookings set status = 'cancelled_provider', refund_pending = 0, hold_expires_at = null,
             settle_by_provider = (r.source = 'app' and r.paid > 0) where id = r.id;
      perform public.stamp_refund(r.id);
      if r.source = 'app' then perform public.notify_booking(r.id, 'cancel'); end if;
      lst := lst || jsonb_build_object('id', r.id, 'name', r.client_name, 'service', r.service_name, 'day', to_char(d, 'YYYY-MM-DD'),
                                       'time', to_char(r.starts_at at time zone tz, 'HH24:MI'), 'app', r.client_id is not null, 'tel', r.tel, 'paid', r.paid);
    end loop;
    delete from public.bookings where provider_id = pid and source = 'block'
       and starts_at >= d::timestamp at time zone tz and starts_at < (d + 1)::timestamp at time zone tz;
    insert into public.bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at, price)
    values (pid, 'Día bloqueado', why, 'block', 'confirmed', (d + o) at time zone tz, (d + c) at time zone tz, 0);
    nb := nb + 1;
  end loop;
  return jsonb_build_object('blocked', nb, 'cancelled', lst);
end $$;

-- Comisión de TuTiempo de un turno pagado: la que se cobró (app_fee); en turnos muy viejos, el % sobre el precio.
create or replace function public.booking_fee(b public.bookings, rate numeric) returns int
language sql immutable as $$
  select case when b.app_fee > 0 or b.client_fee > 0 then b.app_fee else least(b.paid_mp, round(b.price * rate)::int) end
$$;

-- ---------- Panel de administración (solo admins: tabla app_admins) ----------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires';
        m0 timestamptz := date_trunc('month', now() at time zone tz) at time zone tz;      -- 1° del mes (hora Argentina)
        m1 timestamptz := (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz;
        p0 timestamptz := (date_trunc('month', now() at time zone tz) - interval '1 month') at time zone tz;
        p1 timestamptz := now() - interval '1 month';                                       -- mismo período del mes pasado
        rate numeric := public.commission(); r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  with b as (select * from public.bookings where source = 'app' and starts_at >= p0 - interval '1 day' and starts_at < m1 + interval '1 day'),
  fee as (select *, case when app_fee > 0 or client_fee > 0 then app_fee else least(paid_mp, round(price * rate)::int) end as fee from b)
  select jsonb_build_object(
    'commission_pct', (select commission_pct from public.app_settings where id),
    'providers_active', (select count(*) from public.providers where status = 'active'),
    'providers_pending', (select count(*) from public.providers where status = 'pending'),
    'providers_suspended', (select count(*) from public.providers where status = 'suspended'),
    'new_providers_month', (select count(*) from public.providers where created_at >= m0 and status <> 'deleted'),
    'clients', (select count(*) from public.profiles),
    'new_clients_month', (select count(*) from public.profiles where created_at >= m0),
    'bookings_month', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'bookings_prev', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    'gross_month', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'gross_prev', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    'deposits_month', (select coalesce(sum(paid_mp),0) from public.bookings where source = 'app' and paid_mp > 0 and created_at >= m0),
    'commission_month', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= m0),
    'commission_prev', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= p0 and created_at < p1),
    'no_show_month', (select count(*) from fee where status = 'no_show' and starts_at >= m0 and starts_at < m1),
    'cancelled_month', (select count(*) from fee where status = 'cancelled_client' and starts_at >= m0 and starts_at < m1),
    'mp_missing', (select count(*) from public.providers p join public.provider_private pp on pp.provider_id = p.id where p.status = 'active' and not pp.mp_connected),
    'stamp_cards', (select count(distinct s.provider_id) from public.services s join public.provider_settings st on st.provider_id = s.provider_id and st.stamps_on where s.stamp_goal is not null and s.active),
    'by_category', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select category_id, count(*) n from public.provider_categories where active group by 1) x),
    'by_category_month', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select s.category_id, count(*) n from fee f join public.services s on s.id = f.service_id
                           where f.status in ('confirmed','done','no_show') and f.starts_at >= m0 and f.starts_at < m1 group by 1) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n', coalesce(x.n,0), 'gross', coalesce(x.gross,0), 'fee', coalesce(x.fee,0)) order by d.day), '[]')
               from (select g::date as day from generate_series((now() at time zone tz)::date - 29, (now() at time zone tz)::date, interval '1 day') g) d
               left join (select (starts_at at time zone tz)::date as day, count(*) n, sum(price) gross, sum(fee) fee from fee
                          where status in ('confirmed','done','no_show') group by 1) x on x.day = d.day),
    'top', (select coalesce(jsonb_agg(t order by t.activity desc, t.id), '[]') from (
              select p.id, p.name, p.activity, p.photo_path, p.hue,
                     (select array_agg(pc.category_id order by pc.is_primary desc) from public.provider_categories pc where pc.provider_id = p.id) as cats
              from public.providers p where p.status = 'active' order by p.activity desc, p.id limit 5) t)
  ) into r;
  return r;
end $$;

create or replace function public.admin_providers(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select coalesce(jsonb_agg(x order by x.pending desc, x.activity desc, x.created_at desc), '[]') from (
    select p.id, p.name, p.slug, p.status, p.dni_verified, p.owner_id, p.created_at, p.rating_avg, p.rating_count, p.activity, (p.status = 'pending') as pending,
           (select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from public.provider_categories pc where pc.provider_id = p.id) as categories,
           (select count(*) from public.bookings b where b.provider_id = p.id and b.source = 'app' and b.status in ('confirmed','done') and b.starts_at >= date_trunc('month', now())) as bookings_month,
           (select pp.mp_connected from public.provider_private pp where pp.provider_id = p.id) as mp_connected,
           (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'body', n.body, 'at', n.created_at) order by n.created_at desc), '[]')
              from (select * from public.admin_notes an where an.provider_id = p.id order by an.created_at desc limit 30) n) as notes
    from public.providers p
    where p.status <> 'deleted' and (p_status is null or p.status = p_status)
    order by (p.status = 'pending') desc, p.activity desc, p.created_at desc limit 500) x);
end $$;

create or replace function public.admin_set_provider(pid bigint, p_status text, p_verified boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'bad_status'; end if;
  update public.providers set status = p_status, dni_verified = coalesce(p_verified, dni_verified), updated_at = now() where id = pid and status <> 'deleted';
end $$;

create or replace function public.admin_set_commission(p_pct numeric) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 30 then raise exception 'bad_commission'; end if;
  update public.app_settings set commission_pct = round(p_pct, 2), updated_at = now() where id;
  return round(p_pct, 2);
end $$;

-- ---------- Panel admin · notas privadas y baja de prestadores ----------
create or replace function public.admin_add_note(pid bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare txt text := left(btrim(regexp_replace(coalesce(p_body, ''), '[[:cntrl:]]', ' ', 'g')), 1000); nid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if txt = '' then raise exception 'empty_note'; end if;
  if not exists (select 1 from public.providers where id = pid) then raise exception 'not_found'; end if;
  if (select count(*) from public.admin_notes where provider_id = pid) >= 500 then raise exception 'too_many_notes'; end if;
  insert into public.admin_notes (provider_id, author, body) values (pid, auth.uid(), txt) returning id into nid;
  return nid;
end $$;

create or replace function public.admin_delete_note(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.admin_notes where id = p_id;
end $$;

-- El admin elimina un prestador: se cancelan sus turnos futuros (a los clientes se les devuelve todo y les llega el aviso),
-- deja de aparecer y su cuenta queda sin panel. No se puede deshacer.
create or replace function public.admin_delete_provider(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.providers where id = pid and status <> 'deleted') then raise exception 'not_found'; end if;
  r := public.provider_teardown(pid);
  insert into public.admin_notes (provider_id, author, body) values (pid, auth.uid(), 'Eliminado por el administrador.');
  return r;
end $$;

-- ---------- Panel admin · balance de TuTiempo (mes a mes y año a año) ----------
-- Números en vivo de un mes (hora Argentina). Cuenta lo cobrado por Mercado Pago que no se devolvió.
create or replace function public.admin_month_live(m date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires'; rate numeric := public.commission();
        m0 date := make_date(extract(year from m)::int, extract(month from m)::int, 1); m1 date; r jsonb;
begin
  m1 := (m0 + interval '1 month')::date;
  with b as (select x.*, public.booking_fee(x, rate) fee from public.bookings x
             where x.source = 'app' and x.paid_mp > 0 and (x.status in ('confirmed','done','no_show','cancelled_client') or (x.status = 'cancelled_provider' and x.settle_by_provider))
               and x.created_at >= (m0::timestamp at time zone tz) and x.created_at < (m1::timestamp at time zone tz))
  select jsonb_build_object(
    'bookings',   (select count(*) from b),
    'charged',    (select coalesce(sum(paid_mp + case when client_fee > 0 then fee else 0 end), 0) from b),
    'deposits',   (select coalesce(sum(paid_mp - case when client_fee > 0 then 0 else fee end), 0) from b),
    'commission', (select coalesce(sum(fee), 0) from b),
    'expenses',   (select coalesce(sum(amount), 0) from public.admin_expenses where day >= m0 and day < m1)) into r;
  return r;
end $$;

create or replace function public.admin_finance(p_year int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; y int := coalesce(p_year, extract(year from today)::int);
        ms jsonb := '[]'; m date; cj jsonb; v jsonb; ycl timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if y < 2024 or y > 2100 then raise exception 'bad_year'; end if;
  for m in select g::date from generate_series(make_date(y, 1, 1), make_date(y, 12, 1), interval '1 month') g loop
    select to_jsonb(ac) into cj from public.admin_closings ac where kind = 'month' and period = m;
    v := case when cj is not null then jsonb_build_object('bookings', cj->'bookings', 'charged', cj->'charged', 'deposits', cj->'deposits',
                                                          'commission', cj->'commission', 'expenses', cj->'expenses')
              when m > today then jsonb_build_object('bookings', 0, 'charged', 0, 'deposits', 0, 'commission', 0, 'expenses', 0)
              else public.admin_month_live(m) end;
    ms := ms || (v || jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'closed_at', cj->'closed_at',
                                         'state', case when cj is not null then 'closed' when m > today then 'future'
                                                       when (m + interval '1 month')::date > today then 'open' else 'ended' end));
  end loop;
  select closed_at into ycl from public.admin_closings where kind = 'year' and period = make_date(y, 1, 1);
  return jsonb_build_object('year', y, 'months', ms, 'year_closed_at', ycl, 'can_close_year', make_date(y + 1, 1, 1) <= today,
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'day', to_char(day, 'YYYY-MM-DD'), 'concept', concept, 'amount', amount) order by day desc, id desc), '[]')
                 from public.admin_expenses where day >= make_date(y, 1, 1) and day < make_date(y + 1, 1, 1)),
    'years', (select coalesce(jsonb_agg(jsonb_build_object('year', extract(year from period)::int, 'commission', commission, 'expenses', expenses,
                                                           'bookings', bookings, 'closed_at', closed_at) order by period), '[]')
              from public.admin_closings where kind = 'year'));
end $$;

-- Cerrar un mes (cuando terminó) o un año (cuando terminó: cierra también sus meses abiertos).
create or replace function public.admin_close(p_kind text, p_period date) returns void
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; m0 date := date_trunc('month', p_period)::date; m date; v jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'month' then
    if (m0 + interval '1 month')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'month' and period = m0) then raise exception 'already_closed'; end if;
    v := public.admin_month_live(m0);
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
    values ('month', m0, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint, (v->>'expenses')::bigint, auth.uid());
  elsif p_kind = 'year' then
    m0 := date_trunc('year', p_period)::date;
    if (m0 + interval '1 year')::date > today then raise exception 'period_not_over'; end if;
    if exists (select 1 from public.admin_closings where kind = 'year' and period = m0) then raise exception 'already_closed'; end if;
    for m in select g::date from generate_series(m0, (m0 + interval '11 months')::date, interval '1 month') g loop
      if not exists (select 1 from public.admin_closings where kind = 'month' and period = m) then
        v := public.admin_month_live(m);
        insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
        values ('month', m, (v->>'bookings')::int, (v->>'charged')::bigint, (v->>'deposits')::bigint, (v->>'commission')::bigint, (v->>'expenses')::bigint, auth.uid());
      end if;
    end loop;
    insert into public.admin_closings (kind, period, bookings, charged, deposits, commission, expenses, closed_by)
    select 'year', m0, sum(bookings), sum(charged), sum(deposits), sum(commission), sum(expenses), auth.uid()
      from public.admin_closings where kind = 'month' and period >= m0 and period < (m0 + interval '1 year')::date;
  else raise exception 'bad_kind'; end if;
end $$;

create or replace function public.admin_reopen(p_kind text, p_period date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'month' then
    if exists (select 1 from public.admin_closings where kind = 'year' and period = date_trunc('year', p_period)::date) then raise exception 'year_closed'; end if;
    delete from public.admin_closings where kind = 'month' and period = date_trunc('month', p_period)::date;
  elsif p_kind = 'year' then
    delete from public.admin_closings where kind = 'year' and period = date_trunc('year', p_period)::date;
  else raise exception 'bad_kind'; end if;
end $$;

-- Gastos de TuTiempo (no se pueden tocar en un mes cerrado)
create or replace function public.admin_add_expense(p_day date, p_concept text, p_amount int) returns bigint
language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; nid bigint;
        txt text := left(btrim(regexp_replace(coalesce(p_concept, ''), '[[:cntrl:]<>]', '', 'g')), 80);
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_day is null or p_day > today + 31 or p_day < make_date(2024, 1, 1) then raise exception 'bad_day'; end if;
  if txt = '' then raise exception 'empty_concept'; end if;
  if p_amount is null or p_amount < 1 or p_amount > 2000000000 then raise exception 'bad_amount'; end if;
  if exists (select 1 from public.admin_closings where kind = 'month' and period = date_trunc('month', p_day)::date) then raise exception 'month_closed'; end if;
  insert into public.admin_expenses (day, concept, amount, created_by) values (p_day, txt, p_amount, auth.uid()) returning id into nid;
  return nid;
end $$;

create or replace function public.admin_delete_expense(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select day into d from public.admin_expenses where id = p_id;
  if d is null then return; end if;
  if exists (select 1 from public.admin_closings where kind = 'month' and period = date_trunc('month', d)::date) then raise exception 'month_closed'; end if;
  delete from public.admin_expenses where id = p_id;
end $$;

-- ---------- Permisos de ejecución ----------
-- Cierre total: ninguna función se puede llamar desde la app salvo las de esta lista.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin(), public.my_provider(), public.owns_provider(bigint) to anon, authenticated;
grant execute on function public.commission() to anon, authenticated, service_role;
grant execute on function public.list_providers(text,text,text,double precision,bigint,int), public.category_counts(text),
  public.get_provider(bigint), public.provider_busy(bigint,date,date), public.next_free_slot(bigint,int)
  to anon, authenticated;
grant execute on function public.book_slot(bigint,timestamptz,int,int,text,bigint[],jsonb), public.cancel_by_client(bigint),
  public.cancel_by_provider(bigint), public.mark_booking(bigint,text),
  public.my_bookings(), public.send_client_messages(bigint[],text), public.my_messages(), public.mark_messages_read(),
  public.give_stamp(bigint,bigint), public.redeem_stamps(bigint,bigint), public.my_stamps(), public.block_days(date,date,text),
  public.admin_stats(), public.admin_providers(text), public.admin_set_provider(bigint,text,boolean), public.admin_set_commission(numeric),
  public.admin_add_note(bigint,text), public.admin_delete_note(bigint), public.admin_delete_provider(bigint), public.admin_finance(int),
  public.admin_close(text,date), public.admin_reopen(text,date), public.admin_add_expense(date,text,int), public.admin_delete_expense(bigint), public.register_provider(text,text,text[],text,text,text,text),
  public.delete_my_provider(), public.delete_my_account(), public.provider_finance(date,date),
  public.provider_month_totals(int), public.provider_occupancy(date,date)
  to authenticated;
-- confirm_payment, expire_holds, reshuffle_providers, link_client: solo service_role / cron.
revoke execute on function public.confirm_payment(bigint[],text,int), public.expire_holds(bigint),
  public.reshuffle_providers(), public.link_client(bigint,uuid,text), public.refresh_provider_search(bigint)
  from public, anon, authenticated;
grant execute on function public.confirm_payment(bigint[],text,int), public.expire_holds(bigint), public.reshuffle_providers(), public.purge_deleted_secrets(),
  public.refresh_activity(), public.send_scheduled_notices()
  to service_role;

-- ===================== 20261001000005_storage_seed.sql =====================
-- =====================================================================
-- TuTiempo · 0005 · Archivos (Storage), datos base y tareas programadas
-- =====================================================================
set search_path = public, extensions;

-- Fotos y videos de trabajos: lectura pública, escritura solo del dueño en su carpeta /<provider_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 15728640, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime'])
on conflict (id) do nothing;
-- DNI: privado. Sube el dueño en /<user_id>/..., lo ve solo un admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dni', 'dni', false, 8388608, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists media_upload on storage.objects;
create policy media_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_provider()::text);
drop policy if exists media_remove on storage.objects;
create policy media_remove on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = public.my_provider()::text);
drop policy if exists media_public on storage.objects;
create policy media_public on storage.objects for select using (bucket_id = 'media');
drop policy if exists dni_upload on storage.objects;
create policy dni_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'dni' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists dni_admin on storage.objects;
create policy dni_admin on storage.objects for select to authenticated
  using (bucket_id = 'dni' and public.is_admin());

-- Ciudad y rubros
insert into public.cities (slug, name) values ('olavarria', 'Olavarría') on conflict (slug) do nothing;
insert into public.categories (id, slug, name, sort) values
  ('b','barberias','Barberías',1), ('p','peluquerias','Peluquerías',2), ('m','masajes','Masajes',3),
  ('l','pestanas','Pestañas',4), ('u','unas','Uñas',5), ('d','depilacion','Depilación',6)
on conflict (id) do update set name = excluded.name, sort = excluded.sort;

-- Tareas programadas (requiere activar la extensión pg_cron en Supabase → Database → Extensions).
-- Si pg_cron no está activo, este bloque no hace nada y se puede correr después.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('tt-expire-holds', '* * * * *', 'select public.expire_holds(null)');
    perform cron.schedule('tt-reshuffle', '5 3 * * *', 'select public.reshuffle_providers(); select public.purge_deleted_secrets();');   -- también recalcula la actividad
    perform cron.schedule('tt-notices', '*/10 * * * *', 'select public.send_scheduled_notices()'); -- recordatorios y cumpleaños en la app
  end if;
end $$;

-- ---------- Fotos de perfil (clientes y prestadores) ----------
-- Público para mostrarlas; cada usuario solo escribe en su carpeta (su id). Solo imágenes, máximo 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists avatars_public on storage.objects;
create policy avatars_public on storage.objects for select using (bucket_id = 'avatars');
drop policy if exists avatars_upload on storage.objects;
create policy avatars_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and name ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$');
drop policy if exists avatars_remove on storage.objects;
create policy avatars_remove on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===================== 20261001000006_mercadopago.sql =====================
-- =====================================================================
-- TuTiempo · 0006 · Soporte para Mercado Pago (OAuth de prestadores)
-- Solo lo usan las Edge Functions con service_role. Sin políticas = nadie más lo ve.
-- =====================================================================
create table if not exists public.mp_oauth_states (
  state       text primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.mp_oauth_states enable row level security;
revoke all on public.mp_oauth_states from anon, authenticated;

-- v31: PKCE (código verificador por cada intento de conexión; solo lo leen las Edge Functions)
alter table public.mp_oauth_states add column if not exists code_verifier text;

-- ===================== 20261023044614_slugs_reservados.sql =====================
-- =====================================================================
-- TuTiempo · Bloque B · Slugs reservados
-- Las direcciones de la app (/panel, /admin, /cuenta…) no pueden ser el slug de un prestador. La lista es la misma que
-- src/lib/rutas.js (RESERVED_SLUGS); pruebas/test_db.py verifica que coincidan.
-- No cambia ningún dato: los prestadores que ya tengan un slug reservado siguen igual (la app los muestra en /p/<id>).
-- =====================================================================
create or replace function public.reserved_slugs() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'admin', 'api', 'assets', 'auth', 'ayuda', 'blog', 'buscar', 'contacto',
    'crear-cuenta', 'cuenta', 'demo', 'fonts', 'functions', 'ingresar', 'legal', 'login',
    'manifest', 'mis-turnos', 'nueva-contrasena', 'p', 'panel', 'prestadores', 'privacidad', 'registro',
    'reservar', 'rubro', 'sitemap', 'soporte', 'sumate', 'terminos', 'turno', 'turnos',
    'vendor', 'www'
  ]::text[]
$$;

create or replace function public.is_reserved_slug(p_slug text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_slug, '')) = any(public.reserved_slugs())
$$;

revoke execute on function public.reserved_slugs(), public.is_reserved_slug(text) from public;
grant execute on function public.reserved_slugs(), public.is_reserved_slug(text) to anon, authenticated;

-- Alta de prestador: igual que en 0004, salvo que saltea los slugs reservados.
create or replace function public.register_provider(p_name text, p_address text, p_categories text[], p_phone text,
                                                    p_dni text, p_instagram text default null, p_city text default 'olavarria')
returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); pid bigint; cid smallint; base text; sl text; n int := 0; c text; d int;
begin
  if uid is null then raise exception 'login_required'; end if;
  if exists (select 1 from public.providers where owner_id = uid) then raise exception 'already_registered'; end if;
  if p_categories is null or array_length(p_categories,1) is null then raise exception 'category_required'; end if;
  if array_length(p_categories,1) > 6 then raise exception 'too_many_categories'; end if;
  if p_dni !~ '^[0-9]{7,8}$' then raise exception 'bad_dni'; end if;
  select id into cid from public.cities where slug = p_city;
  if cid is null then raise exception 'bad_city'; end if;
  base := trim(both '-' from regexp_replace(lower(extensions.unaccent(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(base) < 3 then base := 'prestador'; end if;
  base := left(base, 50); sl := base;
  -- Bloque B: las palabras reservadas se tratan como un slug ocupado (llevan sufijo: panel → panel-1)
  while exists (select 1 from public.providers where slug = sl) or public.is_reserved_slug(sl) loop
    n := n + 1; sl := base || '-' || n;
  end loop;
  insert into public.providers (owner_id, slug, name, address, city_id, instagram, hue, status)
  values (uid, sl, left(p_name, 80), left(p_address, 160), cid, left(p_instagram, 60), (abs(hashtext(sl)) % 360), 'pending')
  returning id into pid;
  insert into public.provider_private (provider_id, phone, dni_number) values (pid, left(p_phone, 40), p_dni);
  insert into public.provider_settings (provider_id) values (pid);
  foreach c in array p_categories loop
    insert into public.provider_categories (provider_id, category_id) values (pid, c) on conflict do nothing;
  end loop;
  for d in 1 .. 5 loop
    insert into public.provider_hours values (pid, d, 1, '09:00', '12:00'), (pid, d, 2, '15:00', '21:00');
  end loop;
  insert into public.provider_hours values (pid, 6, 1, '09:00', '13:00');
  insert into public.message_templates (provider_id, key, enabled, body) values
   (pid,'conf',true,'¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.'),
   (pid,'r24',true,'{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¿Venís? Confirmá acá: {link}'),
   (pid,'r2',true,'¡Nos vemos a las {hora}! Si te demorás, avisá con un toque: {link}'),
   (pid,'rev',true,'¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? {link}'),
   (pid,'back',true,'{nombre}, ya te toca tu próximo turno. ¿Te reservo? Elegí tu horario: {link}'),
   (pid,'bday',false,'¡Feliz cumpleaños, {nombre}! Este mes tenés 15% off. Reservá: {link}');
  return pid;
end $$;

-- El alta directa en la tabla (permitida al dueño, ver 0003) tampoco puede usar un slug reservado.
-- "not valid": no revisa las filas que ya existen (no se toca ningún dato), solo las nuevas.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'providers_slug_not_reserved') then
    alter table public.providers add constraint providers_slug_not_reserved check (not public.is_reserved_slug(slug)) not valid;
  end if;
end $$;

do $$ declare r record; begin
  for r in select id, slug from public.providers where public.is_reserved_slug(slug) loop
    raise notice 'Prestador % tiene el slug reservado "%": la app lo muestra en /p/%', r.id, r.slug, r.id;
  end loop;
end $$;

-- ===================== 20261023185552_slugs_reservados_trigger.sql =====================
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

-- ===================== 20261023215124_cobros.sql =====================
-- =====================================================================
-- TuTiempo · Bloque 1 · Cobros sin plata en el limbo (H01 a H05, H23; decisiones D15 a D21)
-- - mp_accounts: una llave de Mercado Pago por prestador y cuenta. Solo la "active" crea cobros; las demás quedan
--   para devoluciones y consultas hasta que no hagan falta (después se borran solas).
-- - payments: cada pago aprobado, con la cuenta que lo cobró y lo que respondió Mercado Pago. payment_bookings: lo
--   que se cobró por cada turno. refunds: cada devolución, con sus intentos.
-- - confirm_payment nunca falla ante un pago aprobado: confirma lo que se puede y lo demás queda para devolver o
--   para revisar, siempre ligado al pago.
-- No borra datos: provider_secrets queda intacta y sin uso (D21); se copia a mp_accounts.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Estado nuevo del turno: el pago se devolvió (o hubo contracargo) desde Mercado Pago (D17, D18) ----------
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('hold','confirmed','done','no_show','cancelled_client','cancelled_provider','cancelled_refunded','expired'));

-- ---------- Cuentas de Mercado Pago (llaves) ----------
create table if not exists public.mp_accounts (
  id              bigint generated always as identity primary key,
  provider_id     bigint not null references public.providers(id) on delete cascade,
  mp_user_id      text check (char_length(mp_user_id) between 1 and 40),   -- null: cuenta de antes del Bloque 1 sin id
  status          text not null default 'active' check (status in ('active','refunds_only','purged')),
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  connected_at    timestamptz not null default now(),
  disconnected_at timestamptz,
  purged_at       timestamptz,
  refreshed_at    timestamptz,
  last_error      text check (char_length(last_error) <= 300),
  legacy          boolean not null default false,   -- copiada de provider_secrets (antes del Bloque 1)
  unique (provider_id, mp_user_id)
);
-- una sola cuenta que cobra por prestador
create unique index if not exists mp_accounts_one_active on public.mp_accounts (provider_id) where status = 'active';
create index if not exists mp_accounts_expiring on public.mp_accounts (expires_at) where status <> 'purged';
alter table public.mp_accounts enable row level security;
revoke all on public.mp_accounts from public, anon, authenticated;
grant select, insert, update on public.mp_accounts to service_role;

-- Las llaves de antes del Bloque 1 (provider_secrets) se copian una sola vez; provider_secrets no se toca (D21).
insert into public.mp_accounts (provider_id, mp_user_id, status, access_token, refresh_token, expires_at, disconnected_at, legacy)
select s.provider_id, nullif(pp.mp_user_id, ''),
       case when coalesce(pp.mp_connected, false) and p.status <> 'deleted' then 'active' else 'refunds_only' end,
       s.mp_access_token, s.mp_refresh_token, s.mp_expires_at,
       case when coalesce(pp.mp_connected, false) and p.status <> 'deleted' then null else now() end, true
from public.provider_secrets s
join public.providers p on p.id = s.provider_id
left join public.provider_private pp on pp.provider_id = s.provider_id
where s.mp_access_token is not null
  and not exists (select 1 from public.mp_accounts a where a.provider_id = s.provider_id);

-- provider_private.mp_connected y mp_user_id reflejan la cuenta que cobra (los leen el panel y el admin)
create or replace function public.mp_accounts_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid bigint := coalesce(new.provider_id, old.provider_id);
begin
  update public.provider_private pp set
    mp_connected = exists (select 1 from public.mp_accounts a where a.provider_id = pid and a.status = 'active'),
    mp_user_id = coalesce((select a.mp_user_id from public.mp_accounts a where a.provider_id = pid and a.status = 'active'), pp.mp_user_id)
  where pp.provider_id = pid;
  return null;
end $$;
drop trigger if exists mp_accounts_sync on public.mp_accounts;
create trigger mp_accounts_sync after insert or update of status, mp_user_id or delete on public.mp_accounts
  for each row execute function public.mp_accounts_sync();

-- ¿Puede cobrar hoy? (cuenta activa con llave vigente). No expone datos de la cuenta.
create or replace function public.provider_can_charge(pid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mp_accounts a where a.provider_id = pid and a.status = 'active'
                 and a.access_token is not null and (a.expires_at is null or a.expires_at > now()))
$$;

-- ---------- Pagos ----------
create table if not exists public.payments (
  id                 bigint generated always as identity primary key,
  mp_payment_id      text not null unique check (char_length(mp_payment_id) between 1 and 40),
  provider_id        bigint references public.providers(id) on delete restrict,
  mp_account_id      bigint references public.mp_accounts(id) on delete restrict,   -- la cuenta que cobró
  collector_id       text check (char_length(collector_id) <= 40),                  -- lo que informó Mercado Pago
  client_id          uuid references auth.users(id) on delete set null,
  booking_ids        bigint[] not null default '{}',     -- lo que vino en external_reference
  amount             integer not null check (amount >= 0),
  fee_expected       integer not null default 0 check (fee_expected >= 0),   -- comisión calculada por la base
  fee_mp             integer check (fee_mp >= 0),                            -- la que informó Mercado Pago (application_fee)
  refunded_mp        integer not null default 0 check (refunded_mp >= 0),    -- lo devuelto según Mercado Pago
  mp_status          text not null default 'approved' check (mp_status in ('approved','refunded','cancelled','charged_back','in_mediation')),
  mp_status_detail   text check (char_length(mp_status_detail) <= 60),
  outcome            text not null default 'confirmed' check (outcome in ('confirmed','partial','refund','review')),
  review_reasons     text[] not null default '{}',
  review_resolved_at timestamptz,
  review_resolved_by uuid references auth.users(id) on delete set null,
  review_note        text check (char_length(review_note) <= 500),
  mp_responses       jsonb not null default '[]' check (jsonb_typeof(mp_responses) = 'array'),   -- últimas consultas a MP, sin datos de tarjeta
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payments_provider on public.payments (provider_id, created_at desc);
create index if not exists payments_client on public.payments (client_id, created_at desc) where client_id is not null;
create index if not exists payments_account on public.payments (mp_account_id, created_at desc);
create index if not exists payments_review on public.payments (created_at) where outcome = 'review' and review_resolved_at is null;

-- Lo que se cobró por cada turno de un pago (seña + comisión): el tope de lo que se le puede devolver.
create table if not exists public.payment_bookings (
  payment_id bigint not null references public.payments(id) on delete restrict,
  booking_id bigint not null references public.bookings(id) on delete restrict,
  amount     integer not null check (amount >= 0),
  fee        integer not null default 0 check (fee >= 0),
  result     text not null check (result in ('confirmed','refund')),
  reason     text check (char_length(reason) <= 40),
  primary key (payment_id, booking_id)
);
create index if not exists payment_bookings_booking on public.payment_bookings (booking_id);

alter table public.bookings add column if not exists payment_id bigint references public.payments(id) on delete restrict;
create index if not exists bookings_payment on public.bookings (payment_id) where payment_id is not null;

-- ---------- Devoluciones ----------
create table if not exists public.refunds (
  id               bigint generated always as identity primary key,
  payment_id       bigint references public.payments(id) on delete restrict,
  booking_id       bigint references public.bookings(id) on delete restrict,
  provider_id      bigint references public.providers(id) on delete restrict,
  mp_payment_id    text check (char_length(mp_payment_id) <= 40),   -- el de payments o, en turnos viejos, bookings.mp_payment_id
  mp_account_id    bigint references public.mp_accounts(id) on delete restrict,   -- la cuenta que cobró
  amount           integer not null check (amount > 0),
  reason           text not null check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking')),
  status           text not null default 'pending' check (status in ('pending','done','failed','resolved','cancelled')),
  attempts         smallint not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at  timestamptz,
  next_attempt_at  timestamptz not null default now(),
  last_error       text check (char_length(last_error) <= 300),
  mp_refund_id     text check (char_length(mp_refund_id) <= 40),
  done_at          timestamptz,
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users(id) on delete set null,
  resolved_note    text check (char_length(resolved_note) <= 500),
  created_at       timestamptz not null default now(),
  check (payment_id is not null or booking_id is not null)
);
create index if not exists refunds_due on public.refunds (next_attempt_at) where status = 'pending';
create index if not exists refunds_payment on public.refunds (payment_id);
create index if not exists refunds_booking on public.refunds (booking_id);
create index if not exists refunds_account on public.refunds (mp_account_id) where status in ('pending','failed');

-- Nunca devolver más de lo cobrado: ni más que el pago, ni más que lo cobrado por cada turno.
-- Cuentan todas menos las anuladas ('cancelled'): una fallida se puede reintentar y una resuelta a mano ya se arregló.
create or replace function public.refunds_cap() returns trigger
language plpgsql security definer set search_path = public as $$
declare cap int; used int;
begin
  if new.status = 'cancelled' then return new; end if;
  if new.payment_id is not null then
    perform 1 from public.payments where id = new.payment_id for update;
    select amount into cap from public.payments where id = new.payment_id;
    select coalesce(sum(amount), 0) into used from public.refunds
     where payment_id = new.payment_id and status <> 'cancelled' and id is distinct from new.id;
    if used + new.amount > cap then raise exception 'refund_exceeds_payment' using errcode = 'check_violation'; end if;
    if new.booking_id is not null then
      select amount into cap from public.payment_bookings where payment_id = new.payment_id and booking_id = new.booking_id;
      select coalesce(sum(amount), 0) into used from public.refunds
       where payment_id = new.payment_id and booking_id = new.booking_id and status <> 'cancelled' and id is distinct from new.id;
      if cap is null or used + new.amount > cap then raise exception 'refund_exceeds_booking' using errcode = 'check_violation'; end if;
    end if;
  else
    -- turno de antes del Bloque 1: el tope es lo que se cobró por ese turno
    perform 1 from public.bookings where id = new.booking_id for update;
    select paid_mp + app_fee into cap from public.bookings where id = new.booking_id;
    select coalesce(sum(amount), 0) into used from public.refunds
     where booking_id = new.booking_id and payment_id is null and status <> 'cancelled' and id is distinct from new.id;
    if cap is null or used + new.amount > cap then raise exception 'refund_exceeds_booking' using errcode = 'check_violation'; end if;
  end if;
  return new;
end $$;
drop trigger if exists refunds_cap on public.refunds;
create trigger refunds_cap before insert or update of amount, status, payment_id, booking_id on public.refunds
  for each row execute function public.refunds_cap();

-- RLS: el cliente ve los suyos, el prestador los de su agenda, el admin todo. Solo escriben las funciones del servidor.
alter table public.payments enable row level security;
alter table public.payment_bookings enable row level security;
alter table public.refunds enable row level security;
revoke all on public.payments, public.payment_bookings, public.refunds from public, anon, authenticated;
grant select (id, mp_payment_id, provider_id, client_id, booking_ids, amount, fee_expected, refunded_mp, mp_status, outcome, created_at)
  on public.payments to authenticated;
grant select on public.payment_bookings to authenticated;
grant select (id, payment_id, booking_id, provider_id, amount, reason, status, done_at, created_at) on public.refunds to authenticated;
grant select, insert, update on public.payments, public.payment_bookings, public.refunds to service_role;
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (client_id = (select auth.uid()) or provider_id = (select public.my_provider()) or (select public.is_admin()));
drop policy if exists payment_bookings_read on public.payment_bookings;
create policy payment_bookings_read on public.payment_bookings for select to authenticated
  using (exists (select 1 from public.payments p where p.id = payment_id
                 and (p.client_id = (select auth.uid()) or p.provider_id = (select public.my_provider()) or (select public.is_admin()))));
drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin())
         or exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = (select auth.uid())));

-- ---------- Avisos al prestador (pagos devueltos desde Mercado Pago, contracargos, reclamos) ----------
create table if not exists public.provider_notices (
  id          bigint generated always as identity primary key,
  provider_id bigint not null references public.providers(id) on delete cascade,
  kind        text not null check (kind in ('mp_refunded','mp_charged_back','mp_in_mediation')),
  ref         text not null check (char_length(ref) <= 40),
  body        text not null check (char_length(body) between 1 and 600),
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (provider_id, kind, ref)
);
alter table public.provider_notices enable row level security;
revoke all on public.provider_notices from public, anon, authenticated;
grant select on public.provider_notices to authenticated;
grant select, insert, update on public.provider_notices to service_role;
drop policy if exists provider_notices_read on public.provider_notices;
create policy provider_notices_read on public.provider_notices for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin()));

alter table public.client_messages drop constraint if exists client_messages_kind_check;
alter table public.client_messages add constraint client_messages_kind_check
  check (kind in ('msg','conf','r24','r2','rev','bday','cancel'));

-- ---------- Ayudas ----------
create or replace function public.money_txt(n int) returns text language sql immutable as $$
  select '$' || replace(to_char(coalesce(n, 0), 'FM999,999,999'), ',', '.')
$$;
-- "sábado 24/10 a las 17:30" en la hora del prestador
create or replace function public.booking_when(bid bigint) returns text
language sql stable security definer set search_path = public as $$
  select (array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'])[extract(dow from lt)::int + 1] || ' ' ||
         extract(day from lt)::int || '/' || extract(month from lt)::int || ' a las ' || to_char(lt, 'HH24:MI')
  from (select b.starts_at at time zone public.provider_tz(b.provider_id) as lt from public.bookings b where b.id = bid) x
$$;
-- respuesta de Mercado Pago sin datos de tarjeta ni del documento del pagador
create or replace function public.mp_clean(p jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p) <> 'object' then null else
    (p - 'card' - 'barcode' - 'transaction_details' ||
     case when jsonb_typeof(p->'payer') = 'object' then jsonb_build_object('payer', (p->'payer') - 'identification' - 'phone' - 'first_name' - 'last_name') else '{}'::jsonb end)
  end
$$;
-- guarda la consulta en el pago (las últimas 20)
create or replace function public.payment_log(p_id bigint, p_raw jsonb) returns void
language sql security definer set search_path = public as $$
  update public.payments set
    mp_responses = (select coalesce(jsonb_agg(e order by n), '[]') from (
                      select e, n from jsonb_array_elements(mp_responses || jsonb_build_array(jsonb_build_object('at', now(), 'body', public.mp_clean(p_raw))))
                        with ordinality as t(e, n)
                      order by n desc limit 20) last20),
    updated_at = now()
  where id = p_id and p_raw is not null and jsonb_typeof(p_raw) = 'object'
$$;

-- Pide una devolución: suma al turno lo que falta devolver y crea la fila en refunds, ligada al pago y a la cuenta
-- que cobró. Turnos de antes del Bloque 1: usa bookings.mp_payment_id (el del turno o el del primero de su serie).
create or replace function public.refund_request(p_booking bigint, p_payment bigint, p_amount int, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare b record; pay_id bigint := p_payment; mpid text; acct bigint; pid bigint; rid bigint;
begin
  if coalesce(p_amount, 0) <= 0 then return null; end if;
  if p_booking is not null then
    select * into b from public.bookings where id = p_booking;
    pay_id := coalesce(pay_id, b.payment_id);
    pid := b.provider_id;
  end if;
  if pay_id is not null then
    select mp_payment_id, mp_account_id, coalesce(pid, provider_id) into mpid, acct, pid from public.payments where id = pay_id;
  elsif b.id is not null then
    mpid := coalesce(b.mp_payment_id, (select x.mp_payment_id from public.bookings x
                                        where b.series_id is not null and x.series_id = b.series_id and x.mp_payment_id is not null
                                        order by x.starts_at limit 1));
    -- la llave de antes del Bloque 1 es la que cobró esos turnos; si no está, la activa
    acct := (select a.id from public.mp_accounts a where a.provider_id = b.provider_id and a.status <> 'purged'
             order by a.legacy desc, (a.status = 'active') desc, a.connected_at desc limit 1);
  end if;
  insert into public.refunds (payment_id, booking_id, provider_id, mp_payment_id, mp_account_id, amount, reason, status, last_error)
  values (pay_id, p_booking, pid, mpid, acct, p_amount, p_reason,
          case when mpid is null then 'failed' else 'pending' end,
          case when mpid is null then 'No hay un pago de Mercado Pago ligado a este turno' end)
  returning id into rid;
  if p_booking is not null then
    update public.bookings set refund_pending = refund_pending + p_amount where id = p_booking;
  end if;
  return rid;
end $$;

-- ---------- Confirmar un pago aprobado (lo llama SOLO el webhook, con service_role) ----------
drop function if exists public.confirm_payment(bigint[], text, int);
create or replace function public.confirm_payment(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                  p_provider bigint default null, p_account bigint default null,
                                                  p_fee_mp int default null, p_collector text default null,
                                                  p_raw jsonb default null, p_status_detail text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; pay_id bigint; pid bigint;
begin
  if coalesce(p_payment_id, '') = '' then raise exception 'bad_payment'; end if;
  -- el mismo aviso dos veces: no se hace nada (solo se guarda la consulta)
  select id, outcome into prev from public.payments where mp_payment_id = p_payment_id;
  if prev.id is not null then
    perform public.payment_log(prev.id, p_raw);
    return jsonb_build_object('status', 'already_processed', 'payment', prev.id, 'outcome', prev.outcome);
  end if;
  -- pagos confirmados antes del Bloque 1 (quedaron en bookings.mp_payment_id)
  if exists (select 1 from public.bookings where mp_payment_id = p_payment_id) then
    return jsonb_build_object('status', 'already_processed');
  end if;
  begin
    return public.confirm_payment_core(p_booking_ids, p_payment_id, p_amount, p_provider, p_account, p_fee_mp, p_collector, p_raw, p_status_detail);
  exception when others then
    -- nunca falla ante un pago aprobado: queda registrado para revisar, con el error
    pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(coalesce(p_booking_ids, '{}'))));
    insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, booking_ids, amount, outcome, review_reasons, mp_status_detail)
    values (p_payment_id, pid, p_account, left(p_collector, 40), coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review',
            array['error: ' || left(sqlerrm, 200)], left(p_status_detail, 60))
    on conflict (mp_payment_id) do nothing
    returning id into pay_id;
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'review', 'payment', pay_id, 'error', sqlerrm);
  end;
end $$;

create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; short boolean; why text;
        reasons text[] := '{}'; ok int := 0; back int := 0; first_ok bigint;
begin
  pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(ids)));
  acct := coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active'));
  -- lo que se debía: seña + comisión de los turnos de ESTE prestador que vinieron en el pago
  select sum(deposit + client_fee - paid_wallet), sum(client_fee), min(client_id::text)::uuid, min(client_name)
    into due, fee_exp, uid, nm
    from public.bookings where id = any(ids) and provider_id = pid and source = 'app';
  due := coalesce(due, 0); fee_exp := coalesce(fee_exp, 0);
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.bookings b where b.id = x and b.provider_id = pid and b.source = 'app')) then
    reasons := array_append(reasons, 'other_provider');      -- turnos de otro prestador o que no existen: no se tocan
  end if;
  -- comisión: la que informa Mercado Pago tiene que ser la calculada por la base
  if fee_exp > 0 and p_fee_mp is null then reasons := array_append(reasons, 'fee_missing');
  elsif p_fee_mp is not null and p_fee_mp <> fee_exp then reasons := array_append(reasons, 'fee_mismatch'); end if;
  short := left_amt < due;                       -- D16: llegó menos → no se confirma nada y se devuelve todo
  if left_amt > due and due > 0 then reasons := array_append(reasons, 'amount_over'); end if;   -- D16: llegó más → se confirma y la diferencia se revisa

  insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, client_id, booking_ids, amount, fee_expected, fee_mp, mp_status_detail)
  values (p_payment_id, pid, acct, left(p_collector, 40), uid, ids, left_amt, fee_exp, p_fee_mp, left(p_status_detail, 60))
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);

  for r in select * from public.bookings where id = any(ids) and provider_id = pid and source = 'app' order by starts_at for update loop
    pay := least(left_amt, r.deposit + r.client_fee - r.paid_wallet); left_amt := left_amt - pay;
    fee_part := least(pay, r.client_fee);
    why := null;
    if short then
      why := 'amount_short';
    elsif r.status not in ('hold', 'expired') or r.payment_id is not null then
      why := 'booking_unavailable';             -- cancelado (por el prestador, un bloqueo, una baja) o ya pagado por otro pago
    else
      begin
        update public.bookings set status = 'confirmed', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part, app_fee = fee_part
         where id = r.id;
        ok := ok + 1; first_ok := coalesce(first_ok, r.id);
      exception when exclusion_violation then
        why := 'slot_taken';                     -- el hold venció y otro tomó el horario
      end;
    end if;
    insert into public.payment_bookings (payment_id, booking_id, amount, fee, result, reason)
    values (pay_id, r.id, pay, fee_part, case when why is null then 'confirmed' else 'refund' end, why);
    if why is not null and pay > 0 then
      if r.status in ('hold', 'expired') and r.payment_id is null then
        -- el turno queda como "canceló el prestador" con lo cobrado, como en la v31 (el cliente ve que se le devuelve)
        update public.bookings set status = case when why = 'slot_taken' then 'cancelled_provider' else 'expired' end,
               hold_expires_at = null, payment_id = pay_id, paid_mp = pay - fee_part, app_fee = fee_part
         where id = r.id;
      end if;
      perform public.refund_request(r.id, pay_id, pay, why);
      back := back + 1;
    end if;
  end loop;
  -- nada de este prestador en el pago: se devuelve todo lo cobrado (sin turno)
  if not exists (select 1 from public.payment_bookings where payment_id = pay_id) and left_amt > 0 then
    perform public.refund_request(null, pay_id, left_amt, 'unknown_booking');
    left_amt := 0;
  end if;

  update public.payments set
    outcome = case when cardinality(reasons) > 0 then 'review' when ok > 0 and back = 0 then 'confirmed' when ok > 0 then 'partial' else 'refund' end,
    review_reasons = reasons, updated_at = now()
   where id = pay_id;
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;

-- ---------- Cambios de estado del pago en Mercado Pago (D17, D18) ----------
-- p_status: approved (con o sin devoluciones parciales), refunded, cancelled, charged_back, in_mediation.
create or replace function public.payment_mp_update(p_payment_id text, p_status text, p_refunded int default 0,
                                                    p_status_detail text default null, p_raw jsonb default null,
                                                    p_provider bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pm record; r record; ours int; done_sum int; pend_sum int; n int := 0; reasons text[]; pay_id bigint; prov_name text; txt text;
        refd int := greatest(coalesce(p_refunded, 0), 0);
begin
  if p_status not in ('approved','refunded','cancelled','charged_back','in_mediation') then raise exception 'bad_status'; end if;
  select * into pm from public.payments where mp_payment_id = p_payment_id for update;
  if pm.id is null then
    -- aviso de un pago que no está registrado (por ejemplo, de antes del Bloque 1): queda para revisar
    if p_status = 'approved' then return jsonb_build_object('status', 'unknown_payment'); end if;
    insert into public.payments (mp_payment_id, provider_id, amount, mp_status, mp_status_detail, refunded_mp, outcome, review_reasons)
    values (p_payment_id, coalesce(p_provider, (select provider_id from public.bookings where mp_payment_id = p_payment_id)),
            0, p_status, left(p_status_detail, 60), refd, 'review', array['unregistered_' || p_status])
    on conflict (mp_payment_id) do nothing returning id into pay_id;
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'review', 'payment', pay_id);
  end if;
  perform public.payment_log(pm.id, p_raw);
  select coalesce(sum(amount) filter (where status in ('done','resolved')), 0), coalesce(sum(amount) filter (where status in ('pending','failed')), 0)
    into done_sum, pend_sum from public.refunds where payment_id = pm.id;
  reasons := pm.review_reasons;
  select name into prov_name from public.providers where id = pm.provider_id;

  if p_status = 'approved' then
    -- devolución parcial: tiene que coincidir con las de la app (hechas, o hechas + en curso)
    if refd > 0 and refd <> done_sum and refd <> done_sum + pend_sum and not ('partial_refund_mismatch' = any(reasons)) then
      reasons := array_append(reasons, 'partial_refund_mismatch');
    end if;
    update public.payments set refunded_mp = refd, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons,
           outcome = case when cardinality(reasons) > cardinality(pm.review_reasons) then 'review' else outcome end, updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;
  if pm.mp_status = p_status then return jsonb_build_object('status', 'already_processed', 'payment', pm.id); end if;

  if p_status = 'in_mediation' then
    reasons := array_append(reasons, 'in_mediation');
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, 'mp_in_mediation', p_payment_id,
            'El cliente abrió un reclamo en Mercado Pago por el pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) ||
            '). Respondelo desde tu cuenta de Mercado Pago. Tus turnos siguen como están.')
    on conflict do nothing;
    update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons, outcome = 'review', updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;

  -- refunded / cancelled / charged_back: Mercado Pago ya le devolvió la plata al cliente.
  -- Si la app ya había pedido devolver todo, el aviso es la confirmación de esas devoluciones.
  ours := done_sum + pend_sum;
  if p_status = 'charged_back' then reasons := array_append(reasons, 'charged_back'); end if;
  for r in select * from public.bookings where payment_id = pm.id and status = 'confirmed' and starts_at > now() order by starts_at for update loop
    update public.bookings set status = 'cancelled_refunded', hold_expires_at = null where id = r.id;
    perform public.stamp_refund(r.id);
    n := n + 1;
    if r.client_id is not null then
      txt := case when p_status = 'charged_back'
                  then 'Por el contracargo de tu pago en Mercado Pago, tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado.'
                  else 'Mercado Pago te devolvió el pago, así que tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado. Si querés, reservá de nuevo.' end;
      insert into public.client_messages (provider_id, user_id, body, kind, ref)
      values (r.provider_id, r.client_id, left(txt, 600), 'cancel', r.id::text) on conflict do nothing;
    end if;
  end loop;
  -- las devoluciones que la app tenía en curso: si cubrían todo el pago, son las que Mercado Pago acaba de informar (hechas);
  -- si no, ya no hacen falta (Mercado Pago devolvió el pago entero)
  for r in update public.refunds set status = case when ours >= pm.amount then 'done' else 'cancelled' end,
                  done_at = case when ours >= pm.amount then now() end,
                  last_error = case when ours >= pm.amount then null else 'Mercado Pago ya devolvió el pago (' || p_status || ')' end
            where payment_id = pm.id and status in ('pending','failed') returning booking_id, amount loop
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
  end loop;
  if p_status = 'charged_back' or ours < pm.amount then
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, case when p_status = 'charged_back' then 'mp_charged_back' else 'mp_refunded' end, p_payment_id,
            case when p_status = 'charged_back'
                 then 'El cliente pidió un contracargo del pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') a su banco.'
                 else 'El pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') se devolvió desde Mercado Pago.' end ||
            case when n > 0 then ' Se cancel' || case when n = 1 then 'ó 1 turno futuro' else 'aron ' || n || ' turnos futuros' end || ' de ese pago.' else '' end)
    on conflict do nothing;
  end if;
  update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), refunded_mp = greatest(refd, refunded_mp),
         review_reasons = reasons, outcome = case when cardinality(reasons) > 0 then 'review' else outcome end, updated_at = now()
   where id = pm.id;
  return jsonb_build_object('status', 'ok', 'payment', pm.id, 'cancelled', n, 'ours', ours >= pm.amount);
end $$;

-- ---------- Ejecución de devoluciones (mp-refunds) ----------
-- Devoluciones que tocan ahora, con el id de pago y la cuenta que cobró (la llave la busca la función).
create or replace function public.refunds_due(p_limit int default 50)
returns table (id bigint, amount int, mp_payment_id text, mp_account_id bigint, provider_id bigint, attempts smallint)
language sql stable security definer set search_path = public as $$
  select r.id, r.amount, r.mp_payment_id, r.mp_account_id, r.provider_id, r.attempts from public.refunds r
  where r.status = 'pending' and r.next_attempt_at <= now()
  order by r.next_attempt_at, r.id limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Resultado de cada intento. Si falla, se reintenta con backoff (D19): 10 min, 30 min, 1 h, 3 h, 6 h, 12 h y después cada
-- 24 h; cuando el próximo intento caería después de los 3 días del primero, queda como fallida.
create or replace function public.refund_result(p_refund bigint, p_ok boolean, p_mp_refund_id text default null, p_error text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare r record; nxt timestamptz; first_at timestamptz;
begin
  select * into r from public.refunds where id = p_refund for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'pending' then return r.status; end if;
  if p_ok then
    update public.refunds set status = 'done', done_at = now(), mp_refund_id = left(p_mp_refund_id, 40), attempts = attempts + 1,
           first_attempt_at = coalesce(first_attempt_at, now()), last_attempt_at = now(), last_error = null
     where id = r.id;
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
    return 'done';
  end if;
  first_at := coalesce(r.first_attempt_at, now());
  nxt := now() + case r.attempts + 1 when 1 then interval '10 minutes' when 2 then interval '30 minutes' when 3 then interval '1 hour'
                                     when 4 then interval '3 hours' when 5 then interval '6 hours' when 6 then interval '12 hours'
                                     else interval '24 hours' end;
  update public.refunds set attempts = attempts + 1, first_attempt_at = first_at, last_attempt_at = now(),
         last_error = left(coalesce(p_error, 'Error sin detalle'), 300),
         next_attempt_at = nxt, status = case when nxt > first_at + interval '3 days' then 'failed' else 'pending' end
   where id = r.id;
  return case when nxt > first_at + interval '3 days' then 'failed' else 'pending' end;
end $$;

-- ---------- Conectar y desconectar Mercado Pago ----------
-- Lo llama mp-oauth al volver de Mercado Pago. La misma cuenta actualiza su llave; otra cuenta crea una fila nueva y la
-- anterior queda para devoluciones y consultas (nunca se pisa la llave de otra cuenta).
create or replace function public.mp_connect(p_provider bigint, p_mp_user_id text, p_access text, p_refresh text, p_expires_in int)
returns bigint
language plpgsql security definer set search_path = public as $$
declare acct bigint; uidtxt text := nullif(left(btrim(coalesce(p_mp_user_id, '')), 40), '');
begin
  if not exists (select 1 from public.providers where id = p_provider and status <> 'deleted') then raise exception 'not_found'; end if;
  if coalesce(p_access, '') = '' then raise exception 'bad_token'; end if;
  if uidtxt is null then raise exception 'bad_account'; end if;
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now()
   where provider_id = p_provider and status = 'active' and mp_user_id is distinct from uidtxt;
  insert into public.mp_accounts as a (provider_id, mp_user_id, status, access_token, refresh_token, expires_at, connected_at, refreshed_at)
  values (p_provider, uidtxt, 'active', p_access, p_refresh,
          case when p_expires_in > 0 then now() + make_interval(secs => p_expires_in) end, now(), now())
  on conflict (provider_id, mp_user_id) do update set status = 'active', access_token = excluded.access_token,
     refresh_token = coalesce(excluded.refresh_token, a.refresh_token), expires_at = excluded.expires_at,
     connected_at = now(), refreshed_at = now(), disconnected_at = null, purged_at = null, last_error = null
  returning id into acct;
  return acct;
end $$;

-- El prestador desconecta: deja de cobrar en el acto. Las reservas en pago que todavía no fueron a Mercado Pago se
-- liberan; las que ya tienen el cobro creado siguen hasta vencer (si se pagan, confirm_payment las procesa).
create or replace function public.mp_disconnect() returns jsonb
language plpgsql security definer set search_path = public as $$
declare pid bigint := public.my_provider(); n int;
begin
  if pid is null then raise exception 'not_provider'; end if;
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now() where provider_id = pid and status = 'active';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'mp_not_connected'; end if;
  update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 second'
   where provider_id = pid and status = 'hold' and mp_preference_id is null;
  return public.my_mp_status();
end $$;

-- Lo que ve el prestador: si puede cobrar hoy y lo que todavía depende de cuentas anteriores.
create or replace function public.my_mp_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'can_charge', public.provider_can_charge(x.pid),
    'account', (select a.mp_user_id from public.mp_accounts a where a.provider_id = x.pid and a.status = 'active'),
    'expired', exists (select 1 from public.mp_accounts a where a.provider_id = x.pid and a.status = 'active' and a.expires_at <= now()),
    'old_accounts', (select count(*) from public.mp_accounts a where a.provider_id = x.pid and a.status = 'refunds_only'),
    'future_paid', (select count(*) from public.bookings b where b.provider_id = x.pid and b.status = 'confirmed' and b.source = 'app'
                     and b.starts_at > now() and b.paid_mp > 0),
    'paying_now', (select count(*) from public.bookings b where b.provider_id = x.pid and b.status = 'hold'
                    and b.mp_preference_id is not null and b.hold_expires_at > now()),
    'refunds_pending', (select count(*) from public.refunds r where r.provider_id = x.pid and r.status in ('pending','failed')))
  from (select public.my_provider() as pid) x where x.pid is not null
$$;

-- Llave que venció y no se pudo renovar (lo llaman las funciones de Mercado Pago)
create or replace function public.mp_account_error(p_account bigint, p_error text, p_expired boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.mp_accounts set last_error = left(p_error, 300),
         status = case when p_expired and status = 'active' then 'refunds_only' else status end,
         disconnected_at = case when p_expired and status = 'active' then now() else disconnected_at end
  where id = p_account
$$;

-- Borra las llaves que ya no hacen falta: cuentas desconectadas (o de prestadores eliminados) sin reservas en pago,
-- sin turnos futuros pagados con esa cuenta, sin devoluciones pendientes o fallidas y sin pagos de los últimos 180 días
-- (contracargos y reclamos). La fila queda (sin llave) para saber qué cuenta cobró cada pago.
create or replace function public.purge_mp_accounts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.mp_accounts a set status = 'refunds_only', disconnected_at = now()
    from public.providers p where p.id = a.provider_id and p.status = 'deleted' and a.status = 'active';
  with gone as (
    update public.mp_accounts a set status = 'purged', access_token = null, refresh_token = null, purged_at = now()
    where a.status = 'refunds_only'
      and not exists (select 1 from public.bookings b where b.provider_id = a.provider_id and b.status = 'hold'
                      and b.mp_preference_id is not null and b.hold_expires_at > now() - interval '1 hour')
      and not exists (select 1 from public.bookings b join public.payments p on p.id = b.payment_id
                      where p.mp_account_id = a.id and b.status = 'confirmed' and b.starts_at > now() and b.paid_mp > 0)
      and not exists (select 1 from public.refunds r where r.mp_account_id = a.id and r.status in ('pending','failed'))
      and not exists (select 1 from public.payments p where p.mp_account_id = a.id and p.created_at > now() - interval '180 days')
      -- turnos de antes del Bloque 1 (sin payments): los cobró la llave copiada de provider_secrets
      and not (a.legacy and exists (select 1 from public.bookings b where b.provider_id = a.provider_id and b.payment_id is null
                      and b.mp_payment_id is not null and (b.created_at > now() - interval '180 days' or b.refund_pending > 0
                           or (b.status = 'confirmed' and b.starts_at > now()))))
    returning 1)
  select count(*)::int into n from gone;
  return n;
end $$;
-- nombre viejo (lo llama el cron de 0005): desde el Bloque 1 no toca provider_secrets (D21)
create or replace function public.purge_deleted_secrets() returns int
language sql security definer set search_path = public as $$ select public.purge_mp_accounts() $$;

-- ---------- Reservar: D15 y prestador que no puede cobrar ----------
create or replace function public.book_slot(p_service bigint, p_start timestamptz, p_repeat_weeks int default 0,
                                            p_extra int default 0, p_pay text default 'mp',
                                            p_addons bigint[] default '{}', p_intake jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); s record; p record; st record; tz text; nm text;
  i int; t timestamptz; lt timestamp; disc smallint; v_price int; dep int; v_fee int; v_full boolean;
  ids bigint[] := '{}'; deps int[] := '{}'; total int := 0; bal int; w int := 0; left_w int; pay int;
  sid uuid := case when coalesce(p_extra,0) > 0 then gen_random_uuid() end; bid bigint; skipped int := 0;
  ad_ids bigint[] := array(select distinct x from unnest(coalesce(p_addons,'{}')) x where x is not null);
  ad_price int := 0; ad_min int := 0; ad_json jsonb := '[]'; ad_n int := 0; dur int; v_intake jsonb := '{}';
  v_cash boolean := coalesce(p_pay,'mp') = 'cash'; v_reward boolean := coalesce(p_pay,'mp') = 'reward'; v_have int;
begin
  if uid is null then raise exception 'login_required' using errcode = '28000'; end if;
  if coalesce(p_pay,'mp') not in ('mp','cash','reward') then raise exception 'bad_pay'; end if;
  if coalesce(p_repeat_weeks,0) not in (0,1,2,3,4,6) or coalesce(p_extra,0) not between 0 and 3
     or (coalesce(p_extra,0) > 0 and coalesce(p_repeat_weeks,0) = 0) then raise exception 'bad_repeat'; end if;
  if cardinality(ad_ids) > 10 then raise exception 'bad_addon'; end if;
  select * into s from public.services where id = p_service and active;
  if s is null then raise exception 'service_not_found'; end if;
  select * into p from public.providers where id = s.provider_id and status = 'active';
  if p is null then raise exception 'provider_not_available'; end if;
  select * into st from public.provider_settings where provider_id = p.id;
  if st is null or not st.online then raise exception 'online_booking_off'; end if;
  -- anti-abuso: nadie puede "acaparar" horarios con reservas sin pagar
  if (select count(*) from public.bookings where client_id = uid and status = 'hold' and hold_expires_at > now()) >= 5 then
    raise exception 'too_many_holds';
  end if;
  if (select count(*) from public.bookings where client_id = uid and source = 'app' and status in ('hold','expired') and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_attempts';
  end if;
  -- adicionales: solo los de ESTE servicio; precio y minutos salen de la base
  if cardinality(ad_ids) > 0 then
    select count(*), coalesce(sum(price),0), coalesce(sum(duration_min),0),
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'price', price, 'min', duration_min) order by sort, id), '[]')
      into ad_n, ad_price, ad_min, ad_json
      from public.service_addons where id = any(ad_ids) and service_id = s.id and active;
    if ad_n <> cardinality(ad_ids) then raise exception 'bad_addon'; end if;
  end if;
  dur := s.duration_min + ad_min;
  if dur > 480 then raise exception 'bad_addon'; end if;
  -- preguntas previas: solo texto corto, claves simples, máximo 12
  if jsonb_typeof(coalesce(p_intake,'{}')) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}') into v_intake from (
      select key as k, left(regexp_replace(value #>> '{}', '[[:cntrl:]]', ' ', 'g'), 200) as v
      from jsonb_each(p_intake)
      where key ~ '^[a-z_]{1,20}$' and jsonb_typeof(value) in ('string','number','boolean')
      limit 12) x;
  end if;
  tz := public.provider_tz(p.id);
  select coalesce(nullif(full_name,''),'Cliente') into nm from public.profiles where id = uid;
  perform public.expire_holds(p.id);
  v_full := false;   -- el que faltó perdió su seña: no se le cobra el total en las próximas reservas
  -- premio de la tarjeta de sellos: ese mismo servicio gratis, con SU tarjeta llena, sin repetir
  if v_reward then
    if coalesce(p_extra,0) > 0 or cardinality(ad_ids) > 0 then raise exception 'bad_repeat'; end if;
    if not st.stamps_on or s.stamp_goal is null then raise exception 'reward_not_available'; end if;
    select stamps into v_have from public.loyalty_cards where provider_id = p.id and user_id = uid and service_id = s.id for update;
    if coalesce(v_have,0) < s.stamp_goal then raise exception 'not_enough_stamps'; end if;
  end if;
  -- la seña se paga SIEMPRE con Mercado Pago; 'cash' = el resto en efectivo en el local (si el prestador lo acepta y el cliente no tiene faltas)
  if v_cash then
    if not st.cash_ok or v_full then raise exception 'cash_not_allowed'; end if;
  end if;

  for i in 0 .. coalesce(p_extra,0) loop
    t := p_start + make_interval(days => 7 * coalesce(p_repeat_weeks,0) * i);
    lt := t at time zone tz;
    if not public.slot_fits(p.id, lt, dur)
       or (i = 0 and (t < now() + make_interval(mins => st.notice_min)
                      or lt::date > (now() at time zone tz)::date + st.ahead_days - 1))
       -- D15: una serie puede pasar los 31 días del turnero, pero ningún turno a más de 90 días desde hoy
       or (i > 0 and lt::date > (now() at time zone tz)::date + 90) then
      if i = 0 then raise exception 'slot_not_available'; end if;
      skipped := skipped + 1; continue;
    end if;
    disc := public.happy_disc(p.id, lt);
    v_price := case when v_reward then 0 else round((s.price + ad_price) * (100 - disc) / 100.0) end;
    dep := case when v_reward then 0 when st.pay_mode = 'full' or v_full then v_price else round(v_price * st.deposit_pct / 100.0) end;
    -- comisión de TuTiempo: % del precio, la paga el cliente APARTE de la seña (el prestador recibe la seña completa)
    v_fee := case when v_reward then 0 else round(v_price * public.commission())::int end;
    begin
      insert into public.bookings (provider_id, service_id, client_id, client_name, service_name, source, status,
                                   starts_at, ends_at, buffer_min, price, discount_pct, deposit, client_fee, series_id, hold_expires_at, addons, intake, pay_method)
      values (p.id, s.id, uid, nm, s.name, 'app', 'hold', t, t + make_interval(mins => dur), st.buffer_min,
              v_price, disc, dep, v_fee, sid, now() + interval '10 minutes', ad_json, v_intake, case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end)
      returning id into bid;
    exception when exclusion_violation then
      if i = 0 then raise exception 'slot_taken'; end if;
      skipped := skipped + 1; continue;
    end;
    ids := ids || bid; deps := deps || dep; total := total + dep + v_fee;
  end loop;

  -- Bloque 1 (H23): si hay que pagar con Mercado Pago, el prestador tiene que poder cobrar hoy
  if total - w > 0 and not public.provider_can_charge(p.id) then raise exception 'provider_mp_not_connected'; end if;
  -- sin saldo TuTiempo: se paga con Mercado Pago o en efectivo en el local
  if v_reward then perform public.stamp_add(p.id, uid, s.id, -s.stamp_goal, 'redeem', ids[1]); end if;
  if total - w = 0 then
    update public.bookings set status = 'confirmed', hold_expires_at = null where id = any(ids);
    perform public.link_client(p.id, uid, nm);
    perform public.notify_booking(ids[1], 'conf');
    return jsonb_build_object('status','confirmed','booking_ids', to_jsonb(ids), 'amount_due', 0, 'pay', case when v_cash then 'cash' when v_reward then 'reward' else 'mp' end,
                              'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur);
  end if;
  return jsonb_build_object('status','pending_payment','booking_ids', to_jsonb(ids), 'amount_due', total - w,
                            'wallet_used', w, 'skipped', skipped, 'series_id', sid, 'price', v_price, 'duration', dur,
                            'hold_expires_at', now() + interval '10 minutes');
end $$;

-- ---------- Cancelación del prestador: la devolución queda registrada en refunds ----------
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  back := b.paid_mp + least(b.client_fee, b.app_fee);
  update public.bookings set status = 'cancelled_provider', hold_expires_at = null where id = b.id;
  perform public.refund_request(b.id, null, back, 'provider_cancelled');
  perform public.stamp_refund(b.id);
  if b.status = 'confirmed' then perform public.notify_booking(b.id, 'cancel'); end if;
  if b.client_id is not null then
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: el prestador canceló');
    end if;
    if b.cashback > 0 then
      select balance into bal from public.wallets where user_id = b.client_id for update;
      rev := least(coalesce(bal,0), b.cashback);
      if rev > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'reversal', -rev, b.id, 'Se descuenta el cashback del turno cancelado');
      end if;
    end if;
  end if;
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','refund_mp', back, 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;

-- ---------- Baja del prestador: su cuenta deja de cobrar y la llave queda para las devoluciones ----------
create or replace function public.provider_teardown(pid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if pid is null or not public.owns_provider(pid) then raise exception 'not_found'; end if;
  for r in select id from public.bookings where provider_id = pid and status in ('confirmed','hold') and source = 'app' and starts_at > now() loop
    perform public.cancel_by_provider(r.id); n := n + 1;
  end loop;
  delete from public.bookings where provider_id = pid and source in ('manual','block') and starts_at > now();
  delete from public.provider_clients where provider_id = pid;
  delete from public.walkins where provider_id = pid;
  delete from public.expenses where provider_id = pid;
  delete from public.cash_closings where provider_id = pid;
  delete from public.products where provider_id = pid;
  -- la llave se borra sola (purge_mp_accounts) cuando ya no hace falta para devoluciones ni consultas
  update public.mp_accounts set status = 'refunds_only', disconnected_at = now() where provider_id = pid and status = 'active';
  update public.provider_private set phone = null, dni_number = null, dni_paths = '{}', mp_user_id = null, mp_connected = false where provider_id = pid;
  update public.providers set status = 'deleted', owner_id = null, updated_at = now() where id = pid;
  return jsonb_build_object('status','deleted','cancelled', n);
end $$;

-- ---------- Ficha pública y listado: si el prestador no puede cobrar, no toma turnos online ----------
create or replace function public.get_provider(pid bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then null else jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'bio', p.bio, 'address', p.address, 'instagram', p.instagram,
    'hue', p.hue, 'photo_path', p.photo_path, 'rating_avg', p.rating_avg, 'rating_count', p.rating_count, 'followers', p.followers,
    'dni_verified', p.dni_verified, 'tz', c.tz, 'can_charge', public.provider_can_charge(p.id),
    'categories', (select coalesce(jsonb_agg(pc.category_id order by pc.is_primary desc, pc.category_id), '[]') from public.provider_categories pc where pc.provider_id = p.id),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'duration', s.duration_min, 'price', s.price, 'category', s.category_id,
                   'repeat_days', s.repeat_days, 'prep_note', s.prep_note, 'stamp_goal', s.stamp_goal,
                   'addons', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'price', a.price, 'duration', a.duration_min) order by a.sort, a.id), '[]')
                              from public.service_addons a where a.service_id = s.id and a.active)) order by s.category_id, s.sort, s.price), '[]')
                 from public.services s where s.provider_id = p.id and s.active),
    'settings', (select to_jsonb(st) from public.provider_settings st where st.provider_id = p.id),
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'shift', h.shift, 'opens', to_char(h.opens,'HH24:MI'), 'closes', to_char(h.closes,'HH24:MI'))), '[]')
              from public.provider_hours h where h.provider_id = p.id),
    'reviews', (select coalesce(jsonb_agg(r), '[]') from (select id, author, stars, body, reply, created_at from public.reviews where provider_id = p.id order by created_at desc limit 20) r),
    'media', (select coalesce(jsonb_agg(m), '[]') from (select id, storage_path, kind, label from public.media where provider_id = p.id order by created_at desc limit 24) m),
    'following', exists (select 1 from public.follows f where f.provider_id = p.id and f.user_id = auth.uid()),
    'my_stamps', coalesce((select jsonb_object_agg(lc.service_id::text, lc.stamps) from public.loyalty_cards lc where lc.provider_id = p.id and lc.user_id = auth.uid()), '{}'::jsonb)
  ) end
  from public.providers p join public.cities c on c.id = p.city_id
  where p.id = pid and (p.status = 'active' or p.owner_id = auth.uid() or public.is_admin())
$$;

-- Primer horario libre para las tarjetas del listado: sin cuenta que cobre, no hay horario para ofrecer.
create or replace function public.next_free_slot(pid bigint, dur int default null) returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare tz text := public.provider_tz(pid); st record; d int; h record; t timestamp; now_l timestamp; dd int;
begin
  select * into st from public.provider_settings where provider_id = pid;
  if st is null or not st.online or not public.provider_can_charge(pid) then return null; end if;
  dd := coalesce(dur, (select min(duration_min) from public.services where provider_id = pid and active));
  if dd is null then return null; end if;
  now_l := (now() at time zone tz) + make_interval(mins => st.notice_min);
  for d in 0 .. st.ahead_days - 1 loop
    for h in select opens, closes from public.provider_hours
             where provider_id = pid and dow = extract(dow from (now() at time zone tz)::date + d)::int order by opens loop
      t := ((now() at time zone tz)::date + d) + h.opens;
      while t + make_interval(mins => dd) <= ((now() at time zone tz)::date + d) + h.closes loop
        if t >= now_l and not exists (select 1 from public.bookings b where b.provider_id = pid
             and b.status in ('hold','confirmed','done')
             and b.during && tstzrange(t at time zone tz, (t + make_interval(mins => dd + st.buffer_min)) at time zone tz, '[)')) then
          return t at time zone tz;
        end if;
        t := t + make_interval(mins => st.step_min);
      end loop;
    end loop;
  end loop;
  return null;
end $$;

-- ---------- Mis turnos: estado de la devolución de cada turno ----------
create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.starts_at desc), '[]') from (
    select b.id, b.provider_id, b.service_id, p.name as provider_name, p.address, p.hue,
           coalesce(sv.category_id, (select pc.category_id from public.provider_categories pc where pc.provider_id = p.id and pc.is_primary limit 1)) as category,
           b.service_name, b.starts_at, b.ends_at, b.status, b.price, b.discount_pct, b.deposit, b.paid_mp, b.paid_wallet,
           least(b.client_fee, b.app_fee) as client_fee, b.client_fee as fee_due, b.settle_by_provider, b.cashback, b.series_id, b.attendance_ok, b.addons, b.intake, c.tz, sv.repeat_days, sv.prep_note,
           exists (select 1 from public.reviews r where r.booking_id = b.id) as reviewed, b.pay_method, p.photo_path,
           exists (select 1 from public.loyalty_events le where le.booking_id = b.id and le.kind = 'earn') as stamped,
           rf.amount as refund_amount, rf.done_at as refund_done_at, rf.reason as refund_reason,
           case when rf.amount is null then null when rf.open then 'pending' else 'done' end as refund_status
    from public.bookings b join public.providers p on p.id = b.provider_id join public.cities c on c.id = p.city_id
    left join public.services sv on sv.id = b.service_id
    left join lateral (select sum(r.amount)::int as amount, max(r.done_at) as done_at, min(r.reason) as reason,
                              bool_or(r.status in ('pending','failed')) as open
                       from public.refunds r where r.booking_id = b.id and r.status <> 'cancelled' having count(*) > 0) rf on true
    where b.client_id = auth.uid() and b.source = 'app'
    order by b.starts_at desc limit 200) x
$$;

-- ---------- Avisos del prestador ----------
create or replace function public.my_provider_notices() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'at', n.created_at, 'read', n.read_at is not null)
                            order by n.created_at desc), '[]')
  from (select * from public.provider_notices where provider_id = public.my_provider() order by created_at desc limit 30) n
$$;
create or replace function public.mark_provider_notices_read() returns void
language sql security definer set search_path = public as $$
  update public.provider_notices set read_at = now() where provider_id = public.my_provider() and read_at is null
$$;

-- ---------- Panel admin · "Para revisar" (D19, D20) ----------
create or replace function public.admin_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'refunds', (select coalesce(jsonb_agg(x order by x.failed desc, x.created_at), '[]') from (
      select r.id, r.amount, r.reason, r.status, r.attempts, r.last_error, r.last_attempt_at, r.next_attempt_at, r.created_at,
             r.mp_payment_id, (r.status = 'failed') as failed, p.name as provider_name, b.client_name, b.starts_at
      from public.refunds r left join public.providers p on p.id = r.provider_id left join public.bookings b on b.id = r.booking_id
      where r.status = 'failed' or (r.status = 'pending' and r.attempts > 0)
      order by r.created_at limit 200) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
      select pm.id, pm.mp_payment_id, pm.amount, pm.fee_expected, pm.fee_mp, pm.mp_status, pm.review_reasons, pm.created_at,
             p.name as provider_name, (select min(b.client_name) from public.bookings b where b.payment_id = pm.id) as client_name
      from public.payments pm left join public.providers p on p.id = pm.provider_id
      where pm.outcome = 'review' and pm.review_resolved_at is null
      order by pm.created_at limit 200) x));
end $$;

-- "Reintentar": la devolución vuelve a la cola ya, con otros 3 días de reintentos
create or replace function public.admin_refund_retry(p_refund bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.refunds set status = 'pending', attempts = 0, first_attempt_at = null, next_attempt_at = now()
   where id = p_refund and status in ('pending','failed') and mp_payment_id is not null;
  if not found then raise exception 'cannot_retry'; end if;
end $$;

-- "Resuelto a mano": exige una nota, registra quién y cuándo, y no dispara ninguna devolución
create or replace function public.admin_resolve(p_kind text, p_id bigint, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare txt text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 500); r record;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(txt) < 3 then raise exception 'note_required'; end if;
  if p_kind = 'refund' then
    update public.refunds set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolved_note = txt
     where id = p_id and status in ('pending','failed') returning booking_id, amount into r;
    if r is null then raise exception 'not_found'; end if;
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
  elsif p_kind = 'payment' then
    update public.payments set review_resolved_at = now(), review_resolved_by = auth.uid(), review_note = txt, updated_at = now()
     where id = p_id and outcome = 'review' and review_resolved_at is null;
    if not found then raise exception 'not_found'; end if;
  else
    raise exception 'bad_kind';
  end if;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.mp_accounts_sync(), public.provider_can_charge(bigint), public.refunds_cap(),
  public.money_txt(int), public.booking_when(bigint), public.mp_clean(jsonb), public.payment_log(bigint, jsonb),
  public.refund_request(bigint, bigint, int, text),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.confirm_payment_core(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.refunds_due(int), public.refund_result(bigint, boolean, text, text),
  public.mp_connect(bigint, text, text, text, int), public.mp_disconnect(), public.my_mp_status(), public.mp_account_error(bigint, text, boolean),
  public.purge_mp_accounts(), public.purge_deleted_secrets(), public.my_provider_notices(), public.mark_provider_notices_read(),
  public.admin_review(), public.admin_refund_retry(bigint), public.admin_resolve(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.book_slot(bigint,timestamptz,int,int,text,bigint[],jsonb), public.cancel_by_provider(bigint),
  public.get_provider(bigint), public.next_free_slot(bigint,int) to authenticated;
grant execute on function public.get_provider(bigint), public.next_free_slot(bigint,int) to anon;
grant execute on function public.my_bookings(), public.mp_disconnect(), public.my_mp_status(), public.my_provider_notices(),
  public.mark_provider_notices_read(), public.admin_review(), public.admin_refund_retry(bigint), public.admin_resolve(text, bigint, text)
  to authenticated;
-- solo las Edge Functions (service_role) y el cron
grant execute on function public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.refunds_due(int), public.refund_result(bigint, boolean, text, text),
  public.mp_connect(bigint, text, text, text, int), public.mp_account_error(bigint, text, boolean),
  public.purge_mp_accounts(), public.purge_deleted_secrets()
  to service_role;

-- ===================== 20261024043027_cobros_ajustes.sql =====================
-- =====================================================================
-- TuTiempo · Bloque 1 · Ajustes de cobros (revisión del PR #4)
-- - Turnos que cancela el sistema (pago tardío con el horario ocupado, monto de menos) quedan 'expired' con lo cobrado
--   y su devolución, nunca como "canceló el prestador".
-- - Avisos de Mercado Pago descartados: quedan en mp_webhook_events (sin datos personales). Cobrador equivocado: además
--   el pago va a "Para revisar" sin confirmar turnos.
-- - Renovación de llaves sin carreras (refreshing_until), respuesta de MP guardada con lista de campos permitidos,
--   devolución creada por el admin, errores pasajeros que suben (MP reintenta), orden de bloqueos pago → turno.
-- No borra datos.
-- =====================================================================
set search_path = public, extensions;

-- ---------- Renovación de llaves: una sola a la vez por cuenta ----------
alter table public.mp_accounts add column if not exists refreshing_until timestamptz;

-- Reserva la renovación: solo la obtiene quien la toma (los demás siguen con la llave actual mientras no venza)
create or replace function public.mp_account_refresh_claim(p_account bigint, p_seconds int default 60) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.mp_accounts set refreshing_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 5), 300))
   where id = p_account and status <> 'purged' and refresh_token is not null
     and (refreshing_until is null or refreshing_until < now());
  return found;
end $$;
-- Guarda la llave renovada y libera la reserva
create or replace function public.mp_account_refreshed(p_account bigint, p_access text, p_refresh text, p_expires_in int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_access, '') = '' then raise exception 'bad_token'; end if;
  update public.mp_accounts set access_token = p_access, refresh_token = coalesce(nullif(p_refresh, ''), refresh_token),
         expires_at = case when p_expires_in > 0 then now() + make_interval(secs => p_expires_in) end,
         refreshed_at = now(), refreshing_until = null, last_error = null
   where id = p_account and status <> 'purged';
end $$;
-- Libera la reserva sin cambiar la llave (quien la tomó vio que otro proceso ya la había renovado)
create or replace function public.mp_account_refresh_release(p_account bigint) returns void
language sql security definer set search_path = public as $$
  update public.mp_accounts set refreshing_until = null where id = p_account
$$;
-- Llave que venció y no se pudo renovar: también libera la reserva
create or replace function public.mp_account_error(p_account bigint, p_error text, p_expired boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.mp_accounts set last_error = left(p_error, 300), refreshing_until = null,
         status = case when p_expired and status = 'active' then 'refunds_only' else status end,
         disconnected_at = case when p_expired and status = 'active' then now() else disconnected_at end
  where id = p_account
$$;

-- ---------- Avisos de Mercado Pago descartados (sin datos personales) ----------
create table if not exists public.mp_webhook_events (
  id            bigint generated always as identity primary key,
  mp_payment_id text check (char_length(mp_payment_id) <= 40),
  provider_id   bigint references public.providers(id) on delete set null,
  mp_account_id bigint references public.mp_accounts(id) on delete set null,
  reason        text not null check (reason in ('unknown_provider','payment_not_found','wrong_collector','bad_currency')),
  created_at    timestamptz not null default now()
);
create index if not exists mp_webhook_events_recent on public.mp_webhook_events (created_at desc);
alter table public.mp_webhook_events enable row level security;
revoke all on public.mp_webhook_events from public, anon, authenticated;
grant select on public.mp_webhook_events to authenticated;
grant select, insert on public.mp_webhook_events to service_role;
drop policy if exists mp_webhook_events_read on public.mp_webhook_events;
create policy mp_webhook_events_read on public.mp_webhook_events for select to authenticated using ((select public.is_admin()));

create or replace function public.mp_webhook_event(p_payment_id text, p_provider bigint, p_account bigint, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into public.mp_webhook_events (mp_payment_id, provider_id, mp_account_id, reason)
  values (left(p_payment_id, 40),
          (select id from public.providers where id = p_provider),
          (select id from public.mp_accounts where id = p_account),
          p_reason)
$$;

-- Pago que no se puede tomar como bueno (por ejemplo, cobrado por otra cuenta): queda registrado en "Para revisar",
-- sin confirmar turnos ni pedir devoluciones (las decide el admin).
create or replace function public.payment_review(p_payment_id text, p_provider bigint, p_collector text, p_booking_ids bigint[],
                                                 p_amount int, p_reason text, p_raw jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay_id bigint;
begin
  if coalesce(p_payment_id, '') = '' then raise exception 'bad_payment'; end if;
  select id into pay_id from public.payments where mp_payment_id = p_payment_id;
  if pay_id is not null then
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'already_processed', 'payment', pay_id);
  end if;
  insert into public.payments (mp_payment_id, provider_id, collector_id, booking_ids, amount, outcome, review_reasons)
  values (p_payment_id, (select id from public.providers where id = p_provider), left(p_collector, 40),
          coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review', array[p_reason])
  on conflict (mp_payment_id) do nothing
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);
  return jsonb_build_object('status', 'review', 'payment', pay_id);
end $$;

-- ---------- Respuesta de Mercado Pago: solo campos permitidos ----------
create or replace function public.mp_clean(p jsonb) returns jsonb language sql immutable as $$
  select case when jsonb_typeof(p) <> 'object' then null else
    (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v)
      where k in ('id','status','status_detail','transaction_amount','currency_id','date_created','date_approved',
                  'date_last_updated','collector_id','external_reference','metadata','fee_details','marketplace_fee'))
    || case when jsonb_typeof(p->'refunds') = 'array' then jsonb_build_object('refunds',
         (select coalesce(jsonb_agg(jsonb_build_object('id', r->'id', 'amount', r->'amount', 'status', r->'status', 'date_created', r->'date_created')), '[]'::jsonb)
            from jsonb_array_elements(p->'refunds') r where jsonb_typeof(r) = 'object'))
       else '{}'::jsonb end
  end
$$;

-- ---------- Devoluciones creadas por el admin (salida de "Para revisar", D20) ----------
alter table public.refunds add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.refunds add column if not exists note text check (char_length(note) <= 500);
alter table public.refunds drop constraint if exists refunds_reason_check;
alter table public.refunds add constraint refunds_reason_check
  check (reason in ('provider_cancelled','slot_taken','booking_unavailable','amount_short','unknown_booking','admin'));

-- Crea una devolución de un pago (todo o una parte, de un turno o del pago entero). La ejecuta mp-refunds con la llave
-- de la cuenta que cobró; refunds_cap impide devolver más de lo cobrado. Si el pago estaba en revisión, queda resuelto
-- con la misma nota.
create or replace function public.admin_refund_create(p_payment bigint, p_booking bigint default null, p_amount int default null,
                                                      p_note text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare pm record; txt text := left(btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g')), 500); rid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if char_length(txt) < 3 then raise exception 'note_required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'bad_amount'; end if;
  select * into pm from public.payments where id = p_payment for update;
  if pm.id is null then raise exception 'not_found'; end if;
  if p_booking is not null and not exists (select 1 from public.payment_bookings where payment_id = pm.id and booking_id = p_booking) then
    raise exception 'not_found';
  end if;
  insert into public.refunds (payment_id, booking_id, provider_id, mp_payment_id, mp_account_id, amount, reason, status,
                              created_by, note, last_error)
  values (pm.id, p_booking, pm.provider_id, pm.mp_payment_id, pm.mp_account_id, p_amount, 'admin',
          case when pm.mp_account_id is null then 'failed' else 'pending' end, auth.uid(), txt,
          case when pm.mp_account_id is null then 'El pago no está ligado a una cuenta de Mercado Pago de TuTiempo: devolverlo a mano' end)
  returning id into rid;
  if p_booking is not null then
    update public.bookings set refund_pending = refund_pending + p_amount where id = p_booking;
  end if;
  update public.payments set review_resolved_at = now(), review_resolved_by = auth.uid(),
         review_note = left('Devolución de ' || public.money_txt(p_amount) || ': ' || txt, 500), updated_at = now()
   where id = pm.id and outcome = 'review' and review_resolved_at is null;
  return rid;
end $$;

-- ---------- confirm_payment: los errores pasajeros suben (el webhook responde 500 y Mercado Pago reintenta) ----------
create or replace function public.confirm_payment(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                  p_provider bigint default null, p_account bigint default null,
                                                  p_fee_mp int default null, p_collector text default null,
                                                  p_raw jsonb default null, p_status_detail text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare prev record; pay_id bigint; pid bigint;
begin
  if coalesce(p_payment_id, '') = '' then raise exception 'bad_payment'; end if;
  -- el mismo aviso dos veces: no se hace nada (solo se guarda la consulta)
  select id, outcome into prev from public.payments where mp_payment_id = p_payment_id;
  if prev.id is not null then
    perform public.payment_log(prev.id, p_raw);
    return jsonb_build_object('status', 'already_processed', 'payment', prev.id, 'outcome', prev.outcome);
  end if;
  -- pagos confirmados antes del Bloque 1 (quedaron en bookings.mp_payment_id)
  if exists (select 1 from public.bookings where mp_payment_id = p_payment_id) then
    return jsonb_build_object('status', 'already_processed');
  end if;
  begin
    return public.confirm_payment_core(p_booking_ids, p_payment_id, p_amount, p_provider, p_account, p_fee_mp, p_collector, p_raw, p_status_detail);
  exception
    -- pasajeros: que suban. Dos avisos a la vez chocan en unique_violation y el reintento termina en already_processed.
    when deadlock_detected or serialization_failure or lock_not_available or query_canceled or unique_violation then
      raise;
    when others then
      -- nunca falla ante un pago aprobado: queda registrado para revisar, con el error
      pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(coalesce(p_booking_ids, '{}'))));
      insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, booking_ids, amount, outcome, review_reasons, mp_status_detail)
      values (p_payment_id, pid, coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active')),
              left(p_collector, 40), coalesce(p_booking_ids, '{}'), greatest(coalesce(p_amount, 0), 0), 'review',
              array['error: ' || left(sqlerrm, 200)], left(p_status_detail, 60))
      on conflict (mp_payment_id) do nothing
      returning id into pay_id;
      perform public.payment_log(pay_id, p_raw);
      return jsonb_build_object('status', 'review', 'payment', pay_id, 'error', sqlerrm);
  end;
end $$;

-- Cancelaciones del sistema: el turno queda 'expired' (con lo cobrado y su devolución), nunca 'cancelled_provider'.
create or replace function public.confirm_payment_core(p_booking_ids bigint[], p_payment_id text, p_amount int,
                                                       p_provider bigint, p_account bigint, p_fee_mp int, p_collector text,
                                                       p_raw jsonb, p_status_detail text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids bigint[] := array(select distinct x from unnest(coalesce(p_booking_ids, '{}')) x where x is not null);
        pid bigint; acct bigint; uid uuid; nm text; due int; fee_exp int; pay_id bigint; r record;
        left_amt int := greatest(coalesce(p_amount, 0), 0); pay int; fee_part int; short boolean; why text;
        reasons text[] := '{}'; ok int := 0; back int := 0; first_ok bigint;
begin
  pid := coalesce(p_provider, (select min(provider_id) from public.bookings where id = any(ids)));
  acct := coalesce(p_account, (select id from public.mp_accounts where provider_id = pid and status = 'active'));
  -- lo que se debía: seña + comisión de los turnos de ESTE prestador que vinieron en el pago
  select sum(deposit + client_fee - paid_wallet), sum(client_fee), min(client_id::text)::uuid, min(client_name)
    into due, fee_exp, uid, nm
    from public.bookings where id = any(ids) and provider_id = pid and source = 'app';
  due := coalesce(due, 0); fee_exp := coalesce(fee_exp, 0);
  if exists (select 1 from unnest(ids) x where not exists (select 1 from public.bookings b where b.id = x and b.provider_id = pid and b.source = 'app')) then
    reasons := array_append(reasons, 'other_provider');      -- turnos de otro prestador o que no existen: no se tocan
  end if;
  -- comisión: la que informa Mercado Pago tiene que ser la calculada por la base
  if fee_exp > 0 and p_fee_mp is null then reasons := array_append(reasons, 'fee_missing');
  elsif p_fee_mp is not null and p_fee_mp <> fee_exp then reasons := array_append(reasons, 'fee_mismatch'); end if;
  short := left_amt < due;                       -- D16: llegó menos → no se confirma nada y se devuelve todo
  if left_amt > due and due > 0 then reasons := array_append(reasons, 'amount_over'); end if;   -- D16: llegó más → se confirma y la diferencia se revisa

  insert into public.payments (mp_payment_id, provider_id, mp_account_id, collector_id, client_id, booking_ids, amount, fee_expected, fee_mp, mp_status_detail)
  values (p_payment_id, pid, acct, left(p_collector, 40), uid, ids, left_amt, fee_exp, p_fee_mp, left(p_status_detail, 60))
  returning id into pay_id;
  perform public.payment_log(pay_id, p_raw);

  for r in select * from public.bookings where id = any(ids) and provider_id = pid and source = 'app' order by starts_at for update loop
    pay := least(left_amt, r.deposit + r.client_fee - r.paid_wallet); left_amt := left_amt - pay;
    fee_part := least(pay, r.client_fee);
    why := null;
    if short then
      why := 'amount_short';
    elsif r.status not in ('hold', 'expired') or r.payment_id is not null then
      why := 'booking_unavailable';             -- cancelado (por el prestador, un bloqueo, una baja) o ya pagado por otro pago
    else
      begin
        update public.bookings set status = 'confirmed', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part, app_fee = fee_part
         where id = r.id;
        ok := ok + 1; first_ok := coalesce(first_ok, r.id);
      exception when exclusion_violation then
        why := 'slot_taken';                     -- el hold venció y otro tomó el horario
      end;
    end if;
    insert into public.payment_bookings (payment_id, booking_id, amount, fee, result, reason)
    values (pay_id, r.id, pay, fee_part, case when why is null then 'confirmed' else 'refund' end, why);
    if why is not null and pay > 0 then
      if r.status in ('hold', 'expired') and r.payment_id is null then
        -- lo canceló el sistema, no el prestador: 'expired' con lo cobrado (el cliente ve que se le devuelve y por qué)
        update public.bookings set status = 'expired', hold_expires_at = null, payment_id = pay_id,
               paid_mp = pay - fee_part, app_fee = fee_part
         where id = r.id;
      end if;
      perform public.refund_request(r.id, pay_id, pay, why);
      back := back + 1;
    end if;
  end loop;
  -- nada de este prestador en el pago: se devuelve todo lo cobrado (sin turno)
  if not exists (select 1 from public.payment_bookings where payment_id = pay_id) and left_amt > 0 then
    perform public.refund_request(null, pay_id, left_amt, 'unknown_booking');
    left_amt := 0;
  end if;

  update public.payments set
    outcome = case when cardinality(reasons) > 0 then 'review' when ok > 0 and back = 0 then 'confirmed' when ok > 0 then 'partial' else 'refund' end,
    review_reasons = reasons, updated_at = now()
   where id = pay_id;
  if ok > 0 then
    if uid is not null then perform public.link_client(pid, uid, nm); end if;
    perform public.notify_booking(first_ok, 'conf');
  end if;
  return jsonb_build_object('status', 'processed', 'payment', pay_id, 'confirmed', ok, 'refunded', back, 'review', reasons, 'extra', left_amt);
end $$;

-- ---------- Cambios de estado en Mercado Pago ----------
-- 'approved' vuelve a poner el pago como aprobado (por ejemplo, un reclamo resuelto a favor del prestador); los motivos
-- quedan en review_reasons como historial. Cada reclamo o contracargo nuevo genera su aviso y vuelve a "Para revisar".
create or replace function public.payment_mp_update(p_payment_id text, p_status text, p_refunded int default 0,
                                                    p_status_detail text default null, p_raw jsonb default null,
                                                    p_provider bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pm record; r record; ours int; done_sum int; pend_sum int; n int := 0; reasons text[]; pay_id bigint; prov_name text; txt text;
        refd int := greatest(coalesce(p_refunded, 0), 0); nref text;
begin
  if p_status not in ('approved','refunded','cancelled','charged_back','in_mediation') then raise exception 'bad_status'; end if;
  select * into pm from public.payments where mp_payment_id = p_payment_id for update;
  if pm.id is null then
    -- aviso de un pago que no está registrado (por ejemplo, de antes del Bloque 1): queda para revisar
    if p_status = 'approved' then return jsonb_build_object('status', 'unknown_payment'); end if;
    insert into public.payments (mp_payment_id, provider_id, amount, mp_status, mp_status_detail, refunded_mp, outcome, review_reasons)
    values (p_payment_id, coalesce(p_provider, (select min(provider_id) from public.bookings where mp_payment_id = p_payment_id)),
            0, p_status, left(p_status_detail, 60), refd, 'review', array['unregistered_' || p_status])
    on conflict (mp_payment_id) do nothing returning id into pay_id;
    perform public.payment_log(pay_id, p_raw);
    return jsonb_build_object('status', 'review', 'payment', pay_id);
  end if;
  perform public.payment_log(pm.id, p_raw);
  select coalesce(sum(amount) filter (where status in ('done','resolved')), 0), coalesce(sum(amount) filter (where status in ('pending','failed')), 0)
    into done_sum, pend_sum from public.refunds where payment_id = pm.id;
  reasons := pm.review_reasons;
  select name into prov_name from public.providers where id = pm.provider_id;
  -- aviso nuevo por cada vez que pasa (un segundo reclamo del mismo pago es otro aviso)
  nref := p_payment_id || coalesce('#' || nullif((select count(*) from public.provider_notices
                                                  where provider_id = pm.provider_id and (ref = p_payment_id or ref like p_payment_id || '#%')), 0) + 1, '');

  if p_status = 'approved' then
    -- devolución parcial: tiene que coincidir con las de la app (hechas, o hechas + en curso)
    if refd > 0 and refd <> done_sum and refd <> done_sum + pend_sum and not ('partial_refund_mismatch' = any(reasons)) then
      reasons := array_append(reasons, 'partial_refund_mismatch');
    end if;
    update public.payments set mp_status = 'approved', refunded_mp = refd, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons,
           outcome = case when cardinality(reasons) > cardinality(pm.review_reasons) then 'review' else outcome end,
           review_resolved_at = case when cardinality(reasons) > cardinality(pm.review_reasons) then null else review_resolved_at end,
           updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;
  if pm.mp_status = p_status then return jsonb_build_object('status', 'already_processed', 'payment', pm.id); end if;

  if p_status = 'in_mediation' then
    if not ('in_mediation' = any(reasons)) then reasons := array_append(reasons, 'in_mediation'); end if;
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, 'mp_in_mediation', nref,
            'El cliente abrió un reclamo en Mercado Pago por el pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) ||
            '). Respondelo desde tu cuenta de Mercado Pago. Tus turnos siguen como están.')
    on conflict do nothing;
    update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), review_reasons = reasons, outcome = 'review',
           review_resolved_at = null, review_resolved_by = null, updated_at = now()
     where id = pm.id;
    return jsonb_build_object('status', 'ok', 'payment', pm.id);
  end if;

  -- refunded / cancelled / charged_back: Mercado Pago ya le devolvió la plata al cliente.
  -- Si la app ya había pedido devolver todo, el aviso es la confirmación de esas devoluciones.
  ours := done_sum + pend_sum;
  if p_status = 'charged_back' and not ('charged_back' = any(reasons)) then reasons := array_append(reasons, 'charged_back'); end if;
  for r in select * from public.bookings where payment_id = pm.id and status = 'confirmed' and starts_at > now() order by starts_at for update loop
    update public.bookings set status = 'cancelled_refunded', hold_expires_at = null where id = r.id;
    perform public.stamp_refund(r.id);
    n := n + 1;
    if r.client_id is not null then
      txt := case when p_status = 'charged_back'
                  then 'Por el contracargo de tu pago en Mercado Pago, tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado.'
                  else 'Mercado Pago te devolvió el pago, así que tu turno del ' || public.booking_when(r.id) || ' en ' || prov_name || ' quedó cancelado. Si querés, reservá de nuevo.' end;
      insert into public.client_messages (provider_id, user_id, body, kind, ref)
      values (r.provider_id, r.client_id, left(txt, 600), 'cancel', r.id::text) on conflict do nothing;
    end if;
  end loop;
  -- las devoluciones que la app tenía en curso: si cubrían todo el pago, son las que Mercado Pago acaba de informar (hechas);
  -- si no, ya no hacen falta (Mercado Pago devolvió el pago entero)
  for r in update public.refunds set status = case when ours >= pm.amount then 'done' else 'cancelled' end,
                  done_at = case when ours >= pm.amount then now() end,
                  last_error = case when ours >= pm.amount then null else 'Mercado Pago ya devolvió el pago (' || p_status || ')' end
            where payment_id = pm.id and status in ('pending','failed') returning booking_id, amount loop
    if r.booking_id is not null then
      update public.bookings set refund_pending = greatest(refund_pending - r.amount, 0) where id = r.booking_id;
    end if;
  end loop;
  if p_status = 'charged_back' or ours < pm.amount then
    insert into public.provider_notices (provider_id, kind, ref, body)
    values (pm.provider_id, case when p_status = 'charged_back' then 'mp_charged_back' else 'mp_refunded' end, nref,
            case when p_status = 'charged_back'
                 then 'El cliente pidió un contracargo del pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') a su banco.'
                 else 'El pago ' || p_payment_id || ' (' || public.money_txt(pm.amount) || ') se devolvió desde Mercado Pago.' end ||
            case when n > 0 then ' Se cancel' || case when n = 1 then 'ó 1 turno futuro' else 'aron ' || n || ' turnos futuros' end || ' de ese pago.' else '' end)
    on conflict do nothing;
  end if;
  update public.payments set mp_status = p_status, mp_status_detail = left(p_status_detail, 60), refunded_mp = greatest(refd, refunded_mp),
         review_reasons = reasons, outcome = case when cardinality(reasons) > 0 then 'review' else outcome end,
         review_resolved_at = case when p_status = 'charged_back' then null else review_resolved_at end, updated_at = now()
   where id = pm.id;
  return jsonb_build_object('status', 'ok', 'payment', pm.id, 'cancelled', n, 'ours', ours >= pm.amount);
end $$;

-- ---------- Cancelación del prestador: bloquea primero el pago y después el turno ----------
-- Mismo orden que payment_mp_update (pago → turnos): así dos operaciones sobre el mismo pago no se cruzan.
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int; pay_id bigint;
begin
  select payment_id into pay_id from public.bookings where id = p_booking;
  if pay_id is not null then perform 1 from public.payments where id = pay_id for update; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  back := b.paid_mp + least(b.client_fee, b.app_fee);
  update public.bookings set status = 'cancelled_provider', hold_expires_at = null where id = b.id;
  perform public.refund_request(b.id, null, back, 'provider_cancelled');
  perform public.stamp_refund(b.id);
  if b.status = 'confirmed' then perform public.notify_booking(b.id, 'cancel'); end if;
  if b.client_id is not null then
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: el prestador canceló');
    end if;
    if b.cashback > 0 then
      select balance into bal from public.wallets where user_id = b.client_id for update;
      rev := least(coalesce(bal,0), b.cashback);
      if rev > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'reversal', -rev, b.id, 'Se descuenta el cashback del turno cancelado');
      end if;
    end if;
  end if;
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','refund_mp', back, 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;

-- ---------- El cliente ve también las devoluciones de sus pagos sin turno ----------
drop policy if exists refunds_read on public.refunds;
create policy refunds_read on public.refunds for select to authenticated
  using (provider_id = (select public.my_provider()) or (select public.is_admin())
         or exists (select 1 from public.bookings b where b.id = booking_id and b.client_id = (select auth.uid()))
         or exists (select 1 from public.payments p where p.id = payment_id and p.client_id = (select auth.uid())));

-- ---------- "Para revisar": lo que falta devolver de cada pago y los avisos descartados ----------
create or replace function public.admin_review() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'refunds', (select coalesce(jsonb_agg(x order by x.failed desc, x.created_at), '[]') from (
      select r.id, r.amount, r.reason, r.status, r.attempts, r.last_error, r.last_attempt_at, r.next_attempt_at, r.created_at,
             r.mp_payment_id, (r.status = 'failed') as failed, p.name as provider_name, b.client_name, b.starts_at
      from public.refunds r left join public.providers p on p.id = r.provider_id left join public.bookings b on b.id = r.booking_id
      where r.status = 'failed' or (r.status = 'pending' and r.attempts > 0)
      order by r.created_at limit 200) x),
    'payments', (select coalesce(jsonb_agg(x order by x.created_at), '[]') from (
      select pm.id, pm.mp_payment_id, pm.amount, pm.fee_expected, pm.fee_mp, pm.mp_status, pm.review_reasons, pm.created_at,
             pm.collector_id, (pm.mp_account_id is not null) as refundable_from_app,
             -- lo que falta devolver: lo cobrado que no respalda un turno que sigue en pie, menos lo ya devuelto o pedido
             greatest(pm.amount
                      - coalesce((select sum(pb.amount) from public.payment_bookings pb join public.bookings b on b.id = pb.booking_id
                                  where pb.payment_id = pm.id and pb.result = 'confirmed'
                                    and b.status in ('confirmed','done','no_show','cancelled_client')), 0)
                      - coalesce((select sum(r.amount) from public.refunds r where r.payment_id = pm.id and r.status <> 'cancelled'), 0), 0) as refundable,
             p.name as provider_name, (select min(b.client_name) from public.bookings b where b.payment_id = pm.id) as client_name
      from public.payments pm left join public.providers p on p.id = pm.provider_id
      where pm.outcome = 'review' and pm.review_resolved_at is null
      order by pm.created_at limit 200) x),
    'webhook_events', (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
      select e.id, e.mp_payment_id, e.reason, e.created_at, p.name as provider_name
      from public.mp_webhook_events e left join public.providers p on p.id = e.provider_id
      where e.created_at > now() - interval '30 days'
      order by e.created_at desc limit 50) x));
end $$;

-- ---------- admin_stats: las señas del mes cuentan solo lo que quedó cobrado ----------
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := 'America/Argentina/Buenos_Aires';
        m0 timestamptz := date_trunc('month', now() at time zone tz) at time zone tz;      -- 1° del mes (hora Argentina)
        m1 timestamptz := (date_trunc('month', now() at time zone tz) + interval '1 month') at time zone tz;
        p0 timestamptz := (date_trunc('month', now() at time zone tz) - interval '1 month') at time zone tz;
        p1 timestamptz := now() - interval '1 month';                                       -- mismo período del mes pasado
        rate numeric := public.commission(); r jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  with b as (select * from public.bookings where source = 'app' and starts_at >= p0 - interval '1 day' and starts_at < m1 + interval '1 day'),
  fee as (select *, case when app_fee > 0 or client_fee > 0 then app_fee else least(paid_mp, round(price * rate)::int) end as fee from b)
  select jsonb_build_object(
    'commission_pct', (select commission_pct from public.app_settings where id),
    'providers_active', (select count(*) from public.providers where status = 'active'),
    'providers_pending', (select count(*) from public.providers where status = 'pending'),
    'providers_suspended', (select count(*) from public.providers where status = 'suspended'),
    'new_providers_month', (select count(*) from public.providers where created_at >= m0 and status <> 'deleted'),
    'clients', (select count(*) from public.profiles),
    'new_clients_month', (select count(*) from public.profiles where created_at >= m0),
    'bookings_month', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'bookings_prev', (select count(*) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    'gross_month', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= m0 and starts_at < m1),
    'gross_prev', (select coalesce(sum(price),0) from fee where status in ('confirmed','done','no_show') and starts_at >= p0 and starts_at < p1),
    -- Bloque 1: solo las señas que quedaron cobradas (no las devueltas: cancelaciones del prestador, pagos tardíos, devoluciones desde MP)
    'deposits_month', (select coalesce(sum(paid_mp),0) from public.bookings where source = 'app' and paid_mp > 0 and created_at >= m0
                        and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider))),
    'commission_month', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= m0),
    'commission_prev', (select coalesce(sum(public.booking_fee(x, rate)),0) from public.bookings x
                          where source = 'app' and paid_mp > 0 and (status in ('confirmed','done','no_show','cancelled_client') or (status = 'cancelled_provider' and settle_by_provider)) and created_at >= p0 and created_at < p1),
    'no_show_month', (select count(*) from fee where status = 'no_show' and starts_at >= m0 and starts_at < m1),
    'cancelled_month', (select count(*) from fee where status = 'cancelled_client' and starts_at >= m0 and starts_at < m1),
    'mp_missing', (select count(*) from public.providers p join public.provider_private pp on pp.provider_id = p.id where p.status = 'active' and not pp.mp_connected),
    'stamp_cards', (select count(distinct s.provider_id) from public.services s join public.provider_settings st on st.provider_id = s.provider_id and st.stamps_on where s.stamp_goal is not null and s.active),
    'by_category', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select category_id, count(*) n from public.provider_categories where active group by 1) x),
    'by_category_month', (select coalesce(jsonb_object_agg(category_id, n), '{}') from (select s.category_id, count(*) n from fee f join public.services s on s.id = f.service_id
                           where f.status in ('confirmed','done','no_show') and f.starts_at >= m0 and f.starts_at < m1 group by 1) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'n', coalesce(x.n,0), 'gross', coalesce(x.gross,0), 'fee', coalesce(x.fee,0)) order by d.day), '[]')
               from (select g::date as day from generate_series((now() at time zone tz)::date - 29, (now() at time zone tz)::date, interval '1 day') g) d
               left join (select (starts_at at time zone tz)::date as day, count(*) n, sum(price) gross, sum(fee) fee from fee
                          where status in ('confirmed','done','no_show') group by 1) x on x.day = d.day),
    'top', (select coalesce(jsonb_agg(t order by t.activity desc, t.id), '[]') from (
              select p.id, p.name, p.activity, p.photo_path, p.hue,
                     (select array_agg(pc.category_id order by pc.is_primary desc) from public.provider_categories pc where pc.provider_id = p.id) as cats
              from public.providers p where p.status = 'active' order by p.activity desc, p.id limit 5) t)
  ) into r;
  return r;
end $$;

-- ---------- Permisos de ejecución ----------
revoke execute on function public.mp_account_refresh_claim(bigint, int), public.mp_account_refreshed(bigint, text, text, int),
  public.mp_account_refresh_release(bigint),
  public.mp_account_error(bigint, text, boolean), public.mp_webhook_event(text, bigint, bigint, text),
  public.payment_review(text, bigint, text, bigint[], int, text, jsonb), public.mp_clean(jsonb),
  public.admin_refund_create(bigint, bigint, int, text),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.confirm_payment_core(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint), public.admin_review()
  from public, anon, authenticated;
grant execute on function public.admin_refund_create(bigint, bigint, int, text), public.admin_review(), public.admin_stats() to authenticated;
grant execute on function public.mp_account_refresh_claim(bigint, int), public.mp_account_refreshed(bigint, text, text, int),
  public.mp_account_refresh_release(bigint),
  public.mp_account_error(bigint, text, boolean), public.mp_webhook_event(text, bigint, bigint, text),
  public.payment_review(text, bigint, text, bigint[], int, text, jsonb),
  public.confirm_payment(bigint[], text, int, bigint, bigint, int, text, jsonb, text),
  public.payment_mp_update(text, text, int, text, jsonb, bigint)
  to service_role;

-- ===================== 20261024142729_cancelar_con_pago_bloqueado.sql =====================
-- =====================================================================
-- TuTiempo · Bloque 1 · cancel_by_provider con el pago correcto bloqueado
-- Bloquea primero el pago y después el turno (mismo orden que payment_mp_update). Si entre la lectura sin bloqueo y el
-- bloqueo del turno cambió su payment_id (un hold que se pagó justo), repite con el pago correcto. Todo lo demás
-- (estado, monto a devolver, pago de la devolución) sale de la lectura bloqueada.
-- No cambia datos.
-- =====================================================================
create or replace function public.cancel_by_provider(p_booking bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b record; bal int; rev int; waiting int; back int; pay_id bigint; tries int := 0;
begin
  loop
    select payment_id into pay_id from public.bookings where id = p_booking;
    if pay_id is not null then perform 1 from public.payments where id = pay_id for update; end if;
    select * into b from public.bookings where id = p_booking for update;
    exit when b is null or b.payment_id is not distinct from pay_id;
    -- se pagó entre la lectura y el bloqueo: otra vuelta, ahora con ese pago (el turno sigue bloqueado)
    tries := tries + 1;
    if tries >= 3 then raise exception 'busy_retry' using errcode = 'serialization_failure'; end if;
  end loop;
  if b is null or not public.owns_provider(b.provider_id) then raise exception 'not_found'; end if;
  if b.status not in ('confirmed','hold') or b.source = 'block' then raise exception 'cannot_cancel'; end if;
  back := b.paid_mp + least(b.client_fee, b.app_fee);
  update public.bookings set status = 'cancelled_provider', hold_expires_at = null where id = b.id;
  perform public.refund_request(b.id, b.payment_id, back, 'provider_cancelled');
  perform public.stamp_refund(b.id);
  if b.status = 'confirmed' then perform public.notify_booking(b.id, 'cancel'); end if;
  if b.client_id is not null then
    if b.paid_wallet > 0 then
      insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'refund', b.paid_wallet, b.id, 'Devolución: el prestador canceló');
    end if;
    if b.cashback > 0 then
      select balance into bal from public.wallets where user_id = b.client_id for update;
      rev := least(coalesce(bal,0), b.cashback);
      if rev > 0 then
        insert into public.wallet_movements (user_id, kind, amount, booking_id, note) values (b.client_id, 'reversal', -rev, b.id, 'Se descuenta el cashback del turno cancelado');
      end if;
    end if;
  end if;
  select count(*) into waiting from public.waitlist
   where provider_id = b.provider_id and day = (b.starts_at at time zone public.provider_tz(b.provider_id))::date;
  return jsonb_build_object('status','cancelled','refund_mp', back, 'refund_wallet', b.paid_wallet, 'waitlist', waiting);
end $$;


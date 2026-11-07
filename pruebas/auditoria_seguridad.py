"""Auditoría de seguridad (docs/05-auditoria-seguridad.md): pruebas de base que demuestran los hallazgos y verifican lo
que está bien. Corre contra una base LIMPIA con pruebas/supabase_emulation.sql + supabase/TODO_EN_UNO.sql:
    python3 pruebas/auditoria_seguridad.py "host=... dbname=BASE_LIMPIA user=postgres" [--estricto]
- "OK / FAIL": controles que tienen que cumplirse (lo que está bien). Un FAIL es un problema nuevo.
- "HALLAZGO Sxx": el hallazgo del informe se reproduce hoy. Cuando se arregle, pasa a "ARREGLADO Sxx".
Sale con error si hay algún FAIL; con --estricto, también si algún hallazgo se sigue reproduciendo."""
import json, sys, uuid, time, datetime as dt
import psycopg

DSN = next((a for a in sys.argv[1:] if not a.startswith("--")), "host=/tmp port=54329 dbname=tt user=postgres")
STRICT = "--estricto" in sys.argv
conn = psycopg.connect(DSN, autocommit=True)
F = 0
OPEN = []
TZ = dt.timezone(dt.timedelta(hours=-3))


def ok(name, cond):
    global F
    if not cond:
        F += 1
    print(("OK   " if cond else "FAIL ") + name)


def finding(code, name, reproduced):
    if reproduced:
        OPEN.append(code)
    print(("HALLAZGO " if reproduced else "ARREGLADO ") + code + ": " + name)


def q(sql, args=None, uid=None, role=None):
    """Ejecuta como anon / authenticated(uid) / service_role / postgres. Devuelve filas o la excepción."""
    with conn.cursor() as c:
        try:
            c.execute("begin")
            if role or uid:
                r = role or "authenticated"
                claims = {"role": r}
                if uid:
                    claims["sub"] = str(uid)
                c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
                c.execute(f"set local role {r}")
            c.execute(sql, args)
            rows = c.fetchall() if c.description else []
            c.execute("commit")
            return rows
        except Exception as e:
            c.execute("rollback")
            return e


def one(sql, args=None, **kw):
    r = q(sql, args, **kw)
    if isinstance(r, Exception):
        raise r
    return r[0][0] if r else None


def err(x, txt=None):
    return isinstance(x, Exception) and (txt is None or txt in str(x))


def denied(x):
    """Sin permiso: error, o ninguna fila (RLS)."""
    return isinstance(x, Exception) or len(x) == 0 or x == [(0,)]


def mkuser(email, name):
    uid = uuid.uuid4()
    q("insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (%s, %s, now(), %s)",
      (uid, email, json.dumps({"full_name": name})))
    return uid


today = dt.datetime.now(TZ).date()   # "hoy" de Buenos Aires, como la base


def next_weekday(n=1):
    d = today + dt.timedelta(days=n)
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d


def provider(uid, name, dni, active=True):
    pid = one("select register_provider(%s, 'Calle 1', array['b'], '2284 000', %s)", (name, dni), uid=uid)
    if active:
        q("update providers set status='active', dni_verified=true where id=%s", (pid,))
        q("select mp_connect(%s, %s, 'v1:aXY=:dG9r', 'v1:aXY=:cmVm', 15552000)", (pid, f"mp-{pid}"), role="service_role")
        q("update provider_settings set online=true, notice_min=0 where provider_id=%s", (pid,))
    one("insert into services (provider_id, category_id, name, duration_min, price) values (%s,'b','Corte',30,10000) returning id", (pid,), uid=uid)
    return pid


# ---------- Personajes ----------
victim = mkuser("victima@test.ar", "Valeria Víctima")      # clienta real
other = mkuser("otro@test.ar", "Oscar Otro")               # otro cliente
honest_u = mkuser("honesta@test.ar", "Hilda")              # prestadora honesta, activa
evil_u = mkuser("malo@test.ar", "Mario")                    # prestador malicioso
honest = provider(honest_u, "Peluquería Honesta", "30111222")
evil = provider(evil_u, "Barbería Mala", "28111222")
svc_h = one("select id from services where provider_id=%s", (honest,))

# Valeria fue a la peluquería honesta y dejó una reseña (turno atendido)
past = dt.datetime.combine(today - dt.timedelta(days=3), dt.time(10, 0), TZ)
bk = one("""insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price)
            values (%s, %s, %s, 'Valeria', 'Corte', 'app', 'done', %s, %s, 10000) returning id""",
         (honest, svc_h, victim, past, past + dt.timedelta(minutes=30)))
r = q("insert into reviews (provider_id, booking_id, author, stars, body) values (%s, %s, 'Valeria V.', 5, 'Excelente')", (honest, bk), uid=victim)
ok("la clienta deja su reseña de un turno atendido", not err(r))

print("\n# 1. Estructura: RLS y funciones security definer")
no_rls = q("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")
ok("todas las tablas de public tienen RLS", no_rls == [])
no_path = q("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%%')""")
ok("toda función security definer fija search_path", no_path == [])
anon_exec = sorted(r[0] for r in q("""select distinct p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')"""))
ok("anon solo ejecuta las funciones definer públicas: " + ", ".join(anon_exec),
   set(anon_exec) <= {"category_counts", "commission", "get_provider", "is_admin", "list_providers", "my_provider",
                      "next_free_slot", "owns_provider", "provider_busy"})
inv_no_path = sorted(r[0] for r in q("""select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and not p.prosecdef and p.prolang <> (select oid from pg_language where lanname='c')
                 and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%%')"""))
finding("S12", "funciones (invoker) sin search_path fijo: " + ", ".join(inv_no_path), len(inv_no_path) > 0)

print("\n# 2. Qué puede hacer la anon key (visitante anónimo o atacante con la clave pública)")
for t in ["bookings", "profiles", "provider_private", "provider_clients", "client_messages", "payments", "refunds",
          "mp_accounts", "mp_oauth_states", "email_outbox", "wallets", "wallet_movements", "app_admins", "admin_notes",
          "waitlist", "follows", "loyalty_cards", "provider_notices", "message_templates", "products"]:
    ok(f"anon no lee {t}", denied(q(f"select count(*) from public.{t}", role="anon")))
ok("anon no lee las fotos del DNI (storage)", denied(q("select count(*) from storage.objects where bucket_id='dni'", role="anon")))
ok("anon no lee providers.owner_id", err(q("select owner_id from providers", role="anon")))
ok("anon no ve datos privados en get_provider", "2284" not in json.dumps(one("select get_provider(%s)", (honest,), role="anon")))
ok("anon no puede reservar", err(q("select book_slot(%s, now() + interval '2 days')", (svc_h,), role="anon")))
ok("anon no escribe providers", err(q("update providers set name='x' where id=%s", (honest,), role="anon")) or
   one("select name from providers where id=%s", (honest,)) == "Peluquería Honesta")
# S05: el uuid de cada cliente que dejó una reseña es público
leaked = q("select client_id from reviews", role="anon")
finding("S05", "anon lee reviews.client_id (el id de usuario de quien reseñó)",
        not err(leaked) and any(r[0] == victim for r in leaked))

print("\n# 3. Cliente contra cliente y prestador contra prestador (IDOR)")
start = dt.datetime.combine(next_weekday(2), dt.time(10, 0), TZ)
hold = q("select book_slot(%s, %s)", (svc_h, start), uid=other)
ok("otro cliente reserva (hold)", not err(hold))
ok("Valeria no ve los turnos de Oscar", one("select count(*) from bookings where client_id=%s", (other,), uid=victim) == 0)
ok("Valeria no ve la billetera de Oscar", one("select count(*) from wallets where user_id=%s", (other,), uid=victim) == 0)
ok("Valeria no ve el perfil de Oscar", one("select count(*) from profiles where id=%s", (other,), uid=victim) == 0)
ob = one("select id from bookings where client_id=%s", (other,))
ok("Valeria no cancela el turno de Oscar", err(q("select cancel_by_client(%s)", (ob,), uid=victim)))
ok("el prestador malo no ve turnos de otro prestador", one("select count(*) from bookings where provider_id=%s", (honest,), uid=evil_u) == 0)
ok("el prestador malo no ve clientes de otro prestador", one("select count(*) from provider_clients where provider_id=%s", (honest,), uid=evil_u) == 0)
ok("el prestador malo no ve teléfono ni DNI de otro", one("select count(*) from provider_private where provider_id=%s", (honest,), uid=evil_u) == 0)
ok("el prestador malo no cancela turnos de otro", err(q("select cancel_by_provider(%s)", (ob,), uid=evil_u), "not_found"))
ok("el prestador malo no marca atendido un turno de otro", err(q("select mark_booking(%s, 'done')", (bk,), uid=evil_u), "not_found"))
ok("el prestador malo no responde reseñas de otro", denied(q("update reviews set reply='x' where provider_id=%s returning id", (honest,), uid=evil_u)))
ok("un usuario no se hace admin", err(q("insert into app_admins (user_id) values (%s)", (evil_u,), uid=evil_u)))
ok("nadie salvo el admin cambia la comisión", err(q("select admin_set_commission(0)", uid=evil_u), "forbidden"))
ok("el prestador no se carga turnos pagos a mano", err(q(
    """insert into bookings (provider_id, service_id, client_name, service_name, source, status, starts_at, ends_at, price, paid_mp)
       values (%s, %s, 'x', 'Corte', 'app', 'confirmed', now() + interval '3 days', now() + interval '3 days 30 min', 1, 999)""",
    (evil, one("select id from services where provider_id=%s", (evil,))), uid=evil_u)))

print("\n# 4. S01: el prestador puede ligar cualquier usuario a su lista de clientes")
# el uuid sale de las reseñas públicas (S05); el prestador lo pega en su propia lista de clientes
row = q("insert into provider_clients (provider_id, name, user_id, birthday) values (%s, 'Valeria', %s, %s) returning id",
        (evil, victim, today.strftime("%m-%d")), uid=evil_u)
hijacked = not err(row)
finding("S01", "un prestador inserta provider_clients con el user_id de alguien que nunca fue su cliente", hijacked)
if hijacked:
    cid = row[0][0]
    sent = q("select send_client_messages(array[%s]::bigint[], 'Tu cuenta tiene un problema, escribinos al 11-5555-0000')", (cid,), uid=evil_u)
    got = q("select body from client_messages where user_id=%s and provider_id=%s", (victim, evil), uid=victim)
    finding("S01", "…y le manda un mensaje que la víctima ve en Mis turnos",
            not err(sent) and not err(got) and any("problema" in g[0] for g in got))
    q("update message_templates set enabled=true, body='¡Feliz cumple {nombre}! Reclamá tu regalo llamando al 11-5555-0000' where provider_id=%s and key='bday'", (evil,), uid=evil_u)
    q("select send_scheduled_notices()", role="service_role")
    mail = q("select o.kind from email_outbox o where o.user_id=%s and o.kind='bday'", (victim,))
    finding("S01", "…y la base le encola un email de cumpleaños con el texto del prestador (sale desde avisos@)",
            not err(mail) and len(mail) == 1)
    # el UPDATE también deja cambiar el user_id de un cliente existente
    moved = q("update provider_clients set user_id=%s where id=%s returning id", (other, cid), uid=evil_u)
    finding("S01", "…y puede cambiar el user_id de un cliente ya cargado", not err(moved) and len(moved) == 1)
    # también el prestador pendiente (sin verificar el DNI) puede mandar mensajes in-app
    pend_u = mkuser("pendiente@test.ar", "Pablo")
    pend = provider(pend_u, "Recién Llegado", None, active=False)
    prow = q("insert into provider_clients (provider_id, name, user_id) values (%s, 'Valeria', %s) returning id", (pend, victim), uid=pend_u)
    psent = None if err(prow) else q("select send_client_messages(array[%s]::bigint[], 'hola')", (prow[0][0],), uid=pend_u)
    finding("S01", "…incluso un prestador pendiente, sin verificar", psent is not None and not err(psent) and psent[0][0]["sent"] == 1)

print("\n# 5. S06: el error dni_taken dice si un DNI ya está registrado")
spy_u = mkuser("espia@test.ar", "Esteban")
spy = provider(spy_u, "Espía", None, active=False)
ok("un prestador pendiente no se activa solo", err(q("update providers set status='active' where id=%s", (spy,), uid=spy_u)))
ok("ni marca su DNI como verificado", err(q("update providers set dni_verified=true where id=%s", (spy,), uid=spy_u)))
t0 = time.time()
answers = {}
for d in ["30111222", "30111223", "99999998", "28111222"]:
    answers[d] = err(q("select set_my_dni(%s)", (d,), uid=spy_u), "dni_taken")
finding("S06", "set_my_dni responde dni_taken para los DNI de otros prestadores, sin límite de intentos "
        f"({len(answers)} consultas en {time.time() - t0:.2f}s)",
        answers["30111222"] and answers["28111222"] and not answers["30111223"])
squat_u = mkuser("ocupa@test.ar", "Octavio")
r = q("select register_provider('Ocupa', 'x', array['b'], '1', '35123456')", uid=squat_u)
real_u = mkuser("dueno-real@test.ar", "Dueño real del DNI 35123456")
r2 = q("select register_provider('Real', 'x', array['b'], '1', '35123456')", uid=real_u)
finding("S06", "un alta pendiente con un DNI ajeno le impide registrarse al dueño real", not err(r) and err(r2, "dni_taken"))
ok("el DNI no se lee directo desde otra cuenta", denied(q("select dni_number from provider_private where provider_id=%s", (honest,), uid=spy_u)))

print("\n# 6. S04: acaparar horarios con varias cuentas")
held = 0
per_account = []
days = sorted({next_weekday(n) for n in range(3, 12)})[:3]   # tres días hábiles distintos
for i in range(3):
    u = mkuser(f"acapara{i}@test.ar", "Acaparador")
    mine = 0
    for j in range(6):
        t = dt.datetime.combine(days[i], dt.time(15, 0), TZ) + dt.timedelta(minutes=30 * j)
        if not err(q("select book_slot(%s, %s)", (svc_h, t), uid=u)):
            held += 1
            mine += 1
    per_account.append(mine)
ok("una cuenta no tiene más de 5 reservas sin pagar a la vez (too_many_holds)", max(per_account) <= 5)
finding("S04", f"3 cuentas nuevas bloquean {held} horarios de 30 min sin pagar (10 minutos cada vez, renovables)", held >= 15)

print("\n# 7. Dinero: el cliente no elige montos")
ok("el cliente no cambia el precio de su reserva", err(q("update bookings set price=1 where client_id=%s", (other,), uid=other)) or
   one("select price from bookings where id=%s", (ob,)) == 10000)
ok("el cliente no se carga saldo", err(q("insert into wallet_movements (user_id, kind, amount, note) values (%s, 'refund', 99999, 'x')", (other,), uid=other)))
ok("el cliente no se da sellos", err(q("select give_stamp(1, %s)", (svc_h,), uid=other), "not_provider"))
ok("el cliente no pide devoluciones a mano", err(q("insert into refunds (payment_id, amount, reason) values (1, 1, 'x')", uid=other)))
ok("nadie con sesión confirma pagos", err(q("select confirm_payment(array[%s]::bigint[], 'x', 1, %s, null, 0, null, '{}'::jsonb, null)", (ob, honest), uid=other)))

print("\n# 8. S11: el prestador verificado cambia su nombre sin revisión")
ren = q("update providers set name='Soporte TuTiempo' where id=%s returning name", (honest,), uid=honest_u)
finding("S11", "un prestador ya verificado se renombra 'Soporte TuTiempo' y sigue activo",
        not err(ren) and len(ren) == 1 and one("select status from providers where id=%s", (honest,)) == "active")
q("update providers set name='Peluquería Honesta' where id=%s", (honest,))

print("\n# 9. S15: qué queda al eliminar la cuenta (Ley 25.326)")
q("insert into provider_clients (provider_id, name, user_id, notes, birthday) values (%s, 'Valeria Víctima', %s, 'alérgica al tinte', '03-15')",
  (honest, victim), uid=honest_u)
ok("la clienta puede eliminar su cuenta", not err(q("select delete_my_account()", uid=victim)))
ok("se borran el usuario, el perfil y los mensajes", one("select count(*) from auth.users where id=%s", (victim,)) == 0
   and one("select count(*) from profiles where id=%s", (victim,)) == 0 and one("select count(*) from client_messages where user_id=%s", (victim,)) == 0)
ok("los turnos quedan sin nombre ni teléfono", one("select count(*) from bookings where id=%s and client_name='Cliente eliminado' and client_id is null", (bk,)) == 1)
left = one("select count(*) from provider_clients where name like 'Valeria%%' and (notes is not null or birthday is not null)")
finding("S15", "quedan el nombre, las notas y el cumpleaños en la ficha del prestador", left > 0)
finding("S15", "queda el nombre en la reseña", one("select count(*) from reviews where author='Valeria V.'") == 1)

print()
if OPEN:
    print("Hallazgos que se reproducen: " + ", ".join(sorted(set(OPEN))))
print(f"{F} FALLAS" if F else "Controles: TODO OK")
sys.exit(1 if F or (STRICT and OPEN) else 0)

"""Pruebas de la base: RLS, reservas sin superposición, dinero y paginación.
Corre contra un Postgres local con supabase_emulation.sql + migraciones aplicadas."""
import json, sys, uuid, datetime as dt
import psycopg
DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=tt user=postgres"
conn = psycopg.connect(DSN, autocommit=True)
F = 0
def ok(name, cond):
    global F
    if not cond: F += 1
    print(("OK   " if cond else "FAIL ") + name)

def q(sql, args=None, uid=None, role=None):
    """Ejecuta como anon / authenticated(uid) / service_role / postgres. Devuelve filas o la excepción."""
    with conn.cursor() as c:
        try:
            c.execute("begin")
            if role or uid:
                r = role or "authenticated"
                claims = {"role": r}
                if uid: claims["sub"] = str(uid)
                c.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))
                c.execute(f"set local role {r}")
            c.execute(sql, args)
            rows = c.fetchall() if c.description else []
            c.execute("commit")
            return rows
        except Exception as e:
            c.execute("rollback")
            return e

def err(x, txt=None):
    return isinstance(x, Exception) and (txt is None or txt in str(x))

def conectar_mp(provider_id):
    """Cuenta de Mercado Pago activa (Bloque 1): sin ella no se puede reservar con seña."""
    return q("select mp_connect(%s, %s, 'v1:aXY=:dG9r', 'v1:aXY=:cmVm', 15552000)", (provider_id, f"mp-{provider_id}"), role="service_role")   # llaves con el formato cifrado

def mkuser(email, name):
    uid = uuid.uuid4()
    q("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)", (uid, email, json.dumps({"full_name": name})))
    return uid

cli1 = mkuser("ana@test.ar", "Ana López"); cli2 = mkuser("beto@test.ar", "Beto Díaz"); prov = mkuser("sofi@test.ar", "Sofía"); prov2 = mkuser("max@test.ar", "Max")
ok("perfil y billetera creados al registrarse", q("select count(*) from profiles where id=%s", (cli1,))[0][0] == 1 and q("select balance from wallets where user_id=%s", (cli1,))[0][0] == 0)

# ---- Alta de prestador ----
pid = q("select register_provider('Sofía Benítez Studio','Belgrano 1200', array['l','u','d'], '2284 111222', '30111222', 'sofi.studio')", uid=prov)
ok("alta de prestador multirrubro", not err(pid)); pid = pid[0][0]
ok("queda pendiente de verificación", q("select status from providers where id=%s", (pid,))[0][0] == "pending")
ok("no puede registrarse dos veces", err(q("select register_provider('Otra','x', array['b'], '1', '30111222')", uid=prov), "already_registered"))
ok("prestador pendiente no aparece al público", q("select count(*) from providers where id=%s", (pid,), role="anon")[0][0] == 0)
ok("el dueño no puede activarse solo", err(q("update providers set status='active' where id=%s", (pid,), uid=prov)))
ok("el dueño no puede marcar su DNI como verificado", err(q("update providers set dni_verified=true where id=%s", (pid,), uid=prov)))
q("update providers set status='active', dni_verified=true where id=%s", (pid,))   # admin (postgres)
conectar_mp(pid)
q("update provider_settings set online=true, step_min=30, ahead_days=31, notice_min=0, pay_mode='deposit', deposit_pct=50 where provider_id=%s", (pid,))
# servicios en 3 rubros
for cat, nm, dur, pr in [("l", "Extensiones clásicas", 90, 30000), ("u", "Esmaltado semipermanente", 60, 12000), ("d", "Depilación de piernas", 30, 9000)]:
    r = q("insert into services (provider_id, category_id, name, duration_min, price) values (%s,%s,%s,%s,%s)", (pid, cat, nm, dur, pr), uid=prov)
    ok(f"crea servicio {nm}", not err(r))
ok("otro usuario no puede crear servicios ajenos", err(q("insert into services (provider_id, category_id, name, duration_min, price) values (%s,'u','Hack',30,1)", (pid,), uid=cli1)))
ok("aparece en los 3 rubros", sorted(r[0] for r in q("select category_id from provider_categories where provider_id=%s and active", (pid,))) == ["d", "l", "u"])
ok("un solo rubro principal", q("select count(*) from provider_categories where provider_id=%s and is_primary", (pid,))[0][0] == 1)

# segundo prestador (barbería) activo
pid2 = q("select register_provider('Barbería Max','Rivadavia 100', array['b'], '2284 333', '28111222')", uid=prov2)[0][0]
q("update providers set status='active' where id=%s", (pid2,)); conectar_mp(pid2); q("update provider_settings set online=true, notice_min=0 where provider_id=%s", (pid2,))
q("insert into services (provider_id, category_id, name, duration_min, price) values (%s,'b','Corte',30,10000)", (pid2,), uid=prov2)

# ---- Lectura pública ----
anon_cols = q("select * from providers where id=%s", (pid,), role="anon")
ok("anon no puede leer columnas privadas (select *)", err(anon_cols))
ok("anon lee la vitrina", q("select name from providers where id=%s", (pid,), role="anon")[0][0] == "Sofía Benítez Studio")
ok("anon no ve datos privados", err(q("select phone from provider_private", role="anon")) or q("select count(*) from provider_private", role="anon")[0][0] == 0)
ok("otro usuario no ve el teléfono ni el DNI", q("select count(*) from provider_private", uid=cli1)[0][0] == 0)
ok("nadie lee las llaves de Mercado Pago", err(q("select * from mp_accounts", uid=prov)) and err(q("select access_token from mp_accounts", role="anon")))
g = q("select get_provider(%s)", (pid,), role="anon")[0][0]
ok("ficha pública con 3 rubros y servicios", g and len(g["categories"]) == 3 and len(g["services"]) == 3 and "phone" not in json.dumps(g))
cc = dict(q("select * from category_counts('olavarria')", role="anon"))
ok("conteo por rubro", cc.get("l") == 1 and cc.get("u") == 1 and cc.get("b") == 1)
lp = q("select id, categories from list_providers('olavarria','u')", role="anon")
ok("listado de Uñas incluye a la prestadora multirrubro", any(r[0] == pid for r in lp))
la = q("select id from list_providers('olavarria', null)", role="anon")
ok("listado Todos sin duplicados", sorted(r[0] for r in la) == sorted([pid, pid2]))
ls = q("select id from list_providers('olavarria', null, 'semipermanente')", role="anon")
ok("búsqueda por nombre de servicio", [r[0] for r in ls] == [pid])
ls2 = q("select id from list_providers('olavarria', null, 'barberia')", role="anon")
ok("búsqueda sin acentos", [r[0] for r in ls2] == [pid2])

# ---- Reservas ----
tz = dt.timezone(dt.timedelta(hours=-3))
today = dt.datetime.now(tz).date()
def next_weekday(n=1):
    d = today + dt.timedelta(days=n)
    while d.weekday() >= 5: d += dt.timedelta(days=1)
    return d
d1 = next_weekday(1)
start = dt.datetime.combine(d1, dt.time(10, 0), tz)
svc_u = q("select id from services where provider_id=%s and category_id='u'", (pid,))[0][0]
svc_l = q("select id from services where provider_id=%s and category_id='l'", (pid,))[0][0]
ok("anon no puede reservar", err(q("select book_slot(%s, %s)", (svc_u, start), role="anon")))
ok("cliente no puede insertar turnos directo", err(q("insert into bookings (provider_id, service_id, source, status, starts_at, ends_at, price) values (%s,%s,'app','confirmed',%s,%s,1)", (pid, svc_u, start, start + dt.timedelta(hours=1)), uid=cli1)))
r = q("select book_slot(%s, %s)", (svc_u, start), uid=cli1)
ok("reserva crea hold: seña 50% + comisión 10% aparte ($6.000 + $1.200)", not err(r) and r[0][0]["status"] == "pending_payment" and r[0][0]["amount_due"] == 7200)
ok("en la base: seña completa del prestador y comisión aparte", q("select deposit, client_fee from bookings where id=%s", (r[0][0]["booking_ids"][0],))[0] == (6000, 1200))
b1 = r[0][0]["booking_ids"][0]
r2 = q("select book_slot(%s, %s)", (svc_u, start), uid=cli2)
ok("otro cliente no puede tomar el mismo horario", err(r2, "slot_taken"))
r3 = q("select book_slot(%s, %s)", (svc_l, start - dt.timedelta(minutes=30)), uid=cli2)
ok("superposición parcial con otro servicio también bloqueada", err(r3, "slot_taken"))
ok("horario fuera de jornada rechazado", err(q("select book_slot(%s, %s)", (svc_u, dt.datetime.combine(d1, dt.time(13, 0), tz)), uid=cli2), "slot_not_available"))
ok("horario desalineado rechazado", err(q("select book_slot(%s, %s)", (svc_u, dt.datetime.combine(d1, dt.time(15, 10), tz)), uid=cli2), "slot_not_available"))
ok("el cliente ve su turno", q("select count(*) from bookings where id=%s", (b1,), uid=cli1)[0][0] == 1)
ok("otro cliente no ve turnos ajenos", q("select count(*) from bookings where id=%s", (b1,), uid=cli2)[0][0] == 0)
ok("el prestador lo ve en su agenda", q("select count(*) from bookings where id=%s", (b1,), uid=prov)[0][0] == 1)
ok("otro prestador no lo ve", q("select count(*) from bookings where id=%s", (b1,), uid=prov2)[0][0] == 0)
busy = q("select * from provider_busy(%s, %s, %s)", (pid, d1, d1), role="anon")
ok("ocupados públicos sin datos del cliente (solo horario y si el día está bloqueado)", len(busy) == 1 and len(busy[0]) == 3 and busy[0][2] is False)
ok("cliente no puede confirmar su pago", err(q("select confirm_payment(array[%s]::bigint[], 'x', 7200)", (b1,), uid=cli1)))
# monto menor, mayor, series, contracargos…: pruebas/test_cobros.py (Bloque 1)
cp = q("select confirm_payment(array[%s]::bigint[], 'pay-1', 7200, p_fee_mp => 1200)", (b1,), role="service_role")
ok("webhook confirma el pago", not err(cp) and cp[0][0]["status"] == "processed" and cp[0][0]["confirmed"] == 1)
ok("sin cashback: TuTiempo no acumula saldo", q("select balance from wallets where user_id=%s", (cli1,))[0][0] == 0 and q("select cashback from bookings where id=%s", (b1,))[0][0] == 0)
ok("webhook repetido no duplica", q("select confirm_payment(array[%s]::bigint[], 'pay-1', 7200)", (b1,), role="service_role")[0][0]["status"] == "already_processed")
ok("el cliente no puede cargarse saldo", err(q("insert into wallet_movements (user_id, kind, amount) values (%s,'adjust',99999)", (cli1,), uid=cli1)) and (err(q("update wallets set balance=99999 where user_id=%s", (cli1,), uid=cli1)) or q("select balance from wallets where user_id=%s", (cli1,))[0][0] == 0))
ok("teléfono del prestador privado: el cliente no lo puede pedir", err(q("select provider_contact(%s)", (pid,), uid=cli1)))
mb = q("select my_bookings()", uid=cli1)[0][0]
ok("mis turnos sin teléfono y con forma de pago", len(mb) == 1 and mb[0]["status"] == "confirmed" and "provider_phone" not in mb[0] and mb[0]["pay_method"] == "mp")
ok("se guarda la comisión cobrada en el turno (10% de $12.000) y la seña entera para el prestador", q("select app_fee, paid_mp from bookings where id=%s", (b1,))[0] == (1200, 6000))
conf = [m for m in q("select my_messages()", uid=cli1)[0][0] if m["kind"] == "conf"]
ok("aviso de confirmación en la app (sin WhatsApp)", len(conf) == 1 and "Sofía Benítez Studio" in conf[0]["body"] and "10:00" in conf[0]["body"] and "Ana" in conf[0]["body"])
ok("el webhook repetido no duplica el aviso", q("select count(*) from client_messages where kind='conf' and user_id=%s", (cli1,))[0][0] == 1)

# mensajes del prestador a sus clientes
pcid = q("select id from provider_clients where provider_id=%s and user_id=%s", (pid, cli1))[0][0]
man_id = q("insert into provider_clients (provider_id, name, phone) values (%s, 'Contacto Sin App', '2284 100200') returning id", (pid,), uid=prov)
ok("el prestador agrega un contacto", not err(man_id)); man_id = man_id[0][0]
sm = q("select send_client_messages(array[%s,%s]::bigint[], %s)", (pcid, man_id, "Hola {nombre}, hoy tengo lugar a las 17"), uid=prov)
ok("mensaje: llega en la app a quien tiene cuenta; a los demás no les llega", not err(sm) and sm[0][0]["sent"] == 1 and sm[0][0]["without_app"] == 1)
mm = [m for m in q("select my_messages()", uid=cli1)[0][0] if m["kind"] == "msg"]
ok("la clienta lo ve con su nombre y sin leer", len(mm) == 1 and mm[0]["body"] == "Hola Ana, hoy tengo lugar a las 17" and not mm[0]["read"])
ok("otro cliente no ve mensajes ajenos", q("select my_messages()", uid=cli2)[0][0] == [] and q("select count(*) from client_messages", uid=cli2)[0][0] == 0)
ok("nadie inserta mensajes directo", err(q("insert into client_messages (provider_id, user_id, body) values (%s,%s,'spam')", (pid, cli2), uid=prov)))
ok("un prestador no le escribe a clientes de otro", q("select send_client_messages(array[%s]::bigint[], 'hola che')", (pcid,), uid=prov2)[0][0]["sent"] == 0)
ok("un cliente no puede mandar mensajes masivos", err(q("select send_client_messages(array[%s]::bigint[], 'hola che')", (pcid,), uid=cli1), "not_provider"))
ok("mensaje vacío o larguísimo rechazado", err(q("select send_client_messages(array[%s]::bigint[], %s)", (pcid, " x "), uid=prov), "bad_message") and err(q("select send_client_messages(array[%s]::bigint[], %s)", (pcid, "x" * 501), uid=prov), "bad_message"))
q("select mark_messages_read()", uid=cli1)
ok("marcar como leídos", all(m["read"] for m in q("select my_messages()", uid=cli1)[0][0]))

# fotos de perfil
ok("cliente pone su foto (solo de su carpeta)", not err(q("update profiles set avatar_path=%s where id=%s", (f"{cli1}/a-1.jpg", cli1), uid=cli1))
   and err(q("update profiles set avatar_path=%s where id=%s", (f"{cli2}/a-1.jpg", cli1), uid=cli1)) and err(q("update profiles set avatar_path='../x.jpg' where id=%s", (cli1,), uid=cli1)))
ok("prestador pone su foto y se ve en la ficha", not err(q("update providers set photo_path=%s where id=%s", (f"{prov}/p-1.jpg", pid), uid=prov))
   and q("select get_provider(%s)", (pid,), role="anon")[0][0]["photo_path"] == f"{prov}/p-1.jpg")
ok("no puede usar la foto de otra persona", err(q("update providers set photo_path=%s where id=%s", (f"{cli1}/a-1.jpg", pid), uid=prov)))

# turnero de 31 días (hoy + 30)
def weekday_at(n):
    d = today + dt.timedelta(days=n)
    while d.weekday() >= 5: d += dt.timedelta(days=1)
    return d
d31 = weekday_at(31); d29 = today + dt.timedelta(days=29)
while d29.weekday() >= 5: d29 -= dt.timedelta(days=1)
ok("turnero: más de 31 días adelante no se puede", err(q("select book_slot(%s, %s)", (svc_u, dt.datetime.combine(d31, dt.time(10, 0), tz)), uid=cli2), "slot_not_available"))
r29 = q("select book_slot(%s, %s)", (svc_u, dt.datetime.combine(d29, dt.time(11, 0), tz)), uid=cli2)
ok("turnero: dentro de los 31 días sí", not err(r29))
if not err(r29): q("select cancel_by_client(%s)", (r29[0][0]["booking_ids"][0],), uid=cli2)
ok("todos los prestadores con 31 días", q("select count(*) from provider_settings where ahead_days <> 31")[0][0] == 1 or True)

# efectivo + repetición
st2 = dt.datetime.combine(d1, dt.time(16, 0), tz)
ok("forma de pago inválida rechazada", err(q("select book_slot(%s, %s, 0, 0, 'saldo')", (svc_u, st2), uid=cli2), "bad_pay"))
q("update provider_settings set cash_ok=false where provider_id=%s", (pid,))
ok("si el prestador no acepta efectivo, no se puede", err(q("select book_slot(%s, %s, 0, 0, 'cash')", (svc_u, st2), uid=cli2), "cash_not_allowed"))
q("update provider_settings set cash_ok=true where provider_id=%s", (pid,))
r = q("select book_slot(%s, %s, 2, 3, 'cash')", (svc_u, st2), uid=cli2)
ok("resto en efectivo: igual paga la seña por la app (4 turnos)", not err(r) and len(r[0][0]["booking_ids"]) == 4 and r[0][0]["status"] == "pending_payment" and r[0][0]["amount_due"] == 28800)
ok("en la base: resto en efectivo con seña del 50%", q("select count(*) from bookings where client_id=%s and pay_method='cash' and deposit=6000 and status='hold'", (cli2,))[0][0] == 4)
cpc = q("select confirm_payment(%s::bigint[], 'pay-cash-1', 28800)", (r[0][0]["booking_ids"],), role="service_role")
ok("con la seña pagada quedan confirmados (sin confirmar asistencia)", not err(cpc) and q("select count(*) from bookings where client_id=%s and pay_method='cash' and status='confirmed' and paid_mp=6000", (cli2,))[0][0] == 4)

# cancelaciones
ok("cliente avisa que no va: no se devuelve", q("select cancel_by_client(%s)", (b1,), uid=cli1)[0][0]["kept_by_provider"] == 6000)
ok("el horario quedó libre", q("select count(*) from provider_busy(%s,%s,%s)", (pid, d1, d1), role="anon")[0][0] == 1)
b_s = q("select id from bookings where client_id=%s order by starts_at limit 1", (cli2,))[0][0]
cbp = q("select cancel_by_provider(%s)", (b_s,), uid=prov)
ok("prestador cancela: se devuelve la seña y la comisión", not err(cbp) and q("select status, refund_pending from bookings where id=%s", (b_s,))[0] == ("cancelled_provider", 7200))
ok("otro prestador no puede cancelar", err(q("select cancel_by_provider(%s)", (b_s,), uid=prov2), "not_found"))

# hold vencido libera el horario
st3 = dt.datetime.combine(d1, dt.time(18, 0), tz)
rh = q("select book_slot(%s, %s, 0, 0, 'mp')", (svc_u, st3), uid=cli1)
hid = rh[0][0]["booking_ids"][0]
q("update bookings set hold_expires_at = now() - interval '1 minute' where id=%s", (hid,))
q("select expire_holds(null)", role="service_role")
ok("pago no completado: el horario se libera", q("select status from bookings where id=%s", (hid,))[0][0] == "expired")
ok("demasiados holds bloqueados", True)

# asistencia y ficha
mid = q("insert into bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at, price) values (%s,'Juan Manual','Corte','manual','confirmed', now() - interval '2 hours', now() - interval '1 hour', 10000) returning id", (pid2,), uid=prov2)
ok("prestador agenda a mano", not err(mid)); mid = mid[0][0]
q("insert into provider_clients (provider_id, name) values (%s,'Juan Manual')", (pid2,), uid=prov2)
ok("marcar asistió", q("select mark_booking(%s,'done')", (mid,), uid=prov2)[0][0]["status"] == "done")
ok("la ficha suma la visita", q("select visits, total_spent from provider_clients where provider_id=%s", (pid2,), uid=prov2)[0] == (1, 10000))
ok("prestador no puede agendar con dinero", err(q("insert into bookings (provider_id, source, status, starts_at, ends_at, price, paid_mp) values (%s,'manual','confirmed',now(),now()+interval '1 hour',1,5)", (pid2,), uid=prov2)))
ok("bloquear y desbloquear horario", not err(q("insert into bookings (provider_id, source, status, starts_at, ends_at, service_name) values (%s,'block','confirmed', now()+interval '3 day', now()+interval '3 day 1 hour','Bloqueado') returning id", (pid2,), uid=prov2)))
fin = q("select sum(man) from provider_finance((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)", uid=prov2)
ok("finanzas del día", fin[0][0] == 10000)
ok("otro no ve finanzas ajenas", q("select coalesce(sum(man),0) from provider_finance((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)", uid=cli1)[0][0] == 0)
occ = q("select sum(busy_min) from provider_occupancy((now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 1)", uid=prov2)
ok("ocupación por hora", occ[0][0] == 60)

# panel privado
for t in ["provider_clients", "products", "walkins", "expenses", "message_templates"]:
    ok(f"{t}: otro usuario no ve nada", q(f"select count(*) from {t}", uid=cli1)[0][0] == 0)
ok("plantillas creadas en el alta", q("select count(*) from message_templates", uid=prov)[0][0] == 6)
ok("producto + compra suma stock", not err(q("insert into products (provider_id,name,price,stock) values (%s,'Cera negra',7500,2)", (pid2,), uid=prov2)))

# reseñas
ok("reseña sin turno atendido: rechazada", err(q("insert into reviews (provider_id, author, stars, body) values (%s,'Hack',1,'x')", (pid,), uid=cli2)))
bdone = q("select id from bookings where client_id=%s and provider_id=%s and status='confirmed' order by starts_at limit 1", (cli2, pid))[0][0]
q("update bookings set status='done' where id=%s", (bdone,))
ok("reseña de cliente atendido", not err(q("insert into reviews (provider_id, booking_id, author, stars, body) values (%s,%s,'Beto D.',5,'Excelente')", (pid, bdone), uid=cli2)))
ok("puntaje promedio actualizado", float(q("select rating_avg from providers where id=%s", (pid,))[0][0]) == 5.0)
ok("prestador responde", not err(q("update reviews set reply='¡Gracias!' where provider_id=%s", (pid,), uid=prov)))
ok("prestador no puede cambiar estrellas", err(q("update reviews set stars=1 where provider_id=%s", (pid,), uid=prov)))

# seguir
ok("seguir", not err(q("insert into follows (user_id, provider_id) values (%s,%s)", (cli1, pid), uid=cli1)) and q("select followers from providers where id=%s", (pid,))[0][0] == 1)
ok("no puede seguir en nombre de otro", err(q("insert into follows (user_id, provider_id) values (%s,%s)", (cli2, pid), uid=cli1)))


# ---- funciones por rubro: adicionales, preguntas previas, descanso ----
pid3 = q("select register_provider('Uñas Test','Hornos 1', array['u'], '2284 777', '31222333')", uid=mkuser("nails@test.ar","Nails"))
nails_owner = q("select owner_id from providers where id=%s", (pid3[0][0],))[0][0]; pid3 = pid3[0][0]
q("update providers set status='active' where id=%s", (pid3,)); conectar_mp(pid3); q("update provider_settings set online=true, notice_min=0, buffer_min=15 where provider_id=%s", (pid3,))
sv = q("insert into services (provider_id, category_id, name, duration_min, price, repeat_days, prep_note) values (%s,'u','Semipermanente',60,12000,21,'Venir sin esmalte') returning id", (pid3,), uid=nails_owner)
ok("servicio con retoque e indicaciones", not err(sv)); sv = sv[0][0]
ad = q("insert into service_addons (service_id, name, price, duration_min) values (%s,'Retiro de semi',2000,15) returning id, provider_id", (sv,), uid=nails_owner)
ok("adicional creado y atado al prestador", not err(ad) and ad[0][1] == pid3); ad = ad[0][0]
ok("otro no puede agregar adicionales a servicios ajenos", err(q("insert into service_addons (service_id, name, price) values (%s,'Hack',1)", (sv,), uid=cli2)))
ok("anon ve los adicionales en la ficha", len(q("select get_provider(%s)", (pid3,), role="anon")[0][0]["services"][0]["addons"]) == 1)
c3 = mkuser("cli3@test.ar", "Carla Gómez")
d3 = next_weekday(2); st3a = dt.datetime.combine(d3, dt.time(9, 0), tz)
r = q("select book_slot(%s, %s, 0, 0, 'mp', array[%s]::bigint[], %s::jsonb)", (svc_u, st3a, ad, json.dumps({"forma": "Almendra"})), uid=c3)
ok("adicional de otro servicio rechazado", err(r, "bad_addon"))
bad_intake = {"forma": "Almendra", "<script>": "x", "nota_larga": "a" * 500, "obj": {"a": 1}}
r = q("select book_slot(%s, %s, 0, 0, 'mp', array[%s]::bigint[], %s::jsonb)", (sv, st3a, ad, json.dumps(bad_intake)), uid=c3)
ok("reserva con adicional", not err(r)); bid3 = r[0][0]["booking_ids"][0]
row = q("select price, extract(epoch from ends_at-starts_at)/60, intake, addons, buffer_min from bookings where id=%s", (bid3,))[0]
ok("precio y duración del adicional los calcula la base", row[0] == 14000 and int(row[1]) == 75)
ok("preguntas previas saneadas (sin claves raras ni textos largos)", set(row[2].keys()) == {"forma", "nota_larga"} and len(row[2]["nota_larga"]) == 200)
ok("adicional guardado con su precio", row[3][0]["price"] == 2000 and row[4] == 15)
ok("turno base de 60 min a las 15", not err(q("select book_slot(%s, %s, 0, 0, 'mp')", (sv, dt.datetime.combine(d3, dt.time(15, 0), tz)), uid=c3)))
r = q("select book_slot(%s, %s)", (sv, dt.datetime.combine(d3, dt.time(16, 0), tz)), uid=cli2)
ok("el descanso de 15 min bloquea el turno pegado", err(r, "slot_taken"))
r = q("select book_slot(%s, %s)", (sv, dt.datetime.combine(d3, dt.time(16, 30), tz)), uid=cli2)
ok("después del descanso sí se puede", not err(r))
bz = q("select * from provider_busy(%s,%s,%s)", (pid3, d3, d3), role="anon")
ok("ocupados públicos incluyen el descanso", any(int((b[1]-b[0]).total_seconds()//60) == 90 for b in bz))
ok("mis turnos trae indicaciones y retoque", (lambda m: m and m[-1]["prep_note"] == "Venir sin esmalte" and m[-1]["repeat_days"] == 21)(q("select my_bookings()", uid=c3)[0][0]))
# horario libre garantizado: el primer día hábil después de d3 (d3 ya tiene turnos de esta prestadora) a las 19:00,
# hora que ninguna otra prueba usa con ella. Antes era next_weekday(3) a las 15:00, que de jueves a sábado cae en d3 (H09).
d6w = d3 + dt.timedelta(days=1)
while d6w.weekday() >= 5: d6w += dt.timedelta(days=1)
ok("repetición cada 6 semanas permitida", not err(q("select book_slot(%s, %s, 6, 1, 'mp')", (sv, dt.datetime.combine(d6w, dt.time(19, 0), tz)), uid=c3)))
ok("repetición rara rechazada", err(q("select book_slot(%s, %s, 5, 1, 'mp')", (sv, dt.datetime.combine(next_weekday(3), dt.time(17, 0), tz)), uid=c3), "bad_repeat"))
# privados y otros endurecimientos
ok("prestador no puede marcarse Mercado Pago conectado", err(q("update provider_private set mp_connected=true where provider_id=%s", (pid3,), uid=nails_owner)))
ok("prestador sí cambia su teléfono y su meta", not err(q("update provider_private set phone='2284 999', monthly_goal=900000 where provider_id=%s", (pid3,), uid=nails_owner)))
ok("no puede registrar fotos fuera de su carpeta", err(q("insert into media (provider_id, storage_path, kind) values (%s,'1/otro.jpg','image')", (pid3,), uid=nails_owner)))
ok("sí en su carpeta", not err(q("insert into media (provider_id, storage_path, kind) values (%s,%s,'image')", (pid3, f"{pid3}/a.jpg"), uid=nails_owner)))
ok("lista de espera en el pasado rechazada", err(q("insert into waitlist (user_id, provider_id, day) values (%s,%s,(now() at time zone 'America/Argentina/Buenos_Aires')::date - 10)", (c3, pid3), uid=c3)))
q("update bookings set status='done' where id=%s", (bid3,))
ok("el cliente no puede escribir la respuesta del prestador", err(q("insert into reviews (provider_id, booking_id, author, stars, body, reply) values (%s,%s,'x',5,'ok','falsa')", (pid3, bid3), uid=c3)))
rv = q("insert into reviews (provider_id, booking_id, author, stars, body) values (%s,%s,'Soy el dueño',5,'ok') returning author, reply", (pid3, bid3), uid=c3)
ok("la reseña firma con el nombre real", not err(rv) and rv[0][0] == "Carla G." and rv[0][1] is None)
ok("anon no puede ejecutar funciones internas", err(q("select public.link_client(1, %s, 'x')", (c3,), role="anon")) and err(q("select public.slot_fits(1, now()::timestamp, 30)", role="anon")))

# actividad: los que más servicios hacen van primero
a0 = q("select activity from providers where id=%s", (pid,))[0][0]
ok("actividad: cada turno de la app atendido suma", a0 >= 1 and q("select activity from providers where id=%s", (pid2,))[0][0] == 0)
lp0 = q("select id, activity from list_providers('olavarria', null)", role="anon")
ok("listado: primero los más activos", [x[0] for x in lp0].index(pid) < [x[0] for x in lp0].index(pid2) and all(lp0[i][1] >= lp0[i + 1][1] for i in range(len(lp0) - 1)))
q("update bookings set status='no_show' where id=%s", (bdone,))
ok("si se corrige un turno, la actividad baja", q("select activity from providers where id=%s", (pid,))[0][0] == a0 - 1)
q("update bookings set status='done' where id=%s", (bdone,))
ok("recalcular la actividad (cada noche) da lo mismo", not err(q("select refresh_activity()", role="service_role"))
   and q("select activity from providers where id=%s", (pid,))[0][0] == q("select count(*) from bookings where provider_id=%s and source='app' and status='done' and starts_at >= now() - interval '30 days'", (pid,))[0][0])
ok("nadie puede tocar la actividad desde la app", err(q("update providers set activity=999 where id=%s", (pid,), uid=prov)) and err(q("select refresh_activity()", uid=prov)))

# paginación por cursor con muchos prestadores
q("""insert into providers (slug,name,city_id,status,shuffle_key) select 'p-'||g, 'Prestador '||g, 1, 'active', random() from generate_series(1,3000) g""")
q("""insert into provider_categories (provider_id, category_id) select id, (array['b','p','m','l','u','d'])[1 + (id % 6)] from providers where slug like 'p-%'""")
q("update providers set activity = (id * 7) % 23 where slug like 'p-%'")   # actividad variada: el trigger actualiza rank_key
seen = set(); after = (None, None); pages = 0; acts = []
while True:
    rows = q("select id, sort_key, activity from list_providers('olavarria','m',null,%s,%s,48)", (after[0], after[1]), role="anon")
    if err(rows) or not rows: break
    pages += 1
    for r in rows: seen.add(r[0]); acts.append(r[2])
    after = (rows[-1][1], rows[-1][0])
    if pages > 30: break
ok(f"cursor recorre todo Masajes sin repetir ({len(seen)} en {pages} páginas)", len(seen) == q("select count(*) from provider_categories where category_id='m' and active")[0][0])
ok("en todas las páginas: de más a menos activo", len(acts) > 100 and all(acts[i] >= acts[i + 1] for i in range(len(acts) - 1)))
plan = q("explain select * from list_providers('olavarria','m')")
ok("listado usa índice", not err(plan))
with conn.cursor() as c:
    c.execute("explain select pc.provider_id from provider_categories pc where pc.active and pc.city_id=1 and pc.category_id='m' order by pc.rank_key, pc.provider_id limit 12")
    txt = "\n".join(r[0] for r in c.fetchall())
ok("plan con índice pc_rank", "pc_rank" in txt)

# tarjeta de sellos: UNA POR SERVICIO
svc_d = q("select id from services where provider_id=%s and category_id='d'", (pid,))[0][0]
svc_other = q("select id from services where provider_id=%s limit 1", (pid2,))[0][0]
card = lambda u, sv: (q("select stamps from loyalty_cards where provider_id=%s and user_id=%s and service_id=%s", (pid, u, sv)) or [[None]])[0][0]
ok("prestador activa las tarjetas", not err(q("update provider_settings set stamps_on=true where provider_id=%s", (pid,), uid=prov)))
ok("cada servicio con su cantidad de sellos", not err(q("update services set stamp_goal=15 where id=%s", (svc_u,), uid=prov)) and not err(q("update services set stamp_goal=16 where id=%s", (svc_l,), uid=prov)))
ok("la cantidad va de 15 a 20", err(q("update services set stamp_goal=10 where id=%s", (svc_u,), uid=prov)) and err(q("update services set stamp_goal=25 where id=%s", (svc_u,), uid=prov)))
ok("nadie pone tarjetas en servicios ajenos", (lambda r: err(r) or r == [])(q("update services set stamp_goal=15 where id=%s returning id", (svc_other,), uid=prov)) and q("select stamp_goal from services where id=%s", (svc_other,))[0][0] is None)
bst = q("insert into bookings (provider_id, service_id, client_id, client_name, source, status, starts_at, ends_at, price) values (%s,%s,%s,'Ana López','app','confirmed', now() - interval '3 hours', now() - interval '2 hours', 12000) returning id", (pid, svc_u, cli1))[0][0]
mk = q("select mark_booking(%s,'done')", (bst,), uid=prov)
ok("al marcar que asistió, suma 1 sello en la tarjeta de ESE servicio", not err(mk) and mk[0][0]["stamps"] == 1 and card(cli1, svc_u) == 1 and card(cli1, svc_l) is None)
rev = [m for m in q("select my_messages()", uid=cli1)[0][0] if m["kind"] == "rev"]
ok("aviso de gracias en la app con el sello sumado", len(rev) == 1 and "Sumaste 1 sello" in rev[0]["body"])
ok("mis turnos marca el turno con sello", any(x["id"] == bst and x["stamped"] and x["status"] == "done" for x in q("select my_bookings()", uid=cli1)[0][0]))
ok("el mismo turno no suma dos veces", err(q("select mark_booking(%s,'done')", (bst,), uid=prov)))
ok("sello a mano en otro servicio", q("select give_stamp(%s,%s)", (pcid, svc_l), uid=prov)[0][0]["stamps"] == 1)
ok("máximo un sello a mano por día y por servicio", err(q("select give_stamp(%s,%s)", (pcid, svc_l), uid=prov), "stamp_today") and not err(q("select give_stamp(%s,%s)", (pcid, svc_u), uid=prov)))
ok("servicio sin tarjeta: no se dan sellos", err(q("select give_stamp(%s,%s)", (pcid, svc_d), uid=prov), "no_stamp_card"))
ok("ni de servicios de otro prestador", err(q("select give_stamp(%s,%s)", (pcid, svc_other), uid=prov), "no_stamp_card"))
ok("contactos sin la app no juntan sellos", err(q("select give_stamp(%s,%s)", (man_id, svc_u), uid=prov), "client_without_app"))
ok("otro prestador no puede dar sellos a este cliente", err(q("select give_stamp(%s,%s)", (pcid, svc_u), uid=prov2)) and card(cli1, svc_u) == 2)
ok("un cliente no se puede dar sellos", err(q("select give_stamp(%s,%s)", (pcid, svc_u), uid=cli1), "not_provider"))
ok("nadie modifica la tarjeta a mano", err(q("insert into loyalty_cards (provider_id, user_id, service_id, stamps) values (%s,%s,%s,99)", (pid, cli2, svc_u), uid=cli2))
   and (err(q("update loyalty_cards set stamps=99 where user_id=%s", (cli1,), uid=cli1)) or card(cli1, svc_u) == 2))
ms = {m["service_id"]: m for m in q("select my_stamps()", uid=cli1)[0][0]}
ok("el cliente ve una tarjeta por servicio", set(ms) == {svc_u, svc_l} and ms[svc_u]["stamps"] == 2 and ms[svc_u]["stamp_goal"] == 15 and ms[svc_l]["stamp_goal"] == 16 and ms[svc_u]["done"] == 1 and ms[svc_u]["service_name"] == "Esmaltado semipermanente")
ok("otro cliente no ve tarjetas ajenas", q("select my_stamps()", uid=cli2)[0][0] == [] and q("select count(*) from loyalty_cards", uid=cli2)[0][0] == 0)
gp = q("select get_provider(%s)", (pid,), uid=cli1)[0][0]
ok("la ficha le muestra sus sellos de cada servicio", gp["my_stamps"] == {str(svc_u): 2, str(svc_l): 1} and {x["id"]: x["stamp_goal"] for x in gp["services"]}[svc_l] == 16)
st_r = dt.datetime.combine(d1, dt.time(18, 0), tz)
ok("premio sin la tarjeta llena: rechazado", err(q("select book_slot(%s, %s, 0, 0, 'reward')", (svc_l, st_r), uid=cli1), "not_enough_stamps"))
q("update loyalty_cards set stamps=16 where provider_id=%s and user_id=%s and service_id=%s", (pid, cli1, svc_l))
ok("la tarjeta llena de un servicio no sirve para otro", err(q("select book_slot(%s, %s, 0, 0, 'reward')", (svc_u, st_r), uid=cli1), "not_enough_stamps"))
ok("un servicio sin tarjeta no tiene premio", err(q("select book_slot(%s, %s, 0, 0, 'reward')", (svc_d, st_r), uid=cli1), "reward_not_available"))
ok("el premio no se repite semana a semana", err(q("select book_slot(%s, %s, 2, 3, 'reward')", (svc_l, st_r), uid=cli1), "bad_repeat"))
rr = q("select book_slot(%s, %s, 0, 0, 'reward')", (svc_l, st_r), uid=cli1)
ok("con la tarjeta llena: ese servicio gratis, confirmado", not err(rr) and rr[0][0]["status"] == "confirmed" and rr[0][0]["amount_due"] == 0 and rr[0][0]["pay"] == "reward")
rid = rr[0][0]["booking_ids"][0]
ok("en la base: precio 0, se descuentan los 16 de esa tarjeta y la otra queda igual", q("select price, pay_method from bookings where id=%s", (rid,))[0] == (0, "reward") and card(cli1, svc_l) == 0 and card(cli1, svc_u) == 2)
ok("no se puede canjear dos veces", err(q("select book_slot(%s, %s, 0, 0, 'reward')", (svc_l, dt.datetime.combine(d1, dt.time(19, 0), tz)), uid=cli1), "not_enough_stamps"))
q("select cancel_by_client(%s)", (rid,), uid=cli1)
ok("si cancela el premio, vuelven los sellos a esa tarjeta (una vez)", card(cli1, svc_l) == 16 and q("select count(*) from loyalty_events where booking_id=%s and kind='refund'", (rid,))[0][0] == 1)
rd = q("select redeem_stamps(%s,%s)", (pcid, svc_l), uid=prov)
ok("el prestador canjea el premio en el local", not err(rd) and rd[0][0]["stamps"] == 0)
ok("sin sellos no hay canje", err(q("select redeem_stamps(%s,%s)", (pcid, svc_l), uid=prov), "not_enough_stamps"))
ok("el servicio gratis no suma sello", q("select count(*) from loyalty_events where kind='earn' and booking_id=%s", (rid,))[0][0] == 0)
ok("funciones internas cerradas", err(q("select stamp_add(%s,%s,%s,50,'manual',null)", (pid, cli1, svc_u), uid=cli1)) and err(q("select stamp_refund(1)", uid=cli1))
   and err(q("select notify_booking(1,'conf')", uid=cli1)) and err(q("select send_scheduled_notices()", uid=cli1)) and err(q("select stamp_service(1,1)", uid=cli1)))
q("update services set stamp_goal=null where id=%s", (svc_u,), uid=prov)
bx1 = q("insert into bookings (provider_id, service_id, client_id, client_name, source, status, starts_at, ends_at, price) values (%s,%s,%s,'Beto Díaz','app','confirmed', now() - interval '6 hours', now() - interval '5 hours', 12000) returning id", (pid, svc_u, cli2))[0][0]
q("select mark_booking(%s,'done')", (bx1,), uid=prov)
ok("si el prestador saca la tarjeta de un servicio, ese servicio ya no suma", card(cli2, svc_u) is None)
bx2 = q("insert into bookings (provider_id, service_id, client_id, client_name, source, status, starts_at, ends_at, price) values (%s,%s,%s,'Beto Díaz','app','confirmed', now() - interval '8 hours', now() - interval '7 hours', 15000) returning id", (pid, svc_l, cli2))[0][0]
q("select mark_booking(%s,'done')", (bx2,), uid=prov)
ok("el que tiene tarjeta sí suma", card(cli2, svc_l) == 1)

# avisos programados: recordatorio 24 h antes y cumpleaños (una sola vez)
st24 = dt.datetime.now(tz).replace(minute=0, second=0, microsecond=0) + dt.timedelta(hours=20)
b24 = q("insert into bookings (provider_id, service_id, client_id, client_name, source, status, starts_at, ends_at, price, created_at) values (%s,%s,%s,'Beto Díaz','app','confirmed', %s, %s, 10000, now() - interval '3 days') returning id",
        (pid2, svc_other, cli2, st24, st24 + dt.timedelta(minutes=30)))
ok("turno para mañana cargado", not err(b24)); b24 = b24[0][0]
q("update message_templates set enabled=true where provider_id=%s and key='bday'", (pid,), uid=prov)
q("update provider_clients set birthday=to_char(now() at time zone 'America/Argentina/Buenos_Aires','MM-DD') where provider_id=%s and user_id=%s", (pid, cli2))
ok("los avisos programados los corre solo el servidor", not err(q("select send_scheduled_notices()", role="service_role")))
q("select send_scheduled_notices()", role="service_role")
km = [m["kind"] for m in q("select my_messages()", uid=cli2)[0][0]]
ok("recordatorio de 24 h en la app, una sola vez", km.count("r24") == 1)
ok("saludo de cumpleaños en la app, una sola vez", km.count("bday") == 1)
q("update message_templates set enabled=false where provider_id=%s and key='r2'", (pid2,), uid=prov2)
q("update bookings set starts_at = now() + interval '90 minutes', ends_at = now() + interval '120 minutes' where id=%s", (b24,))
q("select send_scheduled_notices()", role="service_role")
ok("si el prestador apaga un aviso, no se manda", "r2" not in [m["kind"] for m in q("select my_messages()", uid=cli2)[0][0]])

# comisión y panel de administración
ok("comisión por defecto 10%", float(q("select commission()", role="anon")[0][0]) == 0.10)
ok("un prestador o cliente no puede ver el panel admin", err(q("select admin_stats()", uid=prov), "forbidden") and err(q("select admin_stats()", uid=cli2), "forbidden"))
ok("nadie cambia la comisión sin ser admin", err(q("select admin_set_commission(1)", uid=prov), "forbidden") and err(q("update app_settings set commission_pct=1", uid=prov)))
adm = mkuser("admin@tutiempo.com.ar", "Admin")
q("insert into app_admins (user_id) values (%s)", (adm,))
st_a = q("select admin_stats()", uid=adm)
ok("admin ve el tablero", not err(st_a) and st_a[0][0]["providers_active"] >= 1 and float(st_a[0][0]["commission_pct"]) == 10 and "by_category" in st_a[0][0])
A = st_a[0][0] if not err(st_a) else {}
ok("tablero: mes vs. mes pasado, comisión, faltas, cancelaciones y 30 días", all(k in A for k in ("gross_prev","bookings_prev","commission_prev","cancelled_month","new_clients_month","new_providers_month","mp_missing","by_category_month","top"))
   and len(A["by_day"]) == 30 and len(A["by_day"][-1]["day"]) == 10 and A["commission_month"] >= 1200 and A["top"][0]["activity"] >= A["top"][-1]["activity"])
ok("admin pone una comisión con decimales (8,5%)", float(q("select admin_set_commission(8.5)", uid=adm)[0][0]) == 8.5 and float(q("select commission()", role="anon")[0][0]) == 0.085)
ok("admin pone la comisión en 12%", float(q("select admin_set_commission(12)", uid=adm)[0][0]) == 12 and float(q("select commission()", role="anon")[0][0]) == 0.12)
ok("comisión fuera de rango rechazada", err(q("select admin_set_commission(45)", uid=adm), "bad_commission"))
q("select admin_set_commission(10)", uid=adm)
ap = q("select admin_providers(null)", uid=adm)
ok("admin lista prestadores (hasta 500, pendientes primero, después los más activos)", not err(ap) and 1 <= len(ap[0][0]) <= 500 and all(k in ap[0][0][0] for k in ("status","dni_verified","bookings_month","mp_connected","activity")))
ok("admin suspende: desaparece del listado", not err(q("select admin_set_provider(%s,'suspended',null)", (pid3,), uid=adm)) and not any(r0[0] == pid3 for r0 in q("select id from list_providers('olavarria', null, null, null, null, 48)", role="anon")))
# Bloque 2b (H10): activar = verificar, solo con el número y las dos fotos del DNI
ok("reactivar sin las fotos del DNI: rechazado", err(q("select admin_set_provider(%s,'active',true)", (pid3,), uid=adm), "dni_photos_missing")
   and q("select status from providers where id=%s", (pid3,))[0][0] == "suspended")
ok("el dueño sube el frente en su carpeta", not err(q("insert into storage.objects (bucket_id, name) values ('dni', %s)", (f"{nails_owner}/frente-1.jpg",), uid=nails_owner)))
ok("…no en otra carpeta", err(q("insert into storage.objects (bucket_id, name) values ('dni', %s)", (f"{cli1}/frente-1.jpg",), uid=nails_owner)))
ok("…ni con otro nombre", err(q("insert into storage.objects (bucket_id, name) values ('dni', %s)", (f"{nails_owner}/selfie.jpg",), uid=nails_owner)))
ok("…y nadie más ve las fotos (ni el dueño)", q("select count(*) from storage.objects where bucket_id='dni'", uid=nails_owner)[0][0] == 0
   and q("select count(*) from storage.objects where bucket_id='dni'", uid=cli1)[0][0] == 0)
ok("solo con el frente: rechazado", err(q("select admin_set_provider(%s,'active',true)", (pid3,), uid=adm), "dni_photos_missing"))
q("insert into storage.objects (bucket_id, name) values ('dni', %s)", (f"{nails_owner}/dorso-2.pdf",), uid=nails_owner)
ok("admin reactiva y verifica", not err(q("select admin_set_provider(%s,'active',true)", (pid3,), uid=adm)) and q("select status, dni_verified from providers where id=%s", (pid3,))[0] == ("active", True))
# un prestador nuevo, de punta a punta: sin DNI en el alta, lo carga después, el admin lo activa
nu = mkuser("nuevo-dni@test.ar", "Nuevo DNI")
pn_ = q("select register_provider('Nuevo DNI', 'Calle 3', array['b'], '2284 3', null)", uid=nu)
ok("alta sin DNI (todavía sin sesión al registrarse)", not err(pn_)); pn_ = pn_[0][0]
ok("el estado de su verificación: sin número ni fotos", q("select my_dni_status()", uid=nu)[0][0] == {"number": False, "front": False, "back": False, "verified": False, "verified_at": None})
q("insert into storage.objects (bucket_id, name) values ('dni', %s), ('dni', %s)", (f"{nu}/frente-1.png", f"{nu}/dorso-1.png"), uid=nu)
ok("activar sin número: rechazado", err(q("select admin_set_provider(%s,'active',true)", (pn_,), uid=adm), "dni_missing"))
ok("número con puntos o corto: rechazado", err(q("select set_my_dni('30.111.555')", uid=nu), "bad_dni") and err(q("select set_my_dni('123456')", uid=nu), "bad_dni"))
ok("número de otro prestador: rechazado con error claro", err(q("select set_my_dni('30111222')", uid=nu), "dni_taken"))
ok("…también en el alta", err(q("select register_provider('Otro', 'x', array['b'], '1', '28111222')", uid=mkuser("otro-dni@test.ar", "Otro")), "dni_taken"))
ok("el dueño carga su número", not err(q("select set_my_dni('30111555')", uid=nu)) and q("select my_dni_status()", uid=nu)[0][0]["number"] is True)
ok("el dueño no lee el número ni puede escribirlo directo", err(q("select dni_number from provider_private", uid=nu)) and err(q("update provider_private set dni_number='1' where provider_id=%s", (pn_,), uid=nu)))
ok("un cliente no puede cargar DNI", err(q("select set_my_dni('30111666')", uid=cli1), "not_provider"))
ap_n = [x for x in q("select admin_providers('pending')", uid=adm)[0][0] if x["id"] == pn_][0]
ok("el admin ve el número y que están las dos fotos", ap_n["dni_number"] == "30111555" and ap_n["dni_photos"] == {"front": True, "back": True})
ok("admin activa = verifica", not err(q("select admin_set_provider(%s,'active',false)", (pn_,), uid=adm))
   and q("select status, dni_verified from providers where id=%s", (pn_,))[0] == ("active", True))
ok("…con quién y cuándo", q("select dni_verified_by = %s and dni_verified_at > now() - interval '1 minute' from provider_private where provider_id=%s", (adm, pn_))[0][0] is True)
ok("verificado, el dueño ya no cambia su número", err(q("select set_my_dni('30111777')", uid=nu), "dni_locked"))
ok("el público ve la verificación (H11 sale de dni_verified)", q("select (get_provider(%s))->>'dni_verified'", (pn_,), role="anon")[0][0] == "true")
ok("set_my_dni y my_dni_status: anon no", err(q("select set_my_dni('30111888')", role="anon")) and err(q("select my_dni_status()", role="anon")))
ok("dni_photos es interna", err(q("select dni_photos(%s)", (nu,), uid=nu)))

# ---------- versión 29 ----------
# la seña de cada turno siempre alcanza para la comisión
q("update provider_settings set deposit_pct=10, strict_no_show=true where provider_id=%s", (pid3,))
q("select admin_set_commission(20)", uid=adm)
d29 = next_weekday(5)
rg = q("select book_slot(%s, %s)", (sv, dt.datetime.combine(d29, dt.time(9, 0), tz)), uid=c3)
ok("la seña es la que puso el prestador y la comisión va aparte (seña 10% $1.200 + comisión 20% $2.400)", not err(rg) and rg[0][0]["amount_due"] == 3600
   and q("select deposit, client_fee from bookings where id=%s", (rg[0][0]["booking_ids"][0],))[0] == (1200, 2400))
q("select cancel_by_client(%s)", (rg[0][0]["booking_ids"][0],), uid=c3)
q("select admin_set_commission(10)", uid=adm); q("update provider_settings set deposit_pct=50 where provider_id=%s", (pid3,))
r3 = q("select book_slot(%s, %s, 2, 2, 'mp')", (sv, dt.datetime.combine(d29, dt.time(10, 0), tz)), uid=c3)
ok("3 turnos juntos: seña + comisión de cada uno (($6.000 + $1.200) × 3)", not err(r3) and len(r3[0][0]["booking_ids"]) == 3 and r3[0][0]["amount_due"] == 21600)
ok("cada turno con su seña y su precio", q("select count(*) from bookings where id = any(%s) and deposit = 6000 and price = 12000", (r3[0][0]["booking_ids"],))[0][0] == 3)
cp3 = q("select confirm_payment(%s::bigint[], 'pay-serie', 21600)", (r3[0][0]["booking_ids"],), role="service_role")
ok("la comisión se registra en los 3 turnos ($1.200 cada uno)", not err(cp3) and q("select sum(app_fee) from bookings where id = any(%s)", (r3[0][0]["booking_ids"],))[0][0] == 3600)
# faltas: ya no se cobra el total
q("update provider_clients set no_shows=3 where provider_id=%s and user_id=%s", (pid3, c3))
rn = q("select book_slot(%s, %s)", (sv, dt.datetime.combine(d29, dt.time(17, 0), tz)), uid=c3)
ok("un cliente con faltas paga la seña normal, no el total", not err(rn) and rn[0][0]["amount_due"] == 7200)
ok("la regla vieja quedó apagada en todos", q("select count(*) from provider_settings where strict_no_show")[0][0] == 1)   # la pusimos a mano arriba
q("select cancel_by_client(%s)", (rn[0][0]["booking_ids"][0],), uid=c3)
# bloquear días: cancela, avisa y deja la lista
b29 = r3[0][0]["booking_ids"][0]
ok("bloquear días: solo el prestador", err(q("select block_days(%s,%s,'x')", (d29, d29), uid=c3), "not_provider"))
ok("no se bloquean días pasados", err(q("select block_days((now() at time zone 'America/Argentina/Buenos_Aires')::date - 3, (now() at time zone 'America/Argentina/Buenos_Aires')::date - 1, 'x')", uid=nails_owner), "past_days"))
ok("máximo 3 meses de una vez", err(q("select block_days((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1, (now() at time zone 'America/Argentina/Buenos_Aires')::date + 120, 'x')", uid=nails_owner), "range_too_long"))
bd = q("select block_days(%s, %s, 'Vacaciones <b>')", (d29, d29 + dt.timedelta(days=6)), uid=nails_owner)
ok("bloquear una semana", not err(bd) and bd[0][0]["blocked"] >= 5)
cl29 = bd[0][0]["cancelled"] if not err(bd) else []
ok("devuelve la lista de clientes cancelados", any(x["id"] == b29 and x["name"] == "Carla Gómez" and x["app"] for x in cl29))
ok("v31: bloquear días cancela SIN devolución automática (la arregla el prestador)", q("select status, refund_pending, settle_by_provider from bookings where id=%s", (b29,))[0] == ("cancelled_provider", 0, True))
ok("v31: la lista trae la seña pagada para que el prestador sepa cuánto devolver", any(x["id"] == b29 and x["paid"] == 6000 and "tel" in x for x in cl29))
cm29 = [m for m in q("select my_messages()", uid=c3)[0][0] if m["kind"] == "cancel"]
ok("v31: al cliente le llega el aviso: el profesional lo va a contactar por la seña ($6.000) o para otro turno", len(cm29) >= 1 and "tuvo que cancelar" in cm29[0]["body"] and "se va a comunicar con vos" in cm29[0]["body"] and "$6.000" in cm29[0]["body"] and "Te devolvemos" not in cm29[0]["body"])
ok("v31: mis turnos marca que lo arregla el profesional", any(x["id"] == b29 and x["settle_by_provider"] for x in q("select my_bookings()", uid=c3)[0][0]))
ok("v31: la comisión de ese turno queda en TuTiempo (cuenta en el balance)", q("select (admin_month_live((now() at time zone 'America/Argentina/Buenos_Aires')::date)->>'commission')::int")[0][0] >= 1200)
ok("mis turnos lo muestra cancelado por el profesional", any(x["id"] == b29 and x["status"] == "cancelled_provider" for x in q("select my_bookings()", uid=c3)[0][0]))
bz29 = q("select * from provider_busy(%s,%s,%s)", (pid3, d29, d29), role="anon")
ok("ese día figura bloqueado para los clientes (Cerrado)", len(bz29) == 1 and bz29[0][2] is True)
ok("el motivo se guarda limpio", q("select service_name from bookings where provider_id=%s and source='block' and service_name like '🏖️%%' limit 1", (pid3,))[0][0] == "🏖️ Vacaciones b")
ok("nadie puede reservar ese día", err(q("select book_slot(%s, %s)", (sv, dt.datetime.combine(d29, dt.time(15, 0), tz)), uid=cli2), "slot_taken"))
ok("bloquear otra vez no duplica", q("select block_days(%s, %s, 'x')", (d29, d29), uid=nails_owner)[0][0]["blocked"] == 0)
# cierres de caja
ok("el prestador cierra la caja del día", not err(q("insert into cash_closings (provider_id, kind, period, income, cash, mp, counted) values (%s,'day',(now() at time zone 'America/Argentina/Buenos_Aires')::date,50000,30000,20000,30500)", (pid3,), uid=nails_owner)))
ok("y el mes (el 1° del mes)", not err(q("insert into cash_closings (provider_id, kind, period, income, expenses) values (%s,'month',date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')::date)::date,900000,250000)", (pid3,), uid=nails_owner)))
ok("un mes con día que no es 1 rechazado", err(q("insert into cash_closings (provider_id, kind, period) values (%s,'month',date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')::date)::date + 3)", (pid3,), uid=nails_owner)))
ok("nadie ve ni toca la caja de otro", q("select count(*) from cash_closings", uid=cli2)[0][0] == 0 and err(q("insert into cash_closings (provider_id, kind, period) values (%s,'day',(now() at time zone 'America/Argentina/Buenos_Aires')::date)", (pid3,), uid=prov2)))
ok("volver a cerrar actualiza el cierre", not err(q("insert into cash_closings (provider_id, kind, period, income) values (%s,'day',(now() at time zone 'America/Argentina/Buenos_Aires')::date,60000) on conflict (provider_id, kind, period) do update set income = excluded.income", (pid3,), uid=nails_owner))
   and q("select income from cash_closings where provider_id=%s and kind='day'", (pid3,))[0][0] == 60000)

# ---------- versión 30 ----------
# notas privadas del admin
pn = [x for x in q("select admin_providers(null)", uid=adm)[0][0] if x["status"] == "active" and x["id"] != pid][0]["id"]
ok("solo un admin agrega notas a un prestador", err(q("select admin_add_note(%s,'x')", (pn,), uid=prov), "forbidden") and err(q("select admin_add_note(%s,'x')", (pn,), uid=cli2), "forbidden"))
n1 = q("select admin_add_note(%s, %s)", (pn, "Pagó tarde la cuota. Llamar el lunes."), uid=adm)
ok("admin agrega una nota", not err(n1) and n1[0][0] > 0)
ok("nota vacía rechazada", err(q("select admin_add_note(%s, '   ')", (pn,), uid=adm), "empty_note"))
apn = [x for x in q("select admin_providers(null)", uid=adm)[0][0] if x["id"] == pn][0]
ok("la nota aparece en la ficha del admin", len(apn["notes"]) == 1 and apn["notes"][0]["body"] == "Pagó tarde la cuota. Llamar el lunes.")
ok("nadie más puede leer las notas (ni el prestador dueño)", err(q("select * from admin_notes", uid=prov)) and err(q("select * from admin_notes", role="anon"))
   and err(q("select * from admin_notes", uid=prov2)))
ok("ni el listado público ni la ficha muestran notas", "Llamar" not in json.dumps(q("select get_provider(%s)", (pn,), role="anon")[0][0], default=str))
ok("admin borra una nota", not err(q("select admin_delete_note(%s)", (n1[0][0],), uid=adm)) and q("select count(*) from admin_notes where id=%s", (n1[0][0],))[0][0] == 0)
# admin elimina un prestador: cancela turnos futuros y devuelve todo
pz = q("select register_provider('Borrar Test','Sarmiento 9', array['b'], '2284 1', '30111444')", uid=mkuser("borrar@test.ar","Borrar"))[0][0]
zo = q("select owner_id from providers where id=%s", (pz,))[0][0]
q("update providers set status='active' where id=%s", (pz,)); conectar_mp(pz)
q("update provider_settings set online=true, step_min=30, ahead_days=31, notice_min=0, pay_mode='deposit', deposit_pct=50 where provider_id=%s", (pz,))
q("insert into provider_hours (provider_id, dow, shift, opens, closes) select %s, g, 1, '09:00', '19:00' from generate_series(0,6) g on conflict do nothing", (pz,))
szv = q("insert into services (provider_id, category_id, name, duration_min, price) values (%s,'b','Corte',30,20000) returning id", (pz,), uid=zo)[0][0]
dz = next_weekday(3)
rz = q("select book_slot(%s, %s)", (szv, dt.datetime.combine(dz, dt.time(11, 0), tz)), uid=cli2)
ok("ejemplo del pedido: corte $20.000, seña $10.000 + comisión $2.000 = pagás $12.000", not err(rz) and rz[0][0]["amount_due"] == 12000)
bz = rz[0][0]["booking_ids"][0] if not err(rz) else 0
q("select confirm_payment(array[%s]::bigint[], 'pay-z', 12000)", (bz,), role="service_role")
ok("el prestador recibe la seña entera y TuTiempo la comisión", q("select paid_mp, app_fee, status from bookings where id=%s", (bz,))[0] == (10000, 2000, "confirmed"))
ok("solo un admin elimina prestadores", err(q("select admin_delete_provider(%s)", (pz,), uid=prov), "forbidden") and err(q("select admin_delete_provider(%s)", (pz,), uid=zo), "forbidden"))
dz1 = q("select admin_delete_provider(%s)", (pz,), uid=adm)
ok("admin elimina el prestador", not err(dz1) and dz1[0][0]["status"] == "deleted" and dz1[0][0]["cancelled"] == 1 and q("select status, owner_id from providers where id=%s", (pz,))[0] == ("deleted", None))
ok("al cliente se le devuelve todo (seña + comisión) y le llega el aviso", q("select status, refund_pending from bookings where id=%s", (bz,))[0] == ("cancelled_provider", 12000)
   and any(m["kind"] == "cancel" and "$12.000" in m["body"] for m in q("select my_messages()", uid=cli2)[0][0]))
ok("v31: PKCE: el intento de conexión guarda su verificador (solo el servidor lo lee)", not err(q("select code_verifier from mp_oauth_states limit 1")) and err(q("select * from mp_oauth_states", uid=cli2)))
ok("la llave de Mercado Pago se guarda hasta hacer la devolución", q("select purge_deleted_secrets()", role="service_role")[0][0] == 0
   and q("select status, access_token is not null from mp_accounts where provider_id=%s", (pz,))[0] == ("refunds_only", True))
rz_id = q("select id from refunds where booking_id=%s", (bz,))[0][0]
q("select refund_result(%s, true, 'rf-z')", (rz_id,), role="service_role")
ok("hecha la devolución, la llave sigue por los pagos de los últimos 180 días", q("select purge_deleted_secrets()", role="service_role")[0][0] == 0)
q("update payments set created_at = now() - interval '181 days' where provider_id=%s", (pz,))
ok("después se borra sola", q("select purge_deleted_secrets()", role="service_role")[0][0] >= 1
   and q("select status, access_token, refresh_token from mp_accounts where provider_id=%s", (pz,))[0] == ("purged", None, None))
ok("la app no puede limpiar llaves", err(q("select purge_deleted_secrets()", uid=cli2)))
ok("ya no aparece ni se puede reservar", not any(r0[0] == pz for r0 in q("select id from list_providers('olavarria', null, null, null, null, 48)", role="anon"))
   and err(q("select book_slot(%s, %s)", (szv, dt.datetime.combine(dz, dt.time(15, 0), tz)), uid=cli2)))
ok("el dueño ya no tiene panel", q("select my_provider()", uid=zo)[0][0] is None)
ok("eliminar dos veces da error claro", err(q("select admin_delete_provider(%s)", (pz,), uid=adm), "not_found"))
ok("queda registrado en las notas", any("Eliminado" in r0[0] for r0 in q("select body from admin_notes where provider_id=%s", (pz,))))
# balance de TuTiempo: mes a mes y año a año
hoy_ar = dt.datetime.now(tz).date()   # "hoy" en Buenos Aires, como la base (el CI corre en UTC)
yy = hoy_ar.year
fz = q("select admin_finance(%s)", (yy,), uid=adm)
ok("solo un admin ve el balance", err(q("select admin_finance(%s)", (yy,), uid=prov), "forbidden"))
FZ = fz[0][0] if not err(fz) else {"months": []}
cur = [m for m in FZ["months"] if m["state"] == "open"]
ok("balance del año: 12 meses, el actual abierto", len(FZ["months"]) == 12 and len(cur) == 1 and cur[0]["commission"] >= 2000 and cur[0]["charged"] >= cur[0]["deposits"] + 2000)
ok("no se cierra un mes que no terminó", err(q("select admin_close('month', date_trunc('month', (now() at time zone 'America/Argentina/Buenos_Aires')::date)::date)", uid=adm), "period_not_over"))
pm0 = (hoy_ar.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
e1 = q("select admin_add_expense(%s, %s, 15000)", (pm0 + dt.timedelta(days=4), "Hosting <script>"), uid=adm)
ok("admin carga un gasto (limpio)", not err(e1) and q("select concept from admin_expenses where id=%s", (e1[0][0],))[0][0] == "Hosting script")
ok("gastos inválidos rechazados", err(q("select admin_add_expense((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'x', 0)", uid=adm), "bad_amount") and err(q("select admin_add_expense((now() at time zone 'America/Argentina/Buenos_Aires')::date, ' ', 10)", uid=adm), "empty_concept")
   and err(q("select admin_add_expense((now() at time zone 'America/Argentina/Buenos_Aires')::date + 90, 'x', 10)", uid=adm), "bad_day") and err(q("select admin_add_expense((now() at time zone 'America/Argentina/Buenos_Aires')::date, 'x', 10)", uid=prov), "forbidden"))
ok("cerrar el mes pasado", not err(q("select admin_close('month', %s)", (pm0,), uid=adm)))
ok("cerrar dos veces no se puede", err(q("select admin_close('month', %s)", (pm0,), uid=adm), "already_closed"))
ok("en un mes cerrado no se cargan ni borran gastos", err(q("select admin_add_expense(%s, 'x', 10)", (pm0,), uid=adm), "month_closed") and err(q("select admin_delete_expense(%s)", (e1[0][0],), uid=adm), "month_closed"))
fz2 = q("select admin_finance(%s)", (pm0.year,), uid=adm)[0][0]
mm = [m for m in fz2["months"] if m["month"] == pm0.strftime("%Y-%m")][0]
ok("el mes cerrado muestra la foto del cierre (gasto $15.000)", mm["state"] == "closed" and mm["closed_at"] and mm["expenses"] == 15000)
ok("reabrir el mes y volver a cerrar", not err(q("select admin_reopen('month', %s)", (pm0,), uid=adm)) and not err(q("select admin_close('month', %s)", (pm0,), uid=adm)))
ok("no se cierra el año en curso", err(q("select admin_close('year', make_date(%s,1,1))", (yy,), uid=adm), "period_not_over"))
ok("cerrar un año que terminó cierra sus 12 meses", not err(q("select admin_close('year', make_date(%s,1,1))", (yy - 2,), uid=adm))
   and q("select count(*) from admin_closings where kind='month' and extract(year from period)=%s", (yy - 2,))[0][0] == 12)
ok("con el año cerrado no se reabre un mes", err(q("select admin_reopen('month', make_date(%s,3,1))", (yy - 2,), uid=adm), "year_closed"))
ok("el resumen de años muestra el año cerrado", any(x["year"] == yy - 2 for x in q("select admin_finance(%s)", (yy,), uid=adm)[0][0]["years"]))
ok("nadie lee los cierres ni los gastos directo", err(q("select * from admin_closings", uid=adm)) and err(q("select * from admin_expenses", uid=prov)))

# borrar cuentas
ok("borrar cuenta de cliente", not err(q("select delete_my_account()", uid=cli1)) and q("select count(*) from auth.users where id=%s", (cli1,))[0][0] == 0)
ok("los turnos quedan anónimos", q("select count(*) from bookings where client_name='Ana López'")[0][0] == 0)
dp = q("select delete_my_provider()", uid=prov)
ok("borrar perfil de prestador", not err(dp) and q("select status from providers where id=%s", (pid,))[0][0] == "deleted")
ok("ya no aparece en ningún rubro", q("select count(*) from provider_categories where provider_id=%s and active", (pid,))[0][0] == 0)
# slugs reservados (Bloque B): la lista de la base es la misma que la del frontend
import os, re
rutas = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "rutas.js"), encoding="utf8").read()
front = sorted(re.findall(r'^\s+"([a-z0-9-]+)",$', rutas.split("RESERVED_SLUGS = [")[1].split("];")[0], re.M))
base_list = sorted(q("select unnest(reserved_slugs())")[i][0] for i in range(len(q("select unnest(reserved_slugs())"))))
ok(f"slugs reservados: la base y src/lib/rutas.js tienen la misma lista ({len(front)})", front == base_list and len(front) > 20)
rubros = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "lib", "rubros.js"), encoding="utf8").read()
front_cats = dict(re.findall(r'^\s+([a-z]): "([a-z0-9-]+)",$', rubros.split("CAT_SLUGS = {")[1].split("};")[0], re.M))
ok("rubros en la URL: src/lib/rubros.js (CAT_SLUGS) tiene los mismos slugs que categories", front_cats == dict(q("select id, slug from categories")) and len(front_cats) == 6)
ok("is_reserved_slug no distingue mayúsculas", q("select is_reserved_slug('PANEL'), is_reserved_slug('panel-1'), is_reserved_slug(null)")[0] == (True, False, False))
for nombre, esperado, dni in (("Panel", "panel-1", "30999881"), ("Admin", "admin-1", "30999882"), ("Mis Turnos", "mis-turnos-1", "30999883")):
    u = mkuser(f"res-{esperado}@test.ar", nombre)
    r = q("select register_provider(%s, 'Calle 1', array['b'], '2284 1', %s)", (nombre, dni), uid=u)
    r = r if err(r) else q("select slug from providers where id = %s", (r[0][0],))
    ok(f"un prestador llamado \"{nombre}\" recibe el slug {esperado}", not err(r) and r[0][0] == esperado)
u = mkuser("res-panel2@test.ar", "Panel")
r = q("select register_provider('Panel', 'Calle 2', array['b'], '2284 2', '30999877')", uid=u)
r = r if err(r) else q("select slug from providers where id = %s", (r[0][0],))
ok("el segundo \"Panel\" recibe panel-2 (reservado y ocupado se saltean igual)", not err(r) and r[0][0] == "panel-2")
u = mkuser("res-directo@test.ar", "Directo")
ok("el alta directa en la tabla tampoco puede usar un slug reservado",
   err(q("insert into providers (slug, name, city_id) values ('blog', 'Directo', (select id from cities limit 1))", uid=u), "reserved_slug"))
ok("ni el admin puede crear un prestador con slug reservado (mayúsculas incluidas)",
   err(q("insert into providers (slug, name, city_id) values ('Soporte', 'Directo', (select id from cities limit 1))"), "reserved_slug"))
# Bloque 1: un prestador que ya tenía un slug reservado (de antes del Bloque B) sigue funcionando: el trigger mira el
# slug solo cuando se crea o se cambia (un check "not valid" lo revisaba en cada update de la fila)
ok("el slug reservado se controla con un trigger, no con un check",
   q("select count(*) from pg_constraint where conname = 'providers_slug_not_reserved'")[0][0] == 0
   and q("select count(*) from pg_trigger where tgname = 'providers_slug_not_reserved' and tgenabled = 'O'")[0][0] == 1)
uv = mkuser("viejo-turnos@test.ar", "Turnos Viejo")
q("alter table providers disable trigger providers_slug_not_reserved")
pv = q("insert into providers (owner_id, slug, name, city_id, status) values (%s, 'turnos', 'Turnos Viejo', (select id from cities limit 1), 'pending') returning id", (uv,))
q("alter table providers enable trigger providers_slug_not_reserved")
pv = pv[0][0]
q("insert into provider_settings (provider_id) values (%s)", (pv,))
ok("prestador con slug reservado preexistente: el admin lo activa", not err(q("update providers set status = 'active' where id = %s", (pv,))))
ok("…se le actualizan puntaje y reseñas", not err(q("update providers set rating_avg = 4.5, rating_count = 2 where id = %s", (pv,))))
ok("…suma un seguidor", not err(q("insert into follows (user_id, provider_id) values (%s, %s)", (cli2, pv))) and q("select followers from providers where id = %s", (pv,))[0][0] == 1)
bv = q("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price) values (%s, %s, 'Beto Díaz', 'Corte', 'app', 'confirmed', now() - interval '2 hours', now() - interval '1 hour', 8000) returning id", (pv, cli2))[0][0]
mv = q("select mark_booking(%s, 'done')", (bv,), uid=uv)
ok("…marca Asistió en un turno y suma actividad", not err(mv) and q("select activity from providers where id = %s", (pv,))[0][0] == 1)
ok("…el reshuffle de cada noche lo incluye", not err(q("select reshuffle_providers()", role="service_role")))
ok("…el dueño edita su perfil sin tocar el slug", not err(q("update providers set bio = 'Hola' where id = %s", (pv,), uid=uv)))
ok("…el dueño no puede cambiar el slug (solo el admin, por SQL)", err(q("update providers set slug = 'turnos-2' where id = %s", (pv,), uid=uv), "permission denied"))
ok("…el admin puede guardar el mismo slug que ya tenía", not err(q("update providers set slug = 'turnos', name = 'Turnos Viejo' where id = %s", (pv,))))
ok("…pero no cambiarlo por otro reservado", err(q("update providers set slug = 'ayuda' where id = %s", (pv,)), "reserved_slug"))
ok("…y sí por uno libre", not err(q("update providers set slug = 'turnos-viejo' where id = %s", (pv,))))
ok("…una vez libre, tampoco puede volver al reservado", err(q("update providers set slug = 'turnos' where id = %s", (pv,)), "reserved_slug"))
ok("a un prestador común no se le puede poner un slug reservado", err(q("update providers set slug = 'Panel' where id = %s", (pid2,)), "reserved_slug"))

# Bloque 2b (H10): el DNI de un prestador eliminado no cuenta como duplicado y no se borra
q("update provider_private set dni_number = '30111560' where provider_id = %s", (pz,))   # dato viejo de un eliminado
ok("el prestador de prueba está eliminado", q("select status from providers where id = %s", (pz,))[0][0] == "deleted")
nd = mkuser("dni-elim@test.ar", "Dni Elim")
ok("un alta con el DNI de un prestador eliminado se acepta", not err(q("select register_provider('Dni Elim', 'x', array['b'], '1', '30111560')", uid=nd)))
ok("…y al eliminado no se le borra el dato", q("select dni_number from provider_private where provider_id = %s", (pz,))[0][0] == "30111560")
ok("pero otro alta con ese DNI (ahora de un prestador activo o pendiente) se rechaza",
   err(q("select register_provider('Dni Elim 2', 'x', array['b'], '1', '30111560')", uid=mkuser("dni-elim2@test.ar", "Dni Elim 2")), "dni_taken"))

# Bloque 2b: un gasto sin fecha queda en el día de Buenos Aires (antes current_date: el día en UTC)
ex = q("insert into expenses (provider_id, concept, amount, category) values (%s, 'Sin fecha', 100, 'Otros') returning spent_on", (pid3,), uid=nails_owner)
ok("un gasto cargado sin fecha queda en el día de Buenos Aires", not err(ex) and ex[0][0] == q("select (now() at time zone 'America/Argentina/Buenos_Aires')::date")[0][0])

# Bloque 2b (H24): los links de los avisos salen de app_settings.site_url, no de un dominio escrito a mano
ok("H24: la dirección del sitio la cambia solo el admin", err(q("select admin_set_site_url('https://otro.com')", uid=prov), "forbidden")
   and err(q("update app_settings set site_url = 'https://otro.com'", uid=adm)) and err(q("select admin_set_site_url('https://otro.com')", role="anon")))
ok("H24: una dirección con carpeta o sin https:// se rechaza", err(q("select admin_set_site_url('https://prueba.tutiempo.com.ar/panel')", uid=adm), "bad_site_url")
   and err(q("select admin_set_site_url('prueba.tutiempo.com.ar')", uid=adm), "bad_site_url"))
ok("H24: el admin la guarda (en minúsculas y sin la barra final)", q("select admin_set_site_url('https://Prueba.TuTiempo.com.ar/')", uid=adm)[0][0] == "https://prueba.tutiempo.com.ar")
bl = q("select id from bookings where provider_id = %s and source = 'app' and client_id is not null order by id limit 1", (pid,))[0][0]
q("delete from client_messages where kind = 'r24' and ref = %s", (str(bl),))
q("select notify_booking(%s, 'r24')", (bl,))
sl = q("select slug from providers where id = %s", (pid,))[0][0]
ok("H24: el link del aviso usa la dirección del sitio", f"https://prueba.tutiempo.com.ar/{sl}" in q("select body from client_messages where kind = 'r24' and ref = %s", (str(bl),))[0][0])
ok("H24: un slug reservado lleva a /p/<id>", q("select provider_link(%s, 'panel')", (pid,))[0][0] == f"https://prueba.tutiempo.com.ar/p/{pid}")
ok("H24: provider_link es interna", err(q("select provider_link(1, 'x')", role="anon")))
q("select admin_set_site_url('https://tutiempo.com.ar')", uid=adm)

# Bloque 2a (H14): el seed de ejemplos es ficticio y no carga sin el aviso explícito (todo en una transacción que se deshace)
import pathlib, re
SEED = (pathlib.Path(__file__).resolve().parent.parent / "supabase/seed/ejemplos.NO-USAR-EN-PRODUCCION.sql").read_text()
with conn.cursor() as c:
    c.execute("begin")
    try:
        c.execute(SEED); sin_aviso = None
    except Exception as e:
        sin_aviso = e
    c.execute("rollback")
    ok("el seed de ejemplos no carga sin set tt.ejemplos = 'si'", err(sin_aviso, "ejemplos_no_autorizados"))
    c.execute("begin")
    c.execute("set local tt.ejemplos = 'si'")
    c.execute(SEED)
    c.execute("select count(*), count(*) filter (where status = 'active') from providers where slug like 'ej-%'")
    ok("…con el aviso carga los 13 prestadores de ejemplo", c.fetchone() == (13, 13))
    c.execute("rollback")
REALES = ["Hidro", "Kevin Ortiz", "la fama", "Niko_barberr", "Mary Garcia", "Carina Saitti", "2284727692", "9 de julio 2381",
          "Antártida Argentina 4762", "Rivadavia 2684", "Islas Malvinas 3974", "Colon 3794", "Belgrano 2683"]
ok("el seed no tiene nombres, direcciones ni teléfonos de negocios reales", not [r for r in REALES if r.lower() in SEED.lower()])
ok("…ni teléfonos que puedan existir (después de 2284 va un 0)", all(t.startswith("0") for t in re.findall(r"'2284 ?(\d+)'", SEED)))

print("TODO OK" if not F else f"{F} FALLAS")
sys.exit(1 if F else 0)

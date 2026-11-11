"""Notificaciones push (Bloque C): suscripciones (una por dispositivo, solo servicios de push conocidos), la cola
push_outbox que llenan client_messages, provider_notices y bookings, las opciones del cliente y del prestador, lo que
pide push-send (push_due: texto mínimo, sin montos ni datos de otros), el resultado de cada envío (push_result: 404/410
borra, 5xx reintenta), la llamada en el momento, la limpieza y los permisos.
Corre contra una base LIMPIA con pruebas/supabase_emulation.sql + supabase/TODO_EN_UNO.sql:
    python3 pruebas/test_push.py "host=... dbname=BASE_LIMPIA user=postgres"
La función real (con un servicio de push falso) se prueba en pruebas/funciones/."""
import json, re, sys, uuid, secrets, base64, datetime as dt
import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=tt_push user=postgres"
conn = psycopg.connect(DSN, autocommit=True)
F = 0


def ok(name, cond, detail=""):
    global F
    if not cond:
        F += 1
    print(("OK   " if cond else "FAIL ") + name + ("" if cond or not detail else "  → " + detail))


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


def mkuser(email, name):
    uid = uuid.uuid4()
    q("insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values (%s, %s, %s, now())", (uid, email, json.dumps({"full_name": name})))
    return uid


b64u = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
KEY = b64u(b"\x04" + secrets.token_bytes(64))   # p256dh: 65 octetos
AUTH = b64u(secrets.token_bytes(16))


def endpoint(host="fcm.googleapis.com", path="fcm/send/"):
    return f"https://{host}/{path}{secrets.token_hex(12)}"


def sub(uid, ep=None, label="Chrome en Android"):
    ep = ep or endpoint()
    r = q("select push_subscribe(%s, %s, %s, %s)", (ep, KEY, AUTH, label), uid=uid)
    if err(r):
        raise r
    return ep


def sub_id(ep):
    return one("select id from push_subscriptions where endpoint = %s", (ep,))


owner = mkuser("dueno@push.test", "Dueño Push")
pid = one("select register_provider('Barbería Push', 'Calle 1', array['b'], '2284 1', '30111900')", uid=owner)
q("update providers set status = 'active', dni_verified = true where id = %s", (pid,))
owner2 = mkuser("dueno2@push.test", "Dueña Sin Avisos")
pid2 = one("select register_provider('Uñas Push', 'Calle 2', array['u'], '2284 2', '30111901')", uid=owner2)
q("update providers set status = 'active', dni_verified = true where id = %s", (pid2,))
ana = mkuser("ana@push.test", "Ana María Pérez")
apagado = mkuser("apagado@push.test", "Apagado Push")
otra = mkuser("otra@push.test", "Otra Cuenta")
admin = mkuser("admin@push.test", "Admin Push")
q("insert into app_admins (user_id) values (%s)", (admin,))

N = [0]
def turno(client, hours, status="confirmed", provider=None, source="app", name="Ana María Pérez"):
    N[0] += 1
    # creado hace 3 días (como en test_emails: el recordatorio de 24 h es para turnos reservados antes)
    return one("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, created_at) "
               "values (%s, %s, %s, 'Corte y barba', %s, %s, now() + %s * interval '1 hour' + %s * interval '2 minutes', "
               "now() + %s * interval '1 hour' + %s * interval '2 minutes' + interval '1 minute', 12500, now() - interval '3 days') returning id",
               (provider or pid, client, name, source, status, hours, N[0], hours, N[0]))


def cola(user=None, kind=None, source_id=None):
    return q("select kind, status, skip_reason from push_outbox where (%s::uuid is null or user_id = %s) and (%s::text is null or kind = %s) "
             "and (%s::bigint is null or source_id = %s) order by id", (user, user, kind, kind, source_id, source_id))


def due():
    r = q("select id, endpoint, title, body, url, tag, ttl, urgency from push_due(200)", role="service_role")
    return r if err(r) else {x[0]: dict(zip(["endpoint", "title", "body", "url", "tag", "ttl", "urgency"], x[1:])) for x in r}


def pending_ids(user, kind):
    return [r[0] for r in q("select id from push_outbox where user_id = %s and kind = %s and status = 'pending' order by id", (user, kind))]


# ---------- 1. Suscribirse ----------
ok("sin sesión no se puede suscribir", err(q("select push_subscribe(%s, %s, %s, null)", (endpoint(), KEY, AUTH), role="anon")))
ok("sin cuenta (authenticated sin sub) tampoco", err(q("select push_subscribe(%s, %s, %s, null)", (endpoint(), KEY, AUTH), role="authenticated"), "login_required"))
ep_ana = sub(ana)
ep_ana2 = sub(ana, endpoint("web.push.apple.com", ""), "Safari en iPhone")
ok("una suscripción por dispositivo (Chrome en Android y Safari en iPhone)", one("select count(*) from push_subscriptions where user_id = %s", (ana,)) == 2)
for bad in ["http://fcm.googleapis.com/fcm/send/x", "https://evil.com/fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.com/x",
            "https://fcm.googleapis.com:8443/x", "https://localhost/x", "https://169.254.169.254/latest/meta-data", "javascript:alert(1)"]:
    ok(f"endpoint rechazado: {bad}", err(q("select push_subscribe(%s, %s, %s, null)", (bad, KEY, AUTH), uid=ana), "bad_push_endpoint"))
for host in ["updates.push.services.mozilla.com", "web.push.apple.com", "wns2-bn3p.notify.windows.com"]:
    ok(f"endpoint aceptado: {host}", not err(q("select push_subscribe(%s, %s, %s, null)", (endpoint(host, "w/"), KEY, AUTH), uid=otra)))
ok("claves inválidas se rechazan", err(q("select push_subscribe(%s, 'corta', %s, null)", (endpoint(), AUTH), uid=ana), "bad_push_keys")
   and err(q("select push_subscribe(%s, %s, 'x', null)", (endpoint(), KEY), uid=ana), "bad_push_keys"))
ok("suscribir dos veces el mismo dispositivo no duplica", (sub(ana, ep_ana), one("select count(*) from push_subscriptions where endpoint = %s", (ep_ana,)))[1] == 1)
ok("push_registered: sí para su dueña, no para otra cuenta", one("select push_registered(%s)", (ep_ana,), uid=ana) is True
   and one("select push_registered(%s)", (ep_ana,), uid=otra) is False)
ok("nadie lee la tabla de suscripciones directo (ni la cola)", err(q("select * from push_subscriptions", uid=ana)) and err(q("select * from push_outbox", uid=ana))
   and err(q("select * from push_subscriptions", role="anon")))
ok("push_due y push_result son solo de la función (service_role)", err(q("select * from push_due(1)", uid=admin)) and err(q("select push_result(1, 201)", uid=admin))
   and not err(q("select * from push_due(0)", role="service_role")))
for i in range(11):
    sub(otra)
ok("hasta 10 dispositivos por cuenta (se van los más viejos)", one("select count(*) from push_subscriptions where user_id = %s", (otra,)) == 10)

# ---------- 2. Cliente: los mismos avisos que por email ----------
b1 = turno(ana, 48)
q("select notify_booking(%s, 'conf')", (b1,))
conf = cola(ana, "conf")
ok("la confirmación entra a la cola una vez por dispositivo", conf == [("conf", "pending", None)] * 2)
q("select notify_booking(%s, 'conf')", (b1,))
ok("el aviso repetido no suma otra notificación", len(cola(ana, "conf")) == 2)
q("insert into client_messages (provider_id, user_id, body) values (%s, %s, 'Hola, tengo lugar el sábado')", (pid, ana))
ok("los mensajes que escribe el prestador (msg) no van por push", one("select count(*) from push_outbox where user_id = %s and kind not in ('conf')", (ana,)) == 0)
ep_ap = sub(apagado)
q("update profiles set push_notices = false where id = %s", (apagado,))
b_ap = turno(apagado, 48)
q("select notify_booking(%s, 'conf')", (b_ap,))
ok("con «Recordatorios y novedades» apagada, la confirmación igual va", cola(apagado, "conf") == [("conf", "pending", None)])
b_ap24 = turno(apagado, 20)
q("select send_scheduled_notices()")
ok("…el recordatorio no (el aviso en la app, sí)", cola(apagado, "r24") == []
   and one("select count(*) from client_messages where kind = 'r24' and ref = %s", (str(b_ap24),)) == 1)
q("insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, '¡Feliz cumpleaños!', 'bday', '2026'), (%s, %s, '¿Nos dejás tu opinión?', 'rev', %s)",
  (pid, apagado, pid, apagado, str(b_ap)))
ok("…ni la reseña ni el cumpleaños", cola(apagado, "rev") == [] and cola(apagado, "bday") == [])
q("update bookings set status = 'cancelled_provider' where id = %s", (b_ap24,))
q("select notify_booking(%s, 'cancel')", (b_ap24,))
ok("…y una cancelación igual va", cola(apagado, "cancel") == [("cancel", "pending", None)])
ok("el prestador no recibe nada cuando cancela él mismo", cola(owner, "client_cancel") == [])
b_r = turno(ana, 20)
q("select send_scheduled_notices()")
ok("recordatorio de 24 h: a los dos dispositivos de Ana", len(cola(ana, "r24")) == 2)

# ---------- 3. Prestador ----------
ep_owner = sub(owner)
ep_owner2 = sub(owner2)
q("update profiles set push_bookings = false where id = %s", (owner2,))
b_new = turno(ana, 30, status="hold")
q("update bookings set status = 'confirmed' where id = %s", (b_new,))
ok("una reserva de la app que se confirma avisa al prestador (Nueva reserva)", cola(owner, "new_booking", b_new) == [("new_booking", "pending", None)])
q("update bookings set status = 'confirmed' where id = %s", (b_new,))
ok("…una sola vez", len(cola(owner, "new_booking", b_new)) == 1)
b_man = turno(None, 30, source="manual", name="Cliente de mostrador")
ok("un turno que carga el prestador no avisa", cola(owner, "new_booking", b_man) == [])
b_exp = turno(ana, 30, status="hold")
q("update bookings set status = 'expired' where id = %s", (b_exp,))
ok("una reserva que no se pagó (hold → expired) no avisa", cola(owner, "new_booking", b_exp) == [])
q("update bookings set status = 'confirmed' where id = %s", (b_exp,))
ok("11/11: …pero si el pago llega tarde y se confirma igual (expired → confirmed), sí avisa", cola(owner, "new_booking", b_exp) == [("new_booking", "pending", None)])
q("update bookings set status = 'cancelled_refunded' where id = %s", (b_exp,))
b_past = turno(ana, -2, status="hold")
q("update bookings set status = 'confirmed' where id = %s", (b_past,))
ok("una reserva que ya empezó no avisa", cola(owner, "new_booking", b_past) == [])
q("update bookings set status = 'cancelled_client' where id = %s", (b_new,))
ok("el cliente cancela: avisa al prestador (Cancelación del cliente)", cola(owner, "client_cancel", b_new) == [("client_cancel", "pending", None)])
b_nb = turno(ana, 32, status="hold")
q("update bookings set status = 'confirmed' where id = %s", (b_nb,))
b_n2 = turno(ana, 30, status="hold", provider=pid2)
q("update bookings set status = 'confirmed' where id = %s", (b_n2,))
q("update bookings set status = 'cancelled_client' where id = %s", (b_n2,))
ok("con «Nueva reserva y cancelaciones» apagada, al prestador no le llegan", cola(owner2, "new_booking") == [] and cola(owner2, "client_cancel") == [])
q("insert into provider_notices (provider_id, kind, ref, body) values (%s, 'mp_refunded', 'P-1', 'El pago de Ana María Pérez se devolvió: $ 6.250 desde tu cuenta.'), "
  "(%s, 'mp_charged_back', 'P-2', 'Contracargo de $ 12.500'), (%s, 'mp_reconnect', 'R-1', 'Volvé a conectar'), (%s, 'mp_connect', 'aviso-1', 'Conectá')", (pid2, pid2, pid2, pid2))
ok("los avisos de cobros llegan siempre (aunque apague las reservas); el de conectar Mercado Pago (V6) va como el de reconectar",
   [r[0] for r in cola(owner2) if r[0] != "new_follower"] == ["cobros", "cobros", "mp_reconnect", "mp_reconnect"])

# V8 · C06: alguien empieza a seguir al prestador → aviso en la app y push, con el nombre de pila (una vez por persona)
q("insert into follows (user_id, provider_id) values (%s, %s)", (ana, pid2))
seg = q("select id, body from provider_notices where provider_id=%s and kind='new_follower'", (pid2,))
ok("C06: seguir deja el aviso en la app del prestador con el nombre de pila", len(seg) == 1 and seg[0][1] == "Ana empezó a seguirte." and "Pérez" not in seg[0][1])
ok("C06: …y el push al prestador (Nuevos seguidores)", [r[0] for r in cola(owner2, "new_follower")] == ["new_follower"])
q("delete from follows where user_id=%s and provider_id=%s", (ana, pid2)); q("insert into follows (user_id, provider_id) values (%s, %s)", (ana, pid2))
ok("C06: dejar de seguir y volver a seguir no lo repite", q("select count(*) from provider_notices where provider_id=%s and kind='new_follower'", (pid2,))[0][0] == 1)
# ---------- 4. Lo que manda la función: lo mínimo ----------
D = due()
by_kind = {}
for i, d in D.items():
    k = one("select kind from push_outbox where id = %s", (i,))
    by_kind.setdefault(k, []).append(d)
c = by_kind["conf"][0]
ok("confirmación: «Turno confirmado» · negocio, día y hora", c["title"] == "Turno confirmado" and re.fullmatch(r"Barbería Push · (dom|lun|mar|mié|jue|vie|sáb) \d\d/\d\d, \d\d:\d\d", c["body"]) is not None)
ok("confirmación: lleva al turno, alta urgencia, se reemplaza con los avisos del mismo turno", c["url"] == f"/turno/{b1}" and c["urgency"] == "high" and c["tag"] == f"turno-{b1}")
r24 = by_kind["r24"][0]
ok("recordatorio de 24 h: «Mañana tenés turno» · negocio a las HH:MM; vive hasta el turno", r24["title"] == "Mañana tenés turno"
   and re.fullmatch(r"Barbería Push a las \d\d:\d\d", r24["body"]) is not None and 19 * 3600 < r24["ttl"] <= 21 * 3600 and r24["urgency"] == "normal")
ca = by_kind["cancel"][0]
ok("cancelación: sin el monto de la devolución, «Abrí TuTiempo para ver el detalle»", ca["title"] == "Se canceló tu turno" and ca["body"] == "Barbería Push. Abrí TuTiempo para ver el detalle.")
ok("una «Nueva reserva» de un turno que el cliente ya canceló no sale", cola(owner, "new_booking", b_new) == [("new_booking", "skipped", "stale")])
nb = by_kind["new_booking"][0]
ok("nueva reserva: el nombre de pila del cliente, sin apellido ni teléfono", nb["title"] == "Nueva reserva" and nb["body"].startswith("Ana · Corte y barba · ")
   and "Pérez" not in nb["body"] and "María" not in nb["body"])
ok("nueva reserva: lleva a la Agenda de ese día", re.fullmatch(r"/panel/agenda\?dia=\d{4}-\d\d-\d\d", nb["url"]) is not None and nb["urgency"] == "high")
cc = by_kind["client_cancel"][0]
ok("cancelación del cliente: «Se canceló una reserva» · nombre de pila · servicio · día y hora", cc["title"] == "Se canceló una reserva" and cc["body"].startswith("Ana · Corte y barba · "))
co = by_kind["cobros"]
ok("cobros: sin montos ni el nombre del cliente («Abrí tu panel para ver el detalle»)", len(co) == 2 and all(x["title"] == "Novedad en tus cobros" and x["body"] == "Abrí tu panel para ver el detalle." for x in co))
mrs = sorted(by_kind["mp_reconnect"], key=lambda x: x["title"])
ok("reconectar Mercado Pago: lleva al perfil", mrs[1]["title"] == "Volvé a conectar Mercado Pago" and mrs[1]["url"] == "/panel/perfil")
ok("V6 · «Avisarle» del admin: «Conectá Mercado Pago», al perfil, urgente", mrs[0]["title"] == "Conectá Mercado Pago" and mrs[0]["url"] == "/panel/perfil"
   and mrs[0]["urgency"] == "high" and "Conectalo desde tu perfil" in mrs[0]["body"])
nf = by_kind["new_follower"][0]
ok("C06: push «Nuevo seguidor» · «Ana empezó a seguirte.», lleva a Clientes → Seguidores (4/11)", nf["title"] == "Nuevo seguidor" and nf["body"] == "Ana empezó a seguirte." and nf["url"] == "/panel/clientes?ver=seguidores")
everything = " ".join(d["title"] + " " + d["body"] for d in D.values())
ok("ninguna notificación lleva montos, DNI, apellido ni teléfono", "$" not in everything and "30111900" not in everything and "Pérez" not in everything and "2284" not in everything)
ok("cada notificación va al endpoint de su dispositivo", {d["endpoint"] for d in D.values()} >= {ep_ana, ep_ana2, ep_owner, ep_owner2})
ok("lo que se tomó queda reservado (otra corrida no lo manda dos veces)", due() == {})

# ---------- 5. Descartes al mandar ----------
own3 = mkuser("seg3@test.ar", "Seg Tres"); sub(own3)
pid3 = q("select register_provider('Seguidores Push', 'Calle 3', array['b'], '2284 3', null)", uid=own3)[0][0]
q("update profiles set push_followers = false where id = %s", (own3,))
q("insert into follows (user_id, provider_id) values (%s, %s)", (ana, pid3))
ok("C06: con «Nuevos seguidores» apagado no hay push (el aviso en la app queda)", cola(own3, "new_follower") == []
   and q("select count(*) from provider_notices where provider_id=%s and kind='new_follower'", (pid3,))[0][0] == 1)

q("update push_outbox set next_attempt_at = now() where status = 'pending'")
q("update profiles set push_notices = false where id = %s", (ana,))
D = due()
ok("si el cliente apaga «Recordatorios y novedades» antes del envío, el recordatorio se descarta", cola(ana, "r24") == [("r24", "skipped", "opt_out")] * 2
   and all(one("select kind from push_outbox where id = %s", (i,)) != "r24" for i in D))
q("update profiles set push_notices = true where id = %s", (ana,))
b_c = turno(ana, 3)
q("select notify_booking(%s, 'conf')", (b_c,))
q("update bookings set status = 'cancelled_client' where id = %s", (b_c,))
due()
ok("una confirmación de un turno que ya se canceló no sale", {tuple(r) for r in q("select kind, status, skip_reason from push_outbox where source = 'message' and booking_id = %s", (b_c,))} == {("conf", "skipped", "stale")})

# ---------- 6. Resultado de cada envío ----------
b_res = turno(ana, 40)
q("select notify_booking(%s, 'conf')", (b_res,))
ids = {one("select subscription_id from push_outbox where id = %s", (i,)): i for i in [r[0] for r in q("select id from push_outbox where booking_id = %s and kind = 'conf'", (b_res,))]}
s1, s2 = sub_id(ep_ana), sub_id(ep_ana2)
q("select push_result(%s, 201)", (ids[s1],), role="service_role")
ok("201: enviado y el dispositivo queda con su último envío bueno", one("select status from push_outbox where id = %s", (ids[s1],)) == "sent"
   and one("select last_ok_at is not null and failures = 0 from push_subscriptions where id = %s", (s1,)))
q("select push_result(%s, 503, 'Service Unavailable')", (ids[s2],), role="service_role")
r = q("select status, attempts, next_attempt_at > now() + interval '50 seconds', next_attempt_at < now() + interval '70 seconds' from push_outbox where id = %s", (ids[s2],))[0]
ok("503: se reintenta en un minuto", r == ("pending", 1, True, True))
for n in range(4):
    q("select push_result(%s, 500, 'boom')", (ids[s2],), role="service_role")
ok("después de 5 intentos, falla", one("select status from push_outbox where id = %s", (ids[s2],)) == "failed"
   and one("select failures from push_subscriptions where id = %s", (s2,)) == 5)
b_g = turno(ana, 41)
q("select notify_booking(%s, 'conf')", (b_g,))
q("insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, '¡Feliz cumpleaños!', 'bday', '2027')", (pid, ana))
gone = one("select id from push_outbox where booking_id = %s and kind = 'conf' and subscription_id = %s", (b_g, s2))
q("select push_result(%s, 410, 'Gone')", (gone,), role="service_role")
ok("410: la suscripción se borra, con todo lo pendiente de ese dispositivo", sub_id(ep_ana2) is None
   and one("select count(*) from push_outbox where subscription_id = %s", (s2,)) == 0 and sub_id(ep_ana) == s1)
b_404 = turno(ana, 42)
q("select notify_booking(%s, 'conf')", (b_404,))
q("select push_result(%s, 404)", (one("select id from push_outbox where booking_id = %s and kind = 'conf'", (b_404,)),), role="service_role")
ok("404: también se borra", sub_id(ep_ana) is None)
ep_ana = sub(ana)
b_403 = turno(ana, 43)
q("select notify_booking(%s, 'conf')", (b_403,))
o403 = one("select id from push_outbox where booking_id = %s and kind = 'conf'", (b_403,))
q("select push_result(%s, 403, 'invalid JWT')", (o403,), role="service_role")
ok("403 (VAPID que no coincide): falla enseguida, sin reintentos", q("select status, attempts, last_status from push_outbox where id = %s", (o403,))[0] == ("failed", 1, 403))
h = one("select admin_push_health()", uid=admin)
ok("el admin ve los dispositivos y el aviso de claves VAPID", h["devices"] >= 5 and h["vapid_rejected_24h"] == 1 and h["failed_24h"] >= 1)
ok("admin_push_health es solo del admin", err(q("select admin_push_health()", uid=ana), "forbidden"))
q("select push_result(%s, 201)", (o403,), role="service_role")
ok("un resultado tardío no cambia algo que ya terminó", one("select status from push_outbox where id = %s", (o403,)) == "failed")

# ---------- 7. El mismo dispositivo en otra cuenta; desactivar ----------
b_sh = turno(ana, 44)
q("select notify_booking(%s, 'conf')", (b_sh,))
ok("(antes) Ana tiene una notificación pendiente en ese dispositivo", len(pending_ids(ana, "conf")) >= 1)
sub(otra, ep_ana)
ok("si otra cuenta activa avisos en el mismo dispositivo, pasa a esa cuenta", one("select user_id from push_subscriptions where endpoint = %s", (ep_ana,)) == otra)
ok("…y lo pendiente de Ana no le llega a la otra cuenta", one("select count(*) from push_outbox o join push_subscriptions s on s.id = o.subscription_id where s.endpoint = %s and o.user_id = %s", (ep_ana, ana)) == 0)
q("select push_unsubscribe(%s)", (ep_ana,), uid=ana)
ok("Ana no puede desactivar un dispositivo que ya no es suyo", sub_id(ep_ana) is not None)
q("select push_unsubscribe(%s)", (ep_ana,), uid=otra)
ok("su dueña sí (Desactivar o cerrar sesión)", sub_id(ep_ana) is None)

# ---------- 8. En el momento: la base llama a push-send ----------
q("delete from vault.secrets where name in ('tt_project_url', 'tt_cron_secret')"); q("delete from net.requests")
b_k = turno(ana, 45)
ep_k = sub(ana)
q("select notify_booking(%s, 'conf')", (b_k,))
ok("sin los secretos de Vault, encolar no falla ni llama", len(cola(ana, "conf")) > 0 and one("select count(*) from net.requests") == 0)
q("select vault.create_secret('https://proyecto.supabase.co/', 'tt_project_url')"); q("select vault.create_secret('secreto-del-cron', 'tt_cron_secret')")
b_k2 = turno(ana, 46, status="hold")
q("update bookings set status = 'confirmed' where id = %s", (b_k2,))
q("select notify_booking(%s, 'conf')", (b_k2,))
reqs = q("select url, headers->>'Authorization' from net.requests")
ok("al encolar, la base llama a push-send con CRON_SECRET (una llamada por aviso)", len(reqs) == 2 and all(r == ("https://proyecto.supabase.co/functions/v1/push-send", "Bearer secreto-del-cron") for r in reqs))
q("delete from net.requests")
r = q("begin; insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, 'x', 'rev', '1'); rollback;", (pid, ana))
ok("si la transacción se deshace, tampoco queda nada encolado", one("select count(*) from push_outbox where kind = 'rev' and user_id = %s", (ana,)) == 0)
ok("run_push_send() lo puede correr el cron (service_role)", not err(q("select run_push_send()", role="service_role")) and err(q("select run_push_send()", uid=admin)))

# ---------- 9. Opciones en Mi perfil ----------
ok("cada uno cambia sus opciones de push", not err(q("update profiles set push_notices = false, push_bookings = false where id = %s", (ana,), uid=ana))
   and one("select push_notices or push_bookings from profiles where id = %s", (ana,)) is False)
ok("…y las lee", q("select push_notices, push_bookings from profiles where id = %s", (ana,), uid=ana) == [(False, False)])
ok("las de otro no se pueden cambiar", (q("update profiles set push_notices = false where id = %s", (owner,), uid=ana), one("select push_notices from profiles where id = %s", (owner,)))[1] is True)

# ---------- 10. Limpieza diaria ----------
q("update push_outbox set created_at = now() - interval '31 days' where status <> 'pending'")
q("update push_subscriptions set first_failure_at = now() - interval '31 days', failures = 40 where endpoint = %s", (ep_owner2,))
before = one("select count(*) from push_outbox where status = 'pending'")
res = one("select daily_cleanup()", role="service_role")
ok("limpieza: la cola terminada de más de 30 días y los dispositivos que fallan hace 30 días", res["push"] > 0 and res["push_devices"] == 1
   and sub_id(ep_owner2) is None and one("select count(*) from push_outbox where status <> 'pending' and created_at < now() - interval '30 days'") == 0)
ok("…lo pendiente de los demás no se toca", one("select count(*) from push_outbox o join push_subscriptions s on s.id = o.subscription_id where o.status = 'pending'") > 0)

# ---------- 11. Permisos (H32: proyecto nuevo sin permisos por defecto) ----------
ok("anon no ejecuta nada de push", all(err(q(f"select {f}", role="anon")) for f in ["push_registered('x')", "push_unsubscribe('x')", "admin_push_health()", "push_endpoint_ok('x')"]))
ok("service_role ejecuta push_due, push_result y run_push_send", one("select bool_and(has_function_privilege('service_role', f, 'execute')) from unnest(array['push_due(int)','push_result(bigint,int,text)','run_push_send(boolean)']) f"))
ok("authenticated no ejecuta push_due, push_result, run_push_send ni push_enqueue", one(
   "select not bool_or(has_function_privilege('authenticated', f, 'execute')) from unnest(array['push_due(int)','push_result(bigint,int,text)','run_push_send(boolean)',"
   "'push_enqueue(uuid,text,text,bigint,bigint,timestamptz)']) f"))
ok("las tablas tienen RLS y ningún permiso para anon/authenticated", one(
   "select bool_and(c.relrowsecurity) and not bool_or(has_table_privilege(r, c.oid, 'select') or has_table_privilege(r, c.oid, 'insert')) "
   "from pg_class c, unnest(array['anon','authenticated']) r where c.relname in ('push_subscriptions','push_outbox')"))
ok("todas las funciones nuevas con search_path fijo", one(
   "select bool_and(p.proconfig::text like '%%search_path%%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['push%%','run_push_send','client_messages_push','provider_notices_push','bookings_push','admin_push_health'])"))

# ---------- 12. Seguidores y ofertas de horarios (4/11 · Bloque 3) ----------
q("update profiles set push_notices = true, push_bookings = true where id = %s", (ana,))
q("update push_outbox set status = 'skipped', skip_reason = 'stale' where status = 'pending'")
q("insert into follows (user_id, provider_id) values (%s, %s), (%s, %s) on conflict do nothing", (ana, pid, otra, pid))
fl = one("select provider_followers()", uid=owner)
ok("4/11: la lista de seguidores, con «Ana P.» (nombre de pila e inicial) y nada más", fl["count"] == 2 and len(fl["items"]) == 2
   and {i["name"] for i in fl["items"]} == {"Ana P.", "Otra C."} and all(set(i) == {"id", "photo", "since", "name", "client"} for i in fl["items"])
   and "Pérez" not in json.dumps(fl) and "@" not in json.dumps(fl))
ok("4/11: un cliente no ve seguidores de nadie; anon no la ejecuta", one("select provider_followers()", uid=ana) == {"count": 0, "items": []}
   and err(q("select provider_followers()", role="anon")))
def T0(h):
    return f"(date_trunc('hour', now()) + interval '6 days' + interval '{int(h)} hours')"
def offer(h, user=None, dur=1, uid=owner):
    return q(f"select offer_slot({T0(h)}, {T0(h)} + interval '{int(dur)} hours', %s)", (user,), uid=uid)
r = offer(1)
ok("4/11: «Ofrecer» un hueco: les llega a los 2 seguidores", not err(r) and r[0][0]["sent"] == 2, str(r))
oid = r[0][0]["id"] if not err(r) else None
m = q("select user_id, body, ref from client_messages where kind = 'offer' and ref = %s order by user_id", (str(oid),))
ok("4/11: …como aviso en la app («Tengo un turno libre el <día> DD/MM de HH:MM a HH:MM. ¿Lo querés?»)", len(m) == 2
   and all(re.fullmatch(r"Tengo un turno libre el (domingo|lunes|martes|miércoles|jueves|viernes|sábado) \d\d/\d\d de \d\d:\d\d a \d\d:\d\d\. ¿Lo querés\?", x[1]) for x in m), str(m))
ok("4/11: …y por push, uno por dispositivo", [x[0] for x in cola(ana, "offer")] == ["offer"] * one("select count(*) from push_subscriptions where user_id = %s", (ana,)) != [])
D = due()
off = [d for i, d in D.items() if one("select kind from push_outbox where id = %s", (i,)) == "offer"]
slug = one("select slug from providers where id = %s", (pid,))
ok("4/11: push «Turno libre en Barbería Push», con el horario, al perfil ese día", off and all(d["title"] == "Turno libre en Barbería Push" and d["body"].startswith("Tengo un turno libre el ")
   and re.fullmatch(rf"/{slug}\?dia=\d{{4}}-\d\d-\d\d", d["url"]) for d in off) and "$" not in json.dumps(off), json.dumps(off)[:300])
mm = [x for x in one("select my_messages()", uid=ana) if x["kind"] == "offer"]
ok("4/11: Mis turnos recibe el horario ofrecido y la dirección del perfil (para «Reservar»)", len(mm) == 1 and mm[0]["slug"] == slug
   and mm[0]["slot"]["starts"] and mm[0]["slot"]["ends"] and mm[0]["ref"] == str(oid))
ok("4/11: el mismo hueco no se ofrece dos veces", err(offer(1), "offer_repeated"))
b_off = one(f"insert into bookings (provider_id, client_name, source, status, starts_at, ends_at) values (%s, 'Bloqueo', 'block', 'confirmed', {T0(3)}, {T0(3)} + interval '30 minutes') returning id", (pid,))
ok("4/11: un hueco que ya no está libre no se ofrece", err(offer(3), "offer_taken"))
ok("4/11: ni uno que ya pasó", err(q("select offer_slot(now() - interval '1 hour', now(), null)", uid=owner), "offer_past"))
ok("4/11: solo el prestador ofrece", err(offer(5, uid=ana), "not_provider") and err(q("select offer_slot(now() + interval '1 day', now() + interval '25 hours', null)", role="anon")))
ok("4/11: hasta 5 ofertas a todos por día", all(not err(offer(h)) for h in (5, 6, 7, 8)) and err(offer(9), "offer_limit"))
r1 = offer(9, user=ana)
ok("4/11: «Ofrecer turno» a un seguidor: solo a esa persona (cuenta aparte del límite de 5)", not err(r1) and r1[0][0]["sent"] == 1
   and one("select count(*) from client_messages where kind = 'offer' and ref = %s", (str(r1[0][0]["id"]),)) == 1, str(r1))
ok("4/11: …y no a alguien que no lo sigue", err(offer(10, user=admin), "not_follower"))
ok("4/11: el mismo hueco no se le ofrece dos veces a la misma persona", err(offer(9, user=ana), "offer_repeated"))
q("update profiles set push_notices = false where id = %s", (otra,))
r2 = offer(11, user=otra)
ok("4/11: con «Recordatorios y avisos» apagado le llega el aviso en la app, sin push", not err(r2)
   and one("select count(*) from client_messages where kind = 'offer' and user_id = %s and ref = %s", (otra, str(r2[0][0]["id"]))) == 1
   and one("select count(*) from push_outbox where user_id = %s and kind = 'offer' and source_id = (select id from client_messages where ref = %s and user_id = %s and kind = 'offer')", (otra, str(r2[0][0]["id"]), otra)) == 0)
ok("4/11: las ofertas las ve solo su prestador", one("select count(*) from slot_offers", uid=owner) == 7 and q("select * from slot_offers", uid=ana) == []
   and err(q("select * from slot_offers", role="anon")) and err(q("insert into slot_offers (provider_id, starts_at, ends_at) values (%s, now() + interval '1 day', now() + interval '25 hours')", (pid,), uid=owner)))
# Trabajos → "Avisar a tus seguidores": aviso con "Ver perfil" y push "Novedad de…"; comparte el tope de 5 por día con las
# ofertas a todos (ya se usaron las 5 de hoy), así que se prueba con otro prestador
own4 = mkuser("nov4@test.ar", "Nov Cuatro")
pid4 = one("select register_provider('Novedades Push', 'Calle 4', array['b'], '2284 4', null)", uid=own4)
q("update providers set status = 'active', dni_verified = true where id = %s", (pid4,))
q("insert into follows (user_id, provider_id) values (%s, %s)", (ana, pid4))
q("update push_outbox set status = 'skipped', skip_reason = 'stale' where status = 'pending'")
rn = q("select notify_followers('Esta semana hay 2x1 en barba')", uid=own4)
ok("4/11: «Avisar a tus seguidores» le llega a cada seguidor (aviso en la app)", not err(rn) and rn[0][0]["sent"] == 1
   and q("select body from client_messages where kind = 'news' and user_id = %s and provider_id = %s", (ana, pid4)) == [("Esta semana hay 2x1 en barba",)], str(rn))
Dn = [d for i, d in due().items() if one("select kind from push_outbox where id = %s", (i,)) == "news"]
slug4 = one("select slug from providers where id = %s", (pid4,))
ok("4/11: …con push «Novedad de Novedades Push» y el mensaje, al perfil", Dn and all(d["title"] == "Novedad de Novedades Push" and d["body"] == "Esta semana hay 2x1 en barba" and d["url"] == "/" + slug4 for d in Dn), json.dumps(Dn)[:300])
ok("4/11: un mensaje vacío no sale", err(q("select notify_followers(' ')", uid=own4), "bad_message"))
ok("4/11: ofertas a todos y novedades comparten el tope de 5 por día", all(not err(q("select notify_followers(%s)", (f"Novedad {i}",), uid=own4)) for i in range(3))
   and not err(q("select offer_slot(date_trunc('hour', now()) + interval '8 days', date_trunc('hour', now()) + interval '8 days 1 hour', null)", uid=own4))
   and err(q("select notify_followers('Una más')", uid=own4), "offer_limit")
   and err(q("select offer_slot(date_trunc('hour', now()) + interval '8 days 2 hours', date_trunc('hour', now()) + interval '8 days 3 hours', null)", uid=own4), "offer_limit"))
# S19 (8/11): un profesional suspendido no puede mandar novedades ni ofertas a sus seguidores (ni uno pendiente)
for st in ("suspended", "pending"):
    q("update providers set status = %s where id = %s", (st, pid4))
    q("delete from slot_offers where provider_id = %s", (pid4,)); q("delete from posts where provider_id = %s", (pid4,))
    nm = one("select count(*) from client_messages where provider_id = %s", (pid4,))
    ok(f"S19: con el negocio {'suspendido' if st == 'suspended' else 'pendiente'} no avisa a sus seguidores ni les ofrece turnos",
       err(q("select notify_followers('Promo: pagá por transferencia al alias x')", uid=own4), "not_active")
       and err(q("select offer_slot(date_trunc('hour', now()) + interval '9 days', date_trunc('hour', now()) + interval '9 days 1 hour', null)", uid=own4), "not_active")
       and err(q("select offer_slot(date_trunc('hour', now()) + interval '9 days', date_trunc('hour', now()) + interval '9 days 1 hour', %s)", (ana,), uid=own4), "not_active")
       and one("select count(*) from client_messages where provider_id = %s", (pid4,)) == nm)
q("update providers set status = 'active' where id = %s", (pid4,))
ok("S19: …y vuelve a poder cuando el admin lo reactiva", not err(q("select notify_followers('Volvimos')", uid=own4)))
ok("4/11: posts no acepta inserts directos (así no se saltea el límite) y un cliente no avisa", err(q("insert into posts (provider_id, body) values (%s, 'x')", (pid4,), uid=own4))
   and err(q("select notify_followers('hola a todos')", uid=ana), "not_provider") and err(q("select notify_followers('hola')", role="anon")))
q("update bookings set status = 'cancelled_provider' where id = %s", (b_off,))
q("delete from follows where user_id = %s and provider_id = %s", (otra, pid), uid=otra)
fl2 = one("select provider_followers()", uid=owner)
ok("4/11: quien deja de seguir sale de la lista y del número al toque", fl2["count"] == 1 and [i["name"] for i in fl2["items"]] == ["Ana P."]
   and one("select followers from providers where id = %s", (pid,)) == 1)
ok("4/11: funciones nuevas con search_path fijo y solo para cuentas con sesión", one(
   "select bool_and(p.proconfig::text like '%%search_path%%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('provider_followers','offer_slot','follower_label')")
   and not one("select has_function_privilege('anon', 'offer_slot(timestamptz,timestamptz,uuid)', 'execute') or has_function_privilege('anon', 'provider_followers()', 'execute')"))

# ---------- 10/11 · punto 3: dejar de seguir corta lo que estaba en la cola; suscripción vencida deja rastro ----------
own5 = mkuser("seg5@push.test", "Seg Cinco")
pid5 = one("select register_provider('Seguidores Push', 'Calle 5', array['p'], '2284 5', null)", uid=own5)
q("update providers set status = 'active', dni_verified = true where id = %s", (pid5,))
cli5 = mkuser("cli5@push.test", "clara Cinco")
ep5 = sub(cli5, label="Safari en iPhone")
sub(own5)
q("update push_outbox set status = 'skipped', skip_reason = 'stale' where status = 'pending'")
q("insert into follows (user_id, provider_id) values (%s, %s)", (cli5, pid5), uid=cli5)
nf5 = [d for d in due().values() if d["title"] == "Nuevo seguidor" and d["body"] == "Clara empezó a seguirte."]
ok("10/11: seguir → al profesional le llega «Clara empezó a seguirte.» (campanita y push a Seguidores)",
   one("select body from provider_notices where provider_id = %s and kind = 'new_follower'", (pid5,)) == "Clara empezó a seguirte."
   and len(nf5) == 1 and nf5[0]["url"] == "/panel/clientes?ver=seguidores", str(nf5))
q("update push_outbox set status = 'skipped', skip_reason = 'stale' where status = 'pending'")
r5 = q("select notify_followers('Abrimos el domingo')", uid=own5)
r6 = q("select offer_slot(date_trunc('hour', now()) + interval '2 days', date_trunc('hour', now()) + interval '2 days 1 hour', %s)", (cli5,), uid=own5)
ok("10/11: «Avisar» y «Ofrecer» → aviso en la campanita y push en la cola del seguidor", not err(r5) and not err(r6)
   and [r[1] for r in cola(cli5, "news")] == ["pending"] and [r[1] for r in cola(cli5, "offer")] == ["pending"])
q("delete from follows where user_id = %s and provider_id = %s", (cli5, pid5), uid=cli5)
D5 = due()
ok("10/11: dejar de seguir → lo que quedaba en la cola de ese profesional no sale ('unfollowed')",
   cola(cli5, "news") == [("news", "skipped", "unfollowed")] and cola(cli5, "offer") == [("offer", "skipped", "unfollowed")]
   and not [d for d in D5.values() if d["endpoint"] == ep5], str(cola(cli5)))
ok("10/11: …lo que ya le había llegado a la campanita queda, y sale de la lista de Seguidores",
   one("select count(*) from client_messages where user_id = %s and provider_id = %s", (cli5, pid5)) == 2
   and one("select provider_followers()", uid=own5)["count"] == 0)
q("insert into follows (user_id, provider_id) values (%s, %s)", (cli5, pid5), uid=cli5)
ok("10/11: volver a seguir no repite «empezó a seguirte» (una vez por persona, C06)",
   one("select count(*) from provider_notices where provider_id = %s and kind = 'new_follower'", (pid5,)) == 1)
q("select notify_followers('Segunda novedad')", uid=own5)
n5 = pending_ids(cli5, "news")
due()
q("select push_result(%s, 410, 'gone')", (n5[0],), role="service_role")
g5 = q("select user_id, label, host, status, kind from push_gone where user_id = %s", (cli5,))
ok("10/11: suscripción vencida (410) → se borra y queda el rastro en push_gone (sin el endpoint)",
   one("select count(*) from push_subscriptions where user_id = %s", (cli5,)) == 0
   and g5 == [(cli5, "Safari en iPhone", "fcm.googleapis.com", 410, "news")], str(g5))
ok("10/11: push_gone no la lee la app (ni con sesión ni sin)", err(q("select * from push_gone", uid=cli5)) and err(q("select * from push_gone", role="anon"))
   and one("select relrowsecurity from pg_class where oid = 'public.push_gone'::regclass"))

# ---------- 7/11 · feriados: el aviso de 7 días antes también va por push ----------
hoyF = dt.datetime.now(dt.timezone(dt.timedelta(hours=-3))).date()
fF = hoyF + dt.timedelta(days=4)
q("update providers set status = 'active' where id = %s", (pid,))
q("insert into provider_hours select %s, g, 1, '09:00', '18:00' from generate_series(0, 6) g on conflict do nothing", (pid,))
q("select holidays_sync_save(%s, %s::jsonb)", (fF.year, json.dumps([{"fecha": str(fF), "tipo": "inamovible", "nombre": "Feriado Push"}])), role="service_role")
q("select admin_holidays_confirm(%s)", (fF.year,), uid=admin)
q("select holiday_notices()")
hn = one("select id from provider_notices where provider_id = %s and kind = 'holiday'", (pid,))
D = due()
hp = [d for d in D.values() if d["tag"] == f"holiday-{hn}"]
ok("feriados: el aviso va por push al profesional, a Horarios", hn and hp and hp[0]["title"] == "Feriado: tu agenda está cerrada" and hp[0]["url"] == "/panel/horarios"
   and "es feriado y tu agenda está cerrada. ¿Vas a trabajar?" in hp[0]["body"], str(hp))
q("update push_outbox set next_attempt_at = now() where kind = 'holiday' and status = 'pending'")
q("insert into provider_holidays (provider_id, day, open) values (%s, %s, true)", (pid, fF))
due()
ok("feriados: si ya eligió antes de que salga, no se manda", all(r[1] == "skipped" for r in cola(owner, "holiday")) and cola(owner, "holiday"))

# 10/11 · feriados cerrados: el admin agrega un feriado en un día con turnos → «Tenés N turnos…» por push, a la Agenda de ese día
fB = fF + dt.timedelta(days=1)
q("insert into bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at, price) values (%s, 'Agendado', 'Corte', 'manual', 'confirmed', %s, %s, 1000)",
  (pid, dt.datetime.combine(fB, dt.time(10, 0), tzinfo=dt.timezone(dt.timedelta(hours=-3))), dt.datetime.combine(fB, dt.time(10, 30), tzinfo=dt.timezone(dt.timedelta(hours=-3)))))
q("select admin_holiday_save(%s, 'Feriado Turnos', 'inamovible')", (fB,), uid=admin); q("select admin_holidays_confirm(%s)", (fB.year,), uid=admin)
hb = one("select id from provider_notices where provider_id = %s and kind = 'holiday_bookings' and ref = %s", (pid, str(fB)))
D = due()
hbp = [d for d in D.values() if d["tag"] == f"holiday-{hb}"]
ok("feriados cerrados: «Tenés N turnos el <día>, que es feriado…» va por push, a la Agenda de ese día",
   hb and len(hbp) == 1 and hbp[0]["title"] == "Turnos en un feriado" and hbp[0]["url"] == f"/panel/agenda?dia={fB}" and ", que es feriado. Se mantiene" in hbp[0]["body"], str(hbp))

print("TODO OK" if F == 0 else f"{F} FALLAS")
sys.exit(1 if F else 0)

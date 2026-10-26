"""Avisos por email (Bloque 3): la cola email_outbox que llena client_messages, lo que pide email-send (emails_due), el
resultado de cada envío (email_result), la opción del cliente y los permisos.
Corre contra una base LIMPIA con pruebas/supabase_emulation.sql + supabase/TODO_EN_UNO.sql:
    python3 pruebas/test_emails.py "host=... dbname=BASE_LIMPIA user=postgres"
La función real (con un Resend falso) se prueba en pruebas/funciones/."""
import json, sys, uuid, datetime as dt
import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=tt_emails user=postgres"
conn = psycopg.connect(DSN, autocommit=True)
F = 0


def ok(name, cond):
    global F
    if not cond:
        F += 1
    print(("OK   " if cond else "FAIL ") + name)


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


def mkuser(email, name, confirmed=True):
    uid = uuid.uuid4()
    q("insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values (%s, %s, %s, %s)",
      (uid, email, json.dumps({"full_name": name}), dt.datetime.now(dt.timezone.utc) if confirmed else None))
    return uid


owner = mkuser("dueno@mail.test", "Dueño")
pid = one("select register_provider('Barbería Mail', 'Calle 1', array['b'], '2284 1', '30111800')", uid=owner)
q("update providers set status = 'active', dni_verified = true where id = %s", (pid,))
ana = mkuser("ana@mail.test", "Ana Mail")
sin_confirmar = mkuser("sinconfirmar@mail.test", "Sin Confirmar", confirmed=False)
apagado = mkuser("apagado@mail.test", "Apagado")
cambia = mkuser("cambia@mail.test", "Cambia de idea")


N = [0]
def turno(client, hours, status="confirmed", created_days=3):
    """Turno de la app (como postgres) que empieza en `hours` horas (más unos minutos, para que no se superpongan)."""
    N[0] += 1
    return one("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, created_at) "
               "values (%s, %s, 'Ana Mail', 'Corte', 'app', %s, now() + %s * interval '1 hour' + %s * interval '2 minutes', "
               "now() + %s * interval '1 hour' + %s * interval '2 minutes' + interval '1 minute', 10000, now() - %s * interval '1 day') returning id",
               (pid, client, status, hours, N[0], hours, N[0], created_days))


def cola(bid=None, kind=None):
    return q("select o.kind, o.status, o.skip_reason, o.attempts from email_outbox o join client_messages m on m.id = o.message_id "
             "where (%s::bigint is null or o.booking_id = %s) and (%s::text is null or o.kind = %s) order by o.id", (bid, bid, kind, kind))


def due():
    r = q("select id, to_email, subject, body, provider_name, site_url, optional from emails_due(100)", role="service_role")
    return r if err(r) else {x[0]: x[1:] for x in r}


def outbox_id(bid, kind):
    return one("select id from email_outbox where booking_id = %s and kind = %s", (bid, kind))


# ---------- 1. Qué entra a la cola ----------
b1 = turno(ana, 48)
q("select notify_booking(%s, 'conf')", (b1,))
ok("la confirmación de un turno entra a la cola de emails", cola(b1, "conf") == [("conf", "pending", None, 0)])
q("select notify_booking(%s, 'conf')", (b1,))
ok("una sola vez por turno y tipo (el aviso repetido no suma otro email)", len(cola(b1, "conf")) == 1)
q("insert into client_messages (provider_id, user_id, body) values (%s, %s, 'Hola, tengo lugar el sábado')", (pid, ana))
ok("los mensajes que escribe el prestador (msg) no van por email",
   one("select count(*) from email_outbox o join client_messages m on m.id = o.message_id where m.kind = 'msg'") == 0)
# "Recordatorios y novedades por email" apagada: los recordatorios, la reseña y el cumpleaños no van; la confirmación y
# las cancelaciones, siempre (avisos del servicio)
q("update profiles set email_notices = false where id = %s", (apagado,))
b_ap = turno(apagado, 48)
q("select notify_booking(%s, 'conf')", (b_ap,))
ok("con la casilla apagada, la confirmación igual va por email", cola(b_ap) == [("conf", "pending", None, 0)])
b_ap24 = turno(apagado, 20)
q("select send_scheduled_notices()")
ok("…el recordatorio no entra a la cola (el aviso en la app, sí)", cola(b_ap24) == []
   and one("select count(*) from client_messages where kind = 'r24' and ref = %s", (str(b_ap24),)) == 1)
q("insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, '¡Feliz cumpleaños!', 'bday', '2026'), (%s, %s, '¿Nos dejás tu opinión?', 'rev', '1')",
  (pid, apagado, pid, apagado))
ok("…ni la reseña ni el cumpleaños", one("select count(*) from email_outbox where user_id = %s and kind in ('rev','bday')", (apagado,)) == 0)
q("update bookings set status = 'cancelled_provider' where id = %s", (b_ap24,))
q("select notify_booking(%s, 'cancel')", (b_ap24,))
ok("…y una cancelación igual sale por email", cola(b_ap24, "cancel") == [("cancel", "pending", None, 0)])
q("update message_templates set enabled = false where provider_id = %s and key = 'conf'", (pid,))
b_off = turno(ana, 50)
q("select notify_booking(%s, 'conf')", (b_off,))
ok("si el prestador apagó la plantilla, no hay aviso ni email", cola(b_off) == [])
q("update message_templates set enabled = true where provider_id = %s and key = 'conf'", (pid,))
# recordatorios: los arma send_scheduled_notices (cron cada 10 minutos)
b24 = turno(ana, 20)
b2 = turno(ana, 1.5)
q("select send_scheduled_notices()")
ok("recordatorio de 24 h y de 2 h a la cola", cola(b24, "r24") == [("r24", "pending", None, 0)] and cola(b2, "r2") == [("r2", "pending", None, 0)])
ok("…y valen hasta que empieza el turno", one("select bool_and(o.expires_at = b.starts_at) from email_outbox o join bookings b on b.id = o.booking_id "
                                              "where o.kind in ('r24','r2') and o.booking_id in (%s, %s)", (b24, b2)) is True)
q("select send_scheduled_notices()")
ok("una segunda corrida del cron no repite los emails", len(cola(b24)) == 1 and len(cola(b2)) == 1)

# ---------- 2. Lo que pide la función ----------
D = due()
ok("emails_due: dirección, asunto, texto (el mismo de la app), negocio y dirección del sitio",
   D.get(outbox_id(b1, "conf")) == ("ana@mail.test", "Tu turno en Barbería Mail quedó confirmado",
                                    one("select body from client_messages where kind = 'conf' and ref = %s", (str(b1),)),
                                    "Barbería Mail", "https://tutiempo.com.ar", False))   # la confirmación no se puede apagar
ok("…los recordatorios sí se pueden apagar (optional)", D.get(outbox_id(b24, "r24"), [None] * 6)[5] is True and D.get(outbox_id(b2, "r2"), [None] * 6)[5] is True)
ok("…asuntos de los recordatorios", D.get(outbox_id(b24, "r24"), [None, None])[1] == "Mañana tenés turno en Barbería Mail"
   and D.get(outbox_id(b2, "r2"), [None, None])[1] == "Hoy a las " + one("select to_char(starts_at at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') from bookings where id = %s", (b2,)) + " tenés turno en Barbería Mail")
ok("…y los reserva: una segunda corrida al mismo tiempo no los manda otra vez", due() == {})

# ---------- 3. Los que ya no van ----------
b_nc = turno(sin_confirmar, 48)
q("select notify_booking(%s, 'conf')", (b_nc,))
b_tarde = turno(ana, 20)
q("select send_scheduled_notices()")
b_lo_apaga = turno(cambia, 21)
b_conf_cambia = turno(cambia, 49)
q("select send_scheduled_notices()")
q("select notify_booking(%s, 'conf')", (b_conf_cambia,))
q("update profiles set email_notices = false where id = %s", (cambia,))   # la apaga con los emails ya en la cola
q("update bookings set status = 'cancelled_client' where id = %s", (b_tarde,))
D = due()
ok("sin email confirmado: no se manda", cola(b_nc) == [("conf", "skipped", "no_email", 0)])
ok("si apagó la casilla con el recordatorio ya en la cola: no se manda", cola(b_lo_apaga, "r24") == [("r24", "skipped", "opt_out", 0)])
ok("…pero la confirmación sí", cola(b_conf_cambia, "conf") == [("conf", "pending", None, 0)] and outbox_id(b_conf_cambia, "conf") in D
   and D[outbox_id(b_conf_cambia, "conf")][0] == "cambia@mail.test")
ok("recordatorio de un turno que ya no está confirmado: no se manda", cola(b_tarde, "r24") == [("r24", "skipped", "stale", 0)])
b_empezo = turno(ana, 20)
q("select send_scheduled_notices()")
q("update bookings set starts_at = now() - interval '5 minutes', ends_at = now() + interval '25 minutes' where id = %s", (b_empezo,))
due()
ok("recordatorio de un turno que ya empezó: no se manda", cola(b_empezo, "r24") == [("r24", "skipped", "stale", 0)])

# ---------- 4. Resultado de cada envío ----------
e1 = outbox_id(b1, "conf")
q("select email_result(%s, true, 're_123')", (e1,), role="service_role")
ok("enviado: queda con la fecha y el id de Resend", q("select status, attempts, provider_message_id, sent_at is not null from email_outbox where id = %s", (e1,))
   == [("sent", 1, "re_123", True)])
q("select email_result(%s, false, null, 'otra vez')", (e1,), role="service_role")
ok("…y un resultado repetido no lo cambia", one("select status from email_outbox where id = %s", (e1,)) == "sent")
e24 = outbox_id(b24, "r24")
q("select email_result(%s, false, null, '500 Resend caído')", (e24,), role="service_role")
ok("si falla, se reintenta a los 5 minutos con el error", q("select status, attempts, last_error, next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes' "
                                                            "from email_outbox where id = %s", (e24,)) == [("pending", 1, "500 Resend caído", True)])
for _ in range(4):
    q("update email_outbox set expires_at = now() + interval '1 day' where id = %s", (e24,))
    q("select email_result(%s, false, null, '500')", (e24,), role="service_role")
ok("…después del quinto intento queda fallido", q("select status, attempts from email_outbox where id = %s", (e24,)) == [("failed", 5)])
e2 = outbox_id(b2, "r2")
q("select email_result(%s, false, null, '422 dirección inválida', true)", (e2,), role="service_role")
ok("un error que no se arregla reintentando (dirección inválida) queda fallido enseguida", q("select status, attempts from email_outbox where id = %s", (e2,)) == [("failed", 1)])
b_vence = turno(ana, 20)
q("select send_scheduled_notices()")
ev = outbox_id(b_vence, "r24")
q("update email_outbox set expires_at = now() + interval '2 minutes' where id = %s", (ev,))
q("select email_result(%s, false, null, 'timeout')", (ev,), role="service_role")
ok("si el reintento llegaría tarde (después de que empieza el turno), queda fallido", one("select status from email_outbox where id = %s", (ev,)) == "failed")

# ---------- 5. Cancelaciones, reseña y cumpleaños ----------
bc = turno(ana, 30)
q("update bookings set status = 'cancelled_provider' where id = %s", (bc,))
q("select notify_booking(%s, 'cancel')", (bc,))
br = turno(ana, 31)
q("update bookings set status = 'cancelled_refunded' where id = %s", (br,))
q("insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, 'Mercado Pago te devolvió el pago, así que tu turno quedó cancelado.', 'cancel', %s)", (pid, ana, str(br)))
# turno que el sistema no pudo confirmar: el aviso lo deja la devolución (refunds), con el texto de Mis turnos
bx = turno(ana, 32, status="expired")
q("update bookings set paid_mp = 5000, app_fee = 500 where id = %s", (bx,))   # lo cobrado, que se devuelve
q("insert into refunds (booking_id, provider_id, amount, reason) values (%s, %s, 5500, 'slot_taken')", (bx, pid))
cx = q("select body from client_messages where kind = 'cancel' and ref = %s", (str(bx),))
ok("turno que el sistema no pudo confirmar: queda el aviso en la app con el motivo y lo que se devuelve",
   len(cx) == 1 and "No pudimos confirmar tu turno del" in cx[0][0] and "el horario ya no estaba libre cuando se acreditó tu pago" in cx[0][0]
   and "Te devolvemos $5.500" in cx[0][0] and "barberia-mail" in cx[0][0])
bp = turno(ana, 33)
q("update bookings set status = 'cancelled_provider', paid_mp = 5000, app_fee = 500 where id = %s", (bp,))
q("insert into refunds (booking_id, provider_id, amount, reason) values (%s, %s, 5500, 'booking_unavailable')", (bp, pid))
ok("…pero no si lo había cancelado el prestador (ese aviso ya lo tuvo)", q("select count(*) from client_messages where kind = 'cancel' and ref = %s", (str(bp),)) == [(0,)])
bd = turno(ana, -2)
q("update bookings set status = 'done' where id = %s", (bd,))
q("select notify_booking(%s, 'rev')", (bd,))
q("insert into client_messages (provider_id, user_id, body, kind, ref) values (%s, %s, '¡Feliz cumpleaños, Ana!', 'bday', '2026')", (pid, ana))
D = due()
subj = {k: v[1] for k, v in D.items()}
ok("cancelación del prestador (y bloqueo de días): «… canceló tu turno»", subj.get(outbox_id(bc, "cancel")) == "Barbería Mail canceló tu turno")
ok("pago devuelto por Mercado Pago: «Tu turno en … quedó cancelado»", subj.get(outbox_id(br, "cancel")) == "Tu turno en Barbería Mail quedó cancelado")
ok("turno que el sistema no pudo confirmar: «No pudimos confirmar tu turno en …»", subj.get(outbox_id(bx, "cancel")) == "No pudimos confirmar tu turno en Barbería Mail")
ok("reseña y cumpleaños, con su asunto", subj.get(outbox_id(bd, "rev")) == "¿Qué tal tu turno en Barbería Mail?"
   and "¡Feliz cumpleaños de parte de Barbería Mail!" in subj.values())

# ---------- 6. Opción en Mi perfil y permisos ----------
ok("el cliente ve y cambia su opción de emails", q("select email_notices from profiles where id = %s", (ana,), uid=ana) == [(True,)]
   and not err(q("update profiles set email_notices = false where id = %s", (ana,), uid=ana))
   and one("select email_notices from profiles where id = %s", (ana,)) is False)
q("update profiles set email_notices = true where id = %s", (ana,))
ok("…no la de otro", q("update profiles set email_notices = false where id = %s returning id", (ana,), uid=apagado) == []
   and one("select email_notices from profiles where id = %s", (ana,)) is True)
ok("la cola no la lee nadie desde el navegador (ni el admin, ni el cliente)", err(q("select * from email_outbox", uid=ana)) and err(q("select * from email_outbox", role="anon")))
ok("emails_due, email_result y run_email_send son internas", all(err(q(sql, uid=ana)) and err(q(sql, role="anon")) for sql in
   ("select * from emails_due()", "select email_result(1, true)", "select run_email_send()")))

# ---------- 7. Cron ----------
q("delete from vault.secrets where name in ('tt_project_url', 'tt_cron_secret')"); q("delete from net.requests")
ok("sin los secretos en Vault, el cron no llama a nada", q("select run_email_send()", role="service_role") == [(None,)] and one("select count(*) from net.requests") == 0)
q("select vault.create_secret('https://proyecto.supabase.co/', 'tt_project_url')"); q("select vault.create_secret('secreto-del-cron', 'tt_cron_secret')")
q("select run_email_send()", role="service_role")
ok("con los secretos, llama a email-send con la clave del cron", q("select url, headers->>'Authorization' from net.requests")
   == [("https://proyecto.supabase.co/functions/v1/email-send", "Bearer secreto-del-cron")])

# ---------- 8. Retención (D25): la limpieza diaria borra lo enviado, descartado o fallido con más de 90 días ----------
viejos = [x[0] for x in q("select id from email_outbox where status in ('sent','skipped','failed') order by id limit 3")]
pend = one("select id from email_outbox where status = 'pending' order by id limit 1")
nuevo = one("select id from email_outbox where status in ('sent','skipped','failed') and id <> all(%s) order by id limit 1", (viejos,))
q("update email_outbox set created_at = now() - interval '91 days' where id = any(%s)", (viejos + [pend],))
cl = one("select daily_cleanup()", role="service_role")
quedan = {x[0] for x in q("select id from email_outbox where id = any(%s)", (viejos + [pend, nuevo],))}
ok("retención: borra lo enviado, descartado o fallido con más de 90 días", len(viejos) == 3 and not (set(viejos) & quedan) and cl["emails"] >= 3)
ok("…pero no lo pendiente ni lo reciente", pend in quedan and nuevo in quedan)

print("TODO OK" if not F else f"{F} FALLAS")
sys.exit(1 if F else 0)

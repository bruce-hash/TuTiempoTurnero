"""Pruebas de cobros (Bloque 1): pagos, devoluciones, cuentas de Mercado Pago y avisos.
Reemplaza a reproducir_errores_cobro.py: H01 y H02 ya no se reproducen, terminan en devolución registrada.
Corre contra una base LIMPIA con pruebas/supabase_emulation.sql + supabase/TODO_EN_UNO.sql:
    python3 pruebas/test_cobros.py "host=... dbname=BASE_LIMPIA user=postgres"
Las Edge Functions (llaves, webhook, devoluciones contra un Mercado Pago falso) se prueban en pruebas/funciones/."""
import json, sys, uuid, datetime as dt
import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=tt user=postgres"
conn = psycopg.connect(DSN, autocommit=True)
F = 0
TZ = dt.timezone(dt.timedelta(hours=-3))


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


def mkuser(email, name):
    uid = uuid.uuid4()
    q("insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)", (uid, email, json.dumps({"full_name": name})))
    return uid


def at(days, hh, mm=0):
    return dt.datetime.combine(dt.date.today() + dt.timedelta(days=days), dt.time(hh, mm), TZ)


def svc_role(sql, args=None):
    return one(sql, args, role="service_role")


def connect(pid, mp_user):
    return svc_role("select mp_connect(%s, %s, %s, %s, 15552000)", (pid, mp_user, f"tok-{mp_user}", f"ref-{mp_user}"))


def book(sv, start, uid, weeks=0, extra=0):
    return q("select book_slot(%s, %s, %s, %s)", (sv, start, weeks, extra), uid=uid)


def pay(ids, pay_id, amount, fee, pid=None, acct=None, raw=None):
    return svc_role("select confirm_payment(%s::bigint[], %s, %s, p_provider => %s, p_account => %s, p_fee_mp => %s, p_raw => %s)",
                    (ids, pay_id, amount, pid, acct, fee, json.dumps(raw) if raw is not None else None))


def mp_update(pay_id, status, refunded=0):
    return svc_role("select payment_mp_update(%s, %s, %s)", (pay_id, status, refunded))


def bk(bid, cols="status, refund_pending, paid_mp, app_fee"):
    return q(f"select {cols} from bookings where id = %s", (bid,))[0]


def refunds_of(bid):
    return q("select amount, reason, status, payment_id is not null, mp_payment_id, mp_account_id from refunds where booking_id = %s order by id", (bid,))


def expire(bid):
    q("update bookings set hold_expires_at = now() - interval '1 minute' where id = %s", (bid,))
    q("select expire_holds(null)")


# ---------- Datos: un prestador conectado, dos clientes, servicio de $10.000 (seña 50% = $5.000 + comisión 10% = $1.000) ----------
owner = mkuser("prov@cobros.ar", "Prov Cobros")
cli = mkuser("ana@cobros.ar", "Ana Cobros")
cli2 = mkuser("beto@cobros.ar", "Beto Cobros")
adm = mkuser("admin@cobros.ar", "Admin")
q("insert into app_admins (user_id) values (%s)", (adm,))
pid = one("select register_provider('Prov Cobros', 'Calle 1', array['b'], '2284 000111', '30111222')", uid=owner)
q("update providers set status = 'active' where id = %s", (pid,))
q("update provider_settings set online = true, notice_min = 0, step_min = 30, deposit_pct = 50, pay_mode = 'deposit' where provider_id = %s", (pid,))
q("delete from provider_hours where provider_id = %s", (pid,))
q("insert into provider_hours select %s, g, 1, '08:00', '21:00' from generate_series(0, 6) g", (pid,))
q("select admin_set_commission(10)", uid=adm)
sv = one("insert into services (provider_id, category_id, name, duration_min, price) values (%s, 'b', 'Corte', 30, 10000) returning id", (pid,), uid=owner)

# ---------- H23 previo: sin cuenta de Mercado Pago no se reserva con seña ----------
r = book(sv, at(2, 9), cli)
ok("sin cuenta de Mercado Pago: book_slot rechaza la reserva con seña", err(r, "provider_mp_not_connected"))
ok("la ficha pública informa que no puede cobrar (sin datos de la cuenta)",
   one("select get_provider(%s)", (pid,), role="anon")["can_charge"] is False
   and "mp_user_id" not in json.dumps(one("select get_provider(%s)", (pid,), role="anon")))
ok("sin cuenta, el listado no ofrece próximo horario", one("select next_free_slot(%s)", (pid,), role="anon") is None)
acc1 = connect(pid, "111")
ok("conectar crea la cuenta activa y marca mp_connected", q("select status from mp_accounts where id = %s", (acc1,))[0][0] == "active"
   and one("select mp_connected from provider_private where provider_id = %s", (pid,)) is True)
ok("con cuenta: la ficha dice que puede cobrar y el listado ofrece horario",
   one("select get_provider(%s)", (pid,), role="anon")["can_charge"] is True and one("select next_free_slot(%s)", (pid,), role="anon") is not None)

# ---------- Confirmación normal, idempotencia (mismo aviso dos veces), comisión de Mercado Pago ----------
r = book(sv, at(2, 9), cli)[0][0]
b0 = r["booking_ids"][0]
ok("reserva: seña $5.000 + comisión $1.000", r["amount_due"] == 6000)
res = pay([b0], "P-OK", 6000, 1000, pid, acc1, {"id": "P-OK", "status": "approved", "card": {"first_six_digits": "450995"},
                                                 "payer": {"email": "ana@cobros.ar", "identification": {"number": "30111222"}}})
ok("pago aprobado: confirma el turno", res["status"] == "processed" and res["confirmed"] == 1 and bk(b0)[0] == "confirmed")
pm = q("select id, outcome, amount, fee_expected, fee_mp, mp_account_id, booking_ids from payments where mp_payment_id = 'P-OK'")[0]
ok("queda en payments: monto, comisión calculada y la de MP, cuenta que cobró, turnos", pm[1:] == ("confirmed", 6000, 1000, 1000, acc1, [b0]))
ok("el turno queda ligado al pago", one("select payment_id from bookings where id = %s", (b0,)) == pm[0])
ok("lo cobrado por el turno queda en payment_bookings", q("select amount, fee, result from payment_bookings where payment_id = %s", (pm[0],))[0] == (6000, 1000, "confirmed"))
raw = one("select mp_responses from payments where id = %s", (pm[0],))
ok("se guarda la respuesta de Mercado Pago sin datos de tarjeta ni documento",
   len(raw) == 1 and raw[0]["body"]["id"] == "P-OK" and "card" not in raw[0]["body"] and "identification" not in raw[0]["body"]["payer"]
   and "450995" not in json.dumps(raw))
again = pay([b0], "P-OK", 6000, 1000, pid, acc1, {"id": "P-OK", "status": "approved"})
ok("mismo aviso dos veces: no hace nada más", again["status"] == "already_processed"
   and one("select count(*) from payments where mp_payment_id = 'P-OK'") == 1
   and one("select count(*) from client_messages where kind = 'conf' and ref = %s", (str(b0),)) == 1)
ok("…pero guarda la segunda consulta", len(one("select mp_responses from payments where id = %s", (pm[0],))) == 2)

r = book(sv, at(2, 10), cli)[0][0]
res = pay(r["booking_ids"], "P-NOFEE", 6000, None, pid, acc1)
ok("b) Mercado Pago no informa la comisión: el turno se confirma y el pago queda para revisar",
   bk(r["booking_ids"][0])[0] == "confirmed" and q("select outcome, review_reasons from payments where mp_payment_id = 'P-NOFEE'")[0] == ("review", ["fee_missing"]))
r = book(sv, at(2, 11), cli)[0][0]
pay(r["booking_ids"], "P-BADFEE", 6000, 600, pid, acc1)
ok("b) comisión distinta a la calculada: para revisar con su motivo",
   q("select outcome, review_reasons, fee_mp, fee_expected from payments where mp_payment_id = 'P-BADFEE'")[0] == ("review", ["fee_mismatch"], 600, 1000))

# ---------- H01: el hold venció, otro tomó el horario y el pago llega tarde ----------
r = book(sv, at(3, 9), cli)[0][0]
b1 = r["booking_ids"][0]
expire(b1)
ok("H01: otro cliente toma el horario liberado", not err(book(sv, at(3, 9), cli2)))
res = pay([b1], "P-H01", 6000, 1000, pid, acc1)
ok("H01: el pago se registra y el turno queda para devolver (no falla)", res["status"] == "processed" and res["refunded"] == 1
   and bk(b1)[:2] == ("cancelled_provider", 6000))
ok("H01: la devolución queda ligada al pago, con el id de MP y la cuenta que cobró",
   refunds_of(b1) == [(6000, "slot_taken", "pending", True, "P-H01", acc1)])
ok("H01: el pago queda como 'refund'", one("select outcome from payments where mp_payment_id = 'P-H01'") == "refund")
ok("H01: el reintento del webhook no duplica la devolución",
   pay([b1], "P-H01", 6000, 1000, pid, acc1)["status"] == "already_processed" and len(refunds_of(b1)) == 1)

# ---------- H02: el prestador cancela el hold y el cliente termina de pagar igual ----------
r = book(sv, at(3, 10), cli)[0][0]
b2 = r["booking_ids"][0]
ok("H02: el prestador cancela la reserva en pago", one("select cancel_by_provider(%s)", (b2,), uid=owner)["status"] == "cancelled")
res = pay([b2], "P-H02", 6000, 1000, pid, acc1)
ok("H02: el pago se registra y se devuelve todo (antes: bookings_not_found y MP reintentando)",
   res["status"] == "processed" and refunds_of(b2) == [(6000, "booking_unavailable", "pending", True, "P-H02", acc1)]
   and bk(b2)[:2] == ("cancelled_provider", 6000))

# ---------- H03 / D16: monto distinto ----------
r = book(sv, at(3, 11), cli)[0][0]
b3 = r["booking_ids"][0]
res = pay([b3], "P-SHORT", 5000, 1000, pid, acc1)
ok("D16: llegó menos → no se confirma nada y se devuelve todo lo cobrado",
   res["confirmed"] == 0 and bk(b3)[:2] == ("expired", 5000) and refunds_of(b3) == [(5000, "amount_short", "pending", True, "P-SHORT", acc1)])
ok("D16: el horario queda libre", not err(book(sv, at(3, 11), cli2)))
r = book(sv, at(3, 12), cli)[0][0]
b4 = r["booking_ids"][0]
res = pay([b4], "P-OVER", 7000, 1000, pid, acc1)
ok("D16: llegó más → se confirma y la diferencia va a revisión (no se devuelve sola)",
   bk(b4)[0] == "confirmed" and res["extra"] == 1000 and refunds_of(b4) == []
   and q("select outcome, review_reasons from payments where mp_payment_id = 'P-OVER'")[0] == ("review", ["amount_over"]))

# ---------- Serie con el primero ocupado ----------
r = book(sv, at(4, 9), cli, weeks=1, extra=2)[0][0]
s_ids = r["booking_ids"]
ok("serie de 3 turnos: $18.000", len(s_ids) == 3 and r["amount_due"] == 18000)
for x in s_ids:
    expire(x)
ok("la serie vence y otro toma el PRIMER horario", not err(book(sv, at(4, 9), cli2)))
res = pay(s_ids, "P-SERIE", 18000, 3000, pid, acc1)
ok("serie con el primero ocupado: se confirman los otros dos y el primero queda para devolver",
   res["confirmed"] == 2 and res["refunded"] == 1 and [bk(x)[0] for x in s_ids] == ["cancelled_provider", "confirmed", "confirmed"])
ok("serie: el primero tiene su devolución ligada al pago (antes quedaba sin mp_payment_id)",
   refunds_of(s_ids[0]) == [(6000, "slot_taken", "pending", True, "P-SERIE", acc1)])
ok("serie: los 3 turnos quedan ligados al mismo pago", q("select count(distinct payment_id), count(*) from bookings where id = any(%s)", (s_ids,))[0] == (1, 3))
ok("serie: el pago queda como 'partial'", one("select outcome from payments where mp_payment_id = 'P-SERIE'") == "partial")

# ---------- a) Nunca devolver más de lo cobrado ----------
ps = one("select id from payments where mp_payment_id = 'P-SERIE'")
ok("a) no se puede devolver más de lo cobrado por un turno",
   err(q("select refund_request(%s, %s, 1, 'provider_cancelled')", (s_ids[0], ps)), "refund_exceeds_booking"))
ok("a) cancelar otro turno de la serie devuelve solo lo de ese turno", one("select cancel_by_provider(%s)", (s_ids[1],), uid=owner)["refund_mp"] == 6000
   and refunds_of(s_ids[1]) == [(6000, "provider_cancelled", "pending", True, "P-SERIE", acc1)])
ok("a) la suma de devoluciones de la serie no supera el pago",
   err(q("select refund_request(null, %s, 6001, 'unknown_booking')", (ps,)), "refund_exceeds_payment")
   and one("select sum(amount) from refunds where payment_id = %s", (ps,)) == 12000)
ok("a) una devolución hecha también cuenta para el tope",
   err(q("update refunds set amount = amount + 1 where booking_id = %s", (s_ids[1],)), "refund_exceeds"))
ok("a) la app no puede crear devoluciones", err(q("select refund_request(%s, %s, 1, 'provider_cancelled')", (s_ids[2], ps), uid=owner))
   and err(q("insert into refunds (booking_id, amount, reason) values (%s, 1, 'provider_cancelled')", (s_ids[2],), uid=owner)))

# ---------- D15: series hasta 90 días ----------
r = book(sv, at(5, 9), cli, weeks=6, extra=3)[0][0]
dias = [one("select (starts_at at time zone 'America/Argentina/Buenos_Aires')::date - current_date from bookings where id = %s", (x,)) for x in r["booking_ids"]]
ok("D15: cada 6 semanas × 4: el 4° (día 131) pasa los 90 días y se saltea como un ocupado",
   r["skipped"] == 1 and len(r["booking_ids"]) == 3 and max(dias) <= 90 and max(dias) > 31)
r = book(sv, at(6, 9), cli, weeks=4, extra=3)[0][0]
ok("D15: cada 4 semanas × 4 (hasta el día 90) entran todos", r["skipped"] == 0 and len(r["booking_ids"]) == 4)
for x in r["booking_ids"]:
    q("select cancel_by_client(%s)", (x,), uid=cli)
ok("D15: el primer turno sigue limitado a los 31 días del turnero", err(book(sv, at(40, 9), cli), "slot_not_available"))

# ---------- D17: devolución hecha desde Mercado Pago (fuera de la app) ----------
r = book(sv, at(7, 9), cli, weeks=1, extra=1)[0][0]
e_ids = r["booking_ids"]
pay(e_ids, "P-EXT", 12000, 2000, pid, acc1)
q("update bookings set starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '30 minutes' where id = %s", (e_ids[0],))
q("update bookings set status = 'done' where id = %s", (e_ids[0],))
res = mp_update("P-EXT", "refunded", 12000)
ok("D17: devuelto desde MP → el turno futuro se cancela con estado propio y el pasado no cambia",
   res["cancelled"] == 1 and bk(e_ids[1])[0] == "cancelled_refunded" and bk(e_ids[0])[0] == "done")
ok("D17: sin otra devolución", refunds_of(e_ids[1]) == [] and bk(e_ids[1])[1] == 0)
ok("D17: aviso al cliente", any("Mercado Pago te devolvió el pago" in m["body"] for m in one("select my_messages()", uid=cli)))
nt = one("select my_provider_notices()", uid=owner)
ok("D17: aviso al prestador", any(n["kind"] == "mp_refunded" and "P-EXT" in n["body"] and "1 turno futuro" in n["body"] for n in nt))
ok("D17: el pago queda refunded (sin revisión: no hay nada que decidir)", q("select mp_status, outcome from payments where mp_payment_id = 'P-EXT'")[0] == ("refunded", "confirmed"))
ok("D17: el aviso repetido no hace nada", mp_update("P-EXT", "refunded", 12000)["status"] == "already_processed"
   and len([n for n in one("select my_provider_notices()", uid=owner) if n["kind"] == "mp_refunded"]) == 1)
ok("el cliente ve el turno como 'devuelto desde Mercado Pago', distinto de 'canceló el prestador'",
   [b["status"] for b in one("select my_bookings()", uid=cli) if b["id"] == e_ids[1]] == ["cancelled_refunded"])
# nuestra propia devolución total: MP avisa "refunded" y no es un caso externo
r = book(sv, at(7, 11), cli)[0][0]
bo = r["booking_ids"][0]
pay([bo], "P-OURS", 6000, 1000, pid, acc1)
q("select cancel_by_provider(%s)", (bo,), uid=owner)
n_before = len(one("select my_provider_notices()", uid=owner))
mp_update("P-OURS", "refunded", 6000)
ok("devolución de la app informada por MP: se marca hecha y no avisa como externa",
   refunds_of(bo)[0][2] == "done" and bk(bo)[1] == 0 and len(one("select my_provider_notices()", uid=owner)) == n_before)
# devolución parcial
r = book(sv, at(7, 12), cli, weeks=1, extra=1)[0][0]
p_ids = r["booking_ids"]
pay(p_ids, "P-PART", 12000, 2000, pid, acc1)
q("select cancel_by_provider(%s)", (p_ids[1],), uid=owner)
ok("parcial que coincide con la de la app (en curso): sin revisión",
   mp_update("P-PART", "approved", 6000)["status"] == "ok" and one("select outcome from payments where mp_payment_id = 'P-PART'") == "confirmed")
mp_update("P-PART", "approved", 2500)
ok("D17: parcial que no coincide → revisión", q("select outcome, review_reasons from payments where mp_payment_id = 'P-PART'")[0] == ("review", ["partial_refund_mismatch"]))

# ---------- D18: contracargo y reclamo ----------
r = book(sv, at(8, 9), cli)[0][0]
bc = r["booking_ids"][0]
pay([bc], "P-CB", 6000, 1000, pid, acc1)
res = mp_update("P-CB", "charged_back", 6000)
ok("D18: contracargo → turno futuro cancelado, pago en revisión", bk(bc)[0] == "cancelled_refunded"
   and q("select mp_status, outcome, review_reasons from payments where mp_payment_id = 'P-CB'")[0] == ("charged_back", "review", ["charged_back"]))
ok("D18: aviso al cliente y al prestador", any("contracargo" in m["body"] for m in one("select my_messages()", uid=cli))
   and any(n["kind"] == "mp_charged_back" for n in one("select my_provider_notices()", uid=owner)))
ok("D18: sin penalizaciones (no cuenta como falta)", one("select coalesce(sum(no_shows), 0) from provider_clients where provider_id = %s and user_id = %s", (pid, cli)) == 0)
r = book(sv, at(8, 10), cli)[0][0]
bm = r["booking_ids"][0]
pay([bm], "P-MED", 6000, 1000, pid, acc1)
mp_update("P-MED", "in_mediation")
ok("D18: reclamo → solo se marca, el turno sigue, revisión y aviso al prestador", bk(bm)[0] == "confirmed"
   and q("select mp_status, outcome from payments where mp_payment_id = 'P-MED'")[0] == ("in_mediation", "review")
   and any(n["kind"] == "mp_in_mediation" for n in one("select my_provider_notices()", uid=owner)))
ok("aviso de un pago que no está registrado: queda para revisar", mp_update("P-NADA", "charged_back")["status"] == "review"
   and one("select outcome from payments where mp_payment_id = 'P-NADA'") == "review")

# ---------- D19: reintentos con backoff ----------
rf = one("select id from refunds where booking_id = %s", (b1,))
ok("la devolución está en la cola", any(x[0] == rf for x in q("select id from refunds_due(200)", role="service_role")))
steps = []
for i in range(9):
    estado = svc_role("select refund_result(%s, false, null, %s)", (rf, f"insufficient_amount #{i + 1}"))
    gap = one("select round(extract(epoch from next_attempt_at - last_attempt_at) / 60) from refunds where id = %s", (rf,))
    steps.append((estado, int(gap)))
    # simula que pasó el tiempo hasta el próximo intento
    q("update refunds set first_attempt_at = first_attempt_at - (next_attempt_at - last_attempt_at), next_attempt_at = now() where id = %s", (rf,))
ok("D19: 10 min, 30 min, 1 h, 3 h, 6 h, 12 h y después cada 24 h", [g for _, g in steps[:8]] == [10, 30, 60, 180, 360, 720, 1440, 1440])
ok("D19: recién a los ~3 días pasa a fallida (9 intentos)", [s for s, _ in steps] == ["pending"] * 8 + ["failed"])
rv = one("select admin_review()", uid=adm)
rf2 = one("select id from refunds where booking_id = %s", (b2,))
svc_role("select refund_result(%s, false, null, 'collector_without_balance')", (rf2,))
rv = one("select admin_review()", uid=adm)
ok("D19: 'Para revisar' muestra la fallida y la que está reintentando, con el último error",
   any(x["id"] == rf and x["status"] == "failed" for x in rv["refunds"])
   and any(x["id"] == rf2 and x["status"] == "pending" and x["attempts"] == 1 and x["last_error"] == "collector_without_balance" for x in rv["refunds"]))
ok("'Para revisar' muestra los pagos en revisión con su motivo", any(x["mp_payment_id"] == "P-OVER" and x["review_reasons"] == ["amount_over"] for x in rv["payments"]))
ok("solo el admin ve 'Para revisar'", err(q("select admin_review()", uid=owner), "forbidden"))

# ---------- D20: Reintentar y Resuelto a mano ----------
ok("D20: Reintentar vuelve a poner la fallida en la cola", not err(q("select admin_refund_retry(%s)", (rf,), uid=adm))
   and q("select status, attempts from refunds where id = %s", (rf,))[0] == ("pending", 0))
ok("D20: solo el admin reintenta", err(q("select admin_refund_retry(%s)", (rf,), uid=owner), "forbidden"))
ok("D20: Resuelto a mano exige una nota", err(q("select admin_resolve('refund', %s, '  ')", (rf2,), uid=adm), "note_required"))
n_refunds = one("select count(*) from refunds")
ok("D20: Resuelto a mano registra quién y cuándo, y no dispara devoluciones",
   not err(q("select admin_resolve('refund', %s, 'Le devolví por transferencia')", (rf2,), uid=adm))
   and q("select status, resolved_by = %s, resolved_at is not null, resolved_note from refunds where id = %s", (adm, rf2))[0] == ("resolved", True, True, "Le devolví por transferencia")
   and one("select count(*) from refunds") == n_refunds and bk(b2)[1] == 0
   and not any(x[0] == rf2 for x in q("select id from refunds_due(200)", role="service_role")))
ok("D20: un pago en revisión también se resuelve con nota", not err(q("select admin_resolve('payment', (select id from payments where mp_payment_id = 'P-OVER'), 'Diferencia devuelta por MP')", uid=adm))
   and not any(x["mp_payment_id"] == "P-OVER" for x in one("select admin_review()", uid=adm)["payments"]))
ok("D20: el prestador no puede resolver", err(q("select admin_resolve('refund', %s, 'nota larga')", (rf,), uid=owner), "forbidden"))
ok("una devolución hecha descuenta lo pendiente del turno", svc_role("select refund_result(%s, true, 'R-1')", (rf,)) == "done"
   and bk(b1)[1] == 0 and q("select status, mp_refund_id from refunds where id = %s", (rf,))[0] == ("done", "R-1"))

# ---------- e) Turnos viejos (antes del Bloque 1): mp_payment_id sin payment_id ----------
q("alter table bookings disable trigger bookings_activity")
bl = one("""insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, paid_mp, app_fee, mp_payment_id, series_id)
            values (%s, %s, %s, 'Ana Cobros', 'Corte', 'app', 'confirmed', %s, %s, 10000, 5000, 1000, 5000, 1000, 'LEGACY-1', gen_random_uuid()) returning id""",
         (pid, sv, cli, at(9, 9), at(9, 9) + dt.timedelta(minutes=30)))
bl2 = one("""insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, paid_mp, app_fee, series_id)
             values (%s, %s, %s, 'Ana Cobros', 'Corte', 'app', 'confirmed', %s, %s, 10000, 5000, 1000, 5000, 1000, (select series_id from bookings where id = %s)) returning id""",
          (pid, sv, cli, at(16, 9), at(16, 9) + dt.timedelta(minutes=30), bl))
q("alter table bookings enable trigger bookings_activity")
q("select cancel_by_provider(%s)", (bl,), uid=owner)
q("select cancel_by_provider(%s)", (bl2,), uid=owner)
ok("e) turno viejo: la devolución usa su mp_payment_id (no queda 'sin pago ligado')", refunds_of(bl) == [(6000, "provider_cancelled", "pending", False, "LEGACY-1", acc1)])
ok("e) turno viejo de una serie: usa el mp_payment_id del primero de la serie", refunds_of(bl2) == [(6000, "provider_cancelled", "pending", False, "LEGACY-1", acc1)])
ok("e) también con tope: no más de lo cobrado por ese turno", err(q("select refund_request(%s, null, 1, 'provider_cancelled')", (bl,)), "refund_exceeds_booking"))
bn = one("""insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, paid_mp)
            values (%s, %s, 'Ana Cobros', 'Corte', 'app', 'confirmed', %s, %s, 10000, 5000) returning id""", (pid, cli, at(9, 12), at(9, 12) + dt.timedelta(minutes=30)))
q("select cancel_by_provider(%s)", (bn,), uid=owner)
rn = one("select id from refunds where booking_id = %s", (bn,))
ok("turno sin ningún pago ligado: queda fallida para revisar, con el motivo", refunds_of(bn)[0][2] == "failed"
   and any(x["id"] == rn and "No hay un pago" in x["last_error"] for x in one("select admin_review()", uid=adm)["refunds"]))

# ---------- H23: desconectar Mercado Pago ----------
r = book(sv, at(10, 9), cli)[0][0]
h_mp = r["booking_ids"][0]
q("update bookings set mp_preference_id = 'pref-1' where id = %s", (h_mp,))       # el cliente ya está en Mercado Pago
r = book(sv, at(10, 10), cli)[0][0]
h_new = r["booking_ids"][0]                                                       # todavía no fue a Mercado Pago
r = book(sv, at(10, 11), cli2)[0][0]
h_exp = r["booking_ids"][0]
q("update bookings set mp_preference_id = 'pref-2' where id = %s", (h_exp,))
st = one("select mp_disconnect()", uid=owner)
ok("H23: desconectar → no puede cobrar, y le dice cuántos turnos futuros pagados tiene y cuántos están pagando",
   st["can_charge"] is False and st["future_paid"] >= 3 and st["paying_now"] == 2 and st["old_accounts"] == 1)
ok("H23: la cuenta queda solo para devoluciones (con su llave) y mp_connected en false",
   q("select status, access_token is not null from mp_accounts where id = %s", (acc1,))[0] == ("refunds_only", True)
   and one("select mp_connected from provider_private where provider_id = %s", (pid,)) is False)
ok("H23: la reserva que no fue a Mercado Pago se libera en el acto", bk(h_new)[0] == "expired")
ok("H23: la que tiene el cobro creado sigue hasta vencer", bk(h_mp)[0] == "hold" and bk(h_exp)[0] == "hold")
ok("H23: reservas nuevas con seña rechazadas con un error claro", err(book(sv, at(11, 9), cli2), "provider_mp_not_connected"))
ok("H23: la ficha pública dice que no toma turnos online", one("select get_provider(%s)", (pid,), role="anon")["can_charge"] is False)
ok("H23: desconectar dos veces da error claro", err(q("select mp_disconnect()", uid=owner), "mp_not_connected"))
res = pay([h_mp], "P-AFTER", 6000, 1000, pid, acc1)
ok("H23: el hold con cobro creado que se paga después se confirma (con la cuenta que lo cobró)", res["confirmed"] == 1 and bk(h_mp)[0] == "confirmed"
   and one("select mp_account_id from payments where mp_payment_id = 'P-AFTER'") == acc1)
expire(h_exp)
ok("H23: el hold con cobro creado que no se paga vence", bk(h_exp)[0] == "expired")
q("select cancel_by_provider(%s)", (s_ids[2],), uid=owner)
ok("H23: cancelar un turno pagado después de desconectar → devolución con la llave guardada (cuenta vieja)",
   refunds_of(s_ids[2]) == [(6000, "provider_cancelled", "pending", True, "P-SERIE", acc1)])
# reconectar con OTRA cuenta
acc2 = connect(pid, "222")
ok("H23: reconectar con otra cuenta crea otra llave y no pisa la anterior", acc2 != acc1
   and q("select status, access_token from mp_accounts where id = %s", (acc1,))[0] == ("refunds_only", "tok-111")
   and q("select status, access_token from mp_accounts where id = %s", (acc2,))[0] == ("active", "tok-222"))
ok("H23: con la cuenta nueva vuelve a cobrar", one("select my_mp_status()", uid=owner)["can_charge"] is True and one("select my_mp_status()", uid=owner)["account"] == "222")
q("select cancel_by_provider(%s)", (h_mp,), uid=owner)
ok("H23: devolver un pago de la cuenta vieja usa la llave de la cuenta vieja", refunds_of(h_mp)[0][5] == acc1)
r = book(sv, at(11, 9), cli2)[0][0]
pay(r["booking_ids"], "P-NEW", 6000, 1000, pid)
ok("H23: los pagos nuevos quedan con la cuenta nueva", one("select mp_account_id from payments where mp_payment_id = 'P-NEW'") == acc2)
# reconectar con la MISMA cuenta
acc1b = svc_role("select mp_connect(%s, '111', 'tok-111-nuevo', 'ref-111-nuevo', 15552000)", (pid,))
ok("H23: reconectar la misma cuenta actualiza esa llave (no crea otra)", acc1b == acc1
   and q("select status, access_token from mp_accounts where id = %s", (acc1,))[0] == ("active", "tok-111-nuevo")
   and one("select status from mp_accounts where id = %s", (acc2,)) == "refunds_only"
   and one("select count(*) from mp_accounts where provider_id = %s", (pid,)) == 2)
ok("una sola cuenta activa por prestador", one("select count(*) from mp_accounts where provider_id = %s and status = 'active'", (pid,)) == 1)

# ---------- Purga de llaves ----------
ok("purga: la cuenta 222 tiene un turno futuro pagado → no se borra", svc_role("select purge_mp_accounts()") == 0
   and one("select status from mp_accounts where id = %s", (acc2,)) == "refunds_only")
b_new = one("select id from bookings where payment_id = (select id from payments where mp_payment_id = 'P-NEW')")
q("select cancel_by_provider(%s)", (b_new,), uid=owner)
ok("purga: con la devolución pendiente, tampoco", svc_role("select purge_mp_accounts()") == 0)
svc_role("select refund_result(id, true, 'R-NEW') from refunds where booking_id = %s", (b_new,))
ok("purga: con un pago de los últimos 180 días, tampoco (contracargos y reclamos)", svc_role("select purge_mp_accounts()") == 0)
q("update payments set created_at = now() - interval '181 days' where mp_account_id = %s", (acc2,))
ok("purga: sin nada pendiente, se borra la llave y queda la fila", svc_role("select purge_mp_accounts()") == 1
   and q("select status, access_token, refresh_token, mp_user_id from mp_accounts where id = %s", (acc2,))[0] == ("purged", None, None, "222"))
ok("purga: la cuenta activa nunca se borra", one("select status from mp_accounts where id = %s", (acc1,)) == "active")
ok("purga: purge_deleted_secrets (cron viejo) hace lo mismo y no toca provider_secrets",
   svc_role("select purge_deleted_secrets()") == 0 and one("select count(*) from provider_secrets") == 0)

# ---------- Nunca falla ante un pago aprobado ----------
res = pay([], "P-VACIO", 3000, 0, pid, acc1)
ok("pago sin turnos: se registra y se devuelve todo", res["status"] == "processed"
   and q("select amount, reason, status from refunds where payment_id = (select id from payments where mp_payment_id = 'P-VACIO')")[0] == (3000, "unknown_booking", "pending"))
otro = mkuser("otro@cobros.ar", "Otro")
pid_x = one("select register_provider('Otro Prov', 'Calle 2', array['b'], '2284 1', '30111333')", uid=otro)
r = book(sv, at(12, 9), cli)[0][0]
res = pay(r["booking_ids"], "P-OTRO", 6000, 1000, pid_x)
ok("turno de otro prestador: no se toca, el pago queda para revisar y lo cobrado se devuelve", bk(r["booking_ids"][0])[0] == "hold"
   and "other_provider" in one("select review_reasons from payments where mp_payment_id = 'P-OTRO'")
   and q("select amount, reason from refunds where payment_id = (select id from payments where mp_payment_id = 'P-OTRO')")[0] == (6000, "unknown_booking"))

# ---------- Seguridad ----------
ok("nadie de la app lee las llaves", err(q("select access_token from mp_accounts", uid=owner)) and err(q("select * from mp_accounts", role="anon")))
ok("el cliente ve sus pagos y no los ajenos", one("select count(*) from payments where client_id = %s", (cli,), uid=cli) > 0
   and one("select count(*) from payments where client_id = %s", (cli2,), uid=cli) == 0)
ok("el cliente no ve la respuesta de Mercado Pago ni la cuenta", err(q("select mp_responses from payments", uid=cli)) and err(q("select mp_account_id from payments", uid=cli)))
ok("el prestador ve los pagos de su agenda", one("select count(*) from payments", uid=owner) == one("select count(*) from payments where provider_id = %s", (pid,)))
ok("otro prestador solo ve los pagos de su agenda", one("select count(*) from payments", uid=otro) == 1
   and one("select count(*) from payments where provider_id = %s", (pid,), uid=otro) == 0
   and one("select count(*) from refunds", uid=otro) == one("select count(*) from refunds where provider_id = %s", (pid_x,)) == 1)
ok("anon no ve pagos ni devoluciones", err(q("select count(*) from payments", role="anon")) or one("select count(*) from payments", role="anon") == 0)
ok("la app no escribe pagos ni devoluciones", err(q("update payments set amount = 1", uid=adm)) and err(q("update refunds set status = 'done'", uid=adm)))
for fn in ("confirm_payment(array[1]::bigint[], 'x', 1)", "payment_mp_update('x', 'refunded')", "refund_result(1, true)", "refunds_due()",
           "mp_connect(1, '1', 'a', 'b', 1)", "purge_mp_accounts()", "mp_account_error(1, 'x')"):
    ok(f"solo el servidor llama a {fn.split('(')[0]}", err(q(f"select {fn}", uid=owner)) and err(q(f"select {fn}", uid=adm)))
ok("el cliente no puede desconectar a un prestador", err(q("select mp_disconnect()", uid=cli), "not_provider"))
ok("los avisos del prestador son solo suyos", one("select my_provider_notices()", uid=otro) == [] and err(q("select * from provider_notices", role="anon")) is not None)

# ---------- Mudanza de provider_secrets (D21) y migración idempotente ----------
import glob, os
vie = mkuser("viejo@cobros.ar", "Viejo")
pv = one("select register_provider('Prov Viejo', 'Calle 3', array['b'], '2284 2', '30111444')", uid=vie)
q("update providers set status = 'active' where id = %s", (pv,))
q("update provider_private set mp_connected = true, mp_user_id = '999' where provider_id = %s", (pv,))
q("insert into provider_secrets (provider_id, mp_access_token, mp_refresh_token) values (%s, 'tok-viejo', 'ref-viejo')", (pv,))
mig = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "supabase", "migrations", "*_cobros.sql")))[-1]
sql = open(mig, encoding="utf8").read()
for vez in (1, 2):
    with conn.cursor() as c:
        c.execute(sql)
ok("la migración se puede volver a correr sobre una base con datos (2 veces)", True)
ok("la llave vieja se copia a mp_accounts como cuenta activa y 'legacy', una sola vez",
   q("select mp_user_id, status, access_token, legacy from mp_accounts where provider_id = %s", (pv,)) == [("999", "active", "tok-viejo", True)])
ok("provider_secrets queda intacta (se borra en el Bloque 2)", q("select mp_access_token from provider_secrets where provider_id = %s", (pv,)) == [("tok-viejo",)])
ok("los datos de las pruebas siguen igual después de volver a correrla", one("select count(*) from payments") > 10
   and one("select status from mp_accounts where id = %s", (acc1,)) == "active")

print("TODO OK" if not F else f"{F} FALLAS")
sys.exit(1 if F else 0)

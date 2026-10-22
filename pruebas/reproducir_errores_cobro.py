"""Reproduce los errores de cobro H01 y H02 (ver docs/00-estado-y-hallazgos.md).
Correr contra una base LIMPIA con pruebas/supabase_emulation.sql + supabase/TODO_EN_UNO.sql:
    python3 pruebas/reproducir_errores_cobro.py "host=... dbname=BASE_LIMPIA user=postgres"
Hoy (v31) muestra: caso 1 → turno con refund_pending y mp_payment_id vacío; caso 2 → bookings_not_found.
Después del Bloque 1 ambos casos tienen que terminar con el pago registrado y la devolución lista para ejecutarse."""
import sys,json,uuid,datetime as dt,psycopg
c=psycopg.connect(sys.argv[1],autocommit=True)
def q(sql,a=None,uid=None):
    with c.cursor() as cur:
        cur.execute("begin")
        if uid: cur.execute("select set_config('request.jwt.claims',%s,true)",(json.dumps({"sub":str(uid),"role":"authenticated"}),)); cur.execute("set local role authenticated")
        try:
            cur.execute(sql,a); r=cur.fetchall() if cur.description else []; cur.execute("commit"); return r
        except Exception as e: cur.execute("rollback"); return e
def user(e):
    u=uuid.uuid4(); q("insert into auth.users(id,email,raw_user_meta_data) values(%s,%s,'{}')",(u,e)); return u
prov=user("p@t.ar"); a=user("a@t.ar"); b=user("b@t.ar")
pid=q("select register_provider('Prov Test','Calle 1',array['b'],'2284 000111','30111222')",uid=prov)[0][0]
q("update providers set status='active', dni_verified=true where id=%s",(pid,))
q("update provider_settings set online=true, notice_min=0 where provider_id=%s",(pid,))
for d in range(7): q("insert into provider_hours values(%s,%s,1,'09:00','20:00') on conflict do nothing",(pid,d))
sv=q("insert into services(provider_id,category_id,name,duration_min,price) values(%s,'b','Corte',30,10000) returning id",(pid,),uid=prov)[0][0]
tz=dt.timezone(dt.timedelta(hours=-3)); start=dt.datetime.combine(dt.date.today()+dt.timedelta(days=2),dt.time(11,0),tz)
ra=q("select book_slot(%s,%s)",(sv,start),uid=a)[0][0]; ida=ra["booking_ids"][0]; due=ra["amount_due"]
print("A reserva (hold):",ida,"monto",due)
q("update bookings set hold_expires_at=now()-interval '1 minute' where id=%s",(ida,)); q("select expire_holds(null)")
rb=q("select book_slot(%s,%s)",(sv,start),uid=b); print("B toma el mismo horario:", "ok" if not isinstance(rb,Exception) else rb)
r1=q("select confirm_payment(%s,%s,%s)",([ida],"PAY-123",due)); print("webhook 1 (pago de A aprobado tarde):",r1)
print("turno A:",q("select status, refund_pending, mp_payment_id from bookings where id=%s",(ida,)))
r2=q("select confirm_payment(%s,%s,%s)",([ida],"PAY-123",due)); print("webhook reintento:",str(r2).split("\n")[0])
# caso 2: el prestador cancela el hold y despues llega el pago
c2=dt.datetime.combine(dt.date.today()+dt.timedelta(days=3),dt.time(12,0),tz)
rc=q("select book_slot(%s,%s)",(sv,c2),uid=a)[0][0]; idc=rc["booking_ids"][0]
print("prestador cancela el hold:",q("select cancel_by_provider(%s)",(idc,),uid=prov)[0][0])
r3=q("select confirm_payment(%s,%s,%s)",([idc],"PAY-456",rc["amount_due"])); print("webhook del pago de ese hold:",str(r3).split("\n")[0])
print("turno C:",q("select status, refund_pending, paid_mp, mp_payment_id from bookings where id=%s",(idc,)))

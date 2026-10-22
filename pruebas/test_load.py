"""Prueba de carga: 200.000 prestadores, ~1.000.000 de turnos y 60 clientes reservando el mismo horario a la vez."""
import time, json, uuid, sys, threading, datetime as dt
import psycopg
DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=ttload user=postgres"
c = psycopg.connect(DSN, autocommit=True)
def ex(sql, a=None):
    with c.cursor() as cur: cur.execute(sql, a); return cur.fetchall() if cur.description else None
t0 = time.time()
ex("alter table providers disable trigger providers_sync")
ex("""insert into providers (slug,name,address,city_id,status,shuffle_key,hue)
      select 'load-'||g, 'Prestador '||g||' '||(array['Estudio','Salón','Espacio','Studio','Centro'])[1+g%5], 'Calle '||g, 1, 'active', random(), g%360
      from generate_series(1,200000) g""")
ex("alter table providers enable trigger providers_sync")
ex("""insert into provider_categories (provider_id, category_id) select id, (array['b','p','m','l','u','d'])[1+(id%6)] from providers where slug like 'load-%'""")
ex("""insert into provider_categories (provider_id, category_id) select id, (array['b','p','m','l','u','d'])[1+((id+2)%6)] from providers where slug like 'load-%' and id%4=0 on conflict do nothing""")
ex("insert into provider_settings (provider_id, online, notice_min) select id, true, 0 from providers where slug like 'load-%'")
ex("""insert into provider_hours select id, d, 1, '09:00','12:00' from providers, generate_series(1,6) d where slug like 'load-%' and id % 20 = 0""")
ex("""insert into provider_hours select id, d, 2, '15:00','21:00' from providers, generate_series(1,6) d where slug like 'load-%' and id % 20 = 0""")
ex("alter table services disable trigger services_aiud")
ex("""insert into services (provider_id, category_id, name, duration_min, price)
      select pc.provider_id, pc.category_id, 'Servicio '||pc.category_id, 30, 8000 + (pc.provider_id % 20)*1000 from provider_categories pc join providers p on p.id=pc.provider_id where p.slug like 'load-%'""")
ex("alter table services enable trigger services_aiud")
ex("""update providers set search = to_tsvector('simple', name || ' ' || address) where slug like 'load-%'""")
# ~1M turnos: 10.000 prestadores × 100 turnos sin superponerse
ex("""insert into bookings (provider_id, source, status, starts_at, ends_at, price, client_name, service_name)
      select p.id, 'manual', 'done', ts, ts + interval '30 minutes', 10000, 'Cliente', 'Servicio'
      from (select id from providers where slug like 'load-%' and id % 20 = 0) p,
           lateral (select date_trunc('day', now()) - (g/6 || ' days')::interval + ((9 + g%6) || ' hours')::interval as ts from generate_series(1,100) g) x""")
ex("analyze")
print(f"datos cargados en {time.time()-t0:.0f}s:", ex("select (select count(*) from providers), (select count(*) from provider_categories), (select count(*) from bookings)")[0])

def timed(name, sql, a=None, n=5):
    best = 1e9
    for _ in range(n):
        s = time.perf_counter(); r = ex(sql, a); best = min(best, time.perf_counter() - s)
    print(f"{name}: {best*1000:.1f} ms ({len(r) if r else 0} filas)"); return r, best
r, t1 = timed("primera página de Masajes", "select id, sort_key from list_providers('olavarria','m',null,null,null,12)")
last = r[-1]
_, t2 = timed("página 2 (cursor)", "select id from list_providers('olavarria','m',null,%s,%s,12)", (last[1], last[0]))
_, t3 = timed("página 'Todos'", "select id from list_providers('olavarria',null,null,null,null,12)")
_, t4 = timed("búsqueda 'estudio 1999'", "select id from list_providers('olavarria',null,'estudio 1999',null,null,12)")
_, t5 = timed("conteo por rubro", "select * from category_counts('olavarria')")
pid = ex("select id from providers where slug like 'load-%' and id % 20 = 0 limit 1")[0][0]
_, t6 = timed("ocupados de un prestador (60 días)", "select * from provider_busy(%s, current_date - 30, current_date + 30)", (pid,))
_, t7 = timed("ficha completa", "select get_provider(%s)", (pid,))

# 60 clientes intentan el mismo horario al mismo tiempo
users = []
for i in range(60):
    u = uuid.uuid4(); ex("insert into auth.users (id,email) values (%s,%s)", (u, f"load{i}-{u}@t.ar")); users.append(u)
svc = ex("select id from services where provider_id=%s limit 1", (pid,))[0][0]
d = dt.date.today() + dt.timedelta(days=1)
while d.weekday() >= 5: d += dt.timedelta(days=1)
start = dt.datetime.combine(d, dt.time(15, 30), dt.timezone(dt.timedelta(hours=-3)))
results = []
barrier = threading.Barrier(len(users))
def attempt(u):
    with psycopg.connect(DSN, autocommit=True) as cc, cc.cursor() as cur:
        cur.execute("begin"); cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": str(u), "role": "authenticated"}),))
        cur.execute("set local role authenticated"); barrier.wait()
        try: cur.execute("select book_slot(%s, %s)", (svc, start)); cur.execute("commit"); results.append("ok")
        except Exception as e: cur.execute("rollback"); results.append("slot_taken" if "slot_taken" in str(e) else str(e)[:60])
ths = [threading.Thread(target=attempt, args=(u,)) for u in users]
[t.start() for t in ths]; [t.join() for t in ths]
okn = results.count("ok"); taken = results.count("slot_taken")
print(f"60 reservas simultáneas del mismo horario: {okn} ganó, {taken} rechazadas, otras: {[x for x in results if x not in ('ok','slot_taken')][:3]}")
F = 0
for name, cond in [("listado < 50 ms", t1 < .05 and t2 < .05 and t3 < .05), ("búsqueda < 300 ms", t4 < .3), ("ocupados < 20 ms", t6 < .02),
                   ("una sola reserva gana", okn == 1 and taken == 59)]:
    print(("OK   " if cond else "FAIL ") + name); F += 0 if cond else 1
print("TODO OK" if not F else f"{F} FALLAS")

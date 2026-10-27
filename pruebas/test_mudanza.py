"""Mudanza de una base de la versión 31 con llaves de Mercado Pago en provider_secrets (texto plano) hasta la última
migración: después no queda ninguna llave sin cifrar en mp_accounts (Bloque 2a).
Corre contra una base LIMPIA que solo tiene pruebas/supabase_emulation.sql y supabase_emulation_proyecto_viejo.sql (un
proyecto creado antes del 30/05/2026, con los permisos por defecto de entonces): aplica las migraciones una por una, con los
datos viejos cargados después de las de la versión 31 (20261001000001…06)."""
import pathlib, sys
import psycopg
DSN = sys.argv[1] if len(sys.argv) > 1 else "host=/tmp port=54329 dbname=tt_mudanza user=postgres"
conn = psycopg.connect(DSN, autocommit=True)
F = 0
def ok(name, cond):
    global F
    if not cond: F += 1
    print(("OK   " if cond else "FAIL ") + name)
def q(sql, args=None):
    with conn.cursor() as c:
        c.execute(sql, args)
        return c.fetchall() if c.description else []

MIG = sorted((pathlib.Path(__file__).resolve().parent.parent / "supabase/migrations").glob("*.sql"))
v31 = [m for m in MIG if m.name < "20261002"]
resto = [m for m in MIG if m.name >= "20261002"]
for m in v31:
    q(m.read_text())

# versión 31: tres prestadores con llaves en texto plano
city = q("select id from cities where slug = 'olavarria'")[0][0]
def prestador(slug, mp_user, connected):
    pid = q("insert into providers (slug, name, city_id, status) values (%s, %s, %s, 'active') returning id", (slug, slug, city))[0][0]
    q("insert into provider_private (provider_id, mp_user_id, mp_connected) values (%s, %s, %s)", (pid, mp_user, connected))
    q("insert into provider_secrets (provider_id, mp_access_token, mp_refresh_token, mp_expires_at) values (%s, %s, %s, now() + interval '90 days')",
      (pid, f"APP_USR-{slug}", f"TG-{slug}"))
    return pid
con_id = prestador("cobra-con-id", "111", True)      # cobraba y tiene id de Mercado Pago
sin_id = prestador("cobra-sin-id", None, True)       # cobraba, sin id (H26)
desc = prestador("desconectado", "333", False)       # ya no cobraba
# versión 31 (H10): el alta guardaba el DNI en los metadatos de la cuenta hasta el primer ingreso
import json
reg = {"name": "Pendiente", "categories": ["b"], "phone": "2284 0", "dni": "30111999", "instagram": None}
q("insert into auth.users (email, raw_user_meta_data) values ('pendiente@test.ar', %s), ('viejo@test.ar', %s), ('cliente@test.ar', %s)",
  (json.dumps({"full_name": "Pendiente", "provider_reg": reg}), json.dumps({"full_name": "Viejo", "dni": "30111998"}),
   json.dumps({"full_name": "Cliente", "provider_reg": None})))

for m in resto:
    q(m.read_text())

acc = {pid: q("select status, access_token, refresh_token, last_error, disconnected_at is not null from mp_accounts where provider_id = %s", (pid,))
       for pid in (con_id, sin_id, desc)}
ok("las 3 llaves viejas se mudaron a mp_accounts (una cuenta por prestador)", all(len(v) == 1 for v in acc.values()))
ok("después de todas las migraciones no queda ninguna llave sin cifrar",
   q("select count(*) from mp_accounts where (access_token is not null and access_token !~ '^v[0-9]+:') "
     "or (refresh_token is not null and refresh_token !~ '^v[0-9]+:')")[0][0] == 0)
ok("…las llaves viejas quedan en null", all(v[0][1] is None and v[0][2] is None for v in acc.values()))
ok("…con el motivo en last_error", all(v[0][3] == "Llave sin cifrar: hay que reconectar" for v in acc.values()))
ok("las que cobraban pasan a solo devoluciones (con fecha de desconexión)",
   acc[con_id][0][0] == "refunds_only" and acc[sin_id][0][0] == "refunds_only" and acc[con_id][0][4] and acc[sin_id][0][4])
ok("la desconectada sigue como estaba", acc[desc][0][0] == "refunds_only")
ok("ningún prestador queda cobrando", q("select count(*) from mp_accounts where status = 'active'")[0][0] == 0
   and q("select count(*) from provider_private where mp_connected")[0][0] == 0)
avisos = q("select provider_id, count(*) from provider_notices where kind = 'mp_reconnect' group by provider_id order by 1")
ok("los que cobraban reciben un solo aviso para reconectar; el desconectado ninguno", avisos == sorted([(con_id, 1), (sin_id, 1)]))
ok("H10: después de migrar, ningún usuario tiene DNI en los metadatos",
   q("select count(*) from auth.users where raw_user_meta_data::text ~ '3011199[89]' or raw_user_meta_data ? 'dni' "
     "or raw_user_meta_data #> '{provider_reg,dni}' is not null")[0][0] == 0)
ok("…y el resto de los metadatos queda igual (nombre y datos del alta)",
   q("select raw_user_meta_data from auth.users where email = 'pendiente@test.ar'")[0][0]
   == {"full_name": "Pendiente", "provider_reg": {k: v for k, v in reg.items() if k != "dni"}}
   and q("select raw_user_meta_data from auth.users where email = 'viejo@test.ar'")[0][0] == {"full_name": "Viejo"}
   and q("select raw_user_meta_data from auth.users where email = 'cliente@test.ar'")[0][0] == {"full_name": "Cliente", "provider_reg": None})
ok("provider_secrets ya no existe", q("select to_regclass('public.provider_secrets')")[0][0] is None)

# reconectar la misma cuenta: la fila vuelve a cobrar con llaves cifradas
q("set role service_role")
q("select mp_connect(%s, '111', 'v1:aXY=:bnVldmE=', 'v1:aXY=:cmVm', 15552000)", (con_id,))
q("reset role")
ok("al reconectar la misma cuenta vuelve a cobrar, con llaves cifradas y sin el error",
   q("select status, access_token, last_error from mp_accounts where provider_id = %s", (con_id,)) == [("active", "v1:aXY=:bnVldmE=", None)])

# idempotente: todas otra vez, como volver a pegar TODO_EN_UNO.sql
for m in MIG:
    q(m.read_text())
ok("las migraciones se pueden volver a correr: la cuenta reconectada sigue cobrando y no hay avisos nuevos",
   q("select status from mp_accounts where provider_id = %s", (con_id,)) == [("active",)]
   and q("select count(*) from provider_notices where kind = 'mp_reconnect'")[0][0] == 2)

print("TODO OK" if not F else f"{F} FALLAS")
sys.exit(1 if F else 0)

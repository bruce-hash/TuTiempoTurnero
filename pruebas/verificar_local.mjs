// npm run test:verificar: corre pruebas/verificar_prueba.mjs (la verificación del sitio de prueba, docs/10) contra el
// entorno local de las pruebas (base nueva + PostgREST + e2e_server con el build de producción), con SIN_SERVIDOR=1.
// Así, si un cambio de la app rompe el recorrido de la verificación (selectores, ingreso, reserva), se ve en el PR y no
// recién al desplegar. Crea la cuenta de cliente; la del profesional es la de la siembra del e2e (Sofía).
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const c = new pg.Client({ connectionString: process.env.E2E_PG });
await c.connect();
await c.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('verificacion@test.ar', 'cliente12345', now(), '{\"full_name\":\"Verificación\"}')");
await c.end();
// el Mercado Pago falso no aprueba solo: la reserva queda esperando el pago, como en el real sin pagar
await fetch(process.env.E2E_URL + "/__mp?modo=tarde");
try {
  execFileSync("node", ["pruebas/verificar_prueba.mjs"], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, SITIO: process.env.E2E_URL, SIN_SERVIDOR: "1", DB_URL: process.env.E2E_PG, CLIENTE_EMAIL: "verificacion@test.ar", CLIENTE_PASSWORD: "cliente12345", PRO_EMAIL: "sofia@test.ar", PRO_PASSWORD: "prestador123", GITHUB_STEP_SUMMARY: "" },
  });
} catch {
  process.exit(1);
}

// Entorno "en vivo" para las pruebas en navegador: base nueva con la emulación de Supabase, TODO_EN_UNO.sql y
// e2e_seed.sql; PostgREST real y pruebas/e2e_server.js (Auth, Storage y Mercado Pago simulados) sirviendo una carpeta web.
// Uso como comando:  node pruebas/entorno_e2e.mjs <carpeta web> -- <comando…>
//   el comando recibe E2E_URL y E2E_PG en el entorno (y como reemplazo de {url} y {pg} en sus argumentos).
// Variables: PGHOST, PGPORT, PGUSER, PGPASSWORD (conexión de administración), POSTGREST (binario; por defecto "postgrest").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SECRET = "tutiempo-e2e-secreto-de-prueba-0123456789";
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function listo(url, intentos = 100) {
  for (let i = 0; i < intentos; i++) {
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await espera(100);
  }
  throw new Error("No respondió " + url);
}

// Levanta base + PostgREST + e2e_server. Devuelve { url, pg, cerrar() }.
export async function levantar({ web, puerto = 8787, puertoRest = 3011, base = "tt_e2e" } = {}) {
  const env = process.env;
  const admin = { host: env.PGHOST || "localhost", port: +(env.PGPORT || 5432), user: env.PGUSER || "postgres", password: env.PGPASSWORD };
  const c0 = new pg.Client({ ...admin, database: "postgres" });
  await c0.connect();
  await c0.query(`drop database if exists ${base} with (force)`);
  await c0.query(`create database ${base}`);
  await c0.end();
  const c = new pg.Client({ ...admin, database: base });
  await c.connect();
  for (const f of ["pruebas/supabase_emulation.sql", "supabase/TODO_EN_UNO.sql", "pruebas/e2e_seed.sql"]) await c.query(fs.readFileSync(path.join(ROOT, f), "utf8"));
  await c.end();

  const host = admin.host.startsWith("/") ? "localhost" : admin.host;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-e2e-"));
  const conf = path.join(dir, "postgrest.conf");
  fs.writeFileSync(conf, [
    `db-uri = "postgres://authenticator:authpass@${host}:${admin.port}/${base}"`,
    `db-schemas = "public"`, `db-anon-role = "anon"`, `jwt-secret = "${SECRET}"`, `server-port = ${puertoRest}`, `db-pool = 10`,
  ].join("\n") + "\n");
  const procs = [];
  const lanzar = (cmd, args) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    p.on("exit", (code) => { if (code && !p.cerrando) console.error(`${cmd} terminó con ${code}:\n${log.slice(-2000)}`); });
    procs.push(p);
    return p;
  };
  const pgUrl = `postgres://${encodeURIComponent(admin.user)}${admin.password ? ":" + encodeURIComponent(admin.password) : ""}@${host}:${admin.port}/${base}`;
  lanzar(env.POSTGREST || "postgrest", [conf]);
  await listo(`http://localhost:${puertoRest}/`);
  lanzar(process.execPath, ["pruebas/e2e_server.js", web, String(puerto), SECRET, pgUrl, `http://localhost:${puertoRest}`]);
  await listo(`http://localhost:${puerto}/index.html`);
  return {
    url: `http://localhost:${puerto}`,
    pg: pgUrl,
    async cerrar() {
      for (const p of procs) { p.cerrando = true; p.kill(); }
      await espera(200);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Como comando: node pruebas/entorno_e2e.mjs <web> -- <comando…>
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const [web, sep, cmd, ...args] = process.argv.slice(2);
  if (!web || sep !== "--" || !cmd) {
    console.error("Uso: node pruebas/entorno_e2e.mjs <carpeta web> -- <comando…>");
    process.exit(2);
  }
  const e = await levantar({ web });
  const p = spawn(cmd, args.map((a) => a.replace("{url}", e.url).replace("{pg}", e.pg)), {
    cwd: ROOT, stdio: "inherit", env: { ...process.env, E2E_URL: e.url, E2E_PG: e.pg },
  });
  const code = await new Promise((r) => p.on("exit", r));
  await e.cerrar();
  process.exit(code ?? 1);
}

// C02 · El .htaccess real con LiteSpeed (Hostinger usa LiteSpeed, no Apache). Levanta OpenLiteSpeed en un contenedor
// (la versión libre del mismo servidor; la imagen va fija por su digest) sirviendo la carpeta web dos veces:
//   - tal cual: HTTP → HTTPS con la dirección y la query intactas (la regla de forzar HTTPS se lee y se aplica);
//   - con el .htaccess sin esa regla (en Hostinger el pedido ya llega por HTTPS y la regla no actúa): cada dirección de
//     la app (también /panel/…, /mis-turnos, /<slug>, /turno/<id>, con ?mp= o ?token_hash=) responde 200 con
//     index.html y sin redirigir, que es lo que necesita la app para que recargar no lleve al inicio; un archivo con
//     extensión que no existe da 404; los archivos reales salen con su tipo; los ocultos y de respaldo, 403.
// OpenLiteSpeed no aplica los encabezados ni los AddType del .htaccess: la CSP, HSTS, la caché y el tipo del manifest los
// prueba pruebas/htaccess.mjs con Apache. LiteSpeed Enterprise (Hostinger) sí los aplica.
// Uso: node pruebas/litespeed.mjs <carpeta web>   (npm run test:litespeed; necesita docker)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const IMAGE = "litespeedtech/openlitespeed@sha256:276339f2da5ab336fdb6238bf3e3aeb09cb084a1db457192aa8d8f60dc2cdcc4"; // 1.9.4
const WEB = process.argv[2];
if (!WEB) {
  console.error("Uso: node pruebas/litespeed.mjs <carpeta web>");
  process.exit(2);
}
const INDEX = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const asset = fs.readdirSync(path.join(WEB, "assets")).find((f) => f.endsWith(".js"));
let fails = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fails++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};
const get = (url) =>
  new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// la copia sin la regla de HTTPS (solo esas dos líneas: el resto del .htaccess es el real)
const plain = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ols-"));
fs.cpSync(WEB, plain, { recursive: true });
const ht = fs.readFileSync(path.join(WEB, ".htaccess"), "utf8");
const noHttps = ht.replace(/^\s*RewriteCond %\{HTTPS\} off\s*\n\s*RewriteRule \^ https:\/\/[^\n]*\n/m, "");
ok("(la copia de prueba solo saca la regla de forzar HTTPS)", noHttps !== ht && !/HTTPS\} off/.test(noHttps) && noHttps.includes("RewriteRule ^ /index.html [L]"));
fs.writeFileSync(path.join(plain, ".htaccess"), noHttps);
fs.chmodSync(plain, 0o755);

const start = (name, dir, port) => {
  try {
    docker("rm", "-f", name);
  } catch {}
  docker("run", "-d", "--name", name, "-p", `${port}:8088`, "-v", `${path.resolve(dir)}:/usr/local/lsws/Example/html:ro`, IMAGE);
};
async function waitUp(base) {
  for (let i = 0; i < 150; i++) {
    try {
      await get(base + "/robots.txt");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("OpenLiteSpeed no responde en " + base);
}

const REAL = "http://localhost:8091";
const APP = "http://localhost:8092";
try {
  start("tt-ols-real", WEB, 8091);
  start("tt-ols-app", plain, 8092);
  await waitUp(REAL);
  await waitUp(APP);
  console.log("OpenLiteSpeed " + docker("exec", "tt-ols-app", "/usr/local/lsws/bin/lshttpd", "-v").split("\n")[0]);

  // ---------- 1. El .htaccess tal cual: forzar HTTPS ----------
  for (const route of ["/", "/panel/agenda", "/mis-turnos?x=1"]) {
    const r = await get(REAL + route);
    ok(`HTTP ${route} → 301 a HTTPS con la misma dirección`, r.status === 301 && r.headers.location === `https://localhost:8091${route}`, `${r.status} ${r.headers.location}`);
  }

  // ---------- 2. Las direcciones de la app: index.html, sin redirigir ----------
  for (const route of [
    "/",
    "/ingresar",
    "/ingresar?volver=/panel/perfil",
    "/mis-turnos",
    "/cuenta",
    "/panel/agenda",
    "/panel/finanzas?fp=mes",
    "/panel/agenda?dia=2026-11-03",
    "/admin/prestadores",
    "/registrar-negocio/2",
    "/sofia-benitez-studio",
    "/sofia-benitez-studio/trabajos",
    "/rubro/unas",
    "/turno/12?pago=abc",
    "/?b=12&mp=success",
    "/?token_hash=abcdefghij&type=signup",
    "/?mp_connected=0&mp_error=cancelado",
    "/una/ruta/que/no/existe",
  ]) {
    const r = await get(APP + route);
    ok(`${route} → 200 con la app (index.html), sin redirigir`, r.status === 200 && !r.headers.location && r.body === INDEX && /text\/html/.test(r.headers["content-type"] || ""),
      `${r.status} ${r.headers.location || ""} ${r.headers["content-type"]}`);
  }

  // ---------- 3. Archivos ----------
  for (const [route, type] of [
    ["/assets/" + asset, /javascript/],
    ["/sw.js", /javascript/],
    ["/config.js", /javascript/],
    // OpenLiteSpeed tampoco aplica el AddType del .htaccess: el tipo del manifest lo prueba htaccess.mjs con Apache
    ["/manifest.webmanifest", /./],
    ["/robots.txt", /text\/plain/],
  ]) {
    const r = await get(APP + route);
    ok(`${route} → 200 con su tipo (no HTML)`, r.status === 200 && type.test(r.headers["content-type"] || "") && r.body !== INDEX, `${r.status} ${r.headers["content-type"]}`);
  }
  for (const route of ["/assets/no-existe-12345678.js", "/nada.css", "/fonts/nada.woff2", "/panel/x.js"]) {
    const r = await get(APP + route);
    ok(`${route} (no existe) → 404, nunca la app`, r.status === 404 && r.body !== INDEX, String(r.status));
  }
  for (const route of ["/.htaccess", "/.env", "/backup.sql", "/notas.md"]) {
    const r = await get(APP + route);
    ok(`${route} → 403 (oculto o de respaldo)`, r.status === 403, String(r.status));
  }
} finally {
  for (const name of ["tt-ols-real", "tt-ols-app"]) {
    try {
      docker("rm", "-f", name);
    } catch {}
  }
  fs.rmSync(plain, { recursive: true, force: true });
}
console.log(fails ? `${fails} FALLAS` : "TODO OK");
process.exit(fails ? 1 : 0);

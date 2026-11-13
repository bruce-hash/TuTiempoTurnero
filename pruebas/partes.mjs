// 11/11 · División del código (src/partes.js): el build de producción baja al arrancar solo lo de todos (inicio, perfil,
// reservar, Mis turnos) y el panel del profesional, el de TuTiempo y «Registrá tu negocio» van aparte, y la app instalada
// los tiene igual sin conexión.
//  1. dist/: el archivo de arranque y lo que precarga no traen ninguna parte; cada parte existe; nada pasa de 500 kB.
//  2. dist/sw.js guarda todos los JS del build (también las partes).
//  3. En un navegador: con el service worker instalado se corta el servidor y las partes salen igual (de la caché).
//  4. Con la base local (entorno_e2e, el build de producción de verdad): el inicio no baja ninguna parte, y el panel del
//     profesional, el de TuTiempo y «Registrá tu negocio» bajan solo la suya al abrirlos y se dibujan sin errores.
// Uso: npm run test:partes   (compila dist/, levanta base + PostgREST + servidor y corre esta prueba)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { resolver } = require("./fallback.cjs");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// ---------- 1. Qué baja al arrancar ----------
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const assets = fs.readdirSync(path.join(DIST, "assets")).filter((f) => f.endsWith(".js"));
const kb = (f) => Math.round(fs.statSync(path.join(DIST, "assets", f)).size / 102.4) / 10;
const entry = (html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/) || [])[1];
const preload = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]);
const PARTS = ["panel", "admin", "negocio"];
const partFile = (name) => assets.find((f) => f.startsWith(name + "-"));
console.log("tamaños: " + assets.map((f) => `${f} ${kb(f)} kB`).join(" · "));
ok("el arranque es un archivo de la app", !!entry && assets.includes(entry), entry);
for (const name of PARTS) ok(`la parte «${name}» va en su propio archivo`, !!partFile(name), assets.join(", "));
const startup = [entry, ...preload];
ok("al arrancar no se baja ninguna parte (ni se precarga)", !startup.some((f) => PARTS.some((name) => f.startsWith(name + "-"))), startup.join(", "));
const startCode = startup.map((f) => fs.readFileSync(path.join(DIST, "assets", f), "utf8")).join("\n");
ok("…y el arranque no importa ninguna parte de forma estática (solo con import())",
  !PARTS.some((name) => new RegExp(`(from|import)\\s*"\\./${name}-[\\w-]+\\.js"`).test(startCode)));
ok("el código del panel y del admin no está en el arranque", !/Antes de cerrar|Cargar compra|Armar happy hour|Para revisar/.test(startCode));
ok("ningún JS pasa de 500 kB", assets.every((f) => kb(f) <= 500), assets.filter((f) => kb(f) > 500).join(", "));

// ---------- 2. El service worker guarda todos los JS ----------
const sw = fs.readFileSync(path.join(DIST, "sw.js"), "utf8");
const missing = assets.filter((f) => !sw.includes(`"/assets/${f}"`));
ok("sw.js guarda todos los JS del build, también las partes", missing.length === 0, missing.join(", "));

// ---------- 3. Sin conexión, en un navegador ----------
let online = true;
const server = http.createServer((req, res) => {
  if (!online) {
    req.socket.destroy();
    return;
  }
  const { status, file } = resolver(DIST, new URL(req.url, "http://x").pathname);
  if (status !== 200) {
    res.writeHead(status);
    res.end();
    return;
  }
  const type = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" }[path.extname(file)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  // la pantalla «Sin conexión» es estática: alcanza para instalar el service worker del build sin arrancar la app
  await page.goto(BASE + "/offline.html");
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready));
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const key of keys) for (const req of await (await caches.open(key)).keys()) urls.push(new URL(req.url).pathname);
    return urls;
  });
  ok("el service worker quedó instalado y controla la página", await page.evaluate(() => !!navigator.serviceWorker.controller));
  for (const name of PARTS) ok(`la parte «${name}» está en la caché`, cached.includes("/assets/" + partFile(name)), cached.filter((u) => u.startsWith("/assets/")).join(", "));
  online = false;
  const offline = await page.evaluate(async (files) => {
    const out = {};
    for (const f of files) out[f] = await fetch("/assets/" + f).then((r) => (r.ok ? "ok" : "http " + r.status), (e) => "falla: " + e.message);
    out.__red = await fetch("/no-existe-" + Date.now() + ".js").then(() => "respondió", () => "sin red");
    return out;
  }, PARTS.map(partFile));
  ok("sin conexión, el servidor de verdad no responde", offline.__red === "sin red", offline.__red);
  for (const name of PARTS) ok(`sin conexión, la parte «${name}» sale de la caché`, offline[partFile(name)] === "ok", offline[partFile(name)]);
} finally {
  server.close();
}

// ---------- 4. Cada pantalla baja lo suyo (build de producción, base local) ----------
if (process.env.E2E_URL) {
  const SITE = process.env.E2E_URL;
  const pg = (await import("pg")).default;
  const db = new pg.Client({ connectionString: process.env.E2E_PG });
  await db.connect();
  await db.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('partes-admin@test.ar', 'admin12345', now(), '{\"full_name\":\"Admin\"}') on conflict do nothing");
  await db.query("insert into app_admins (user_id) select id from auth.users where email = 'partes-admin@test.ar' on conflict do nothing");
  // 13/11: un cliente para la escritura de la parte de todos (seguir a un profesional)
  await db.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('partes-cli@test.ar', 'cliente12345', now(), '{\"full_name\":\"Cli Partes\"}') on conflict do nothing");
  const sofi = (await db.query("select p.id, p.slug, p.status from providers p join auth.users u on u.id = p.owner_id where u.email = 'sofia@test.ar'")).rows[0];
  const q1 = async (sql, args) => (await db.query(sql, args)).rows[0];
  const visit = async (label, email, password, url, selector, act) => {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    const errors = [];
    const got = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
    page.on("request", (r) => {
      const m = new URL(r.url()).pathname.match(/^\/assets\/([^/]+\.js)$/);
      if (m) got.push(m[1]);
    });
    try {
      if (email) {
        await page.goto(SITE + "/ingresar");
        await page.waitForSelector("#ai_e", { timeout: 20000 });
        await page.fill("#ai_e", email);
        await page.fill("#ai_p", password);
        await page.click("#fLogin button[type=submit]");
        await page.waitForSelector("nav .acct-btn", { timeout: 30000 });
        if (url) await page.goto(SITE + url);
      } else {
        await page.goto(SITE + url);
      }
      await page.waitForSelector(selector, { timeout: 20000 });
      await page.waitForTimeout(500);
      if (act) await act(page);
    } catch (e) {
      errors.push(e.message.split("\n")[0]);
    }
    const parts = PARTS.filter((name) => got.includes(partFile(name)));
    await ctx.close();
    return { errors, parts };
  };
  const home = await visit("inicio", null, null, "/", "#app .rubros, #app [data-go], #app h1");
  ok("inicio: no baja ninguna parte", home.parts.length === 0, home.parts.join(", "));
  ok("inicio: sin errores", !home.errors.length, home.errors.join(" | "));
  const panel = await visit("panel", "sofia@test.ar", "prestador123", null, "[data-btab=agenda]");
  ok("panel del profesional: baja solo su parte y se dibuja (Agenda)", panel.parts.join() === "panel", panel.parts.join(", "));
  ok("panel del profesional: sin errores", !panel.errors.length, panel.errors.join(" | "));
  const admin = await visit("admin", "partes-admin@test.ar", "admin12345", "/admin", ".kpis.adm");
  ok("panel de TuTiempo: baja solo su parte y se dibuja (tablero)", admin.parts.join() === "admin", admin.parts.join(", "));
  ok("panel de TuTiempo: sin errores", !admin.errors.length, admin.errors.join(" | "));
  // 13/11: escrituras de verdad con el build de producción. Hasta hoy dist/ no traía src/api/live/m-*.js (api.m.* sin
  // definir: suspender, eliminar, seguir, guardar el perfil…) y las pruebas no lo veían porque usan el build de prueba.
  const susp = await visit("admin-suspender", "partes-admin@test.ar", "admin12345", "/admin/prestadores", `[data-act=admOpen][data-id="${sofi.id}"]`, async (page) => {
    await page.click(`[data-act=admOpen][data-id="${sofi.id}"]`);
    await page.click(`[data-act=admSusp][data-id="${sofi.id}"]`);
    await page.waitForSelector("#admSuspWhy", { timeout: 10000 });
    await page.click(".admsusp [data-act=admSet][data-s=suspended]");
    for (let i = 0; i < 40 && (await q1("select status from providers where id = $1", [sofi.id])).status !== "suspended"; i++) await page.waitForTimeout(250);
  });
  const suspended = (await q1("select status from providers where id = $1", [sofi.id])).status;
  ok("producción: el admin suspende a un profesional (api.m.adminSetProvider)", suspended === "suspended", suspended);
  ok("producción: suspender, sin errores", !susp.errors.length, susp.errors.join(" | "));
  await db.query("update providers set status = $2 where id = $1", [sofi.id, sofi.status]);
  const fol = await visit("seguir", "partes-cli@test.ar", "cliente12345", "/" + sofi.slug, "[data-act=seguir]", async (page) => {
    await page.click("[data-act=seguir]");
    for (let i = 0; i < 40 && !(await q1("select count(*)::int n from follows f join auth.users u on u.id = f.user_id where u.email = 'partes-cli@test.ar' and f.provider_id = $1", [sofi.id])).n; i++) await page.waitForTimeout(250);
  });
  const nFol = (await q1("select count(*)::int n from follows f join auth.users u on u.id = f.user_id where u.email = 'partes-cli@test.ar' and f.provider_id = $1", [sofi.id])).n;
  ok("producción: un cliente sigue a un profesional (api.m.follow)", nFol === 1, String(nFol));
  ok("producción: seguir, sin errores", !fol.errors.length, fol.errors.join(" | "));
  await db.end();
  const biz = await visit("negocio", null, null, "/registrar-negocio", "#app [data-act=authKind], #app form, #app h1");
  ok("«Registrá tu negocio»: baja su parte", biz.parts.includes("negocio") && !biz.parts.includes("admin"), biz.parts.join(", "));
  ok("«Registrá tu negocio»: sin errores", !biz.errors.length, biz.errors.join(" | "));
} else {
  console.log("—    4. sin E2E_URL: se saltea la prueba con la base (npm run test:partes la levanta)");
}
await browser.close();
console.log(F ? `${F} FALLAS` : "TODO OK");
process.exit(F ? 1 : 0);

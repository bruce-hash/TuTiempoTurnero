// "Verificar prueba" (docs/10): revisa el sitio de prueba de verdad, contra Hostinger y el Supabase de prueba.
//  1. Hostinger sirve el build del commit esperado (version.json), las direcciones de la app devuelven index.html (200,
//     text/html, sin redirecciones), los encabezados de seguridad, robots.txt y un 404 para un .js que no existe.
//  2. Con las dos cuentas fijas (cliente y profesional): ingresar, recorrer sus pantallas sin errores en la consola, y el
//     cliente reserva hasta Mercado Pago SIN pagar: se comparan en la base la seña y las comisiones con lo que tienen que
//     dar (y, con el token del vendedor de prueba, con la preferencia que creó Mercado Pago) y se libera el horario.
//  3. La base: la última migración aplicada, las tareas programadas y lo que respondieron las Edge Functions; y cada
//     Edge Function desplegada responde (sin hacer nada: preflight, o rechazo de un pedido sin clave).
// Variables: SITIO (por defecto https://prueba.tutiempo.com.ar), ESPERADO_SHA, DB_URL (usuario tt_verificador),
//   CLIENTE_EMAIL, CLIENTE_PASSWORD, PRO_EMAIL, PRO_PASSWORD, MP_VENDEDOR_TOKEN (opcional),
//   SIN_SERVIDOR=1 (npm run test:verificar: el mismo recorrido contra el entorno local de las pruebas; saltea lo que es
//   solo del servidor real: Hostinger, tareas programadas, migraciones y Edge Functions desplegadas).
// Escribe el resumen en GITHUB_STEP_SUMMARY si existe. Sale con 1 si algo falló.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const SITIO = (env.SITIO || "https://prueba.tutiempo.com.ar").replace(/\/+$/, "");
const SIN_SERVIDOR = env.SIN_SERVIDOR === "1";
const filas = [];
let fallas = 0;
const ok = (seccion, nombre, cond, detalle = "") => {
  if (!cond) fallas++;
  filas.push([seccion, cond ? "OK" : "FALLA", nombre, cond ? "" : String(detalle).slice(0, 300)]);
  console.log((cond ? "OK   " : "FAIL ") + `[${seccion}] ${nombre}` + (cond || !detalle ? "" : "  → " + String(detalle).slice(0, 300)));
};
const salteado = (seccion, nombre, motivo) => {
  filas.push([seccion, "SALTEADO", nombre, motivo]);
  console.log(`--   [${seccion}] ${nombre}: ${motivo}`);
};
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-AR");
const CAPTCHA_PRUEBA = "XXXX.DUMMY.TOKEN.XXXX"; // el token de prueba de Cloudflare (lo acepta la clave secreta de prueba)

// ---------- 1 · Hostinger ----------
const traer = (ruta, opts = {}) => fetch(SITIO + ruta, { redirect: "manual", headers: { "cache-control": "no-cache" }, ...opts });
const cfgTxt = await (await traer("/config.js?t=" + Date.now())).text();
const sandbox = { window: {} };
try {
  vm.runInNewContext(cfgTxt, sandbox, { timeout: 1000 });
} catch {}
const CFG = sandbox.window.TT_CONFIG || {};
const SUPA = (CFG.supabaseUrl || "").replace(/\/+$/, "");
const ANON = CFG.supabaseAnonKey || "";
ok("sitio", "config.js de prueba con la URL y la clave pública de Supabase", /^https?:\/\//.test(SUPA) && ANON.length > 10, cfgTxt.slice(0, 120));

if (!SIN_SERVIDOR) {
  const ver = await traer("/version.json?t=" + Date.now()).then((r) => r.json()).catch(() => null);
  if (env.ESPERADO_SHA) {
    ok("sitio", `Hostinger sirve el build del commit ${env.ESPERADO_SHA.slice(0, 7)}`, ver && ver.commit === env.ESPERADO_SHA, JSON.stringify(ver));
  } else {
    ok("sitio", "Hostinger sirve un build con version.json", ver && /^[0-9a-f]{40}$/.test(ver.commit || ""), JSON.stringify(ver));
  }
  const raiz = await traer("/");
  const h = (n) => raiz.headers.get(n) || "";
  ok("sitio", "la portada responde 200 con text/html", raiz.status === 200 && h("content-type").includes("text/html"), raiz.status + " " + h("content-type"));
  ok("sitio", "CSP: solo scripts propios y de Turnstile, conexiones a Supabase, sin marcos ajenos",
     /default-src 'self'/.test(h("content-security-policy")) && /connect-src[^;]*supabase\.co/.test(h("content-security-policy")) && /frame-ancestors 'none'/.test(h("content-security-policy")),
     h("content-security-policy"));
  ok("sitio", "encabezados: HSTS, nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy",
     /max-age=\d+/.test(h("strict-transport-security")) && h("x-content-type-options") === "nosniff" && !!h("referrer-policy") && h("x-frame-options") === "DENY" && !!h("permissions-policy"),
     JSON.stringify(Object.fromEntries(["strict-transport-security", "x-content-type-options", "referrer-policy", "x-frame-options", "permissions-policy"].map((n) => [n, h(n)]))));
  const robots = await traer("/robots.txt");
  ok("sitio", "robots.txt no deja indexar (Disallow: /)", robots.status === 200 && /Disallow:\s*\/\s*$/m.test(await robots.text()));
  const js404 = await traer(`/assets/no-existe-${Date.now()}.js`);
  ok("sitio", "un .js que no existe da 404 (no la app)", js404.status === 404, js404.status);
  const http = await fetch(SITIO.replace(/^https:/, "http:") + "/", { redirect: "manual" }).catch(() => null);
  ok("sitio", "http:// redirige a https://", http && [301, 302, 307, 308].includes(http.status) && /^https:/.test(http.headers.get("location") || ""), http && http.status);
} else {
  salteado("sitio", "Hostinger (versión, encabezados, robots, 404)", "SIN_SERVIDOR=1");
}

// ---------- sesiones por la API (para saber el perfil del profesional y para liberar el horario) ----------
async function sesion(email, password) {
  const body = { email, password };
  if (CFG.turnstileSiteKey) body.gotrue_meta_security = { captcha_token: env.CAPTCHA_TOKEN || CAPTCHA_PRUEBA };
  const r = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? j : { error: j.error_code || j.msg || r.status };
}
const rest = (ruta, token, opts = {}) =>
  fetch(`${SUPA}/rest/v1/${ruta}`, { ...opts, headers: { apikey: ANON, authorization: `Bearer ${token || ANON}`, "content-type": "application/json", ...(opts.headers || {}) } });

const faltan = ["CLIENTE_EMAIL", "CLIENTE_PASSWORD", "PRO_EMAIL", "PRO_PASSWORD"].filter((n) => !env[n]);
let cli = null, pro = null, perfil = null;
if (faltan.length) {
  salteado("cuentas", "cuentas de prueba", "faltan " + faltan.join(", "));
} else {
  cli = await sesion(env.CLIENTE_EMAIL, env.CLIENTE_PASSWORD);
  pro = await sesion(env.PRO_EMAIL, env.PRO_PASSWORD);
  ok("cuentas", "la cuenta de cliente ingresa", !!cli.access_token, cli.error);
  ok("cuentas", "la cuenta del profesional ingresa", !!pro.access_token, pro.error);
  if (pro.access_token) {
    // su negocio (my_provider) y la dirección de su perfil; solo los negocios aprobados se ven en público (anon)
    const pid = await rest("rpc/my_provider", pro.access_token, { method: "POST", body: "{}" }).then((r) => r.json()).catch(() => null);
    const rows = pid ? await rest(`providers?select=id,slug,name&id=eq.${pid}`).then((r) => r.json()).catch(() => []) : [];
    perfil = Array.isArray(rows) && rows[0] && rows[0].slug ? rows[0] : null;
    ok("cuentas", "el profesional tiene su negocio aprobado y visible", !!perfil, `my_provider=${pid} ${JSON.stringify(rows).slice(0, 200)}`);
  }
}

// ---------- direcciones de la app (recarga directa: 200, text/html, sin redirecciones) ----------
if (!SIN_SERVIDOR) {
  for (const ruta of ["/panel/agenda", "/mis-turnos", "/turno/1", ...(perfil ? ["/" + perfil.slug] : [])]) {
    const r = await traer(ruta);
    ok("sitio", `recargar ${ruta} devuelve la app`, r.status === 200 && (r.headers.get("content-type") || "").includes("text/html") && !r.headers.get("location"),
       `${r.status} ${r.headers.get("content-type")} ${r.headers.get("location") || ""}`);
  }
}

// ---------- base: el informe de verificacion_prueba ----------
let db = null;
if (env.DB_URL) {
  db = new pg.Client({ connectionString: env.DB_URL, ssl: /localhost|127\.0\.0\.1/.test(env.DB_URL) ? false : { rejectUnauthorized: false } });
  await db.connect().catch((e) => {
    ok("base", "conexión con el usuario de verificación", false, e.message);
    db = null;
  });
} else {
  salteado("base", "informe de la base", "falta DB_URL (PRUEBA_DB_URL_LECTURA)");
}
const informe = async (booking = null) => (db ? (await db.query("select public.verificacion_prueba($1) r", [booking])).rows[0].r : null);

// ---------- 2 · navegador ----------
const browser = await chromium.launch();
const ruido = (msg) => /challenges\.cloudflare\.com|turnstile|private access token|Failed to load resource.*(favicon|\/cdn-cgi\/)/i.test(msg);
async function pagina() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
  const page = await ctx.newPage();
  page.errores = [];
  page.on("pageerror", (e) => page.errores.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !ruido(m.text() + " " + (m.location().url || ""))) page.errores.push(m.text());
  });
  // nunca se sale a Mercado Pago (no se paga nada)
  await page.route(/mercadopago\.com|mercadolibre\.com|mercadopago\.com\.ar/, (route) => route.abort());
  return page;
}
// 8/11 (punto 11): el turno se elige con margen, el primer horario del próximo día abierto (no el «Primer turno», que puede
// ser dentro de minutos y quedar en el pasado mientras corre la verificación)
async function turnoConMargen(p) {
  await p.waitForSelector(".wd[data-day]", { timeout: 20000 });
  await p.locator(".wd[data-day]:not(.today):not([disabled]):not(.full)").first().click();
  await p.waitForTimeout(300);
  await p.locator(".slots [data-slot]").first().click();
  await p.waitForTimeout(200);
}
async function ingresar(page, email, password) {
  await page.goto(SITIO + "/ingresar");
  await page.waitForSelector("#ai_e", { timeout: 20000 });
  await page.fill("#ai_e", email);
  await page.fill("#ai_p", password);
  await page.click("#fLogin button[type=submit]");
  await page.waitForSelector("nav .acct-btn", { timeout: 30000 });
}

if (cli && cli.access_token && perfil) {
  const p = await pagina();
  let booking = null;
  try {
    await ingresar(p, env.CLIENTE_EMAIL, env.CLIENTE_PASSWORD);
    ok("cliente", "ingresa desde /ingresar (con el CAPTCHA de prueba)", true);
    await p.goto(SITIO + "/mis-turnos");
    await p.waitForSelector("#app h1, #app .h1", { timeout: 15000 });
    ok("cliente", "Mis turnos abre", /Mis turnos/.test(await p.locator("#app").innerText()));
    await p.goto(`${SITIO}/${perfil.slug}`);
    await p.waitForSelector("[data-quick]", { timeout: 20000 });
    ok("cliente", `el perfil de ${perfil.name} ofrece un horario libre`, true);
    await turnoConMargen(p);
    await p.click("[data-act=reservarT]");
    await p.waitForSelector("#fTurno", { timeout: 15000 });
    const totalUi = await p.locator("#fTurno .tot").innerText();
    // la respuesta de mp-create-preference se lee al pasar (la app enseguida sale al init_point, que se corta)
    let res = null, j = {};
    await p.route(/\/functions\/v1\/mp-create-preference/, async (route) => {
      res = await route.fetch();
      j = await res.json().catch(() => ({}));
      await route.fulfill({ response: res, json: j });
    });
    // creada la preferencia, la página no sale a ningún lado (ni a Mercado Pago ni a la vuelta): no se paga
    await p.route("**/*", (route) => (res && route.request().isNavigationRequest() ? route.abort() : route.fallback()));
    await p.click("#fTurno button[type=submit]");
    for (let i = 0; i < 60 && !res; i++) await p.waitForTimeout(500);
    booking = j.booking || null;
    ok("cliente", "reservar crea el cobro en Mercado Pago (sin pagar)", res && res.status() === 200 && !!j.init_point && !!booking, `${res && res.status()} ${JSON.stringify(j).slice(0, 200)}`);
    if (db && booking) {
      const r = (await informe(booking)).reserva;
      ok("cobro", "el turno queda en espera de pago, con el cobro abierto", r && r.estado === "hold" && r.cobro_abierto, JSON.stringify(r));
      if (r) {
        const e = r.esperado;
        ok("cobro", `seña del ${r.sena_pct}% de ${pesos(r.precio)} = ${pesos(e.sena)}`, r.sena_pct === 30 && r.sena === e.sena, JSON.stringify(r));
        ok("cobro", `comisión de TuTiempo (${r.comision_pct}% del servicio) = ${pesos(e.comision)}`, r.comision === e.comision, JSON.stringify(r));
        ok("cobro", `costo de Mercado Pago (${r.mp_pct}%, plazo ${r.plazo}) = ${pesos(e.costo_mp)}`, r.costo_mp === e.costo_mp, JSON.stringify(r));
        ok("cobro", `la app mostró el mismo total (${pesos(e.total)})`, totalUi.replace(/\D/g, "") === String(e.total), totalUi);
        const prefId = (String(j.init_point).match(/pref_id=([^&]+)/) || [])[1];
        if (env.MP_VENDEDOR_TOKEN && prefId) {
          const mp = await fetch(`https://api.mercadopago.com/checkout/preferences/${prefId}`, { headers: { authorization: `Bearer ${env.MP_VENDEDOR_TOKEN}` } }).then((x) => x.json()).catch((x) => ({ error: x.message }));
          const item = (mp.items || [])[0] || {};
          ok("cobro", "Mercado Pago: la preferencia cobra el total y la comisión de TuTiempo va aparte",
             Math.round(item.unit_price) === e.total && Math.round(mp.marketplace_fee) === e.comision, JSON.stringify({ unit_price: item.unit_price, marketplace_fee: mp.marketplace_fee, error: mp.error || mp.message }));
        } else {
          salteado("cobro", "la preferencia en Mercado Pago", env.MP_VENDEDOR_TOKEN ? "no vino el pref_id" : "sin PRUEBA_MP_VENDEDOR_TOKEN");
        }
      }
    }
  } catch (e) {
    ok("cliente", "recorrido del cliente", false, e.message.split("\n")[0]);
  } finally {
    // el horario se libera siempre (aunque algo haya fallado)
    if (booking) {
      const r = await rest("rpc/cancel_by_client", cli.access_token, { method: "POST", body: JSON.stringify({ p_booking: booking }) });
      const j = await r.json().catch(() => ({}));
      ok("cobro", "el horario se libera (la reserva sin pagar se cancela)", r.ok && j.status === "released", JSON.stringify(j));
      if (db) ok("cobro", "…y en la base queda vencida", (await informe(booking)).reserva?.estado === "expired");
    }
    ok("cliente", "sin errores en la consola", !p.errores.length, p.errores.join(" | "));
    await p.context().close();
  }
}
if (pro && pro.access_token) {
  const p = await pagina();
  try {
    await ingresar(p, env.PRO_EMAIL, env.PRO_PASSWORD);
    await p.waitForSelector("[data-btab=agenda]", { timeout: 20000 });
    ok("profesional", "ingresa y llega a su Agenda", /\/panel\/agenda/.test(p.url()), p.url());
    for (const tab of ["finanzas", "clientes", "productos", "horarios", "perfil"]) {
      await p.click(`[data-btab=${tab}]`);
      await p.waitForTimeout(800);
    }
    ok("profesional", "recorre Finanzas, Clientes, Productos, Horarios y Perfil", true);
  } catch (e) {
    ok("profesional", "recorrido del profesional", false, e.message.split("\n")[0]);
  } finally {
    ok("profesional", "sin errores en la consola", !p.errores.length, p.errores.join(" | "));
    await p.context().close();
  }
}
await browser.close();

// ---------- 3 · base y Edge Functions ----------
if (SIN_SERVIDOR) {
  salteado("base", "migraciones, tareas programadas y Edge Functions", "SIN_SERVIDOR=1");
}
if (db && !SIN_SERVIDOR) {
  const inf = await informe(null);
  const mig = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().pop().slice(0, 14);
  ok("base", `la última migración aplicada es la del repo (${mig})`, inf.migracion === mig, inf.migracion);
  const esperadas = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "supabase/migrations"))) {
    for (const m of fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8").matchAll(/cron\.schedule\('([a-z0-9-]+)'/g)) esperadas.add(m[1]);
  }
  const tareas = inf.tareas || [];
  for (const t of [...esperadas].sort()) {
    const x = tareas.find((y) => y.tarea === t);
    if (x && x.activa && !x.estado) salteado("tareas", t, "todavía no corrió");
    else ok("tareas", `${t} (${x ? x.cron : "?"}): la última corrida salió bien`, x && x.activa && x.estado === "succeeded", x ? `${x.estado}: ${x.mensaje || ""}` : "no existe");
  }
  const resp = inf.funciones || {};
  const malas = Object.entries(resp).filter(([k]) => k !== "200" && k !== "201" && k !== "204");
  ok("funciones", `las Edge Functions que llama el cron respondieron bien en las últimas 2 horas (${JSON.stringify(resp)})`, malas.length === 0, JSON.stringify(malas));
  await db.end();
}
if (db && SIN_SERVIDOR) await db.end();
if (SUPA && !SIN_SERVIDOR) {
  const fns = fs.readdirSync(path.join(ROOT, "supabase/functions")).filter((f) => !f.startsWith("_") && fs.statSync(path.join(ROOT, "supabase/functions", f)).isDirectory());
  const delNavegador = ["mp-create-preference", "mp-oauth", "mp-reconcile"];
  for (const f of fns) {
    const url = `${SUPA}/functions/v1/${f}`;
    let r;
    if (delNavegador.includes(f)) r = await fetch(url, { method: "OPTIONS", headers: { origin: SITIO, "access-control-request-method": "POST" } }).catch((e) => ({ status: e.message }));
    else if (f === "mp-webhook") r = await fetch(url).catch((e) => ({ status: e.message }));
    else r = await fetch(url, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }).catch((e) => ({ status: e.message }));
    const s = r.status;
    const bien = delNavegador.includes(f) || f === "mp-webhook" ? s === 200 : s === 401 || s === 403;
    ok("funciones", `${f} está desplegada y responde (${delNavegador.includes(f) ? "preflight 200" : f === "mp-webhook" ? "200" : "rechaza sin la clave del cron"})`, bien, s);
  }
}

// ---------- resumen ----------
const md = [`## Verificar prueba · ${SITIO}`, "", fallas ? `**${fallas} falla(s)**` : "**Todo bien**", "", "| | Qué | Detalle |", "| --- | --- | --- |",
  ...filas.map(([s, e, n, d]) => `| ${e === "OK" ? "✅" : e === "FALLA" ? "❌" : "➖"} | ${s} · ${n.replace(/\|/g, "/")} | ${String(d).replace(/\|/g, "/").replace(/\n/g, " ")} |`)].join("\n");
if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(fallas ? `${fallas} FALLAS` : "TODO OK");
process.exit(fallas ? 1 : 0);

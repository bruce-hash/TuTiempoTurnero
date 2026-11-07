// Auditoría de seguridad (docs/05-auditoria-seguridad.md) · XSS en navegador real, en vivo (base + PostgREST).
// Carga textos con HTML en todo lo que escribe un usuario (nombre, bio, dirección, Instagram, servicios, adicionales,
// indicaciones, reseñas y respuestas, publicaciones, mensajes, plantillas, clientes, productos, turnos, perfil) y recorre
// las pantallas del cliente, del prestador y del admin: ningún texto puede convertirse en un elemento.
// Uso: vite build --mode test && node pruebas/entorno_e2e.mjs dist-test -- node pruebas/auditoria_xss.js {url} {pg}
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
let F = 0;
const ok = (n, c, extra = "") => { if (!c) F++; console.log((c ? "OK   " : "FAIL ") + n + (c || !extra ? "" : "  → " + extra)); };
// cierra comillas dobles, simples y el texto: si alguno se interpreta, aparece un elemento con la clase ttxss
// (cortos: entran en los límites de largo de la base; XS para los campos de hasta 40 letras)
const X = (tag) => `${tag}"><b class=ttxss>1</b>'><i class=ttxss>2</i>`;
const XS = `"><b class=ttxss>1</b>'`;

(async () => {
  const db = new Client({ connectionString: PG }); await db.connect();
  const q = async (s, a) => (await db.query(s, a)).rows;
  const ANA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await q("insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ($1, 'ana@test.ar', 'cliente12345', now(), $2)",
    [ANA, JSON.stringify({ full_name: X("Ana") })]);
  await q("insert into app_admins (user_id) values ($1)", [ANA]);
  await q("update profiles set full_name = $2, phone = $3 where id = $1", [ANA, X("Ana"), XS]);
  const sofi = (await q("select id, slug from providers where name like 'Sofía%'"))[0];
  await q("update providers set name = $2, bio = $3, address = $4 where id = $1", [sofi.id, X("Sofía"), X("bio"), X("Belgrano")]);
  await q("update providers set instagram = $2 where id = $1", [sofi.id, X("ig")]);
  await q("update services set name = $2, prep_note = $3 where provider_id = $1", [sofi.id, X("Servicio"), X("nota")]);
  await q("update service_addons set name = $2 where provider_id = $1", [sofi.id, X("Adicional")]);
  const svc = (await q("select id from services where provider_id = $1 order by id limit 1", [sofi.id]))[0].id;
  const past = "now() - interval '3 days'";
  const bk = (await q(`insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price)
     values ($1, $2, $3, $4, $5, 'app', 'done', ${past}, ${past} + interval '1 hour', 12000) returning id`, [sofi.id, svc, ANA, X("Ana"), X("Servicio")]))[0].id;
  await q(`insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price)
     values ($1, $2, $3, $4, $5, 'app', 'confirmed', date_trunc('day', now()) + interval '1 day 13 hours', date_trunc('day', now()) + interval '1 day 14 hours', 12000)`,
    [sofi.id, svc, ANA, X("Ana"), X("Servicio")]);
  await q(`insert into bookings (provider_id, service_id, client_name, service_name, source, status, starts_at, ends_at, price)
     values ($1, $2, $3, $4, 'manual', 'confirmed', date_trunc('day', now()) + interval '15 hours', date_trunc('day', now()) + interval '16 hours', 12000)`,
    [sofi.id, svc, X("Manual"), X("Servicio")]);
  await q("insert into reviews (provider_id, booking_id, client_id, author, stars, body, reply) values ($1, $2, $3, $4, 5, $5, $6)",
    [sofi.id, bk, ANA, XS, X("reseña"), X("respuesta")]);
  await q("insert into posts (provider_id, body) values ($1, $2)", [sofi.id, X("post")]);
  await q("insert into client_messages (provider_id, user_id, body) values ($1, $2, $3)", [sofi.id, ANA, X("mensaje")]);
  await q("update message_templates set body = $2 where provider_id = $1", [sofi.id, X("plantilla")]);
  await q("insert into provider_clients (provider_id, user_id, name, notes, birthday) values ($1, $2, $3, $4, '01-01')", [sofi.id, ANA, X("Ana"), X("notas")]);
  await q("update provider_clients set phone = $2 where provider_id = $1", [sofi.id, XS]);
  await q("insert into products (provider_id, name, price, stock) values ($1, $2, 1000, 3)", [sofi.id, X("Producto")]);
  await q("insert into admin_notes (provider_id, body) values ($1, $2)", [sofi.id, X("nota admin")]).catch(() => {});

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  const wait = (ms = 600) => page.waitForTimeout(ms);
  const ready = () => page.waitForFunction(() => typeof S !== "undefined" && document.querySelector("#app").children.length, null, { timeout: 10000 });
  // revisa la pantalla: ni elementos inyectados ni atributos on* que vengan de los textos
  const check = async (name, mustShow = true) => {
    const r = await page.evaluate(() => ({
      tags: document.querySelectorAll(".ttxss").length,
      shown: document.body.innerText.includes("<b class=ttxss>"),
    }));
    ok(`${name}: ${mustShow ? "el texto se muestra como texto, " : ""}sin elementos inyectados`, r.tags === 0 && (r.shown || !mustShow), JSON.stringify(r));
  };
  const visit = async (route, name, mustShow) => { await page.goto(BASE + route); await ready(); await wait(900); await check(name || route, mustShow); };
  const login = async (email, pass, form) => {
    if (form === "panel") { await page.fill("#be", email); await page.fill("#bp", pass); await page.click("#fBarb button[type=submit]"); }
    else { await page.fill("#ai_e", email); await page.fill("#ai_p", pass); await page.click("#fLogin button[type=submit]"); }
    await wait(1500);
  };

  // ---------- Visitante ----------
  await visit("/", "inicio");
  await visit("/" + sofi.slug, "perfil público");
  await page.click(".sgroup .svci").catch(() => {}); await wait(300); await check("perfil público con el servicio abierto");
  await visit("/" + sofi.slug + "/resenas", "reseñas");
  await visit("/" + sofi.slug + "/trabajos", "trabajos");
  await visit("/buscar?q=" + encodeURIComponent('"><b class=ttxss>') , "búsqueda con HTML en la dirección");
  ok("el título de la página no toma HTML", !(await page.evaluate(() => document.head.querySelector(".ttxss"))));

  // ---------- Clienta (también admin) ----------
  await page.goto(BASE + "/ingresar"); await ready(); await login("ana@test.ar", "cliente12345");
  await visit("/mis-turnos", "mis turnos y mensajes");
  await visit("/cuenta", "mi perfil");
  await visit("/" + sofi.slug + "/reservar", "reservar");
  for (const t of ["resumen", "prestadores"]) await visit("/admin/" + t, "admin · " + t);
  for (const t of ["balance", "comision"]) await visit("/admin/" + t, "admin · " + t, false);   // sin textos de usuarios
  await visit("/admin/prestadores", "admin · prestadores");
  await page.evaluate((id) => { S.admOpen = id; render(); }, sofi.id); await wait(400); await check("admin · ficha del prestador");
  await page.goto(BASE + "/"); await ready(); await page.evaluate(() => go("cuenta")); await wait(400);
  await page.click("[data-act=logout]").catch(() => {}); await wait(800);

  // ---------- Prestadora ----------
  await page.goto(BASE + "/prestadores/ingresar"); await ready(); await login("sofia@test.ar", "prestador123", "panel");
  for (const t of ["agenda", "caja", "finanzas", "clientes", "productos", "horarios", "estadisticas", "trabajos", "perfil"]) await visit("/panel/" + t, "panel · " + t);
  await page.goto(BASE + "/panel/clientes"); await ready(); await wait(700);
  const cli = await page.evaluate(() => Object.keys(CLIENTS)[0]);
  if (cli) { await page.evaluate((c) => { S.cli = c; render(); }, cli); await wait(400); await check("panel · ficha del cliente"); }
  else ok("panel · hay clientes para abrir la ficha", false);
  await page.evaluate(() => { S.btab = "perfil"; S.msgOpen = true; render(); }); await wait(300); await check("panel · mensajes y plantillas");

  ok("ningún diálogo (alert) se abrió", dialogs.length === 0, dialogs.join(" | "));
  await browser.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK");
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

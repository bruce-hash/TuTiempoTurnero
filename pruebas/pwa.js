// Bloque C · app instalable y notificaciones push, en navegador real (Chromium) contra la base, PostgREST y e2e_server.js.
// Ahí Supabase está en el MISMO origen que el sitio (e2e_server lo imita en /rest/v1, /auth/v1, /functions/v1 y
// /storage/v1): así se prueba que el service worker no guarda ninguna de esas llamadas aunque podría. Comprueba:
//  - el manifest y sus íconos; el service worker se instala y controla la página;
//  - después de usar la app, en la caché no hay nada de Supabase (ni /rest, /auth, /functions, /storage) ni config.js, y
//    ninguna de esas respuestas salió del service worker;
//  - sin conexión: la pantalla "Sin conexión", y una llamada a Supabase falla (no sale de la caché);
//  - una versión nueva reemplaza a la vieja (borra su caché) y la app muestra "Hay una versión nueva";
//  - el permiso NO se pide al abrir la app; "Activar avisos" lo pide y guarda la suscripción; Mi perfil y el panel
//    muestran el estado y las opciones; al cerrar sesión se borra la suscripción de este dispositivo;
//  - un push entregado al service worker muestra la notificación con su título y texto;
//  - iPhone sin la app agregada a inicio: la guía en vez del permiso; "Instalar la app" en el menú y la tarjeta de una vez;
//  - el freno de emergencia (serviceWorker: false) desinstala el service worker y borra su caché.
// Uso: node pruebas/entorno_e2e.mjs dist-test -- node pruebas/pwa.js {url} {pg}   (npm run test:pwa)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
const WEB = path.join(__dirname, "..", "dist-test");
let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};
// clave pública VAPID de prueba (65 octetos, formato de npm run vapid): el navegador no la usa (la suscripción es simulada)
const VAPID = Buffer.concat([Buffer.from([4]), require("crypto").randomBytes(64)]).toString("base64url");
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

// el navegador de la prueba no tiene servicio de push real: Notification.requestPermission y PushManager simulados
// (cuentan las llamadas); el resto (service worker, caché, notificaciones del service worker) es el de Chromium
const PUSH_STUB = `(() => {
  // el estado (permiso y suscripción) sobrevive a las recargas, como en un navegador de verdad
  const load = () => { try { return JSON.parse(localStorage.getItem("__pushstub") || "{}"); } catch (e) { return {}; } };
  const save = (st) => { try { localStorage.setItem("__pushstub", JSON.stringify(st)); } catch (e) {} };
  const st = load();
  window.__perm = 0;
  Object.defineProperty(Notification, "permission", { get: () => load().permission || "default", configurable: true });
  Notification.requestPermission = async () => { window.__perm++; const s = load(); s.permission = window.__answer || "granted"; save(s); return s.permission; };
  const wrap = (endpoint) => ({
    endpoint,
    options: { applicationServerKey: null },
    toJSON() { return { endpoint, keys: { p256dh: "B" + "A".repeat(86), auth: "A".repeat(22) } }; },
    async unsubscribe() { const s = load(); delete s.endpoint; save(s); window.__unsub = (window.__unsub || 0) + 1; return true; },
  });
  PushManager.prototype.getSubscription = async function () { const s = load(); return s.endpoint ? wrap(s.endpoint) : null; };
  PushManager.prototype.subscribe = async function () {
    window.__subscribed = (window.__subscribed || 0) + 1;
    const s = load();
    s.endpoint = s.endpoint || "https://fcm.googleapis.com/fcm/send/pwa-" + Math.random().toString(36).slice(2);
    save(s);
    return wrap(s.endpoint);
  };
})();`;

(async () => {
  const db = new Client({ connectionString: PG });
  await db.connect();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const uid = (await q("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('pwa@test.ar', 'Pwa2026xxx', now(), '{\"full_name\":\"Pía Wanda Abril\"}') returning id::text"))[0].id;
  const sofia = (await q("select p.id, p.owner_id from providers p where p.slug = 'sofia-benitez-studio'"))[0];
  const booking = (await q("insert into bookings (provider_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price) values ($1, $2, 'Pía Wanda Abril', 'Esmaltado semipermanente', 'app', 'confirmed', now() + interval '3 days', now() + interval '3 days 1 hour', 12000) returning id", [sofia.id, uid]))[0].id;
  const setPwa = (sw, vapid = "") => fetch(`${BASE}/__pwa?sw=${sw ? 1 : 0}&vapid=${vapid}`);

  // el Chromium completo en modo headless nuevo: el "headless shell" de Playwright no tiene notificaciones
  const browser = await chromium.launch({ channel: "chromium" });
  const errors = [], csp = [];
  async function nueva(opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, ...opts });
    await ctx.addInitScript(PUSH_STUB);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
    return page;
  }
  const open = async (page, route) => { await page.goto(BASE + route); await page.waitForFunction(() => document.querySelector("#app").children.length); await page.waitForTimeout(500); };
  const login = async (page, email, pass) => {
    await open(page, "/ingresar");
    await page.fill("#ai_e", email); await page.fill("#ai_p", pass); await page.click("#fLogin button[type=submit]");
    await page.waitForFunction(() => window.S && S.user, null, { timeout: 8000 });
    await page.waitForTimeout(500);
  };
  const cached = (page) => page.evaluate(async () => {
    const out = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) out.push(key + " " + req.url);
    return out;
  });
  const swReady = (page) => page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).then(() => true).catch(() => false);

  // ---------- manifest e íconos ----------
  const mres = await fetch(BASE + "/manifest.webmanifest");
  const man = await mres.json();
  ok("manifest: nombre, nombre corto, inicio, standalone, colores y es-AR", man.name === "TuTiempo · Turnos en Olavarría" && man.short_name === "TuTiempo" && man.start_url === "/"
     && man.scope === "/" && man.display === "standalone" && man.theme_color === "#121212" && man.background_color === "#fafaf9" && man.lang === "es-AR");
  const sizes = {};
  for (const icon of man.icons) {
    const r = await fetch(BASE + icon.src);
    const buf = Buffer.from(await r.arrayBuffer());
    sizes[icon.src] = r.status === 200 && buf.slice(1, 4).toString() === "PNG" ? `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` : "falta";
  }
  ok("manifest: íconos 192, 512 y maskable 512 que existen y miden eso", man.icons.every((i) => sizes[i.src] === i.sizes) && man.icons.some((i) => i.purpose === "maskable"), JSON.stringify(sizes));
  ok("manifest: atajos a Mis turnos y Mi agenda", man.shortcuts.map((s) => s.url).join(",") === "/mis-turnos,/panel/agenda");
  const apple = await fetch(BASE + "/icons/apple-touch-icon.png");
  ok("ícono de iPhone (apple-touch-icon de 180)", apple.status === 200 && Buffer.from(await apple.arrayBuffer()).readUInt32BE(16) === 180);

  // ---------- sin el service worker prendido (como corren las demás pruebas) ----------
  let page = await nueva();
  await open(page, "/");
  ok("con serviceWorker: false en config.js, la app no registra el service worker", (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0);
  await page.context().close();

  // ---------- service worker ----------
  await setPwa(true, VAPID);
  page = await nueva();
  const fromSW = [];
  page.on("response", (r) => { if (r.fromServiceWorker()) fromSW.push(new URL(r.url()).pathname); });
  await open(page, "/");
  ok("el service worker se instala y controla la página", await swReady(page));
  await page.reload(); await page.waitForTimeout(600);
  await page.click(".grid .card [data-go=perfil]").catch(() => {}); await page.waitForTimeout(600);
  await login(page, "pwa@test.ar", "Pwa2026xxx");
  for (const route of ["/mis-turnos", "/cuenta", `/turno/${booking}`, "/"]) await open(page, route);
  const entries = await cached(page);
  const bad = entries.filter((e) => /\/(rest|auth|functions|storage)\/v1|config\.js|supabase|mercadopago|cloudflare/i.test(e) || !e.includes(BASE));
  ok("la caché tiene archivos de la app (JS y CSS con hash, sin conexión, íconos)", entries.some((e) => /\/assets\/index-[\w-]{8}\.js$/.test(e)) && entries.some((e) => e.endsWith("/offline.html")) && entries.some((e) => e.endsWith("/icons/icon-192.png")));
  ok("la caché NO tiene nada de Supabase (/rest, /auth, /functions, /storage) ni config.js", bad.length === 0, bad.slice(0, 3).join(" | "));
  ok("ninguna respuesta de Supabase ni config.js salió del service worker", !fromSW.some((p) => /^\/(rest|auth|functions|storage)\/v1|^\/config\.js/.test(p)), fromSW.filter((p) => /v1|config/.test(p)).slice(0, 3).join(" | "));
  ok("las pantallas no salen de la caché (siempre de la red)", !entries.some((e) => /\/(index\.html)?$/.test(new URL(e.split(" ")[1]).pathname) && !e.endsWith("/offline.html")));

  // ---------- sin conexión ----------
  // sin conexión: el servidor corta toda conexión (setOffline de Playwright no frena las del service worker)
  await fetch(BASE + "/__down?on=1");
  await page.goto(BASE + "/mis-turnos").catch(() => {});
  await page.waitForTimeout(500);
  const offlineText = await page.locator("body").innerText().catch((e) => "error: " + e.message);
  ok("sin conexión: la pantalla «Sin conexión»", /Sin conexión/.test(offlineText), offlineText.slice(0, 160));
  const offlineFetch = await page.evaluate(() => fetch("/rest/v1/providers?select=id").then((r) => "respondió " + r.status).catch(() => "falla"));
  ok("sin conexión: una llamada a Supabase falla (no sale de la caché)", offlineFetch === "falla", offlineFetch);
  await fetch(BASE + "/__down?on=0");
  await open(page, "/");

  // ---------- el permiso: nunca al abrir ----------
  ok("el permiso de notificaciones no se pide al abrir la app (ni al navegar)", (await page.evaluate(() => window.__perm)) === 0);
  await open(page, `/turno/${booking}`);
  await page.evaluate(() => { S.justBooked = true; render(); }); await page.waitForTimeout(300);
  ok("después de reservar: «¿Te avisamos antes del turno?»", await page.isVisible(".pwa-card [data-act=pushOn]") && (await page.evaluate(() => window.__perm)) === 0);
  await page.click(".pwa-card [data-act=pushOn]"); await page.waitForTimeout(1200);
  const subs = await q("select endpoint, label from push_subscriptions where user_id = $1", [uid]);
  ok("«Activar avisos» pide el permiso (una vez) y guarda la suscripción del dispositivo", (await page.evaluate(() => window.__perm)) === 1 && subs.length === 1
     && /^https:\/\/fcm\.googleapis\.com\/fcm\/send\/pwa-/.test(subs[0].endpoint) && subs[0].label === "Chrome en Linux", JSON.stringify(subs));
  ok("…y la tarjeta ya no aparece", (await page.locator(".pwa-card [data-act=pushOn]").count()) === 0);
  await open(page, "/cuenta");
  ok("Mi perfil: «Activadas» en este dispositivo, con Desactivar y la opción de recordatorios", /Activadas/.test(await page.locator(".push-panel").innerText()) && await page.isVisible("[data-act=pushOff]") && await page.isChecked("#uPush"));
  await page.uncheck("#uPush"); await page.waitForTimeout(800);
  ok("Mi perfil: «Recordatorios y novedades por notificación» se guarda en la base", (await q("select push_notices from profiles where id = $1", [uid]))[0].push_notices === false);
  await page.check("#uPush"); await page.waitForTimeout(600);
  await page.click("[data-act=pushOff]"); await page.waitForTimeout(1000);
  ok("«Desactivar en este celular» borra la suscripción", (await q("select count(*)::int c from push_subscriptions where user_id = $1", [uid]))[0].c === 0 && /Activar avisos/.test(await page.locator(".push-panel").innerText()));
  await page.click(".push-panel [data-act=pushOn]"); await page.waitForTimeout(1000);
  ok("…y se puede volver a activar desde Mi perfil", (await q("select count(*)::int c from push_subscriptions where user_id = $1", [uid]))[0].c === 1);

  // ---------- un push llega al service worker y se muestra ----------
  await page.context().grantPermissions(["notifications"], { origin: BASE });
  const cdp = await page.context().newCDPSession(page);
  let regId = null;
  cdp.on("ServiceWorker.workerRegistrationUpdated", (ev) => { for (const r of ev.registrations) if (r.scopeURL.startsWith(BASE)) regId = r.registrationId; });
  await cdp.send("ServiceWorker.enable");
  for (let i = 0; i < 20 && !regId; i++) await page.waitForTimeout(100);
  const message = { title: "Turno confirmado", body: "Sofía Benítez Studio · jue 22/10, 17:30", url: `/turno/${booking}`, tag: `turno-${booking}` };
  if (regId) await cdp.send("ServiceWorker.deliverPushMessage", { origin: BASE, registrationId: regId, data: JSON.stringify(message) });
  await page.waitForTimeout(800);
  const shown = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url, icon: n.icon }))));
  ok("un push entregado al service worker muestra la notificación (título, texto, etiqueta, adónde lleva)", shown.some((n) => n.title === message.title && n.body === message.body && n.tag === message.tag && n.url === message.url && /icon-192/.test(n.icon)), JSON.stringify(shown));
  if (regId) await cdp.send("ServiceWorker.deliverPushMessage", { origin: BASE, registrationId: regId, data: JSON.stringify({ title: "x", body: "y", url: "https://evil.test/robo" }) });
  await page.waitForTimeout(600);
  const shown2 = await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((list) => list.map((n) => n.data && n.data.url)));
  ok("una dirección de otro sitio en el push no se usa (lleva al inicio)", shown2.includes("/") && !shown2.some((u) => /evil/.test(u || "")), JSON.stringify(shown2));
  await cdp.send("ServiceWorker.disable").catch(() => {});
  await cdp.detach().catch(() => {});

  // ---------- cerrar sesión borra la suscripción ----------
  await open(page, "/cuenta");
  await page.click("#app [data-act=logout]"); await page.waitForTimeout(1500);
  ok("al cerrar sesión se borra la suscripción de este dispositivo", (await q("select count(*)::int c from push_subscriptions where user_id = $1", [uid]))[0].c === 0);

  // ---------- versión nueva ----------
  const swFile = path.join(WEB, "sw.js");
  const original = fs.readFileSync(swFile, "utf8");
  const oldVersion = original.match(/const VERSION = "([^"]+)"/)[1];
  try {
    fs.writeFileSync(swFile, original.replace(`const VERSION = "${oldVersion}"`, `const VERSION = "${oldVersion}-nueva"`));
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
    await page.waitForFunction(() => window.S && S.updateReady, null, { timeout: 10000 }).catch(() => {});
    ok("una versión nueva toma el control y la app muestra «Hay una versión nueva»", await page.evaluate(() => S.updateReady) && await page.isVisible(".pwa-update"));
    // controllerchange llega apenas empieza la activación; el borrado de la caché vieja termina un momento después
    for (let i = 0; i < 50 && (await page.evaluate(() => caches.keys())).length !== 1; i++) await page.waitForTimeout(200);
    const keys = await page.evaluate(() => caches.keys());
    const detail = keys.length === 1 ? "" : JSON.stringify(await cached(page));
    ok("…y borra la caché de la versión vieja", keys.length === 1 && keys[0] === `tt-${oldVersion}-nueva`, JSON.stringify(keys) + " " + detail.slice(0, 900));
    await Promise.all([page.waitForNavigation(), page.click("[data-act=pwaReload]")]);
    ok("«Actualizar» recarga la app con la versión nueva", !(await page.evaluate(() => S.updateReady)));
  } finally {
    fs.writeFileSync(swFile, original);
  }
  await page.context().close();

  // ---------- prestador: la tarjeta en la Agenda y la opción de reservas ----------
  page = await nueva();
  await open(page, "/prestadores/ingresar");
  await page.fill("#be", "sofia@test.ar"); await page.fill("#bp", "prestador123"); await page.click("#fBarb button[type=submit]");
  await page.waitForSelector(".bhead", { timeout: 8000 }); await page.waitForTimeout(600);
  ok("panel: «Enterate al toque de cada reserva» arriba de la Agenda, sin pedir permiso todavía", await page.isVisible(".pwa-card [data-act=pushOn]") && (await page.evaluate(() => window.__perm)) === 0);
  await page.click(".pwa-card [data-act=pushLater]"); await page.waitForTimeout(300);
  ok("«Ahora no» la esconde", (await page.locator(".pwa-card").count()) === 0);
  await page.click("[data-btab=perfil]"); await page.waitForTimeout(500);
  ok("Perfil del panel: notificaciones con «Nuevas reservas y cancelaciones de clientes»", await page.isVisible(".push-panel") && await page.isChecked("#bPushBk"));
  await page.uncheck("#bPushBk"); await page.waitForTimeout(800);
  ok("…que se guarda en la base", (await q("select push_bookings from profiles where id = $1", [sofia.owner_id]))[0].push_bookings === false);
  await open(page, "/panel/agenda?dia=" + new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
  ok("/panel/agenda?dia= (desde la notificación de una reserva) abre la Agenda en ese día", await page.evaluate(() => S.aday) === new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
  // instalar: el aviso del navegador (simulado: Chromium headless no lo dispara)
  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt");
    ev.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(ev);
  });
  await page.waitForTimeout(300);
  await page.click("[data-act=acctMenu]");
  ok("con el aviso del navegador, «Instalar la app» en el menú de cuenta", await page.isVisible("#acctMenu [data-act=pwaInstall]"));
  await page.click("#acctMenu [data-act=pwaInstall]"); await page.waitForTimeout(300);
  ok("…y lo abre", (await page.evaluate(() => window.__prompted)) === 1);
  await page.context().close();

  // ---------- la tarjeta de instalar después de reservar: una sola vez ----------
  page = await nueva();
  await login(page, "pwa@test.ar", "Pwa2026xxx");
  await open(page, `/turno/${booking}`);
  await page.evaluate(() => { const ev = new Event("beforeinstallprompt"); ev.prompt = () => {}; ev.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(ev); S.justBooked = true; render(); });
  await page.waitForTimeout(300);
  ok("después de reservar: «Instalá TuTiempo para tener tus turnos a mano»", await page.isVisible("[data-act=installLater]"));
  await page.click("[data-act=installLater]"); await page.waitForTimeout(300);
  await page.evaluate(() => { S.canInstall = true; S.justBooked = true; render(); }); await page.waitForTimeout(300);
  ok("cerrada, no vuelve (queda en el menú)", (await page.locator("[data-act=installLater]").count()) === 0);
  await page.click("[data-act=acctMenu]");
  ok("…y en el menú sigue «Instalar la app»", await page.isVisible("#acctMenu [data-act=pwaInstall]"));
  await page.context().close();

  // ---------- iPhone sin la app agregada a inicio ----------
  page = await nueva({ userAgent: IPHONE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await login(page, "pwa@test.ar", "Pwa2026xxx");
  await open(page, `/turno/${booking}`);
  await page.evaluate(() => { S.justBooked = true; render(); }); await page.waitForTimeout(300);
  ok("iPhone: después de reservar, la guía «agregá TuTiempo a tu pantalla de inicio» en vez del permiso", /agregá TuTiempo a tu pantalla de inicio/.test(await page.locator(".pwa-card").innerText().catch(() => ""))
     && (await page.locator(".pwa-card [data-act=pushOn]").count()) === 0 && (await page.evaluate(() => window.__perm)) === 0);
  await open(page, "/cuenta");
  ok("iPhone: Mi perfil explica que funciona con la app agregada a inicio", /pantalla de inicio/.test(await page.locator(".push-panel").innerText()) && (await page.locator(".push-panel [data-act=pushOn]").count()) === 0);
  await page.click("[data-act=acctMenu]");
  await page.click("#acctMenu [data-act=pwaInstall]"); await page.waitForTimeout(300);
  ok("iPhone: «Agregar a inicio» en el menú abre la guía (Compartir → Agregar a inicio)", await page.isVisible(".pwa-guide") && /Agregar a inicio/.test(await page.locator(".pwa-guide").innerText()));
  await page.click("[data-act=pwaGuideClose]"); await page.waitForTimeout(200);
  ok("…que se cierra con «Entendido»", (await page.locator(".pwa-guide").count()) === 0);
  await page.context().close();

  // ---------- freno de emergencia ----------
  page = await nueva();
  await open(page, "/");
  await swReady(page);
  ok("(antes) el service worker está y tiene su caché", (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 1 && (await page.evaluate(() => caches.keys())).length === 1);
  await setPwa(false);
  await page.reload(); await page.waitForTimeout(500);
  const killState = () => page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length, keys: await caches.keys() }));
  let kill = await killState();
  for (let i = 0; i < 25 && (kill.regs || kill.keys.length); i++) { await page.waitForTimeout(200); kill = await killState(); }
  ok("con serviceWorker: false en config.js, la app desinstala el service worker y borra su caché", kill.regs === 0 && kill.keys.length === 0, JSON.stringify(kill));
  await page.context().close();

  ok("sin errores de JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("sin bloqueos de la CSP", csp.length === 0, csp.slice(0, 2).join(" | "));
  await browser.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK");
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

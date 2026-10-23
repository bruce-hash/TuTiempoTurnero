// Prueba de direcciones (Bloque B) en navegador real contra la base, PostgREST y e2e_server.js (que imita el fallback
// del .htaccess): cada ruta abierta directo (como una recarga), rutas reservadas, rutas con sesión, atrás/adelante,
// historias y ficha de cliente, QR decodificado, link copiado, reserva con recarga y vuelta de Mercado Pago, y el link
// de recuperación de contraseña.
// Uso: node pruebas/entorno_e2e.mjs dist-test -- node pruebas/rutas.js {url} {pg}   (npm run test:rutas)
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { Client } = require("pg");
const jsQR = require("jsqr");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};
const RESERVED = [...fs.readFileSync(path.join(__dirname, "..", "src", "lib", "rutas.js"), "utf8").matchAll(/^\s+"([a-z0-9-]+)",$/gm)].map((m) => m[1]);
const SOFIA = "sofia-benitez-studio";

(async () => {
  const db = new Client({ connectionString: PG });
  await db.connect();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  await q("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('ruta@test.ar', 'cliente12345', '{\"full_name\":\"Rita Ruta\"}'), ('admin@test.ar', 'admin12345', '{\"full_name\":\"Admin\"}')");
  await q("insert into public.app_admins (user_id) select id from auth.users where email = 'admin@test.ar'");
  const sofiaId = +(await q("select id from providers where slug = $1", [SOFIA]))[0].id;
  const maxId = +(await q("select id from providers where slug = 'barberia-max'"))[0].id;
  await q("insert into media (provider_id, storage_path, kind, label) values ($1, 'x/trabajo.jpg', 'image', 'Trabajo de prueba')", [sofiaId]);

  const browser = await chromium.launch();
  const errors = [];
  const csp = [];
  async function nueva() {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) csp.push(m.text());
    });
    return page;
  }
  const wait = (page, ms = 500) => page.waitForTimeout(ms);
  const here = (page) => { const u = new URL(page.url()); return u.pathname + u.search; };
  const st = (page) => page.evaluate(() => ({ view: S.view, role: S.role, pid: S.pid, ptab: S.ptab, cat: S.cat, q: S.q, btab: S.btab, admT: S.admT, cli: S.cli, story: !!S.story, user: !!S.user }));
  // abre la dirección y espera a que la app haya arrancado (el enrutador pone el título al primer dibujo)
  const ready = (page) =>
    page.waitForFunction(() => typeof S !== "undefined" && document.title && document.querySelector("#app").children.length, null, { timeout: 10000 }).catch(async (err) => {
      console.log("  (la app no arrancó en " + page.url() + ": " + (await page.content()).slice(0, 300).replace(/\s+/g, " ") + ")");
      throw err;
    });
  const go = async (page, route) => { await page.goto(BASE + route); await ready(page); await wait(page, 700); return st(page); };
  const text = (page) => page.locator("#app").innerText();
  async function login(page, email, pass) {
    await page.fill("#ai_e", email);
    await page.fill("#ai_p", pass);
    await page.click("#fLogin button[type=submit]");
    await wait(page, 1200);
  }
  async function loginPanel(page) {
    await page.fill("#be", "sofia@test.ar");
    await page.fill("#bp", "prestador123");
    await page.click("#fBarb button[type=submit]");
    await wait(page, 1500);
  }

  // ---------- 1. Cada ruta abierta directo (sin sesión) ----------
  let page = await nueva();
  let s = await go(page, "/");
  ok("/ → inicio con el título del sitio", s.view === "home" && (await page.title()) === "TuTiempo · Turnos online en Olavarría");
  s = await go(page, "/rubro/unas");
  ok("/rubro/unas → inicio filtrado por Uñas (slug de categories)", s.view === "home" && s.cat === "u" && (await page.title()) === "Uñas en Olavarría · TuTiempo");
  s = await go(page, "/rubro/no-existe");
  ok("/rubro/no-existe → no encontrado", s.view === "notfound");
  s = await go(page, "/buscar?q=corte");
  await page.waitForSelector(".grid .card", { timeout: 8000 }).catch(() => {});
  ok("/buscar?q=corte → búsqueda con resultados", s.view === "home" && s.q === "corte" && /barbería max/i.test(await text(page)));
  s = await go(page, "/" + SOFIA);
  const desc = await page.evaluate(() => document.querySelector('meta[name="description"]').getAttribute("content"));
  ok("/<slug> → perfil con nombre, rubro y ciudad en el título", s.view === "perfil" && s.pid === sofiaId && /^Sofía Benítez Studio · .+ en Olavarría · TuTiempo$/.test(await page.title()), await page.title());
  ok("/<slug> → descripción propia", desc.includes("Sofía Benítez Studio") && desc.includes("Olavarría"), desc);
  s = await go(page, "/" + SOFIA + "/trabajos");
  ok("/<slug>/trabajos → pestaña Trabajos", s.view === "perfil" && s.ptab === "works");
  s = await go(page, "/" + SOFIA + "/resenas");
  ok("/<slug>/resenas → pestaña Reseñas", s.view === "perfil" && s.ptab === "reviews");
  s = await go(page, "/p/" + sofiaId);
  ok("/p/<id> → perfil, y la dirección pasa a /<slug>", s.view === "perfil" && here(page) === "/" + SOFIA, here(page));
  s = await go(page, "/nadie-se-llama-asi");
  ok("slug inexistente → “no encontrado” y la dirección queda", s.view === "notfound" && here(page) === "/nadie-se-llama-asi" && (await text(page)).includes("No encontramos esta página"));
  s = await go(page, "/" + SOFIA + "/otra-cosa");
  ok("/<slug>/otra-cosa → no encontrado", s.view === "notfound");
  for (const [route, view, title] of [
    ["/ingresar", "login", "Ingresar · TuTiempo"],
    ["/crear-cuenta", "register", "Crear cuenta · TuTiempo"],
    ["/sumate", "prestador", "Sumate como prestador · TuTiempo"],
    ["/terminos", "terminos", "Términos y condiciones · TuTiempo"],
    ["/prestadores/ingresar", "loginBarbero", "Acceso prestadores · TuTiempo"],
    ["/nueva-contrasena", "newpass", "Contraseña nueva · TuTiempo"],
  ]) {
    s = await go(page, route);
    ok(`${route} → su pantalla y su título`, s.view === view && here(page) === route && (await page.title()) === title, `${s.view} ${here(page)} ${await page.title()}`);
  }

  // ---------- 2. Rutas con sesión, sin sesión: al ingreso y de vuelta ----------
  for (const [route, view] of [["/mis-turnos", "misturnos"], ["/cuenta", "cuenta"]]) {
    s = await go(page, route);
    ok(`${route} sin sesión → ingreso con ?volver=`, s.view === "login" && here(page) === "/ingresar?volver=" + encodeURIComponent(route), here(page));
    await login(page, "ruta@test.ar", "cliente12345");
    s = await st(page);
    ok(`${route}: después de ingresar vuelve a ${route}`, s.view === view && here(page) === route, `${s.view} ${here(page)}`);
    await page.context().clearCookies();
    await page.evaluate(() => sb.auth.signOut());
    await page.evaluate(() => localStorage.clear());
  }
  await page.context().close();
  page = await nueva();
  s = await go(page, "/turno/999999");
  ok("/turno/<id> sin sesión → ingreso con ?volver=", s.view === "login" && here(page) === "/ingresar?volver=%2Fturno%2F999999");
  s = await go(page, "/panel/agenda");
  ok("/panel/agenda sin sesión → acceso prestadores con ?volver=", s.view === "loginBarbero" && here(page) === "/prestadores/ingresar?volver=%2Fpanel%2Fagenda", here(page));
  await loginPanel(page);
  s = await st(page);
  ok("panel: después de ingresar vuelve a /panel/agenda", s.role === "barbero" && s.btab === "agenda" && here(page) === "/panel/agenda", here(page));
  await page.context().close();
  page = await nueva();
  s = await go(page, "/admin/balance");
  ok("/admin/balance sin sesión → ingreso con ?volver=", s.view === "login" && here(page) === "/ingresar?volver=%2Fadmin%2Fbalance");
  await login(page, "admin@test.ar", "admin12345");
  s = await st(page);
  ok("admin: después de ingresar vuelve a /admin/balance", s.role === "admin" && s.admT === "bal" && here(page) === "/admin/balance", here(page));
  for (const [route, tab] of [["/admin/resumen", "res"], ["/admin/prestadores", "prov"], ["/admin/balance", "bal"], ["/admin/comision", "com"]]) {
    await page.goto(BASE + route);
    await page.reload();
    await wait(page, 900);
    s = await st(page);
    ok(`recarga en ${route}: misma pantalla`, s.role === "admin" && s.admT === tab && here(page) === route && (await page.title()).endsWith("· Admin · TuTiempo"), here(page));
  }
  await page.context().close();
  page = await nueva();
  await go(page, "/ingresar");
  await login(page, "ruta@test.ar", "cliente12345");
  s = await go(page, "/admin/resumen");
  ok("/admin con una cuenta que no es admin → no encontrado", s.view === "notfound" && s.role !== "admin");
  s = await go(page, "/panel/agenda");
  ok("/panel con una cuenta sin perfil de prestador → inicio (con aviso)", s.view === "home" && s.role === "cliente");
  for (const [route, view] of [["/mis-turnos", "misturnos"], ["/cuenta", "cuenta"]]) {
    await page.goto(BASE + route);
    await page.reload();
    await wait(page, 900);
    s = await st(page);
    ok(`recarga en ${route} con sesión: misma pantalla`, s.view === view && here(page) === route);
  }
  s = await go(page, "/ingresar?volver=%2Fmis-turnos");
  ok("/ingresar?volver= con la sesión abierta → directo a la dirección", s.view === "misturnos" && here(page) === "/mis-turnos", here(page));

  // ---------- 3. Atrás y adelante ----------
  await go(page, "/");
  await page.click(".segtile.seg-u");
  await wait(page);
  await page.click(".grid .card [data-go=perfil]");
  await wait(page, 900);
  await page.click("[data-act=ptab][data-t=works]");
  await wait(page);
  const steps = [here(page)];
  await page.goBack(); await wait(page, 800); steps.push(here(page));
  await page.goBack(); await wait(page, 800); steps.push(here(page));
  await page.goBack(); await wait(page, 800); steps.push(here(page));
  await page.goForward(); await wait(page, 800); steps.push(here(page));
  ok("atrás: trabajos → perfil → rubro → inicio; adelante: rubro", JSON.stringify(steps) === JSON.stringify(["/" + SOFIA + "/trabajos", "/" + SOFIA, "/rubro/unas", "/", "/rubro/unas"]), steps.join(" · "));
  s = await st(page);
  ok("adelante deja la pantalla que corresponde a la dirección", s.view === "home" && s.cat === "u");

  // ---------- 4. Historias: atrás las cierra; la X también, sin dejar una entrada de más ----------
  await go(page, "/");
  await page.goto(BASE + "/" + SOFIA);
  await wait(page, 900);
  await page.click(".pav.ring");
  await wait(page);
  ok("abrir una historia → ?historia=0", here(page) === "/" + SOFIA + "?historia=0" && (await st(page)).story, here(page));
  await page.goBack();
  await wait(page);
  s = await st(page);
  ok("atrás cierra la historia y queda en el perfil", !s.story && s.view === "perfil" && here(page) === "/" + SOFIA, here(page));
  await page.click(".pav.ring");
  await wait(page);
  await page.click("[data-act=storyClose]");
  await wait(page);
  s = await st(page);
  ok("la X cierra la historia y vuelve a la misma entrada", !s.story && here(page) === "/" + SOFIA && !(await page.evaluate(() => history.state && history.state.overlay)));
  await page.goBack();
  await wait(page, 800);
  ok("después de cerrarla, atrás va a la pantalla anterior (no a la historia)", here(page) === "/", here(page));

  // ---------- 5. Reserva: el horario va en la dirección, la recarga lo conserva y vuelve de Mercado Pago ----------
  await page.goto(BASE + "/" + SOFIA);
  await wait(page, 900);
  await page.click(".sgroup.seg-u .svci");
  await page.click("[data-quick]");
  await wait(page, 300);
  await page.click("[data-act=reservarT]");
  await wait(page, 900);
  const checkout = here(page);
  ok("confirmar turno → /<slug>/reservar?servicio=&dia=&hora=", /^\/sofia-benitez-studio\/reservar\?servicio=\d+&dia=\d{4}-\d{2}-\d{2}&hora=\d{2}%3A\d{2}$/.test(checkout), checkout);
  await page.reload();
  await wait(page, 1500);
  ok("recarga en la confirmación: sigue ahí con el mismo horario", (await st(page)).view === "checkoutT" && here(page) === checkout && (await page.locator("#fTurno").count()) === 1);
  await Promise.all([page.waitForURL(/\/turno\/\d+$/, { timeout: 10000 }).catch(() => {}), page.click("#fTurno button[type=submit]")]);
  await wait(page, 1200);
  ok("vuelta de Mercado Pago (?mp=success&b=) → /turno/<id> con el “¡Listo!”", /^\/turno\/\d+$/.test(here(page)) && (await page.locator(".booked").count()) === 1, here(page));
  const turno = here(page);
  await page.reload();
  await wait(page, 1200);
  ok("recarga en /turno/<id>: el detalle del turno", (await st(page)).view === "turnoOk" && here(page) === turno);
  await page.context().close();

  // ---------- 6. Panel: recarga en cada pestaña, ficha de cliente, QR y link ----------
  page = await nueva();
  await go(page, "/prestadores/ingresar");
  await loginPanel(page);
  for (const [word, tab] of [["agenda", "agenda"], ["caja", "caja"], ["finanzas", "finanzas"], ["clientes", "clientes"], ["productos", "productos"], ["horarios", "horarios"], ["estadisticas", "stats"], ["trabajos", "comunidad"], ["perfil", "perfil"]]) {
    await page.goto(BASE + "/panel/" + word);
    await page.reload();
    await wait(page, 1000);
    s = await st(page);
    ok(`recarga en /panel/${word}: misma pestaña`, s.role === "barbero" && s.btab === tab && here(page) === "/panel/" + word, here(page));
  }
  await page.goto(BASE + "/panel/clientes");
  await wait(page, 1000);
  const name = await page.locator("[data-cli]").first().getAttribute("data-cli");
  await page.click("[data-cli]");
  await wait(page);
  const ficha = here(page);
  const clientId = +(await q("select id from provider_clients where provider_id = $1 and name = $2", [sofiaId, name]))[0].id;
  ok("ficha de cliente → ?cliente=<id de provider_clients>, nunca el nombre", ficha === "/panel/clientes?cliente=" + clientId && !ficha.includes(encodeURIComponent(name)), ficha);
  await page.reload();
  await wait(page, 1200);
  ok("recarga en la ficha: el mismo cliente", (await st(page)).cli === name);
  await page.goBack();
  await wait(page);
  ok("atrás cierra la ficha", !(await st(page)).cli && here(page) === "/panel/clientes", here(page));
  await page.goto(BASE + "/panel/trabajos");
  await wait(page, 1000);
  const pixels = await page.evaluate(async () => {
    const svg = document.querySelector(".qr svg");
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 264;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 264, 264);
    g.drawImage(img, 0, 0, 264, 264);
    return Array.from(g.getImageData(0, 0, 264, 264).data);
  });
  const decoded = jsQR(Uint8ClampedArray.from(pixels), 264, 264);
  ok("el QR se decodifica y es la dirección del perfil", decoded && decoded.data === BASE + "/" + SOFIA, decoded && decoded.data);
  ok("el link que se muestra es el mismo (sin https://)", (await text(page)).includes(new URL(BASE).host + "/" + SOFIA));
  await page.click("[data-act=copiarLink]");
  await wait(page, 300);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  ok("“Copiar link” copia la dirección del perfil con el dominio actual", copied === BASE + "/" + SOFIA, copied);
  await page.context().close();
  page = await nueva();
  s = await go(page, new URL(copied).pathname);
  ok("el link copiado abre el perfil", s.view === "perfil" && s.pid === sofiaId);

  // ---------- 7. Palabras reservadas: cada una abre su pantalla y nunca un perfil ----------
  // como un dato viejo, de antes de la lista: el trigger que rechaza slugs reservados se apaga solo para cargarlo
  await q("alter table providers disable trigger providers_slug_not_reserved");
  await q("update providers set slug = 'blog' where id = $1", [maxId]);
  await q("alter table providers enable trigger providers_slug_not_reserved");
  const screens = { ingresar: "login", "crear-cuenta": "register", "nueva-contrasena": "newpass", sumate: "prestador", terminos: "terminos", buscar: "home", "mis-turnos": "login", cuenta: "login", panel: "loginBarbero", admin: "login" };
  const wrong = [];
  const folders = ["assets", "fonts", "vendor"]; // carpetas reales del sitio: Apache responde 403, nunca la app
  for (const word of RESERVED) {
    if (folders.includes(word)) {
      const status = (await fetch(BASE + "/" + word)).status;
      if (status !== 403) wrong.push(`${word}→HTTP ${status}`);
      continue;
    }
    s = await go(page, "/" + word);
    const expected = screens[word] || "notfound";
    if (s.view === "perfil" || s.view !== expected) wrong.push(`${word}→${s.view}`);
  }
  ok(`las ${RESERVED.length} palabras reservadas abren su pantalla (o “no encontrado”, o 403 si es una carpeta), nunca un perfil`, wrong.length === 0 && RESERVED.length > 20, wrong.join(", "));
  s = await go(page, "/p/" + maxId);
  ok("un prestador con un slug reservado (dato viejo) se ve en /p/<id> y la dirección queda así", s.view === "perfil" && s.pid === maxId && here(page) === "/p/" + maxId, here(page));

  // ---------- 8. Link de recuperación de contraseña ----------
  await go(page, "/ingresar");
  await page.click("[data-act=authMode][data-m=forgot]");
  await page.fill("#af_e", "ruta@test.ar");
  await page.click("#fForgot button[type=submit]");
  await wait(page, 800);
  const mail = await (await fetch(BASE + "/__mail?email=ruta%40test.ar")).json();
  s = await go(page, "/?token_hash=" + mail.recovery + "&type=recovery");
  await wait(page, 800);
  ok("link de recuperación (?token_hash=) → /nueva-contrasena", (await st(page)).view === "newpass" && here(page) === "/nueva-contrasena", here(page));

  ok("sin errores de JavaScript", errors.length === 0, errors.join(" | "));
  ok("sin bloqueos de la CSP", csp.length === 0, csp.join(" | "));
  await browser.close();
  await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK");
  process.exit(F ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Prueba end-to-end en navegador real (Chromium) contra Postgres + PostgREST + reglas RLS reales.
// Recorre: listado multirrubro → perfil → login por código → reserva → pago (MP simulado) → cashback →
// panel del prestador (agenda, bloqueo, productos, gastos, rubros/servicios) → cancelación con devolución → seguridad →
// admin ("Para revisar · cobros") → Bloque 1: avisos de cobros y desconectar Mercado Pago.
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
let F = 0; const ok = (n, c, d) => { if (!c) F++; console.log((c ? "OK   " : "FAIL ") + n); if (!c && d) console.log("     ", d) };
// 8/11 (punto 11): el turno se elige con margen, el primer horario del próximo día abierto (no el «Primer turno», que puede
// ser dentro de minutos y quedar en el pasado mientras corre la prueba: pasó a las 15:00 en el CI de #61)
async function turnoConMargen(p) {
  await p.locator(".wd[data-day]:not(.today):not([disabled]):not(.full)").first().click();
  await p.waitForTimeout(200);
  await p.locator(".slots [data-slot]").first().click();
  await p.waitForTimeout(200);
}
(async () => {
  const db = new Client({ connectionString: PG }); await db.connect();
  const q = async (s, a) => (await db.query(s, a)).rows;
  // 8/11 (punto 1): Crear cuenta empieza con dos opciones; después, la elegida queda arriba con «Cambiar»
  const kindOf = async (p) => {
    const t = await p.locator(".kindsel").first().innerText().catch(() => "");
    return /Tengo un negocio/.test(t) ? "biz" : /Quiero reservar turnos/.test(t) ? "client" : null;
  };
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 400, height: 900 } }); const pg = await ctx.newPage();
  const errs = [], csp = []; let probing = false;
  pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("console", (m) => { if (m.type() === "error") { const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) csp.push(t); else if (!/favicon|404/.test(t) && !(probing && /Failed to load resource/.test(t))) errs.push(t) } });
  const bad = []; pg.on("response", async (r) => { if (r.status() >= 400 && !probing) { let t = ""; try { t = (await r.text()).slice(0, 160) } catch {} bad.push(r.status() + " " + r.request().method() + " " + r.url().replace(BASE, "") + " " + t) } });
  const wait = (ms = 400) => pg.waitForTimeout(ms);
  const txt = () => pg.locator("#app").innerText();
  // menú de cuenta de la cabecera (Bloque D): lo abre y elige la opción
  const menu = async (sel) => { await pg.click("nav .acct-btn"); await pg.waitForSelector("#acctMenu:not([hidden])"); await pg.click(`#acctMenu ${sel}`); await wait(); };
  const seg = () => pg.evaluate(() => document.body.dataset.seg);
  // espera hasta que la consulta devuelva algo que cumple la condición (para lo que guarda la app sin avisar cuándo)
  const until = async (sql, args, test, ms = 6000) => { const t0 = Date.now(); let rows; do { rows = await q(sql, args); if (test(rows)) return true; await wait(200) } while (Date.now() - t0 < ms); return false };

  await pg.goto(BASE); await pg.waitForSelector(".grid .card"); await wait();
  ok("modo en vivo: sin barra demo", !(await pg.isVisible(".modebar")) && !(await pg.isVisible(".demo")));
  {
    // C04: el logo del manual (isotipo + "tutiempo", con el nombre para lectores de pantalla), el lema en el pie, el
    // favicon, el color de la barra del navegador y el logo de los emails
    const brand = await pg.evaluate(() => ({
      head: document.querySelectorAll("#logoLink svg.lg-i, #logoLink svg.lg-t").length, name: document.querySelector("#logoLink .vh")?.textContent,
      foot: document.querySelectorAll("#logoFoot svg.lg-i").length, claim: document.querySelector("footer .claim")?.textContent,
      icon: document.querySelector("link[rel=icon]")?.getAttribute("href"), theme: document.querySelector("meta[name=theme-color]")?.content,
      bg: getComputedStyle(document.body).backgroundColor, brand: getComputedStyle(document.body).getPropertyValue("--brand").trim(), ok: getComputedStyle(document.body).getPropertyValue("--ok").trim(),
    }));
    ok("C04: logo del manual en la cabecera y el pie, lema, favicon y colores (azul #0440F3, verde de texto #07774F, crema)",
       brand.head === 2 && brand.name === "TuTiempo" && brand.foot === 1 && brand.claim === "TU TIEMPO. SU SOLUCIÓN. AL INSTANTE." && brand.icon === "/icons/favicon.svg"
       && brand.theme === "#04122E" && brand.bg === "rgb(248, 245, 241)" && brand.brand.toUpperCase() === "#0440F3" && brand.ok.toUpperCase() === "#07774F", JSON.stringify(brand));
    const files = await Promise.all(["/icons/favicon.svg", "/icons/logo-email.png", "/fonts/nunito-latin-800-normal.woff2", "/fonts/montserrat-latin-700-normal.woff2"].map((f) => pg.evaluate((u) => fetch(u).then((r) => r.status), f)));
    ok("C04: el favicon, el logo de los emails y las dos fuentes se sirven", files.every((s) => s === 200), JSON.stringify(files));
  }
  // Ingreso y registro (rediseño aprobado el 1/11): un solo "Ingresar"; la ventana es la misma para clientes y prestadores
  ok("ingreso: la cabecera sin sesión tiene solo Ingresar", (await pg.locator("nav [data-act=authOpen]").count()) === 1 && (await pg.locator("nav [data-go=login]").count()) === 0);
  const urlHome = pg.url();
  const opener = pg.locator("nav [data-act=authOpen]");
  await opener.click(); await wait();
  ok("ingreso: abre una ventana sobre la misma página (role=dialog con título)", (await pg.isVisible(".authmodal #fLogin")) && pg.url() === urlHome && (await pg.locator(".grid .card").count()) === 2
     && (await pg.evaluate(() => document.body.classList.contains("am-open"))) && (await pg.getAttribute(".authmodal", "role")) === "dialog" && (await pg.locator("#amTitle").innerText()).length > 0);
  ok("ingreso: sin elegir cliente o profesional (una cuenta = una persona)", (await pg.locator(".am-tabs, [data-act=authSide], #fBarb").count()) === 0 && (await pg.locator(".am-sub").innerText()).includes("Clientes y profesionales entran por acá"));
  ok("ingreso: en el celular no enfoca un campo (no abre el teclado tapando la ventana)", await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains("am-box")));
  ok("ingreso: debajo de Google, la aceptación de los Términos y la Política de privacidad", /Al continuar, aceptás los Términos y la Política de privacidad/.test(await pg.locator(".authmodal .gterms").innerText()) && (await pg.locator(".authmodal .gterms [data-go=terminos]").count()) === 1 && (await pg.locator(".authmodal .gterms [data-go=privacidad]").count()) === 1);
  // el foco no se escapa de la ventana
  for (let i = 0; i < 30; i++) await pg.keyboard.press("Tab");
  ok("ingreso: Tab da la vuelta adentro de la ventana", await pg.evaluate(() => !!document.activeElement.closest(".am-box")));
  await pg.click(".authmodal [data-act=authMode][data-m=up]"); await wait(200);
  // 8/11 (punto 1): primero las dos opciones, sin Google ni el formulario todavía
  const opts = await pg.locator(".authmodal .kindopt").allInnerTexts();
  ok("8/11: Crear cuenta adentro de la ventana empieza con dos opciones grandes: «Quiero reservar turnos» y «Tengo un negocio»",
     opts.length === 2 && /Quiero reservar turnos/.test(opts[0]) && /Tengo un negocio/.test(opts[1]) && pg.url() === urlHome
     && (await pg.locator(".authmodal #fSignup, .authmodal [data-act=google], .authmodal #au_biz").count()) === 0
     && (await pg.locator(".authmodal .am-foot [data-act=bizStart]").count()) === 0 && (await pg.locator("#amTitle").innerText()) === "Creá tu cuenta");
  await pg.click('.authmodal .kindopt[data-k=client]'); await wait(200);
  const selBox = await pg.locator(".authmodal .kindsel").boundingBox().catch(() => null); const gBox = await pg.locator(".authmodal [data-act=google]").boundingBox().catch(() => null);
  ok("8/11: «Quiero reservar turnos» sigue a Google y al formulario, con la elección arriba y «Cambiar»",
     (await pg.isVisible(".authmodal #fSignup")) && (await kindOf(pg)) === "client" && !(await pg.evaluate(() => S.pending)) && (await pg.locator(".authmodal .gterms").count()) === 1
     && selBox && gBox && selBox.y < gBox.y && (await pg.locator(".authmodal .kindsel [data-act=authKind]").innerText()) === "Cambiar");
  await pg.click(".authmodal .kindsel [data-act=authKind]"); await wait(200);
  ok("8/11: «Cambiar» vuelve a las dos opciones", (await pg.locator(".authmodal .kindopt").count()) === 2 && (await pg.locator(".authmodal #fSignup").count()) === 0);
  await pg.keyboard.press("Escape"); await wait(200);
  ok("ingreso: Escape cierra la ventana y el foco vuelve a Ingresar", (await pg.locator(".authmodal").count()) === 0 && !(await pg.evaluate(() => document.body.classList.contains("am-open")))
     && (await pg.evaluate(() => document.activeElement && document.activeElement.matches("nav [data-act=authOpen]"))));
  await pg.click("footer [data-act=authOpen]"); await wait();
  ok("ingreso: Ingresar del footer abre la misma ventana", await pg.isVisible(".authmodal #fLogin"));
  await pg.click(".authmodal .am-x"); await wait(200);
  ok("ingreso: la cruz cierra la ventana", (await pg.locator(".authmodal").count()) === 0);
  await pg.click("footer [data-act=bizStart]"); await wait();
  ok("8/11: Registrá tu negocio del footer abre Crear cuenta con «Tengo un negocio» ya elegido", (await pg.isVisible(".authmodal #fSignup")) && (await kindOf(pg)) === "biz" && (await pg.locator(".authmodal .kindopt").count()) === 0 && (await pg.locator("#amTitle").innerText()) === "Creá tu cuenta" && (await pg.locator("#au_t").count()) === 0 && (await pg.evaluate(() => S.pending && S.pending.a)) === "negocio");
  await pg.mouse.click(5, 5); await wait(200);
  ok("ingreso: tocar afuera cierra la ventana", (await pg.locator(".authmodal").count()) === 0);
  {
    // 4/11 · Bloque 2: "Crear cuenta" siempre en la ventana, también desde la página /ingresar; /crear-cuenta queda
    // como página solo para los links directos
    await pg.goto(BASE + "/ingresar"); await pg.waitForSelector("#fLogin"); await wait(300);
    await pg.click("[data-act=authMode][data-m=up]"); await wait(300);
    ok("4/11: en /ingresar, «Creá una» abre Crear cuenta en la ventana (la dirección no cambia), con las dos opciones",
       (await pg.locator(".authmodal .kindopt").count()) === 2 && new URL(pg.url()).pathname === "/ingresar" && (await pg.locator("#fLogin").count()) === 0 && (await pg.locator("#amTitle").count()) === 1);
    await pg.click(".authmodal .am-x"); await wait(300);
    ok("4/11: …al cerrarla, la página de ingreso queda como estaba", (await pg.locator(".authmodal").count()) === 0 && (await pg.isVisible("#fLogin")) && new URL(pg.url()).pathname === "/ingresar");
    await pg.click("footer [data-act=bizStart]"); await wait(300);
    ok("4/11: en /ingresar, «Registrá tu negocio» también abre la ventana, con «Tengo un negocio» elegido",
       (await pg.isVisible(".authmodal #fSignup")) && (await kindOf(pg)) === "biz" && new URL(pg.url()).pathname === "/ingresar");
    await pg.keyboard.press("Escape"); await wait(200);
    await pg.goto(BASE + "/crear-cuenta"); await pg.waitForSelector(".kindpick"); await wait(300);
    ok("4/11: /crear-cuenta (link directo) sigue siendo una página, también con las dos opciones", (await pg.locator(".authmodal").count()) === 0 && (await pg.locator(".kindopt").count()) === 2);
    // el logo: para el cliente y sin sesión, la página general de rubros (sin el rubro ni la búsqueda de antes)
    await pg.goto(BASE + "/rubro/unas"); await pg.waitForSelector(".grid .card, .empty", { timeout: 8000 }).catch(() => {}); await wait(300);
    const conRubro = (await pg.locator("[data-act=verTodos]").count()) === 1;
    await pg.click("#logoLink"); await wait(400);
    ok("4/11: el logo lleva a la página general de rubros (todos, sin filtro)", conRubro && new URL(pg.url()).pathname === "/" && (await pg.locator("[data-act=verTodos]").count()) === 0);
    await pg.goto(BASE + "/"); await pg.waitForSelector(".grid .card"); await wait(300);
  }
  ok("ingreso: el footer dice Ingresar y Registrá tu negocio (sin Acceso prestadores ni Sumate)", /Registrá tu negocio/.test(await pg.locator("footer").innerText()) && !/Acceso prestadores|Sumate/.test(await pg.locator("footer").innerText()));
  ok("General: el footer tiene contacto@tutiempo.com.ar como link mailto y sin @tutiempo.arg",
     (await pg.locator('footer a[href="mailto:contacto@tutiempo.com.ar"]').count()) === 1 && !/@tutiempo\.arg/.test(await pg.locator("footer").innerText()));
  ok("7/11: el inicio ya no tiene el cartel «¿Tenés un negocio?»; queda «Registrá tu negocio» en el footer",
     (await pg.locator("#app .bizcta").count()) === 0 && !/¿Tenés un negocio\?/.test(await pg.locator("#app").innerText()) && (await pg.locator("footer [data-act=bizStart]").count()) === 1);
  const foot = await pg.locator("footer").innerText();
  const socials = await pg.evaluate(() => [...document.querySelectorAll("footer a[target=_blank]")].map((a) => [a.href, a.rel]));
  ok("V7: footer con teléfono, las cuatro redes (pestaña nueva) y sin Prototipo",
    (await pg.locator('footer a[href="tel:+5492284722825"]').count()) === 1 && !/prototipo/i.test(foot) &&
    ["wa.me/5492284722825", "instagram.com/tutiempo.arg", "facebook.com/profile.php?id=61592065464698", "youtube.com/channel/UCMQI8_kVvk_7S7_ceHfiKAg", "tiktok.com/@tutiempo_arg"].every((u) => socials.some(([h, r]) => h.includes(u) && /noopener/.test(r))), JSON.stringify(socials));
  ok("7/11: el teléfono del footer abre WhatsApp (pestaña nueva) y al lado «Llamar», cada uno con su ícono",
     (await pg.locator('footer a[href="https://wa.me/5492284722825"][target=_blank] svg').count()) === 1 && (await pg.locator('footer a[href="tel:+5492284722825"] svg').count()) === 1
     && /WhatsApp 2284 722825/.test(foot) && /Llamar/.test(foot));
  ok("lista desde la base (2 prestadores)", (await pg.locator(".grid .card").count()) === 2);
  ok("conteo por rubro", (await pg.locator(".segtile.seg-l").innerText()).includes("1 con turnos"));
  await pg.click(".segtile.seg-u"); await wait();
  ok("rubro Uñas: Sofía con paleta coral", (await seg()) === "u" && (await pg.locator(".grid .card.seg-u").count()) === 1);
  await pg.click(".grid .card [data-go=perfil]"); await pg.waitForSelector(".sgroup"); await wait();
  ok("perfil con 3 grupos de servicios", (await pg.locator(".sgroup").count()) === 3);
  ok("perfil sin teléfono; seña con Mercado Pago y resto en efectivo o MP", !(await txt()).includes("111222") && !(await txt()).includes("Teléfono") && (await txt()).includes("Seña con Mercado Pago"));
  ok("perfil sin “Desde” sobre la foto", (await pg.locator(".phero .ph-price").count()) === 0);
  await pg.click(".sgroup.seg-u .svci"); await wait(200);
  ok("indicaciones en el perfil, sin adicionales", (await pg.locator("[data-add]").count()) === 0 && (await txt()).includes("Venir sin esmalte"));
  await turnoConMargen(pg);
  const slotTime = await pg.evaluate(() => S.slot && S.slot.date + " " + S.slot.time);
  await pg.click("[data-act=reservarT]"); await wait();
  ok("pide ingresar para reservar, en la ventana encima del perfil", (await txt()).includes("Ingresá para reservar") && (await pg.isVisible(".authmodal #fLogin")));
  const tk = await pg.locator(".authmodal .tk").innerText().catch(() => "");
  const [slotDay, slotHM] = slotTime.split(" ");
  ok("ingreso: el ticket muestra día, hora, servicio y negocio, y que sigue directo al pago",
     tk.includes(slotHM) && tk.includes(+slotDay.slice(8) + "/" + +slotDay.slice(5, 7)) && /Esmaltado/.test(tk) && /Sofía/.test(tk) && tk.includes("Al ingresar seguís directo al pago"), tk);
  ok("ingreso con Google, email y contraseña", await pg.isVisible("[data-act=google]") && await pg.isVisible("#ai_p"));
  // 4/11: sin "Entrar con un código por email" (en ningún lado): se ingresa con contraseña o con Google
  ok("4/11: el ingreso no ofrece entrar con un código por email", (await pg.locator("[data-m=code]").count()) === 0 && !/con un código/.test(await pg.locator(".authmodal").innerText()));
  await db.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('ana@test.ar', 'cliente12345', now(), '{\"full_name\":\"ana\"}')");
  probing = true; await pg.fill("#ai_e", "ana@test.ar"); await pg.fill("#ai_p", "otra-clave-1"); await pg.click("#fLogin button[type=submit]"); await wait(); probing = false;
  ok("contraseña incorrecta avisa (y propone recuperarla, no un código)", (await pg.locator("#ai_p_err").innerText().catch(() => "")).includes("recuperá tu contraseña"));
  await pg.fill("#ai_p", "cliente12345"); await pg.click("#fLogin button[type=submit]"); await pg.waitForSelector("#fTurno"); await wait();
  ok("vuelve al pago ya logueado", (await txt()).includes("Confirmá tu turno"));
  ok("checkout: seña obligatoria (4/11: fija del 30%, $3.600 de $12.000) y el resto en efectivo o Mercado Pago, sin preguntas ni saldo", (await pg.locator("[data-paym=mp]").count()) === 1 && (await pg.locator("[data-paym=cash]").count()) === 1 && !(await pg.locator(".intake").count()) && !(await txt()).includes("Saldo") && (await txt()).includes("$3.600"));
  ok("D34: la comisión va aparte de la seña, sobre el precio (10% del servicio = $1.200) y se paga $4.800 (4/11: con la seña fija del 30%)", (await pg.locator(".feerow").innerText()).includes("10% del servicio") && (await pg.locator(".feerow").innerText()).includes("$1.200") && (await pg.locator("#fTurno .tot").innerText()).includes("$4.800") && (await pg.locator("#fTurno button[type=submit]").innerText()).includes("$4.800"));
  // C52 (V8): el prestador cambia el precio mientras la clienta está en la confirmación
  const holdsAntes = (await q("select count(*)::int c from bookings where status = 'hold'"))[0].c;
  await db.query("update services set price = 14000 where name = 'Esmaltado semipermanente'");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /El precio cambió/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("C52: si el precio cambió, no cobra: muestra el nuevo total (y el de antes) y pide confirmar de nuevo",
     /El precio cambió mientras mirabas: ahora pagás \$5\.600 \(antes \$4\.800\)/.test(await pg.locator("#terr").innerText()) && (await pg.locator("#fTurno .tot").innerText()).includes("$5.600")
     && (await q("select count(*)::int c from bookings where status = 'hold'"))[0].c === holdsAntes && new URL(pg.url()).pathname.endsWith("/reservar"));
  await db.query("update services set price = 12000 where name = 'Esmaltado semipermanente'");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /antes \$5\.600/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("C52: …y si vuelve al precio de antes, lo avisa igual", (await pg.locator("#fTurno .tot").innerText()).includes("$4.800"));
  // D30 (V1): el admin carga los % de Mercado Pago y la prestadora elige "10 días" mientras la clienta está en la confirmación
  await db.query("update app_settings set mp_pct_instant = 7.61, mp_pct_d10 = 5.31");
  await db.query("update provider_settings set payout_term = 'd10' where provider_id = (select id from providers where name like 'Sofía%')");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /antes \$4\.800/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  const fr30 = await pg.locator("#fTurno .feerow").allInnerTexts();
  ok("D30: antes de cobrar avisa el total nuevo con el costo de Mercado Pago ($3.600 + $1.200 + $270 = $5.070)",
     /ahora pagás \$5\.070 \(antes \$4\.800\)/.test(await pg.locator("#terr").innerText()) && (await pg.locator("#fTurno .tot").innerText()).includes("$5.070"));
  ok("D30: el resumen muestra los tres conceptos por separado (seña, comisión de TuTiempo y costo de Mercado Pago con su plazo)",
     fr30.length === 2 && fr30[0].includes("10% del servicio") && fr30[0].includes("$1.200") && /acreditación en 10 días, 5,31% del total/.test(fr30[1]) && fr30[1].includes("$270")
     && (await pg.locator("#fTurno").innerText()).includes("Se suma la comisión de TuTiempo y el costo de Mercado Pago"));
  await Promise.all([pg.waitForURL(/mp=success/).catch(() => {}), pg.click("#fTurno button[type=submit]")]);
  await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("vuelve de Mercado Pago con el turno confirmado", await pg.isVisible(".booked"));
  const bk30 = (await q("select deposit, client_fee, mp_fee, paid_mp, app_fee, paid_mp_fee, status from bookings where client_id = (select id from auth.users where email='ana@test.ar') order by id desc limit 1"))[0];
  ok("D30: en la base: seña completa para la prestadora, comisión de TuTiempo y lo de Mercado Pago aparte",
     bk30 && bk30.status === "confirmed" && bk30.deposit === 3600 && bk30.client_fee === 1200 && bk30.mp_fee === 270 && bk30.paid_mp === 3600 && bk30.app_fee === 1200 && bk30.paid_mp_fee === 270, JSON.stringify(bk30));
  await db.query("update app_settings set mp_pct_instant = 0, mp_pct_d10 = 0");
  await db.query("update provider_settings set payout_term = 'instant' where provider_id = (select id from providers where name like 'Sofía%')");
  {
    // C52: en el perfil, al volver a la pestaña, los precios se actualizan solos
    const pv = await ctx.newPage(); pv.on("pageerror", (e) => errs.push(e.message));
    const sid = (await q("select id from providers where name like 'Sofía%'"))[0].id;
    await pv.goto(BASE + "/p/" + sid); await pv.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await pv.waitForTimeout(500);
    const antes = (await pv.locator("#app").innerText()).includes("$12.000");
    await db.query("update services set price = 13500 where name = 'Esmaltado semipermanente'");
    await pv.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await pv.waitForFunction(() => document.querySelector("#app")?.innerText.includes("$13.500"), null, { timeout: 8000 }).catch(() => {});
    ok("C52: el perfil abierto muestra el precio nuevo al volver a la pestaña (sin recargar)", antes && (await pv.locator("#app").innerText()).includes("$13.500"));
    // D31 (V3): la app muestra los mismos horarios que la base acepta (slot_starts), contando el turno de Ana
    let d31 = (await q("select to_char(starts_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') d from bookings where client_id = (select id from auth.users where email='ana@test.ar') order by id desc limit 1"))[0].d;
    const hoy31 = (await q("select to_char(now() at time zone 'America/Argentina/Buenos_Aires' + interval '61 minutes', 'YYYY-MM-DD HH24:MI') h"))[0].h;
    let desde31 = d31 === hoy31.slice(0, 10) ? hoy31.slice(11) : "00:00";
    const base31 = async () => (await q("select to_char(s, 'HH24:MI') t from slot_starts($1, $2::date, 60) s order by s", [sid, d31])).map((r) => r.t).filter((t) => t >= desde31);
    let srv31 = await base31();
    // si el turno de Ana es hoy y ya no quedan horarios (de tarde-noche en Argentina), el próximo día con horarios
    for (let i = 0; !srv31.length && i < 7; i++) {
      d31 = (await q("select to_char($1::date + 1, 'YYYY-MM-DD') d", [d31]))[0].d; desde31 = "00:00"; srv31 = await base31();
    }
    const cli31 = (await pv.evaluate(([pid, d]) => slotsFor(pid, d, 60, null, true).list.filter((x) => x.free).map((x) => x.time), [sid, d31])).filter((t) => t >= desde31);
    ok("D31: la app y la base calculan los mismos horarios (servicio de 60 min, el día del turno de Ana)", srv31.length > 0 && JSON.stringify(srv31) === JSON.stringify(cli31), JSON.stringify([srv31, cli31]));
    await db.query("update services set price = 12000 where name = 'Esmaltado semipermanente'");
    await pv.close();
  }
  ok("el aviso principal dice qué servicio pagaste, sin la tarjeta repetida", (await pg.locator(".booked").innerText()).includes("Esmaltado semipermanente") && (await pg.locator(".turnocard").count()) === 0);
  ok("“No voy a poder ir” es un botón como los demás", (await pg.locator(".tacts [data-act=cancelAsk]").count()) === 1);
  const conf = await q("select m.body, m.kind from client_messages m join auth.users u on u.id=m.user_id where u.email='ana@test.ar' and m.kind='conf'");
  ok("aviso de confirmación en la app (sin WhatsApp)", conf.length === 1 && conf[0].body.includes("Sofía Benítez Studio"));
  ok("en la base: comisión cobrada aparte y guardada", (await q("select app_fee, client_fee from bookings where client_id = (select id from auth.users where email='ana@test.ar')"))[0].app_fee === 1200);
  ok("v30/D30: el aviso dice seña + comisiones (TuTiempo y Mercado Pago)", (await pg.locator(".booked .bk-must").innerText()).includes("$3.600 + $1.470 de comisiones"));
  ok("Paso 1: la vuelta de Mercado Pago llega a /turno/<id> (no al inicio)", /^\/turno\/\d+$/.test(new URL(pg.url()).pathname));
  {
    // Paso 1: pagó desde la app instalada y Mercado Pago volvió al navegador, que no tiene la sesión
    const ck = await (await fetch(BASE + "/__checkout")).json();
    const ctxP = await b.newContext({ viewport: { width: 400, height: 900 } }); const pp = await ctxP.newPage();
    pp.on("pageerror", (e) => errs.push(e.message));
    await pp.goto(`${BASE}/turno/${ck.booking}?pago=${ck.token}&mp=success`); await pp.waitForSelector(".pay-back", { timeout: 8000 }).catch(() => {}); await pp.waitForTimeout(600);
    const ptxt = await pp.locator("#app").innerText().catch(() => "");
    ok("Paso 1: sin sesión, la vuelta muestra el turno confirmado (servicio, prestador y hora) y ofrece ingresar",
       /¡Listo! Tenés turno/.test(ptxt) && ptxt.includes("Esmaltado semipermanente") && ptxt.includes("Sofía Benítez Studio") && (await pp.locator("[data-act=payLogin]").count()) === 1
       && !/Ana/.test(ptxt), ptxt.slice(0, 200));
    ok("Paso 1: la dirección conserva el token (se puede recargar)", new URL(pp.url()).searchParams.get("pago") === ck.token);
    await pp.reload(); await pp.waitForSelector(".pay-back", { timeout: 8000 }).catch(() => {}); await pp.waitForTimeout(400);
    ok("Paso 1: …y recargando sigue ahí", /¡Listo! Tenés turno/.test(await pp.locator("#app").innerText()));
    await pp.click("[data-act=payLogin]"); await pp.waitForSelector("#ai_e", { timeout: 8000 }).catch(() => {}); await pp.waitForTimeout(300);
    ok("Paso 1: “Ingresá para ver tu turno” lleva al ingreso y después vuelve al turno", new URL(pp.url()).pathname === "/ingresar" && new URL(pp.url()).searchParams.get("volver") === `/turno/${ck.booking}`);
    await pp.fill("#ai_e", "ana@test.ar"); await pp.fill("#ai_p", "cliente12345"); await pp.click("#fLogin button[type=submit]");
    await pp.waitForURL(new RegExp(`/turno/${ck.booking}$`), { timeout: 8000 }).catch(() => {}); await pp.waitForTimeout(800);
    ok("Paso 1: …ya con sesión, el detalle de su turno", new URL(pp.url()).pathname === `/turno/${ck.booking}` && /Esmaltado semipermanente/.test(await pp.locator("#app").innerText()));
    const ctxQ = await b.newContext({ viewport: { width: 400, height: 900 } }); const pq = await ctxQ.newPage();
    pq.on("pageerror", (e) => errs.push(e.message));
    await pq.goto(`${BASE}/turno/${ck.booking}?pago=${"0".repeat(64)}&mp=success`); await pq.waitForSelector(".pay-back", { timeout: 8000 }).catch(() => {}); await pq.waitForTimeout(400);
    ok("Paso 1: un token que no existe no muestra nada del turno", /No encontramos este pago/.test(await pq.locator("#app").innerText()) && !(await pq.locator("#app").innerText()).includes("Esmaltado"));
    // un cobro todavía sin pago: "Estamos confirmando tu pago" y se actualiza sola cuando llega
    const hb = (await q("select id, provider_id, service_id, starts_at, ends_at from bookings where client_id = (select id from auth.users where email='ana@test.ar') and status='confirmed' order by id limit 1"))[0];
    const hid = (await q("insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, hold_expires_at) values ($1, $2, (select id from auth.users where email='ana@test.ar'), 'Ana', 'Esmaltado semipermanente', 'app', 'hold', $3::timestamptz + interval '7 days', $4::timestamptz + interval '7 days', 12000, 6000, 1200, now() + interval '10 minutes') returning id",
      [hb.provider_id, hb.service_id, hb.starts_at, hb.ends_at]))[0].id;
    const htok = (await q("select checkout_open(array[$1]::bigint[], null) as t", [hid]))[0].t;
    await pq.goto(`${BASE}/turno/${hid}?pago=${htok}&mp=success`); await pq.waitForSelector(".pay-back", { timeout: 8000 }).catch(() => {}); await pq.waitForTimeout(400);
    ok("Paso 1: sin sesión y sin el pago todavía: “Estamos confirmando tu pago”", /Estamos confirmando tu pago/.test(await pq.locator("#app").innerText()));
    await q("select confirm_payment(array[$1]::bigint[], $2, 7200, p_provider => $3, p_fee_mp => 1200)", [hid, "mp-test-tarde-" + hid, hb.provider_id]);
    await pq.waitForFunction(() => /Tenés turno/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 12000 }).catch(() => {});
    ok("Paso 1: …y se actualiza sola cuando el pago queda confirmado", /¡Listo! Tenés turno/.test(await pq.locator("#app").innerText()));
    await ctxP.close(); await ctxQ.close();
    // ese turno extra no sigue: las pruebas de más abajo cuentan los turnos de Ana
    await db.query("delete from mp_checkouts where $1 = any(booking_ids)", [hid]);
    await db.query("delete from client_messages where ref = $1::text", [hid]);
    await db.query("delete from payment_bookings where booking_id = $1", [hid]);
    await db.query("update bookings set payment_id = null where id = $1", [hid]);
    await db.query("delete from payments where mp_payment_id = $1", ["mp-test-tarde-" + hid]);
    await db.query("delete from bookings where id = $1", [hid]);
  }
  {
    // C54 (V8): volvió de Mercado Pago sin pagar (mp=failure): "El pago no se completó" y "Volver a intentar"
    const hb = (await q("select provider_id, service_id, starts_at, ends_at from bookings where client_id = (select id from auth.users where email='ana@test.ar') and status='confirmed' order by id limit 1"))[0];
    const hid = (await q("insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, hold_expires_at) values ($1, $2, (select id from auth.users where email='ana@test.ar'), 'Ana', 'Esmaltado semipermanente', 'app', 'hold', $3::timestamptz + interval '8 days', $4::timestamptz + interval '8 days', 12000, 6000, 1200, now() + interval '10 minutes') returning id",
      [hb.provider_id, hb.service_id, hb.starts_at, hb.ends_at]))[0].id;
    const htok = (await q("select checkout_open(array[$1]::bigint[], null) as t", [hid]))[0].t;
    await pg.goto(`${BASE}/turno/${hid}?pago=${htok}&mp=failure`); await pg.waitForSelector("[data-act=payRetry]", { timeout: 8000 }).catch(() => {}); await wait(400);
    ok("C54: con sesión y el pago sin completar: “El pago no se completó”, con “Volver a intentar” (no “Estamos confirmando”)",
       /El pago no se completó/.test(await txt()) && !/Estamos confirmando/.test(await txt()) && (await pg.locator("[data-act=payRetry]").count()) === 1);
    const prefsAntes = (await (await fetch(BASE + "/__log")).json()).filter((x) => x.fn === "mp-create-preference").length;
    await Promise.all([pg.waitForURL(/mp=success/, { timeout: 8000 }).catch(() => {}), pg.click("[data-act=payRetry]")]);
    await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(600);
    const log = (await (await fetch(BASE + "/__log")).json()).filter((x) => x.fn === "mp-create-preference");
    ok("C54: “Volver a intentar” vuelve a abrir Mercado Pago para el mismo turno y queda confirmado",
       log.length === prefsAntes + 1 && JSON.stringify(log.at(-1).body.booking_ids) === JSON.stringify([Number(hid)])
       && (await q("select status from bookings where id = $1", [hid]))[0].status === "confirmed");
    // ese turno extra no sigue: las pruebas de más abajo cuentan los turnos de Ana
    await db.query("delete from mp_checkouts where $1 = any(booking_ids)", [hid]);
    await db.query("delete from client_messages where ref = $1::text", [hid]);
    await db.query("delete from payment_bookings where booking_id = $1", [hid]);
    const pids = (await q("select payment_id from bookings where id = $1", [hid])).map((r) => r.payment_id);
    await db.query("update bookings set payment_id = null where id = $1", [hid]);
    await db.query("delete from payments where id = any($1::bigint[])", [pids.filter(Boolean)]);
    await db.query("delete from bookings where id = $1", [hid]);
  }
  {
    // 4/11 · Bloque 1: Mercado Pago "tarde" (como el real): la vuelta llega antes que el aviso del pago, con los
    // parámetros que agrega Mercado Pago. Turnos extra en "hold" de Ana, que se borran al final.
    const hb = (await q("select provider_id, service_id, starts_at, ends_at from bookings where client_id = (select id from auth.users where email='ana@test.ar') and status='confirmed' order by id limit 1"))[0];
    const hold = async (days) => {
      const id = (await q("insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, price, deposit, client_fee, hold_expires_at) values ($1, $2, (select id from auth.users where email='ana@test.ar'), 'Ana', 'Esmaltado semipermanente', 'app', 'hold', $3::timestamptz + make_interval(days => $5), $4::timestamptz + make_interval(days => $5), 12000, 6000, 1200, now() + interval '10 minutes') returning id",
        [hb.provider_id, hb.service_id, hb.starts_at, hb.ends_at, days]))[0].id;
      return { id: Number(id), tok: (await q("select checkout_open(array[$1]::bigint[], null) as t", [id]))[0].t };
    };
    const extra = [];
    const prefs = async () => (await (await fetch(BASE + "/__log")).json()).filter((x) => x.fn === "mp-create-preference");
    await fetch(BASE + "/__mp?modo=tarde");
    // (2) navegador con sesión: Volver a intentar → Mercado Pago → vuelta sin el pago todavía → confirmando → confirmado
    const h1 = await hold(9); extra.push(h1.id);
    await pg.goto(`${BASE}/turno/${h1.id}?pago=${h1.tok}&mp=failure`); await pg.waitForSelector("[data-act=payRetry]", { timeout: 8000 }).catch(() => {});
    await Promise.all([pg.waitForURL(/collection_id=/, { timeout: 8000 }).catch(() => {}), pg.click("[data-act=payRetry]")]);
    await pg.waitForFunction(() => /Estamos confirmando tu pago/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("4/11 navegador: la vuelta (con los parámetros de Mercado Pago) muestra “Estamos confirmando tu pago” en la pantalla del turno",
       /^\/turno\/\d+$/.test(new URL(pg.url()).pathname) && /Estamos confirmando tu pago/.test(await txt()), new URL(pg.url()).pathname + " " + (await txt()).slice(0, 120));
    await pg.waitForFunction(() => /Tenés turno/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 15000 }).catch(() => {});
    ok("4/11 navegador: …y pasa sola a “Tenés turno” cuando la consulta a Mercado Pago encuentra el pago",
       /Tenés turno/.test(await txt()) && (await q("select status from bookings where id = $1", [h1.id]))[0].status === "confirmed");
    ok("4/11 navegador: el cobro guardado se borra al confirmarse", (await pg.evaluate(() => localStorage.getItem("tt_cobro"))) === null);
    ok("4/11 navegador: en el navegador el cobro no lleva la marca de la app", (await prefs()).at(-1).body.app === false);
    // (3) la app instalada: Mercado Pago abre la vuelta en Safari (simulado: la app no la recibe); al volver a abrir la
    // app, sola: confirmando → confirmado. Contexto aparte, con la sesión de Ana, pantalla táctil y modo instalado.
    const actx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, storageState: await ctx.storageState() });
    await actx.addInitScript(() => Object.defineProperty(navigator, "standalone", { get: () => true }));
    const pa = await actx.newPage(); pa.on("pageerror", (e) => errs.push(e.message));
    const atxt = () => pa.locator("#app").innerText();
    let vuelta = null;
    await pa.route("**/turno/**", (route) => {
      const u = route.request().url();
      if (/[?&]app=1/.test(u) && /collection_id=/.test(u)) { vuelta = u; return route.fulfill({ contentType: "text/html", body: "<title>Mercado Pago</title><p>Pagando en Mercado Pago…</p>" }); }
      return route.continue();
    });
    const h2 = await hold(10); extra.push(h2.id);
    await pa.goto(`${BASE}/turno/${h2.id}?pago=${h2.tok}&mp=failure`); await pa.waitForSelector("[data-act=payRetry]", { timeout: 8000 }).catch(() => {});
    await Promise.all([pa.waitForURL(/collection_id=/, { timeout: 8000 }).catch(() => {}), pa.click("[data-act=payRetry]")]);
    await pa.waitForTimeout(300);
    const saved = await pa.evaluate(() => JSON.parse(localStorage.getItem("tt_cobro") || "null"));
    const lastPref = (await prefs()).at(-1);
    ok("4/11 app: antes de ir a Mercado Pago guarda el cobro (turno y token, nada personal) y lo marca como de la app",
       saved && saved.b === h2.id && /^[0-9a-f]{64}$/.test(saved.t) && Object.keys(saved).sort().join() === "at,b,t" && lastPref.body.app === true && !!vuelta, JSON.stringify([saved, lastPref.body]));
    ok("4/11 app: el turno sigue sin pagar mientras se paga en Mercado Pago", (await q("select status from bookings where id = $1", [h2.id]))[0].status === "hold");
    await pa.goto(BASE + "/");
    await pa.waitForFunction(() => /Estamos confirmando tu pago/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("4/11 app: al volver a abrir la app, va sola a su turno con “Estamos confirmando tu pago”",
       new URL(pa.url()).pathname === `/turno/${h2.id}` && /Estamos confirmando tu pago/.test(await atxt()), new URL(pa.url()).pathname + " " + (await atxt()).slice(0, 120));
    await pa.waitForFunction(() => /Tenés turno/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 15000 }).catch(() => {});
    ok("4/11 app: …y pasa sola a “Tenés turno” (consulta a Mercado Pago, sin depender de la vuelta)",
       /Tenés turno/.test(await atxt()) && (await q("select status from bookings where id = $1", [h2.id]))[0].status === "confirmed"
       && (await pa.evaluate(() => localStorage.getItem("tt_cobro"))) === null);
    // la vuelta que abrió Safari (sin la sesión de la app): "Pago recibido. Volvé a la app"
    const sctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const ps = await sctx.newPage(); ps.on("pageerror", (e) => errs.push(e.message));
    await ps.goto(vuelta); await ps.waitForSelector(".pay-back", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(400);
    const stxt = await ps.locator("#app").innerText().catch(() => "");
    ok("4/11 Safari: la vuelta con la marca de la app dice “Pago recibido · Volvé a la app TuTiempo para ver tu turno”, sin datos de la clienta",
       /Pago recibido/.test(stxt) && /Volvé a la app TuTiempo para ver tu turno/.test(stxt) && stxt.includes("Esmaltado semipermanente") && !/Ana/.test(stxt) && (await ps.locator("[data-act=payLogin]").count()) === 1, stxt.slice(0, 200));
    await sctx.close();
    // al volver a primer plano (visibilitychange) con un cobro abierto y sin pago: confirmando y, a los ~20 s,
    // "El pago no se completó · Volver a intentar"
    const h3 = await hold(11); extra.push(h3.id);
    await pa.goto(BASE + "/"); await pa.waitForSelector(".grid .card", { timeout: 8000 }).catch(() => {});
    await pa.evaluate(([t, id]) => localStorage.setItem("tt_cobro", JSON.stringify({ t, b: id, at: Date.now() })), [h3.tok, h3.id]);
    await pa.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await pa.waitForFunction(() => /Estamos confirmando tu pago/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("4/11 app: al volver a primer plano con un cobro abierto, “Estamos confirmando tu pago”", new URL(pa.url()).pathname === `/turno/${h3.id}` && /Estamos confirmando tu pago/.test(await atxt()));
    await pa.waitForSelector("[data-act=payRetry]", { timeout: 30000 }).catch(() => {});
    ok("4/11 app: …y si Mercado Pago no tiene el pago, “El pago no se completó” con “Volver a intentar”",
       /El pago no se completó/.test(await atxt()) && (await pa.locator("[data-act=payRetry]").count()) === 1 && (await q("select status from bookings where id = $1", [h3.id]))[0].status === "hold");
    // (4) deslizar hacia abajo para actualizar (solo en la app instalada) y "Actualizar" en el menú
    // (sin el cobro abierto de recién: al recargar, la app volvería a ese turno)
    await pa.evaluate(() => localStorage.removeItem("tt_cobro"));
    // (la barra la arma el arranque al final: se espera a que exista, si no el tirón llega antes que ella)
    await pa.goto(BASE + "/mis-turnos"); await pa.waitForSelector(".ptr", { state: "attached", timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(300);
    await pa.evaluate(() => { window.__antes = 1; });
    const pull = async (to, end) => pa.evaluate(([y, fin]) => {
      const t = (cy) => new Touch({ identifier: 1, target: document.body, clientX: 150, clientY: cy });
      document.body.dispatchEvent(new TouchEvent("touchstart", { touches: [t(120)], bubbles: true }));
      document.body.dispatchEvent(new TouchEvent("touchmove", { touches: [t(y)], bubbles: true }));
      const bar = document.querySelector(".ptr"); const out = { text: bar && bar.textContent, ready: !!bar && bar.classList.contains("ready") };
      if (fin) document.body.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
      return out;
    }, [to, end]);
    const poco = await pull(150, true);
    ok("4/11 deslizar: un tirón corto no actualiza", poco.text === "Deslizá para actualizar" && !poco.ready && (await pa.evaluate(() => window.__antes)) === 1);
    await Promise.all([pa.waitForEvent("load", { timeout: 8000 }).catch(() => {}), pull(260, true)]);
    await pa.waitForTimeout(600);
    ok("4/11 deslizar: tirando hasta “Soltá para actualizar” y soltando, la app recarga la misma pantalla",
       (await pa.evaluate(() => window.__antes)) === undefined && new URL(pa.url()).pathname === "/mis-turnos");
    await pa.click("nav .acct-btn"); await pa.waitForSelector("#acctMenu:not([hidden])");
    ok("4/11: en la app instalada, el menú de cuenta tiene “Actualizar”", (await pa.locator("#acctMenu [data-act=appReload]").count()) === 1);
    ok("4/11: en el navegador no (ni el gesto)", (await pg.locator("#acctMenu [data-act=appReload]").count()) === 0 && (await pg.locator(".ptr").count()) === 0);
    await actx.close();
    await fetch(BASE + "/__mp?modo=ya");
    // esos turnos extra no siguen: las pruebas de más abajo cuentan los turnos de Ana
    for (const id of extra) {
      await db.query("delete from mp_checkouts where $1 = any(booking_ids)", [id]);
      await db.query("delete from client_messages where ref = $1::text", [id]);
      await db.query("delete from payment_bookings where booking_id = $1", [id]);
      const pids = (await q("select payment_id from bookings where id = $1", [id])).map((r) => r.payment_id).filter(Boolean);
      await db.query("update bookings set payment_id = null where id = $1", [id]);
      await db.query("delete from payments where id = any($1::bigint[])", [pids]);
      await db.query("delete from bookings where id = $1", [id]);
    }
  }
  const bk = await q("select status, deposit, paid_mp, cashback from bookings where client_id = (select id from auth.users where email='ana@test.ar')");
  ok("en la base: confirmado, seña 30% (4/11) y sin cashback", bk.length === 1 && bk[0].status === "confirmed" && bk[0].deposit === 3600 && bk[0].paid_mp === 3600 && bk[0].cashback === 0);
  const bx = await q("select price, addons, intake, buffer_min, extract(epoch from busy_until - ends_at)::int gap, extract(epoch from ends_at - starts_at)::int dur from bookings where client_id = (select id from auth.users where email='ana@test.ar')");
  ok("en la base: precio del servicio y sin descanso (C39)", bx[0].price === 12000 && bx[0].addons.length === 0 && bx[0].buffer_min === 0 && bx[0].gap === 0 && bx[0].dur === 60 * 60);
  ok("sin saldo TuTiempo", (await q("select balance from wallets w join auth.users u on u.id=w.user_id where u.email='ana@test.ar'"))[0].balance === 0);
  // Bloque D: menú de cuenta con teclado y con el mouse
  await pg.focus("nav .acct-btn"); await pg.keyboard.press("Enter"); await wait(150);
  ok("Bloque D: Enter abre el menú de cuenta en la primera opción", await pg.evaluate(() => !document.getElementById("acctMenu").hidden && document.activeElement === document.querySelector("#acctMenu [role=menuitem]") && document.querySelector("nav .acct-btn").getAttribute("aria-expanded") === "true"));
  await pg.keyboard.press("ArrowDown"); await wait(80);
  ok("Bloque D: ↓ pasa a Mis turnos", await pg.evaluate(() => document.activeElement && document.activeElement.dataset.go === "misturnos"));
  await pg.keyboard.press("End"); await wait(80);
  ok("Bloque D: Fin va a Cerrar sesión", await pg.evaluate(() => document.activeElement && document.activeElement.dataset.act === "logout"));
  await pg.keyboard.press("Escape"); await wait(80);
  ok("Bloque D: Esc cierra y vuelve al botón", await pg.evaluate(() => document.getElementById("acctMenu").hidden && document.activeElement === document.querySelector("nav .acct-btn") && document.querySelector("nav .acct-btn").getAttribute("aria-expanded") === "false"));
  await pg.click("nav .acct-btn"); await wait(150); await pg.mouse.click(20, 400); await wait(150);
  ok("Bloque D: tocar afuera lo cierra", await pg.evaluate(() => document.getElementById("acctMenu").hidden));
  ok("Bloque D: el menú del cliente tiene Mi perfil, Mis turnos, Ajustes (4/11), Registrá tu negocio y Cerrar sesión (sin paneles)", await pg.evaluate(() => [...document.querySelectorAll("#acctMenu [role=menuitem]")].map((b) => b.dataset.go || b.dataset.act).join(",") === "cuenta,misturnos,ajustes,bizStart,logout"));
  await menu("[data-go=misturnos]");
  ok("mis turnos desde la base", (await pg.locator(".tcard").count()) >= 1 && (await txt()).includes("Sofía"));
  ok("mis turnos: confirmado sin pedir asistencia ni mostrar saldo", (await txt()).includes("Confirmado") && !(await txt()).includes("Confirmá tu asistencia") && !(await txt()).includes("Saldo"));
  // el mismo horario ya no se ofrece
  await pg.click("[data-go=home]"); await wait(); await pg.click(".segtile.seg-u"); await wait(); await pg.click(".grid .card [data-go=perfil]"); await pg.waitForSelector(".sgroup"); await wait();
  const [d, t] = slotTime.split(" ");
  await pg.evaluate((d) => { S.day = d; render() }, d); await wait(200);
  ok("el horario reservado ya no aparece libre", !(await pg.locator(`[data-slot="${t}"]`).count()));
  // segundo turno pagando en efectivo: se confirma sin pasar por Mercado Pago
  const fnBefore = (await (await fetch(BASE + "/__log")).json()).filter((x) => x.fn === "mp-create-preference").length;
  await pg.click(".sgroup.seg-d .svci"); await wait(200); await turnoConMargen(pg); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno"); await wait();
  await pg.click("[data-paym=cash]"); await wait(200);
  ok("resto en efectivo: igual paga la seña + comisión", /pagar \$/i.test(await pg.locator("#fTurno button[type=submit]").innerText()) && (await txt()).includes("Comisión TuTiempo"));
  await Promise.all([pg.waitForURL(/mp=success/).catch(() => {}), pg.click("#fTurno button[type=submit]")]); await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("seña pagada: turno confirmado, resto en efectivo", await pg.isVisible(".booked") && (await txt()).includes("Pagaste la seña") && (await txt()).includes("en efectivo en el local"));
  const bcash = await q("select status, deposit, paid_mp, pay_method from bookings where client_id = (select id from auth.users where email='ana@test.ar') and pay_method='cash'");
  const fnAfter = (await (await fetch(BASE + "/__log")).json()).filter((x) => x.fn === "mp-create-preference").length;
  ok("en la base: seña cobrada por Mercado Pago y resto en efectivo", bcash.length === 1 && bcash[0].status === "confirmed" && bcash[0].deposit > 0 && bcash[0].paid_mp === bcash[0].deposit && fnAfter === fnBefore + 1);
  // seguridad desde el navegador con la sesión de la clienta
  probing = true;
  const sec = await pg.evaluate(async () => {
    const r1 = await sb.from("provider_private").select("phone"); const r2 = await sb.from("bookings").select("id,client_id");
    const r3 = await sb.from("wallet_movements").insert({ user_id: S.user.id, kind: "adjust", amount: 99999 });
    const r4 = await sb.rpc("confirm_payment", { p_booking_ids: [1], p_payment_id: "x", p_amount: 1 });
    const r5 = await sb.from("providers").update({ status: "active" }).eq("id", 1);
    return { priv: (r1.data || []).length, mine: (r2.data || []).every((x) => x.client_id === S.user.id), w: !!r3.error, cp: !!r4.error, st: !!r5.error || (r5.data || []).length === 0 };
  });
  await wait(300); probing = false;
  ok("clienta no ve datos privados de prestadores", sec.priv === 0);
  ok("clienta solo ve sus turnos", sec.mine);
  ok("clienta no puede cargarse saldo", sec.w);
  ok("clienta no puede confirmar pagos", sec.cp);
  ok("clienta no puede tocar prestadores", sec.st);
  await pg.evaluate(() => { const b = BOOK.find((x) => x.id === S.turnoId); go("perfil", b ? b.pid : S.pid) }); await pg.waitForSelector(".pcard"); await wait();
  await pg.click("[data-act=seguir]"); await wait();
  ok("seguir guarda en la base", (await q("select count(*)::int c from follows"))[0].c === 1);
  // C06 (V8): al prestador le queda el aviso con el nombre de pila de quien lo sigue (y va por push)
  ok("C06: seguir le deja al prestador «Ana empezó a seguirte.»", (await q("select body from provider_notices where kind='new_follower'"))[0]?.body === "Ana empezó a seguirte."
     && (await q("select count(*)::int c from push_outbox where kind='new_follower'"))[0].c >= 0);
  await menu("[data-go=cuenta]");
  ok("4/11: mi perfil ya no muestra «Profesionales que seguís» (ni saldo) ni Seguridad", !(await txt()).includes("Profesionales que seguís") && !(await txt()).includes("Saldo TuTiempo") && !(await txt()).includes("Cambiar contraseña"));
  const PNG = { name: "foto.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAhQZKgAAZHwCArkOvB0AAAAASUVORK5CYII=", "base64") };
  await pg.setInputFiles("#upAv", PNG); await wait(1200);
  const av = await q("select p.avatar_path from profiles p join auth.users u on u.id=p.id where u.email='ana@test.ar'");
  ok("foto de la clienta guardada en su carpeta", !!av[0].avatar_path && av[0].avatar_path.startsWith((await q("select id::text from auth.users where email='ana@test.ar'"))[0].id + "/a-") && (await pg.locator("nav .avbtn img").count()) === 1);
  // Bloque 3: su reserva dejó el email de confirmación en la cola, y en Mi perfil apaga y prende los emails
  ok("Bloque 3: la reserva de la clienta dejó su email de confirmación en la cola", (await q("select count(*)::int c from email_outbox o join auth.users u on u.id = o.user_id where u.email = 'ana@test.ar' and o.kind = 'conf'"))[0].c >= 1);
  ok("Bloque 3: Mi perfil tiene la opción de avisos por email, prendida", await pg.isChecked("#uMail") && (await txt()).includes("Recordatorios y novedades por email"));
  await pg.uncheck("#uMail");
  ok("Bloque 3: apagarla queda en la base", await until("select p.email_notices from profiles p join auth.users u on u.id = p.id where u.email = 'ana@test.ar'", [], (r) => r[0].email_notices === false));
  await pg.evaluate(() => go("home")); await wait(); await menu("[data-go=cuenta]");
  ok("Bloque 3: …y al volver a Mi perfil sigue apagada", !(await pg.isChecked("#uMail")));
  await pg.check("#uMail");
  ok("Bloque 3: prenderla de nuevo también", await until("select p.email_notices from profiles p join auth.users u on u.id = p.id where u.email = 'ana@test.ar'", [], (r) => r[0].email_notices === true));
  await pg.click("#app [data-act=logout]"); await wait();

  // ---------- Prestadora ----------
  // el mismo ingreso que los clientes; desde cualquier página, la prestadora entra a su Agenda
  await pg.click("footer [data-act=authOpen]"); await wait();
  const BAD = "Email o contraseña incorrectos. Revisalos o recuperá tu contraseña.";
  probing = true; await pg.fill("#ai_e", "nadie.registrado@test.ar"); await pg.fill("#ai_p", "Cualquiera2026"); await pg.click("#fLogin button[type=submit]"); await wait(900);
  const badNoAccount = await pg.locator("#ai_p_err").innerText().catch(() => "");
  await pg.fill("#ai_e", "sofia@test.ar"); await pg.fill("#ai_p", "mal"); await pg.click("#fLogin button[type=submit]"); await wait(900); probing = false;
  ok("ingreso: el mismo mensaje si el email no tiene cuenta o si la contraseña está mal", badNoAccount.includes(BAD) && (await pg.locator("#ai_p_err").innerText()).includes(BAD), badNoAccount);
  await pg.fill("#ai_p", "prestador123"); await pg.click("#fLogin button[type=submit]"); await pg.waitForSelector(".bhead"); await wait();
  ok("ingreso: la prestadora entra a su Agenda, aunque abrió el ingreso desde el inicio", new URL(pg.url()).pathname === "/panel/agenda");
  ok("panel de Sofía con sus 3 rubros", (await pg.locator(".bhead .cchip").count()) === 3);
  await pg.evaluate((d) => { S.aday = d; render() }, d); await wait(300);
  ok("su agenda muestra la reserva de la app", (await pg.locator(".ev.app").count()) >= 1);
  // bloquear horario
  // en un día hábil sin turnos: el día de la reserva de Ana chocaba con ella si su primer turno libre caía a las 20:00
  const dBloq = await pg.evaluate(() => { for (let i = 9; ; i++) { const k = dkey(addDays(i)); if (![0, 6].includes(new Date(k + "T12:00:00").getDay())) return k } });
  await pg.evaluate((x) => { S.aday = x; render() }, dBloq); await wait(300);
  await pg.click("[data-act=blockOpen]"); await pg.fill("#bkf", "20:00"); await pg.fill("#bkt", "21:00"); await pg.click("#fBlock button[type=submit]"); await wait(600);
  ok("bloqueo guardado en la base", (await q("select count(*)::int c from bookings where source='block'"))[0].c === 1);
  await pg.evaluate((x) => { S.aday = x; render() }, d); await wait(300);
  // productos y gastos
  await pg.click("[data-btab=productos]"); await pg.click("[data-act=prodOpen]"); await pg.fill("#pnn", "Gel top coat"); await pg.fill("#pnp", "8000"); await pg.fill("#pns", "3");
  await pg.click("#fProd button[type=submit]"); await wait(600);
  ok("producto guardado", (await q("select stock from products where name='Gel top coat'"))[0]?.stock === 3);
  await pg.click("[data-act=buyOpen]"); await pg.fill("#bq", "6"); await pg.fill("#bc", "30000"); await pg.click("#fBuy button[type=submit]"); await wait(800);
  ok("compra suma stock y carga gasto", (await q("select stock from products where name='Gel top coat'"))[0].stock === 9 && (await q("select count(*)::int c from expenses where amount=30000"))[0].c === 1);
  // 7/11: «Editar» cambia nombre, precio de venta y de compra; la compra ya cargada no cambia
  await pg.click('.plist li:has-text("Gel top coat") [data-act=prodEdit]'); await wait(300);
  ok("7/11: «Editar» abre el producto con su nombre y su precio", (await pg.inputValue("#pen")) === "Gel top coat" && (await pg.inputValue("#pep")) === "8000");
  await pg.fill("#pen", "Gel top coat brillo"); await pg.fill("#pep", "9.500"); await pg.fill("#pec", "4000"); await pg.click("#fProdEdit button[type=submit]");
  ok("7/11: se guardan el nombre, el precio de venta y el de compra",
     await until("select name, price, cost from products where id = (select id from products where name ilike 'Gel top coat%')", [], (r) => r[0]?.name === "Gel top coat brillo" && r[0].price === 9500 && r[0].cost === 4000));
  ok("7/11: …y la compra ya cargada sigue igual", (await q("select count(*)::int c from expenses where amount=30000"))[0].c === 1 && /Gel top coat brillo/.test(await txt()));
  await wait(700);
  await pg.click('.plist li:has-text("Gel top coat brillo") [data-act=prodEdit]'); await wait(300);
  await pg.fill("#pen", "Gel top coat"); await pg.fill("#pep", "8000"); await pg.fill("#pec", ""); await pg.click("#fProdEdit button[type=submit]");
  ok("7/11: …y se puede volver atrás (sin precio de compra)", await until("select name, price, cost from products where name = 'Gel top coat'", [], (r) => r[0]?.price === 8000 && r[0].cost === null));
  // H08: montos enteros en pesos: "8000,50" se rechaza (antes se guardaba 800.050) y "8.000" es $8.000
  await pg.click("[data-act=prodOpen]"); await pg.fill("#pnn", "Gel caro"); await pg.fill("#pnp", "8000,50"); await pg.click("#fProd button[type=submit]"); await wait(400);
  ok("H08: un precio con centavos se rechaza con un mensaje claro", /sin centavos/.test(await pg.locator("#perr2").innerText()) && (await q("select count(*)::int c from products where name='Gel caro'"))[0].c === 0);
  await wait(700);   // la app ignora un segundo envío del mismo formulario en menos de medio segundo
  await pg.fill("#pnp", "8.000"); await pg.click("#fProd button[type=submit]");
  ok("H08: 8.000 se guarda como $8.000", await until("select price from products where name='Gel caro'", [], (r) => r[0]?.price === 8000));
  // C35 (V4): eliminar un producto, con aviso antes
  await pg.click('.plist li:has-text("Gel caro") [data-act=prodDel]'); await wait(200);
  ok("C35: antes de eliminar avisa que las ventas quedan", /Las ventas y compras que ya cargaste quedan/.test(await pg.locator(".plist .movask").innerText()) && (await q("select count(*)::int c from products where name='Gel caro'"))[0].c === 1);
  await pg.click("[data-act=prodDelYes]"); await wait(700);
  ok("C35: el producto se elimina", (await q("select count(*)::int c from products where name='Gel caro'"))[0].c === 0 && !(await txt()).includes("Gel caro"));
  // C34 (V4): la Caja está en Finanzas, como "Caja del día"; la pestaña Caja salió
  ok("C34: el panel ya no tiene la pestaña Caja", (await pg.locator("[data-btab=caja]").count()) === 0);
  await pg.click("[data-btab=finanzas]"); await wait(300);
  await pg.click("[data-act=walkOpen]"); await pg.fill("#wpr", "7000"); await pg.click("#fWalk button[type=submit]"); await wait(600);
  ok("servicio sin turno guardado desde la Caja del día", (await q("select count(*)::int c from walkins"))[0].c === 1);
  // C25 (V4): Transferencia como medio; editar y borrar un movimiento
  await wait(300); await pg.click("[data-act=walkOpen]"); await pg.fill("#wpr", "4000"); await pg.click('[data-medio="Transferencia"]'); await pg.click("#fWalk button[type=submit]"); await wait(700);
  ok("C25: lo cobrado por transferencia queda así en la base y en la caja", (await q("select count(*)::int c from walkins where method='transfer' and amount=4000"))[0].c === 1 && (await txt()).includes("Transferencia"));
  await pg.click('.movs li:has-text("$4.000") [data-act=movEdit]'); await wait(200);
  await pg.fill("#wed_m", "4500"); await pg.click('#fWalkEd [data-medio="Efectivo"]'); await pg.click("#fWalkEd button[type=submit]"); await wait(800);
  ok("C25: editar un movimiento cambia monto y medio en la base", (await q("select count(*)::int c from walkins where method='cash' and amount=4500"))[0].c === 1 && (await q("select count(*)::int c from walkins where amount=4000"))[0].c === 0);
  await pg.click('.movs li:has-text("$4.500") [data-act=movDel]'); await wait(200);
  ok("C25: borrar pide confirmación", (await pg.locator(".movs .movask").innerText()).includes("¿Borrar"));
  await pg.click("[data-act=movDelYes]"); await wait(800);
  ok("C25: borrar un movimiento lo saca de la base y de la caja", (await q("select count(*)::int c from walkins where amount=4500"))[0].c === 0 && !(await txt()).includes("$4.500"));
  // cierre de caja del día
  ok("finanzas: caja del día con lo que entró hoy (sin balance de 7 días)", (await txt()).includes("$7.000") && (await pg.locator("[data-fp=semana]").count()) === 0);
  await pg.fill("#cdCount", "7500"); await pg.click("#fCloseDay button[type=submit]"); await wait(900);
  const cc = await q("select kind, income, cash, counted from cash_closings");
  ok("caja del día cerrada en la base (y te sobran $500)", cc.length === 1 && cc[0].kind === "day" && cc[0].income === 7000 && cc[0].cash === 7000 && cc[0].counted === 7500 && /te sobran \$500/i.test(await txt()));
  await pg.click("[data-fp=mes]"); await wait(300); await pg.fill("#gc", "Alquiler"); await pg.fill("#gm", "150000"); await pg.click("#fGasto button[type=submit]"); await wait(800);
  ok("gasto del mes cargado una vez (sin categoría ni compras de productos)", (await q("select count(*)::int c from expenses where concept='Alquiler' and amount=150000"))[0].c === 1 && (await pg.locator("#gprod").count()) === 0);
  const msum = await pg.evaluate(() => (document.querySelector(".msum") || {}).textContent || "");
  ok("C33: el resumen del mes separa ingresos por origen y gastos fijos y de productos", /Resumen de [A-ZÁÉÍÓÚ]/.test(msum) && msum.includes("Sin turno") && msum.includes("Gastos fijos") && msum.includes("$150.000") && /Balance: /.test(msum), msum);
  ok("C32: los meses van con mayúscula y el balance negativo en rojo", /Balance de [A-ZÁÉÍÓÚ]/.test(await pg.locator(".kpi.big").innerText()) && (await pg.locator(".msum .mbal.neg").count()) === 1);
  // C31 (V4 resto): gastos fijos precargados, sin monto; se cargan con ✎ y se repiten solos
  {
    const sofiP = (await q("select id from providers where name like 'Sofía%'"))[0].id;
    ok("C31: precargados alquiler, luz, gas, internet y monotributo (sin monto)", (await q("select count(*)::int c from fixed_expenses where provider_id=$1", [sofiP]))[0].c === 5
       && /Gastos fijos/.test(await txt()) && /Monotributo/.test(await txt()) && /Sin monto: tocá\s*para cargarlo/.test(await txt()));
    const luz = (await q("select id from fixed_expenses where provider_id=$1 and concept='Luz'", [sofiP]))[0].id;
    await pg.click(`[data-act=fxEdit][data-id="${luz}"]`); await wait(200);
    await pg.fill("#fxm", "25000"); await pg.click("#fFixed button[type=submit]");
    ok("C31: el monto de la luz queda como gasto de este mes (desde este mes en adelante)", await until("select amount from expenses where fixed_id=$1", [luz], (r) => r.length === 1 && r[0].amount === 25000)
       && (await q("select amount from fixed_expenses where id=$1", [luz]))[0].amount === 25000);
    await wait(400);
    ok("C31: …y se ve en Gastos fijos con el total", /Gastos fijos · \$25\.000/i.test(await txt()));
    await pg.click("[data-act=fxNew]"); await wait(200);
    await pg.fill("#fxc", "Seguro del local"); await pg.fill("#fxm", "9000"); await pg.click("#fFixed button[type=submit]");
    const seg = await until("select e.amount from expenses e join fixed_expenses f on f.id=e.fixed_id where f.concept='Seguro del local'", [], (r) => r.length === 1 && r[0].amount === 9000);
    ok("C31: un gasto fijo nuevo entra este mes", seg);
    await wait(400);
    const segId = (await q("select id from fixed_expenses where concept='Seguro del local'"))[0].id;
    await pg.click(`[data-act=fxEdit][data-id="${segId}"]`); await wait(200); await pg.click("[data-act=fxStop]");
    ok("C31: «Dejar de repetirlo desde este mes» lo saca", await until("select count(*)::int c from expenses where fixed_id=$1", [segId], (r) => r[0].c === 0));
    await wait(400);
    // S17 (8/11): un mes pasado se ve sin ✎ (se cambian desde el mes actual en adelante)
    await pg.click('.wnav [data-fm="-1"]'); await wait(300);
    ok("S17: en un mes pasado los gastos fijos no se editan", (await pg.locator("[data-act=fxEdit]").count()) === 0 && (await pg.locator("[data-act=fxNew]").count()) === 0
       && /Los gastos fijos se cambian desde el mes actual en adelante/.test(await txt()));
    await pg.click('.wnav [data-fm="1"]'); await wait(300);
  }
  await pg.click("[data-act=closeMonth]"); await wait(800);
  ok("mes cerrado en la base", (await q("select count(*)::int c from cash_closings where kind='month'"))[0].c === 1);
  ok("C31: con el mes cerrado, los gastos fijos de ese mes no se editan", (await pg.locator("[data-act=fxEdit]").count()) === 0 && /Mes cerrado: los gastos fijos de este mes quedan como están/.test(await txt()));
  // V4b · C25 "Cargar diferencia": al marcar "Asistió", el resto en dos medios; después se cambia desde la Caja del día
  {
    const [sv] = await q("select s.id, s.provider_id from services s join providers p on p.id=s.provider_id where p.name like 'Sofía%' and s.active order by s.id limit 1");
    const hoyBA = (await q("select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d"))[0].d;
    const [bd] = await q("insert into bookings (provider_id, service_id, client_name, service_name, source, status, starts_at, ends_at, price) values ($1,$2,'Diferencia','Corte','manual','confirmed',($3||' 07:00')::timestamp at time zone 'America/Argentina/Buenos_Aires',($3||' 07:30')::timestamp at time zone 'America/Argentina/Buenos_Aires',5000) returning id", [sv.provider_id, sv.id, hoyBA]);
    await pg.reload(); await wait(1500);
    await pg.click("[data-btab=agenda]"); await wait(300);
    await pg.evaluate((x) => { S.aday = x; S.sel = null; render() }, hoyBA); await wait(300);
    await pg.click(`.ev[data-sel="${bd.id}"]`); await wait(200);
    await pg.click(`[data-act=bDone][data-id="${bd.id}"]`); await wait(700);
    ok("V4b: al marcar «Asistió» pregunta cómo te pagó el resto", /¿Cómo te pagó el resto\? · \$5\.000/.test(await pg.locator(".detail .restbox").innerText()));
    await pg.click(".restbox [data-act=restSplitOn]"); await wait(200);
    await pg.fill("#rs_a1", "3000"); await wait(100);
    ok("V4b: al escribir el primer monto, el segundo se completa con lo que falta", (await pg.inputValue("#rs_a2")) === "2000" && /justo el resto/.test(await pg.locator("#rs_left").innerText()));
    await pg.fill("#rs_a2", "2500"); await pg.click("#fRest button[type=submit]"); await wait(300);
    ok("V4b: si suman más que el resto avisa y no guarda", /no puede pasar del resto/.test(await pg.locator("#rserr").innerText()) && (await q("select rest_parts from bookings where id=$1", [bd.id]))[0].rest_parts === null);
    await pg.fill("#rs_a2", "2000"); await wait(600); await pg.click("#fRest button[type=submit]");
    ok("V4b: $3.000 efectivo + $2.000 transferencia quedan en la base", await until("select rest_parts from bookings where id=$1", [bd.id],
       (r) => JSON.stringify((r[0]?.rest_parts || []).map((x) => [x.method, x.amount])) === JSON.stringify([["cash", 3000], ["transfer", 2000]])));
    ok("V4b: la Agenda muestra el resto en los dos medios", /Resto: .*\$3\.000 en Efectivo \+ .*\$2\.000 en Transferencia/.test(await pg.locator(".detail .restbox").innerText()));
    await pg.click("[data-btab=finanzas]"); await wait(300); await pg.click("[data-fp=dia]"); await wait(300);
    const kpiT = async (medio) => pg.evaluate((m) => [...document.querySelectorAll(".kpis .kpi")].find((k) => k.textContent.includes(m))?.querySelector("b")?.textContent, medio);
    ok("V4b: en la Caja del día cada parte cuenta en su medio", (await pg.locator('.movs li:has-text("Diferencia")').count()) === 2
       && (await kpiT("Transferencia")) === "$2.000" && (await kpiT("Efectivo")) === "$10.000", `${await kpiT("Transferencia")} · ${await kpiT("Efectivo")}`);
    await pg.click('.movs li:has-text("Diferencia") >> nth=1 >> [data-act=movEdit]'); await wait(200);
    await pg.click(".movs [data-act=restSplitOn]"); await wait(200);
    ok("V4b: desde Finanzas se abre con lo que estaba cargado", (await pg.inputValue("#rs_a1")) === "3000" && (await pg.inputValue("#rs_a2")) === "2000");
    await pg.fill("#rs_a2", "1000"); await wait(600); await pg.click("#fRest button[type=submit]");
    ok("V4b: si suman menos, se guarda y lo que falta queda sin cobrar", await until("select rest_parts from bookings where id=$1", [bd.id], (r) => r[0]?.rest_parts?.[1]?.amount === 1000)
       && /Sin cobrar · Diferencia/.test(await txt()) && (await kpiT("Transferencia")) === "$1.000");
    await pg.click('.movs li:has-text("Diferencia") >> nth=0 >> [data-act=movEdit]'); await wait(200);
    await pg.click('.movs [data-act=restMedio][data-m="Transferencia"]'); await wait(800);
    ok("V4b: un solo medio vuelve al resto entero (sin partes)", (await q("select rest_parts, rest_method from bookings where id=$1", [bd.id]))[0].rest_method === "transfer"
       && (await q("select rest_parts from bookings where id=$1", [bd.id]))[0].rest_parts === null && !/Sin cobrar · Diferencia/.test(await txt()));
    // C30 (V4 resto): antes de cerrar el día, lo pendiente: turnos de hoy sin marcar y cobros sin medio de pago (el
    // turno es a las 00:00 para que siempre haya empezado, corra a la hora que corra la prueba). Se cuentan los pendientes
    // que ya había (otro turno de hoy de esta prueba puede haber empezado). Sin esperas fijas: en el CI, la caja reabierta
    // y el panel tardaban más que los 600 ms de antes (falló dos veces)
    const openDay = async () => {
      await pg.click("[data-btab=finanzas]"); await pg.waitForSelector("[data-fp=dia]"); await pg.click("[data-fp=dia]");
      await pg.waitForSelector("#fCloseDay, [data-act=reopenDay]", { timeout: 8000 });
      if (await pg.locator("[data-act=reopenDay]").count()) { await pg.click("[data-act=reopenDay]"); await pg.waitForSelector("#fCloseDay", { timeout: 8000 }); }
      await wait(300);
    };
    await pg.reload(); await wait(1500);
    await openDay();
    const pend0 = +((await pg.locator(".pendday .lbl").innerText().catch(() => "")).match(/(\d+) pendiente/) || [0, 0])[1];
    await q("insert into bookings (provider_id, service_id, client_name, service_name, source, status, starts_at, ends_at, price) values ($1,$2,'Pendiente C30','Corte','manual','confirmed',($3||' 00:00')::timestamp at time zone 'America/Argentina/Buenos_Aires',($3||' 00:30')::timestamp at time zone 'America/Argentina/Buenos_Aires',4000)", [sv.provider_id, sv.id, hoyBA]);
    await pg.reload(); await wait(1500);
    await openDay();
    await pg.waitForFunction((n) => new RegExp(`Antes de cerrar · ${n} pendiente`, "i").test(document.querySelector("#app")?.innerText || ""), pend0 + 1, { timeout: 8000 }).catch(() => {});
    ok("C30: antes de cerrar avisa el turno de hoy sin marcar", new RegExp(`Antes de cerrar · ${pend0 + 1} pendiente`, "i").test(await txt()) && (await pg.locator('.pendday li:has-text("Pendiente C30") [data-act=bDone]').count()) === 1
       && /Cerrar igual/.test(await pg.locator("#fCloseDay").innerText().catch(() => "")),
       JSON.stringify({ pend0, pend: await pg.locator(".pendday").innerText().catch(() => "(sin panel)"), cierre: await pg.locator("#fCloseDay, .cclosed").first().innerText().catch(() => "(sin cierre)") }));
    await pg.click('.pendday li:has-text("Pendiente C30") [data-act=bDone]');
    await pg.waitForFunction(() => /¿Cómo te pagó \$4\.000\?/.test(document.querySelector(".pendday")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("C30: «Vino» lo marca y pasa a pedir con qué pagó", (await until("select status from bookings where client_name='Pendiente C30'", [], (r) => r[0]?.status === "done"))
       && /¿Cómo te pagó \$4\.000\?/.test(await pg.locator(".pendday").innerText()));
    await pg.click('.pendday li:has-text("Pendiente C30") [data-act=restMedio][data-m="Efectivo"]');
    await pg.waitForFunction(() => !/Pendiente C30/.test(document.querySelector(".pendday")?.innerText || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
    ok("C30: con el medio anotado no queda nada pendiente y el botón vuelve a «Cerrar la caja»", (await until("select rest_method from bookings where client_name='Pendiente C30'", [], (r) => r[0]?.rest_method === "cash"))
       && (pend0 ? (await pg.locator('.pendday li:has-text("Pendiente C30")').count()) === 0 && /Cerrar igual/.test(await pg.locator("#fCloseDay").innerText())
                 : (await pg.locator(".pendday").count()) === 0 && /Cerrar la caja ·/.test(await pg.locator("#fCloseDay").innerText())));
    // C36 (V4 resto): precio de compra y "Vendí uno" desde Productos, que entra en la Caja del día
    await pg.click("[data-btab=productos]"); await wait(300);
    await pg.click("[data-act=prodOpen]"); await pg.fill("#pnn", "Cera C36"); await pg.fill("#pnp", "8000"); await pg.fill("#pnc", "4500"); await pg.fill("#pns", "2");
    await pg.click("#fProd button[type=submit]");
    ok("C36: el producto guarda el precio de compra y muestra lo que ganás", await until("select cost from products where name='Cera C36'", [], (r) => r[0]?.cost === 4500) && /compra \$4\.500 · ganás \$3\.500/.test(await txt()));
    // 4/11 · Bloque 4: el stock inicial (2 × $4.500) entra en los gastos de productos del mes, ligado al producto
    ok("4/11: el stock inicial suma a Gastos de productos (stock × precio de compra)",
       await until("select e.amount, e.category, e.qty, e.product_id = p.id same from expenses e join products p on p.name = 'Cera C36' where e.concept like 'Stock inicial: Cera C36%'", [],
                   (r) => r.length === 1 && r[0].amount === 9000 && r[0].category === "Productos" && r[0].qty === 2 && r[0].same === true));
    ok("4/11: Productos ya no tiene «Vendí uno» (las ventas se cargan en Finanzas)", (await pg.locator("[data-act=prodSell]").count()) === 0 && !/Vendí uno/.test(await txt()));
    // 7/11: la venta tiene su propio botón en la Caja del día (producto, cantidad y medio); "Servicio sin turno" es solo servicios
    await pg.click("[data-btab=finanzas]"); await wait(300); await pg.click("[data-fp=dia]"); await wait(300);
    await pg.click("[data-act=walkOpen]"); await wait(200);
    ok("7/11: «Servicio sin turno» ya no ofrece productos", !(await pg.evaluate(() => [...document.querySelectorAll("#wsv option")].some((o) => /Cera C36/.test(o.textContent)))) && (await pg.locator("#wqty").count()) === 0);
    await pg.click("[data-act=walkClose]"); await wait(200);
    await pg.click("[data-act=saleOpen]"); await wait(200);
    const pv36 = await pg.evaluate(() => [...document.querySelectorAll("#spr option")].find((o) => /Cera C36/.test(o.textContent))?.value);
    await pg.selectOption("#spr", pv36); await wait(150);
    ok("7/11: «Vender producto» pide el producto y la cantidad (1) y muestra el total ($8.000)", (await pg.inputValue("#sqty")) === "1" && (await pg.locator("#stot").innerText()) === "$8.000");
    await pg.fill("#sqty", "2"); await pg.dispatchEvent("#sqty", "input"); await wait(100);
    ok("7/11: …con 2, el total es $16.000", (await pg.locator("#stot").innerText()) === "$16.000");
    await pg.click('#fSale [data-medio="Transferencia"]'); await pg.click("#fSale button[type=submit]");
    ok("4/11: la venta de 2 queda en la caja con su cantidad y descuenta 2 del stock", await until("select amount, method, qty from walkins where kind='product' and description='Cera C36 × 2'", [], (r) => r.length === 1 && r[0].amount === 16000 && r[0].method === "transfer" && r[0].qty === 2)
       && await until("select stock from products where name='Cera C36'", [], (r) => r[0].stock === 0));
    ok("C36: …y se ve en los movimientos de hoy", (await pg.locator('.movs li:has-text("Cera C36 × 2")').count()) === 1);
  }
  // rubros y servicios: sumar Masajes
  await pg.click("[data-btab=perfil]"); await wait(300);
  await pg.check("#rc-m", { force: true }); await wait(200); await pg.click("[data-act=svcAdd]"); await wait(200);
  const n = await pg.locator(".svcrow3").count();
  await pg.fill(`#sn${n - 1}`, "Masaje relajante"); await pg.fill(`#sd${n - 1}`, "50"); await pg.fill(`#sp${n - 1}`, "17000"); await pg.selectOption(`#sc${n - 1}`, "m");
  await pg.click("#fDatos button[type=submit]");
  // espera a que el guardado llegue a la base (hasta 6 s) en lugar de un tiempo fijo: en el CI a veces tarda más de 1,5 s
  ok("nuevo rubro y servicio en la base",
    await until("select count(*)::int c from provider_categories pc join providers p on p.id=pc.provider_id where p.name like 'Sofía%' and pc.category_id='m'", [], (r) => r[0].c === 1)
    && await until("select count(*)::int c from services where name='Masaje relajante'", [], (r) => r[0].c === 1));
  await wait(300);
  // horarios
  await pg.click("[data-btab=horarios]"); await wait(300);
  ok("C39/D31: Horarios sin 'Descanso entre turnos' ni 'Cada cuánto empieza un turno', con la regla explicada",
     (await pg.locator("#hbuf, #hst").count()) === 0 && /se suceden según lo que dura el servicio/.test(await pg.locator("#fHorarios").innerText()));
  // C37 (V3b): sin botón Guardar; cada cambio se guarda solo
  await pg.selectOption("#hno", "120"); await wait(1400);
  ok("C37: Horarios se guarda solo al cambiar, sin botón Guardar", (await pg.locator("#fHorarios button[type=submit]").count()) === 0
     && (await q("select notice_min, buffer_min from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'"))[0].notice_min === 120
     && /Cambios guardados · \d\d:\d\d h/.test(await pg.locator("#hSaved").innerText()));
  // 4/11 · Bloque 4: la seña fija del 30% se muestra (sin elegir) y el plazo de Mercado Pago lo elige el profesional
  ok("4/11: Horarios muestra la seña fija del 30% (sin el selector de seña ni «El total»)", (await pg.locator("#hpay").count()) === 0 && /Seña: 30% del servicio/.test(await pg.locator("#fHorarios").innerText()));
  ok("4/11: Horarios tiene el acceso a «Bloquear días o semanas» arriba, antes de los horarios",
     await pg.evaluate(() => { const a = document.querySelector("[data-act=toDayBlock]"); const d = document.querySelector(".hdays"); return !!a && !!d && !!(a.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  // 9/11: el plazo de Mercado Pago salió de Horarios (estaba al final y no se encontraba): Horarios lleva a Perfil
  ok("9/11: Horarios ya no tiene el plazo de Mercado Pago y dice dónde está", (await pg.locator("#fHorarios .termpick").count()) === 0
     && (await pg.locator("#fHorarios [data-act=toPanel][data-tab=perfil]").innerText()).includes("Cobros con Mercado Pago"));
  await pg.click("#fHorarios [data-act=toPanel][data-tab=perfil]"); await wait(500);
  const cobros = await pg.locator(".panel.mpcobros").innerText().catch(() => "");
  ok("9/11: Perfil → «Cobros con Mercado Pago», con los 4 plazos y el % de cada uno (la tabla del admin)",
     /Cobros con Mercado Pago/i.test(cobros) && (await pg.locator('.mpcobros input[name="pterm"]').count()) === 4
     && /Al instante[\s\S]*%[\s\S]*10 días[\s\S]*%[\s\S]*18 días[\s\S]*%[\s\S]*35 días[\s\S]*%/.test(cobros), cobros);
  await pg.click('.mpcobros label.termopt:has(input[value="d10"])'); await wait(1400);
  ok("9/11: elegir «10 días» en Perfil se guarda solo (y la seña sigue en 30%)",
     (await until("select payout_term, deposit_pct from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'", [], (r) => r[0].payout_term === "d10" && r[0].deposit_pct === 30))
     && /plazo de Mercado Pago guardado/.test(await pg.locator(".toast").innerText().catch(() => "")));
  await pg.click("[data-btab=horarios]"); await wait(400);
  await pg.click("[data-act=toDayBlock]"); await wait(600);
  ok("4/11: «Bloquear días o semanas» lleva al formulario de bloqueo", await pg.evaluate(() => { const r = document.querySelector("#fDayBlock").getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }));
  await db.query("update provider_settings set payout_term = 'instant' where provider_id = (select id from providers where name like 'Sofía%')");
  // 4/11 · Bloque 4: agendar a mano desde la ficha del cliente, eligiendo el día (no solo hoy)
  {
    await pg.click("[data-btab=clientes]"); await wait(300);
    await pg.click('.clist [data-cli]'); await wait(300);
    const who = await pg.evaluate(() => S.cli);
    await pg.click("[data-act=cliAgendar]"); await wait(400);
    const target = await pg.evaluate(() => {
      for (let off = 2; off < 12; off++) { const d = dkey(addDays(off)); if (slotsFor(S.me, d, pr(S.me).svcs[0][1]).list.some((x) => x.free)) return d; }
      return null;
    });
    await pg.fill("#mday", target); await pg.dispatchEvent("#mday", "change"); await wait(400);
    ok("4/11: agendar desde la ficha deja elegir el día y conserva el cliente", (await pg.inputValue("#mday")) === target && (await pg.inputValue("#mcl")) === who && (await pg.locator("#fManual .lbl").innerText()).length > 0);
    const hr = await pg.inputValue("#mhr");
    await pg.click("#fManual button[type=submit]");
    ok("4/11: el turno agendado a mano queda ese día en la base",
       await until("select count(*)::int c from bookings b join providers p on p.id=b.provider_id where p.name like 'Sofía%' and b.source='manual' and b.client_name=$1 and to_char(b.starts_at at time zone 'America/Argentina/Buenos_Aires','YYYY-MM-DD HH24:MI')=$2", [who, target + " " + hr], (r) => r[0].c === 1));
    await pg.click("[data-btab=horarios]"); await wait(300);
  }
  await db.query("update provider_settings set notice_min = 0 where provider_id = (select id from providers where name like 'Sofía%')");
  // un día abierto dentro de 3 a 4 semanas (lejos de los turnos de la prueba) para el happy hour y la agenda
  const hhSel = "select happy_on, happy_pct, happy_days, happy_from::text f, happy_to::text t from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'";
  const hhBefore = (await q(hhSel))[0];
  const hDay = await pg.evaluate(() => {
    for (let off = 22; off < 31; off++) {
      const d = dkey(addDays(off)); const dow = new Date(d + "T12:00:00").getDay(); const dc = cfg(S.me).days[dow];
      if (dc.on && dc.m.on) return { d, dow, from: dc.m.from };
    }
    return null;
  });
  const hFrom = hDay.from; const hTo = String(+hFrom.slice(0, 2) + 2).padStart(2, "0") + hFrom.slice(2);
  // con error (termina antes de empezar): lo marca y no guarda
  await pg.check("#hhon"); await pg.fill("#hhf", hTo); await pg.fill("#hht", hFrom); await pg.dispatchEvent("#hht", "change"); await wait(1400);
  ok("C37: si algo no cierra lo marca al lado y no guarda", (await pg.locator("#herr-hh").innerText()).includes("terminar después de empezar")
     && (await pg.locator("#hSaved").innerText()).includes("No se guardó") && (await q(hhSel))[0].f === hhBefore.f);
  await pg.fill("#hhf", hFrom); await pg.fill("#hht", hTo);
  for (const dow of [0, 1, 2, 3, 4, 5, 6]) { if ((dow === hDay.dow) !== (await pg.isChecked("#hhd" + dow))) await pg.click(`label:has(#hhd${dow})`); }
  await pg.dispatchEvent("#hht", "change"); await wait(1400);
  const hhNow = (await q(hhSel))[0];
  ok("C37: corregido, se guarda solo", hhNow.happy_on === true && hhNow.f.startsWith(hFrom) && hhNow.t.startsWith(hTo) && JSON.stringify(hhNow.happy_days) === JSON.stringify([hDay.dow]));
  ok("C38: el día con happy hour lo muestra en Horarios", (await pg.locator(".hhchip").count()) === 1 && (await pg.locator(".hhchip").innerText()).includes(`${hFrom}–${hTo}`));
  // C38: y en la Agenda de ese día, como una franja
  await pg.click("[data-btab=agenda]"); await wait(300);
  await pg.evaluate((d) => { S.aday = d; render(); }, hDay.d); await wait(300);
  ok("C38: la Agenda marca la franja del happy hour", (await pg.locator(".tl .tl-hh").count()) === 1 && (await pg.locator(".tl-top").innerText()).includes(`Happy hour ${hFrom}–${hTo}`));
  // C22 (V3b): la Agenda se pone al día sola (cada 30 s y al volver a la pestaña) con lo que cambió en la base
  const seen = () => pg.locator(".tl").innerText().then((t) => t.includes("Llegó Solo"));
  const showUp = () => pg.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))).then(() => wait(1500));
  const newBk = (await q("insert into bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at) select p.id, 'Llegó Solo', 'Corte', 'manual', 'confirmed', ($1::date + $2::time) at time zone 'America/Argentina/Buenos_Aires', ($1::date + $2::time + interval '30 minutes') at time zone 'America/Argentina/Buenos_Aires' from providers p where p.name like 'Sofía%' returning id", [hDay.d, hFrom]))[0].id;
  ok("C22: un turno nuevo no aparece sin que la Agenda se actualice", !(await seen()));
  await pg.click("[data-act=manOpen]"); await wait(200); await showUp();
  ok("C22: con el formulario de turno manual abierto no se toca la pantalla", !(await seen()) && (await pg.locator("[data-act=manClose], #fMan").count()) > 0);
  await pg.evaluate(() => { S.manOpen = false; render(); }); await showUp();
  ok("C22: al volver a la pestaña aparece el turno nuevo", await seen());
  await q("delete from bookings where id = $1", [newBk]);
  await showUp();
  ok("C22: y desaparece el que se borró", !(await seen()));
  await db.query("update provider_settings ps set happy_on=$1, happy_pct=$2, happy_days=$3, happy_from=$4, happy_to=$5 from providers p where p.id=ps.provider_id and p.name like 'Sofía%'", [hhBefore.happy_on, hhBefore.happy_pct, hhBefore.happy_days, hhBefore.f, hhBefore.t]);
  await pg.evaluate(async () => { await api.loadMine(); S.btab = "horarios"; render(); }); await wait(300);
  // bloquear una semana (vacaciones)
  const wk0 = await pg.evaluate(() => dkey(addDays(20)));
  await pg.fill("#dbf", wk0); await pg.click("[data-act=dbQuick][data-d='6']"); await wait(200); await pg.click("#fDayBlock button[type=submit]"); await wait(1500);
  const blk = await q("select count(*)::int c from bookings b join providers p on p.id=b.provider_id where p.name like 'Sofía%' and b.source='block' and b.service_name like '🏖️%'");
  ok("semana de vacaciones bloqueada en la base", blk[0].c >= 5 && /próximos días bloqueados/i.test(await txt()));
  const pubBusy = await q("select count(*)::int c from provider_busy((select id from providers where name like 'Sofía%'), $1::date, $1::date)", [wk0]);
  ok("esos días figuran ocupados para los clientes", pubBusy[0].c >= 1 || (await pg.evaluate((d) => !ranges(cfg(S.me), new Date(d + "T12:00:00").getDay()).length, wk0)));
  // foto del prestador
  await pg.click("[data-btab=perfil]"); await wait(300); await pg.setInputFiles("#upPhoto", PNG); await wait(1200);
  ok("foto del prestador guardada", ((await q("select photo_path from providers where name like 'Sofía%'"))[0].photo_path || "").startsWith("11111111-1111-1111-1111-111111111111/p-"));
  await pg.click("[data-act=cashToggle]"); await wait(600);
  ok("prestador apaga el efectivo", (await q("select cash_ok from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'"))[0].cash_ok === false);
  await pg.click("[data-act=cashToggle]"); await wait(600);
  // C28 (V5): el pedido de reseña ya no está en el panel (sale solo, siempre)
  ok("C28: los avisos automáticos del panel no tienen el pedido de reseña", !/Pedido de reseña/.test(await txt()) && /El pedido de reseña también sale solo/.test(await txt()));
  // C26 (V5): ponerle nombre a un trabajo y borrarlo con confirmación
  {
    await pg.click("[data-btab=comunidad]"); await wait(300);
    const before = (await q("select count(*)::int c from media m join providers p on p.id=m.provider_id where p.name like 'Sofía%'"))[0].c;
    await pg.setInputFiles("#upMedia", PNG);
    ok("C26: el trabajo se sube sin el nombre del archivo", await until("select label from media m join providers p on p.id=m.provider_id where p.name like 'Sofía%' order by m.id desc limit 1", [],
       (r) => r.length && r[0].label === null, 8000)
       && (await q("select count(*)::int c from media m join providers p on p.id=m.provider_id where p.name like 'Sofía%'"))[0].c === before + 1);
    await wait(600);
    await pg.click(".gal .gi-ed >> nth=0"); await wait(200);
    await pg.fill("#mdName", "  Degradé con diseño "); await pg.click("#fMedia button[type=submit]");
    ok("C26: el nombre queda guardado en la base", await until("select label from media m join providers p on p.id=m.provider_id where p.name like 'Sofía%' order by m.id desc limit 1", [], (r) => r[0]?.label === "Degradé con diseño"));
    ok("C26: y se ve sobre la foto", /Degradé con diseño/.test(await pg.locator(".gal").innerText()));
    await pg.click(".gal .gi-ed >> nth=0"); await wait(200);
    await pg.click("[data-act=mediaDel]"); await wait(200);
    ok("C26: borrar pide confirmación con el nombre", /¿Borrar «Degradé con diseño»\?/.test(await pg.locator(".mediaed").innerText()));
    await pg.click("[data-act=mediaDelNo]"); await wait(200);
    ok("C26: «No» no borra nada", (await q("select count(*)::int c from media where label='Degradé con diseño'"))[0].c === 1);
    ok("C26: «No» vuelve al editor del trabajo", (await pg.locator("#fMedia").count()) === 1);
    await pg.click("[data-act=mediaDel]"); await wait(200); await pg.click("[data-act=mediaDelYes]");
    ok("C26: «Sí, borrar» lo saca de la base", await until("select count(*)::int c from media where label='Degradé con diseño'", [], (r) => r[0].c === 0));
  }
  // mensaje a clientes
  await pg.click("[data-btab=clientes]"); await wait(300); await pg.click("[data-act=msgOpen]"); await wait(200);
  await pg.fill("#msgTxt", "Hola {nombre}, mañana tengo lugar a las 10 en {negocio}"); await pg.check("#msgAll"); await pg.click("[data-act=msgSend]"); await wait(900);
  const cmsg = await q("select m.body from client_messages m join auth.users u on u.id=m.user_id where u.email='ana@test.ar' and m.kind='msg'");
  ok("mensaje a clientes: le llega a Ana con su nombre", cmsg.length === 1 && cmsg[0].body.toLowerCase() === "hola ana, mañana tengo lugar a las 10 en sofía benítez studio" && /mensaje enviado/i.test(await txt()));
  await pg.click("[data-act=msgClose]"); await wait(200);
  // tarjetas de sellos por servicio: configurar, sello a mano, canje en el local
  const esm = Number((await q("select id from services where name='Esmaltado semipermanente'"))[0].id);
  await pg.click("[data-btab=perfil]"); await wait(300);
  await pg.check("#stOn");
  const ie = await pg.evaluate((id) => pr(S.me).svcs.findIndex((x) => x[4] === id), esm);
  await pg.evaluate((ie) => document.querySelectorAll("[data-sts]").forEach((x) => { x.checked = +x.dataset.sts === ie }), ie);
  await pg.selectOption(`[data-stg="${ie}"]`, "16");
  await pg.click("#fStamps button[type=submit]"); await wait(1200);
  const sg = await q("select s.name, s.stamp_goal from services s join providers p on p.id=s.provider_id where p.name like 'Sofía%' and s.stamp_goal is not null");
  ok("tarjeta solo en Esmaltado, con 16 sellos", sg.length === 1 && sg[0].name === "Esmaltado semipermanente" && sg[0].stamp_goal === 16);
  ok("tarjetas activadas en la base", (await q("select stamps_on from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'"))[0].stamps_on === true);
  await pg.click("[data-btab=clientes]"); await wait(300); await pg.click(".clist [data-cli]"); await wait(300);
  ok("v2: el cliente se ve sin la ficha (números y teléfono)", (await pg.locator("#fNotas").count()) === 0 && /Visitas[\s\S]*Faltas[\s\S]*Gastó en total[\s\S]*Última visita/.test(await txt()) && (await pg.locator("#app .panel.contact .hint svg.ic").count()) > 0);
  await pg.click(`[data-act=stampAdd][data-sk="${esm}"]`); await wait(800);
  const anaStamps = async () => ((await q("select stamps from loyalty_cards lc join auth.users u on u.id=lc.user_id where u.email='ana@test.ar' and lc.service_id=$1", [esm]))[0] || {}).stamps || 0;
  ok("sello a mano guardado en la tarjeta de Esmaltado de Ana", (await anaStamps()) === 1 && (await pg.locator(".stampcard").innerText()).includes("1 / 16"));
  probing = true; await pg.click(`[data-act=stampAdd][data-sk="${esm}"]`); await wait(800); probing = false;
  ok("segundo sello a mano el mismo día: rechazado", (await anaStamps()) === 1);
  await db.query("update loyalty_cards set stamps = 16 where user_id = (select id from auth.users where email='ana@test.ar') and service_id = $1", [esm]);
  await pg.evaluate(async () => { await api.loadMine(); render() }); await wait(500);
  await pg.click("[data-act=stampRedeem]"); await wait(200); await pg.click("[data-act=stampRedeem]"); await wait(900);
  ok("canje del premio en el local: descuenta 16", (await anaStamps()) === 0);
  await pg.click("[data-act=cliBack]"); await wait(200);
  // bloquear el día que Ana tiene turno: se cancela solo, con devolución, aviso y lista
  await pg.click("[data-btab=horarios]"); await wait(300);
  await pg.fill("#dbf", d); await pg.fill("#dbt", d); await pg.click("#fDayBlock button[type=submit]"); await wait(400);
  ok("antes de bloquear, la lista de turnos que se cancelan", (await pg.locator("[data-act=dbConfirm]").count()) === 1 && /esos días tenés/i.test(await txt()));
  await pg.click("[data-act=dbConfirm]"); await wait(1500);
  const bc = await q("select id, status, refund_pending, settle_by_provider from bookings where source='app' and pay_method='mp'");
  ok("v31: el turno de Ana se canceló sin devolución automática (la arregla el prestador)", bc[0].status === "cancelled_provider" && bc[0].refund_pending === 0 && bc[0].settle_by_provider === true);
  ok("v31: la lista le dice al prestador que llame, con la seña ($3.600)", /TuTiempo no devuelve la seña/i.test(await pg.locator(".dbdone").innerText()) && (await pg.locator(".dbdone").innerText()).includes("$3.600"));
  ok("al prestador le queda la lista de cancelados", (await pg.locator(".dbdone li").count()) >= 1 && /ana/i.test(await pg.locator(".dbdone").innerText()));
  // Ana tiene dos turnos ese día (el pagado por Mercado Pago y el de resto en efectivo): se cancelan los dos y le llega
  // un aviso por cada uno. Se mira el de este turno (ref = id del turno), no el primero que devuelva la base.
  const cn = await q("select m.body from client_messages m join auth.users u on u.id=m.user_id where u.email='ana@test.ar' and m.kind='cancel' and m.ref=$1", [String(bc[0].id)]);
  ok("a Ana le llegó el aviso para reprogramar", cn.length >= 1 && cn[0].body.includes("tuvo que cancelar") && cn[0].body.includes("se va a comunicar con vos") && cn[0].body.includes("$3.600"));
  const dayBlk = await q("select count(*)::int c from provider_busy((select id from providers where name like 'Sofía%'), $1::date, $1::date) where day_block", [d]);
  ok("ese día queda Cerrado para los clientes", dayBlk[0].c === 1);
  // 7/11 · feriados: un feriado confirmado de acá a 7 días, en un día que Sofía atiende y sin turnos: le llega el aviso
  // con Abro / Cierro; Cierro bloquea el día (igual que Bloquear días) y Abro, desde Horarios, lo vuelve a abrir
  {
    const sof = "(select id from providers where name like 'Sofía%')";
    const hd = (await q(`select to_char(g::date, 'YYYY-MM-DD') d from generate_series((now() at time zone 'America/Argentina/Buenos_Aires')::date + 1,
        (now() at time zone 'America/Argentina/Buenos_Aires')::date + 7, interval '1 day') g
       where exists (select 1 from provider_hours ph where ph.provider_id = ${sof} and ph.dow = extract(dow from g)::int)
         and not exists (select 1 from bookings b where b.provider_id = ${sof} and (b.starts_at at time zone 'America/Argentina/Buenos_Aires')::date = g::date and b.status in ('confirmed','hold'))
       order by g limit 1`))[0].d;
    await q("select holidays_sync_save($1::int, $2::jsonb)", [+hd.slice(0, 4), JSON.stringify([{ fecha: hd, tipo: "trasladable", nombre: "Feriado de la prueba" }])]);
    await q("update holiday_years set confirmed_at = now() where year = $1", [+hd.slice(0, 4)]);
    // (abrir la campanita deja leídos los otros avisos de Sofía: al final vuelven a quedar como estaban)
    const unread = (await q(`select id from provider_notices where provider_id = ${sof} and read_at is null`)).map((r) => r.id);
    await q("select holiday_notices()");
    await pg.evaluate(async () => { await api.loadMine(); render() }); await wait(600);
    await pg.click("nav [data-act=bellToggle]"); await wait(500);
    const hn = pg.locator(".bellpanel li", { hasText: "Feriado de la prueba" });
    ok("7/11 · feriados: el aviso «El <día> es feriado (…). ¿Abrís?» llega a la campanita con Abro / Cierro",
       (await hn.count()) === 1 && /es feriado \(Feriado de la prueba\)\. ¿Abrís\?/.test(await hn.innerText())
       && (await hn.locator("[data-act=holOpen]").count()) === 1 && (await hn.locator("[data-act=holClose]").count()) === 1);
    await hn.locator("[data-act=holClose]").click(); await wait(1800);
    ok("7/11 · feriados: Cierro bloquea ese día (como Bloquear días) y guarda la elección",
       (await q(`select count(*)::int c from provider_busy(${sof}, $1::date, $1::date) where day_block`, [hd]))[0].c === 1
       && (await q(`select open from provider_holidays where provider_id = ${sof} and day = $1::date`, [hd]))[0]?.open === false);
    ok("7/11 · feriados: …lleva a Horarios, donde «Próximos feriados» lo muestra cerrado",
       await pg.evaluate(() => S.btab === "horarios") && /✓ Cerrado/.test(await pg.locator(`#holPanel li[data-hol="${hd}"]`).innerText()));
    await pg.click(`#holPanel li[data-hol="${hd}"] [data-act=holOpen]`); await wait(1800);
    ok("7/11 · feriados: Abro lo vuelve a abrir",
       (await q(`select count(*)::int c from provider_busy(${sof}, $1::date, $1::date) where day_block`, [hd]))[0].c === 0
       && (await q(`select open from provider_holidays where provider_id = ${sof} and day = $1::date`, [hd]))[0]?.open === true
       && /✓ Abrís/.test(await pg.locator(`#holPanel li[data-hol="${hd}"]`).innerText()));
    if (unread.length) await q("update provider_notices set read_at = null where id = any($1::bigint[])", [unread]);
  }
  // seguridad como prestadora
  probing = true;
  const sec2 = await pg.evaluate(async () => {
    const other = await sb.from("bookings").select("id").neq("provider_id", S.me);
    const r1 = await sb.from("providers").update({ dni_verified: true }).eq("id", S.me);
    const r2 = await sb.from("bookings").insert({ provider_id: S.me, source: "app", status: "confirmed", starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3600e3).toISOString(), price: 1 });
    const r3 = await sb.from("mp_accounts").select("*");   // las llaves de Mercado Pago (Bloque 2a: cifradas y sin acceso)
    return { other: (other.data || []).length, dni: !!r1.error, ins: !!r2.error, secrets: (r3.data || []).length };
  });
  await wait(300); probing = false;
  ok("prestadora no ve turnos de otros", sec2.other === 0);
  ok("no puede marcarse verificada", sec2.dni);
  ok("no puede crear turnos pagos falsos", sec2.ins);
  ok("no puede leer tokens de Mercado Pago", sec2.secrets === 0);
  // volver al público: aparece en Masajes
  await menu("[data-act=salirBarbero]"); await wait(600); await pg.click(".segtile.seg-m"); await wait(800);
  ok("ahora aparece también en Masajes", (await pg.locator(".grid .card").innerText()).includes("Sofía"));
  // la clienta ve su tarjeta y reserva el premio gratis
  // los más activos primero
  await db.query("update providers set activity = 50 where name = 'Barbería Max'");
  await pg.evaluate(() => { S.cat = "todos"; S.q = ""; S.list = null; render() }); await wait(1500);
  ok("listado: primero el más activo (Max), sin mostrar el número de servicios", /max/i.test(await pg.locator(".grid .card h3").first().innerText()) && !(await pg.locator(".grid .card").first().innerText()).includes("servicios en los últimos"));
  await db.query("update loyalty_cards set stamps = 16 where user_id = (select id from auth.users where email='ana@test.ar') and service_id = $1", [esm]);
  // V7 (C49): ingresar desde la capa deja la misma página (la ficha de un prestador)
  await pg.locator(".grid .card [data-go=perfil]").first().click(); await pg.waitForSelector(".pcard"); await wait(400);
  const urlProv = pg.url();
  await pg.click("nav [data-act=authOpen]"); await wait();
  ok("V7: Ingresar adentro de la capa", (await pg.isVisible(".authmodal #fLogin")) && pg.url() === urlProv);
  await pg.fill("#ai_e", "ana@test.ar"); await pg.fill("#ai_p", "cliente12345"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  ok("V7: después de ingresar la capa se cierra y queda la misma página", (await pg.evaluate(() => !!S.user)) && (await pg.locator(".authmodal").count()) === 0 && pg.url() === urlProv && (await pg.isVisible(".pcard")), pg.url() + " vs " + urlProv);
  await menu("[data-go=misturnos]"); await wait(800);
  ok("v31: Mis turnos: el turno cancelado por bloqueo dice que el profesional la va a llamar (sin Reprogramar automático)", /canceló el profesional/i.test(await txt()) && /te va a llamar/i.test(await txt()) && (await pg.locator(".delpanel [data-act=rebook]").count()) === 0);
  // C29 (V5 resto): con los sellos apagados en TuTiempo, Mis turnos no muestra la tarjeta; encendidos, vuelve como estaba
  await db.query("update app_settings set stamps_on = false");
  await pg.reload(); await pg.waitForSelector("#app"); await wait(1500);
  ok("C29: apagados, Mis turnos no muestra «Mis sellos» ni la tarjeta", (await pg.locator(".stampcard").count()) === 0 && !/mis sellos/i.test(await txt()));
  await db.query("update app_settings set stamps_on = true");
  await pg.reload(); await pg.waitForSelector(".stampcard", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("Mis sellos: tarjeta de Esmaltado 16 de 16, premio listo", (await pg.locator(".stampcard").count()) === 1 && (await pg.locator(".stampcard").innerText()).includes("Esmaltado semipermanente") && (await pg.locator(".stampcard").innerText()).includes("16 de 16") && /premio listo/i.test(await pg.locator(".stampcard").innerText()));
  const tt = (await txt()).toLowerCase(); ok("Mis turnos: primero los próximos y después los sellos; los avisos ya no están acá (4/11: campanita)", tt.indexOf("próximos") >= 0 && tt.indexOf("próximos") < tt.indexOf("mis sellos") && !tt.includes("avisos y mensajes"))
  // 4/11: la campanita de la cabecera, con el número de avisos sin leer
  const bellOpen = async () => { if (!(await pg.locator(".bellpanel").count())) { await pg.click("nav [data-act=bellToggle]"); await wait(300); } };;
  {
    // v2 · Cliente: cada aviso con la acción que corresponde (nunca «Reservar»), ✕ por aviso y «Borrar los leídos»
    const ana = (await q("select id from auth.users where email='ana@test.ar'"))[0].id;
    const badge = await pg.locator("nav .bell-n").innerText().catch(() => "");
    await bellOpen();
    ok("4/11: la campanita muestra cuántos avisos hay sin leer y los lista al tocarla", +badge >= 1 && (await pg.locator(".bellpanel .inbox li, .bellpanel li").count()) >= 2, badge);
    const rows = await pg.locator(".inbox li").evaluateAll((lis) => lis.map((li) => ({ id: li.dataset.msg, acts: [...li.querySelectorAll(".msg-act")].map((b) => b.dataset.act || "go:" + b.dataset.go), txt: li.innerText })));
    const kinds = Object.fromEntries((await q("select id::text, kind from client_messages where user_id=$1", [ana])).map((r) => [r.id, r.kind]));
    ok("v2: ningún aviso de Mis turnos tiene «Reservar»", rows.length >= 2 && !rows.some((r) => /Reservar/.test(r.txt)), JSON.stringify(rows));
    ok("v2: los de un turno llevan «Ver turno» y los mensajes «Ver perfil»",
       rows.every((r) => (["conf", "r24", "r2", "cancel"].includes(kinds[r.id]) ? r.acts.join() === "verTurno" || r.acts.join() === "go:perfil" : kinds[r.id] === "rev" ? true : r.acts.join() === "go:perfil"))
       && rows.some((r) => kinds[r.id] === "msg" && r.acts.join() === "go:perfil") && rows.some((r) => ["conf", "cancel"].includes(kinds[r.id]) && r.acts.join() === "verTurno"),
       JSON.stringify(rows.map((r) => [kinds[r.id], r.acts])));
    const turno = rows.find((r) => r.acts.join() === "verTurno");
    await pg.click(`.inbox li[data-msg="${turno.id}"] [data-act=verTurno]`); await wait(500);
    ok("v2: «Ver turno» abre ese turno (y cierra la campanita)", await pg.evaluate(() => S.view === "turnoOk" && !!S.turnoId) && (await pg.locator(".bellpanel").count()) === 0);
    await wait(1200);
    ok("4/11: al abrir la campanita, los avisos quedan leídos (sin número)", (await pg.locator("nav .bell-n").count()) === 0
       && (await q("select count(*)::int c from client_messages where user_id=$1 and read_at is null and dismissed_at is null", [ana]))[0].c === 0);
    await menu("[data-go=misturnos]"); await wait(800);
    // pedido de reseña de un turno atendido y sin reseña: «Dejar reseña» abre la reseña de ese turno en el perfil del
    // profesional, pestaña Reseñas (7/11 · Bloque 5: Mis turnos ya no tiene «Anteriores»)
    // (si Ana no tiene ninguno, se le carga uno atendido hace 40 días, copia de uno suyo)
    if (!(await q("select 1 from bookings b where b.client_id = $1 and b.status = 'done' and not exists (select 1 from reviews r where r.booking_id = b.id)", [ana])).length) {
      await q(`insert into bookings (provider_id, service_id, client_id, client_name, service_name, source, status, starts_at, ends_at, busy_until, price)
        select provider_id, service_id, client_id, client_name, service_name, source, 'done', starts_at - interval '40 days', ends_at - interval '40 days', busy_until - interval '40 days', price
          from bookings where client_id = $1 order by id limit 1`, [ana]);
    }
    const rv = await q(`insert into client_messages (provider_id, user_id, body, kind, ref)
       select b.provider_id, b.client_id, 'Contanos cómo te fue', 'rev', b.id::text from bookings b
        where b.client_id = $1 and b.status = 'done' and not exists (select 1 from reviews r where r.booking_id = b.id)
        order by b.id limit 1 on conflict do nothing returning id, ref`, [ana]);
    if (rv.length) {
      await pg.reload(); await pg.waitForSelector("nav [data-act=bellToggle]"); await wait(1200);
      await bellOpen();
      await pg.click(`.inbox li[data-msg="${rv[0].id}"] [data-act=inboxRate]`); await wait(500);
      await pg.waitForSelector(".rateform", { timeout: 8000 }).catch(() => {}); await wait(400);
      const pos = await pg.evaluate((ref) => { const box = document.querySelector(".rateform"); const send = box && box.querySelector("[data-act=sendReview]");
        return box && [S.view, S.ptab, send && send.dataset.id === String(ref), document.querySelector(".top").getBoundingClientRect().bottom, box.getBoundingClientRect().top, innerHeight]; }, rv[0].ref);
      ok("7/11 · Bloque 5: «Dejar reseña» abre la reseña de ese turno en el perfil del profesional (Reseñas) y lleva hasta ahí",
         pos && pos[0] === "perfil" && pos[1] === "reviews" && pos[2] && pos[4] >= pos[3] && pos[4] < pos[5], JSON.stringify(pos));
      await menu("[data-go=misturnos]"); await wait(800);
      ok("7/11 · Bloque 5: Mis turnos ya no tiene la lista de «Anteriores»", !/Anteriores/.test(await pg.locator("#app").innerText()) && (await pg.locator("#app [data-bk]").count()) === 0);
    } else ok("v2: hay un turno atendido de Ana para probar «Dejar reseña»", false);
    await bellOpen();
    const first = await pg.locator(".inbox li").first().getAttribute("data-msg");
    await pg.click(`.inbox li[data-msg="${first}"] [data-act=inboxDel]`); await wait(800);
    ok("v2: el ✕ borra ese aviso de la lista (y queda guardado en la base, fuera de la lista)", (await pg.locator(`.inbox li[data-msg="${first}"]`).count()) === 0
       && (await q("select dismissed_at is not null d from client_messages where id=$1", [first]))[0].d);
    await pg.click("[data-act=inboxClear]"); await wait(1000);
    ok("v2: «Borrar los leídos» vacía la lista", (await pg.locator(".bellpanel li").count()) === 0 && /No tenés avisos/.test(await pg.locator(".bellpanel").innerText())
       && (await q("select count(*)::int c from client_messages where user_id=$1 and dismissed_at is null", [ana]))[0].c === 0);
    await pg.reload(); await pg.waitForSelector("#app"); await wait(1500);
    await bellOpen();
    ok("v2: …y al volver a entrar siguen borrados", (await pg.locator(".bellpanel li").count()) === 0);
    await pg.keyboard.press("Escape"); await wait(200);
    ok("4/11: Esc cierra la campanita", (await pg.locator(".bellpanel").count()) === 0);
  }
  await pg.click("[data-act=useReward]"); await pg.waitForSelector(".pcard"); await wait(800);
  await turnoConMargen(pg); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno"); await wait(300);
  ok("checkout con “Usar mi premio”, gratis", (await pg.locator("[data-paym=reward][aria-checked=true]").count()) === 1 && /canjear premio/i.test(await pg.locator("#fTurno button[type=submit]").innerText()));
  await pg.click("#fTurno button[type=submit]"); await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(600);
  const rwb = await q("select price, pay_method, status from bookings where pay_method='reward'");
  ok("en la base: turno de premio gratis y sin sellos", rwb.length === 1 && rwb[0].price === 0 && rwb[0].status === "confirmed" && (await anaStamps()) === 0 && (await txt()).includes("Canjeaste tu premio"));
  await menu("[data-act=logout]"); await wait(800);
  // cuentas: crear, activar con el link del email, ingresar con contraseña, recuperar y crear contraseña nueva
  const mailOf = async (em) => (await (await fetch(BASE + "/__mail?email=" + encodeURIComponent(em))).json());
  await pg.click("nav [data-act=authOpen]"); await wait();
  // Bloque D: el ingreso recuerda el último email (casilla marcada por defecto)
  ok("Bloque D: el ingreso arranca con el último email y Recordar marcado", (await pg.inputValue("#ai_e")) === "ana@test.ar" && (await pg.isChecked("#ai_rem")), await pg.inputValue("#ai_e"));
  await pg.click("[data-act=authMode][data-m=up]"); await wait(200); await pg.click(".authmodal .kindopt[data-k=client]"); await wait(200);
  ok("Bloque D: Crear cuenta sin \"Repetí la contraseña\", con el celular opcional", (await pg.locator("#au_p2").count()) === 0 && (await pg.locator("#au_t").count()) === 1);
  await pg.fill("#au_e", "carla@"); await pg.click("#fSignup button[type=submit]"); await wait(700);
  const errsUp = await pg.evaluate(() => [...document.querySelectorAll("[aria-invalid=true]")].map((el) => el.id).join(","));
  ok("Bloque D: Crear cuenta muestra todos los errores a la vez, cada uno al lado de su campo", errsUp === "au_n,au_e,au_p,au_ok" && (await pg.locator(".fe-msg").count()) === 4 && (await pg.evaluate(() => document.activeElement.id)) === "au_n", errsUp);
  await pg.fill("#au_n", "Carla Ruiz"); await wait(100);
  ok("Bloque D: al corregir un campo, su error se va", (await pg.locator("#au_n_err").count()) === 0 && (await pg.getAttribute("#au_n", "aria-invalid")) === null);
  await pg.fill("#au_n", "Carla Ruiz"); await pg.fill("#au_e", "carla@test.ar"); await pg.fill("#au_t", "2284 445566"); await pg.fill("#au_p", "Mate2026x");
  await pg.click("#fSignup button[type=submit]"); await wait(700);   // la app ignora un segundo envío en menos de medio segundo (doble toque)
  ok("crear cuenta pide aceptar términos", (await pg.locator("#au_ok_err").innerText()).includes("términos"));
  await pg.check("#au_ok"); await pg.click("#fSignup button[type=submit]"); await wait(800);
  ok("cuenta creada: pide activarla por email", (await txt()).includes("Tocalo para activar la cuenta") && !(await pg.evaluate(() => !!S.user)));
  ok("Bloque D: Reenviar el email espera un minuto (cuenta regresiva)", await pg.isDisabled("[data-act=resendConfirm]") && /\(en 0:\d\d\)/.test(await pg.locator("[data-act=resendConfirm]").innerText()));
  const pc = await q("select p.full_name, p.phone from profiles p join auth.users u on u.id = p.id where u.email = 'carla@test.ar'");
  ok("en la base: nombre y celular guardados", pc.length === 1 && pc[0].full_name === "Carla Ruiz" && pc[0].phone === "2284 445566");
  probing = true; await pg.goto(BASE + "/?token_hash=" + "f".repeat(32) + "&type=signup"); await wait(1200); probing = false;
  ok("link falso o vencido: no entra", !(await pg.evaluate(() => !!S.user)) && !(await pg.url()).includes("token_hash"));
  await pg.goto(BASE + "/?token_hash=" + (await mailOf("carla@test.ar")).signup + "&type=signup"); await wait(1500);
  ok("link de activación: entra sola y limpia la dirección", (await pg.evaluate(() => S.user && S.user.email)) === "carla@test.ar" && !(await pg.url()).includes("token_hash"));
  await menu("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-act=authOpen]"); await wait();
  probing = true; await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "otra1234"); await pg.click("#fLogin button[type=submit]"); await wait(800); probing = false;
  ok("contraseña incorrecta avisa", (await txt()).includes("Email o contraseña incorrectos"));
  ok("Bloque D: el error va debajo de la contraseña (sin aviso de intentos todavía)", (await pg.getAttribute("#ai_p", "aria-invalid")) === "true" && (await pg.locator("#ai_p_err").innerText()).includes("incorrectos") && (await pg.locator(".tries").count()) === 0);
  probing = true;
  for (let i = 0; i < 2; i++) { await pg.fill("#ai_p", "otra1234"); await pg.click("#fLogin button[type=submit]"); await wait(800); }
  probing = false;
  ok("ingreso: desde el tercer intento avisa cuántos quedan y «Olvidé mi contraseña» va en negrita", /Te quedan 2 intentos/.test(await pg.locator(".tries").innerText()) && (await pg.getAttribute("[data-act=authMode][data-m=forgot]", "style") || "").includes("700"));
  await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "Mate2026x"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  ok("ingresar con email y contraseña", (await pg.evaluate(() => S.user && S.user.name)) === "Carla Ruiz");
  await menu("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-act=authOpen]"); await wait(); await pg.click("[data-act=authMode][data-m=forgot]"); await wait(200);
  await pg.fill("#af_e", "nadie@test.ar"); await pg.click("#fForgot button[type=submit]"); await wait(600);
  ok("recuperar con email inexistente: mismo mensaje", (await txt()).includes("Si nadie@test.ar tiene una cuenta"));
  await pg.click("[data-act=authMode][data-m=in]"); await wait(200); await pg.click("[data-act=authMode][data-m=forgot]"); await wait(200);
  await pg.fill("#af_e", "carla@test.ar"); await pg.click("#fForgot button[type=submit]"); await wait(600);
  await pg.goto(BASE + "/?token_hash=" + (await mailOf("carla@test.ar")).recovery + "&type=recovery"); await wait(1500);
  ok("link de recuperación abre “contraseña nueva”", await pg.isVisible("#fNewPass"));
  await pg.fill("#np1", "Nueva2026zz"); await pg.fill("#np2", "Nueva2026zz"); await pg.click("#fNewPass button[type=submit]"); await wait(1200);
  ok("en la base: contraseña nueva guardada", (await q("select encrypted_password from auth.users where email='carla@test.ar'"))[0].encrypted_password === "Nueva2026zz");
  await menu("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-act=authOpen]"); await wait();
  await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "Nueva2026zz"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  ok("ingresa con la contraseña nueva", (await pg.evaluate(() => S.user && S.user.email)) === "carla@test.ar");
  // panel de administración (Carla pasa a ser admin)
  await db.query("insert into app_admins (user_id) select id from auth.users where email='carla@test.ar'");
  await pg.goto(BASE); await wait(1500); await menu("[data-go=cuenta]");
  ok("admin: botón del panel en Mi perfil", (await pg.locator("#app [data-act=toAdmin]").count()) === 1);
  ok("Bloque D: y en el menú de cuenta", (await pg.locator("#acctMenu [data-act=toAdmin]").count()) === 1);
  ok("v2: la cuenta admin no tiene «Registrá tu negocio» en el menú de cuenta", (await pg.locator("#acctMenu [data-act=bizStart]").count()) === 0);
  await pg.click("#app [data-act=toAdmin]"); await pg.waitForSelector(".kpis.adm", { timeout: 8000 }).catch(() => {}); await wait(500);
  ok("admin: tablero con datos reales", (await pg.locator(".kpis.adm .kpi").count()) === 8 && (await pg.locator(".admtop li").count()) >= 2);
  ok("v30: sin la proyección y con el tablero simple (hoy/ayer + 4 semanas)", !(await txt()).includes("cerrás el mes") && (await pg.locator(".admday>div").count()) === 2 && (await pg.locator(".wkrow").count()) === 4 && (await pg.locator(".admbars").count()) === 0);
  await pg.click("[data-act=admT][data-t=com]"); await wait(300);
  ok("admin/D34: comisión de TuTiempo 10% del servicio y Mercado Pago en 0% en los cuatro plazos", (await pg.inputValue("#admCom")) === "10"
     && (await Promise.all(["instant", "d10", "d18", "d35"].map((t) => pg.inputValue("#admMp-" + t)))).every((v) => v === "0"));
  ok("admin: comisión sin botones fijos", (await pg.locator("[data-act=admComQuick]").count()) === 0);
  // 7/11 · feriados: el admin ve el año en curso y el siguiente; corrige, agrega y confirma
  {
    const ny = (await q("select extract(year from now() at time zone 'America/Argentina/Buenos_Aires')::int + 1 y"))[0].y;
    await q("select holidays_sync_save($1, $2::jsonb)", [ny, JSON.stringify([{ fecha: `${ny}-01-01`, tipo: "inamovible", nombre: "Año nuevo" }])]);
    await pg.evaluate(async () => { await api.adminHolidays(); render() }); await wait(400);
    const yb = pg.locator(".holyear", { hasText: String(ny) });
    ok("7/11 · feriados: el admin ve el año siguiente sin confirmar, con lo que trajo la fuente",
       /Sin confirmar/.test(await yb.innerText()) && /Año nuevo/.test(await yb.innerText()) && (await yb.locator("[data-act=admHolConfirm]").count()) === 1);
    await pg.fill("#holD", `${ny}-03-24`); await pg.fill("#holN", "Día Nacional de la Memoria"); await pg.selectOption("#holK", "inamovible");
    await pg.click("#fHol button[type=submit]"); await wait(1200);
    ok("7/11 · feriados: agrega uno a mano", (await q("select source from holidays where day = $1::date", [`${ny}-03-24`]))[0]?.source === "admin"
       && /cargado a mano/.test(await pg.locator(".holyear", { hasText: String(ny) }).innerText()));
    await pg.click(`.holyear [data-act=admHolConfirm][data-y="${ny}"]`); await wait(1200);
    ok("7/11 · feriados: confirma el año (desde ahí lo ven los profesionales)", (await q("select confirmed_at is not null c from holiday_years where year = $1", [ny]))[0].c === true
       && /Confirmado el/.test(await pg.locator(".holyear", { hasText: String(ny) }).innerText()));
  }
  // D30: guarda Comisión y espera a que el panel se vuelva a dibujar con lo guardado (si no, el render tardío pisa lo que se
  // escribe después: en el CI pasa)
  const saveCom = async () => {
    await wait(500);   // la app ignora un segundo envío del mismo formulario en menos de 450 ms (doble toque)
    await pg.evaluate(() => document.getElementById("fCom").setAttribute("data-viejo", "1"));
    await pg.click("#fCom button[type=submit]");
    await pg.waitForFunction(() => { const f = document.getElementById("fCom"); return f && !f.hasAttribute("data-viejo"); }, null, { timeout: 10000 }).catch(() => {});
    await wait(200);
  };
  await pg.fill("#admCom", "7"); await pg.fill("#admMp-instant", "7,61"); await pg.fill("#admMp-d10", "5,31"); await pg.fill("#admMp-d18", "4,10"); await pg.fill("#admMp-d35", "1,80");
  await saveCom();
  const fs30 = (await q("select deposit_commission_pct, mp_pct_instant, mp_pct_d10, mp_pct_d18, mp_pct_d35 from app_settings"))[0];
  ok("admin/D34: comisiones guardadas en la base (7% del servicio; 7,61 / 5,31 / 4,10 / 1,80)", [fs30.deposit_commission_pct, fs30.mp_pct_instant, fs30.mp_pct_d10, fs30.mp_pct_d18, fs30.mp_pct_d35].map(Number).join() === "7,7.61,5.31,4.1,1.8");
  ok("admin/D34: el ejemplo (corte $20.000, seña 50%, al instante) da $10.000 + $1.400 (7% de $20.000) + $939 = $12.339", (await pg.locator(".comex .tot").innerText()).includes("$12.339")
     && (await pg.locator(".comex").innerText()).includes("$1.400") && (await pg.locator(".comex").innerText()).includes("$939"));
  await pg.fill("#admMp-d10", "16"); await pg.click("#fCom button[type=submit]"); await wait(700);   // la app ignora un segundo envío en menos de 450 ms (doble toque)
  ok("admin/D30: Mercado Pago fuera de rango no se guarda", (await pg.locator("#comerr").innerText()).includes("entre 0 y 15") && Number((await q("select mp_pct_d10 from app_settings"))[0].mp_pct_d10) === 5.31);
  await pg.fill("#admCom", "8,5"); await pg.fill("#admMp-d10", "5,31"); await saveCom();
  ok("admin: comisión libre con decimales (8,5% del servicio)", await until("select deposit_commission_pct from app_settings", [], (r) => Number(r[0].deposit_commission_pct) === 8.5, 8000));
  await pg.fill("#admCom", "10"); for (const t of ["instant", "d10", "d18", "d35"]) await pg.fill("#admMp-" + t, "0"); await saveCom();
  await until("select deposit_commission_pct, mp_pct_instant from app_settings", [], (r) => Number(r[0].deposit_commission_pct) === 10 && Number(r[0].mp_pct_instant) === 0, 8000);
  probing = true; const forb = await pg.evaluate(async () => { const r = await sb.from("app_settings").update({ deposit_commission_pct: 1, mp_pct_d10: 9 }).eq("id", true).select(); return (r.data || []).length }); probing = false;
  ok("nadie cambia las comisiones por fuera de la función", forb === 0 && Number((await q("select deposit_commission_pct from app_settings"))[0].deposit_commission_pct) === 10);
  // H24: la dirección del sitio para los links de los avisos
  ok("H24: Comisión muestra la dirección del sitio", (await pg.inputValue("#admSite")) === "https://tutiempo.com.ar");
  // solo https:// y el dominio: cada dirección inválida avisa y no guarda (entre envíos, más que el antidoble toque)
  const badSites = [];
  for (const bad of ["prueba.tutiempo.com.ar", "http://prueba.tutiempo.com.ar", "https://prueba.tutiempo.com.ar/", "https://prueba.tutiempo.com.ar/panel", "https://prueba.tutiempo.com.ar?x=1"]) {
    await pg.evaluate(() => { document.querySelector("#siteerr").textContent = "" });
    await pg.fill("#admSite", bad); await pg.click("#fSite button[type=submit]"); await wait(700);
    if (!(await pg.locator("#siteerr").innerText()).includes("sin barra al final") || (await q("select site_url from app_settings"))[0].site_url !== "https://tutiempo.com.ar") badSites.push(bad);
  }
  ok("H24: sin https://, con http://, barra final, carpeta o parámetros avisa y no guarda" + (badSites.length ? " → " + badSites.join(", ") : ""), !badSites.length);
  await pg.fill("#admSite", " https://Prueba.TuTiempo.com.ar "); await pg.click("#fSite button[type=submit]");
  ok("H24: el admin guarda la dirección del subdominio de prueba", await until("select site_url from app_settings", [], (r) => r[0].site_url === "https://prueba.tutiempo.com.ar"));
  await wait(400);
  await db.query("update app_settings set site_url = 'https://tutiempo.com.ar'");
  // Bloque 1: "Para revisar · cobros": una devolución que falló una vez (el turno de Ana pagado con Mercado Pago)
  // (el turno puede seguir confirmado o haber caído en el bloqueo de días: depende de la fecha; la devolución se pide igual)
  const bpaid = (await q("select pb.booking_id as id, pb.amount from payment_bookings pb order by pb.payment_id desc limit 1"))[0];
  const rfe = (await q("select refund_request($1, null, $2, 'provider_cancelled') as id", [bpaid.id, bpaid.amount]))[0].id;
  await db.query("update refunds set attempts = 1, first_attempt_at = now(), last_error = '400 insufficient_amount', next_attempt_at = now() + interval '10 minutes' where id = $1", [rfe]);
  await pg.evaluate(() => { S.admRev = null; S.admT = "res"; render() }); await pg.waitForSelector("[data-act=admRetry]", { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("Bloque 1: Para revisar muestra la devolución que se reintenta, con el último error", /Para revisar · cobros/i.test(await txt()) && (await txt()).includes("400 insufficient_amount") && /Reintentando · 1 intento/i.test(await txt()));
  await pg.click(`[data-act=admRetry][data-id="${rfe}"]`); await wait(1200);
  ok("Bloque 1: Reintentar la vuelve a la cola", (await q("select status, attempts from refunds where id=$1", [rfe]))[0].attempts === 0 && (await pg.locator(`[data-act=admRetry][data-id="${rfe}"]`).count()) === 0);
  await db.query("update refunds set status = 'failed', attempts = 9, last_error = '400 insufficient_amount' where id = $1", [rfe]);
  await pg.evaluate(() => { S.admRev = null; render() }); await pg.waitForSelector("[data-act=admResolveOpen]", { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("Bloque 1: la fallida aparece como que ya no se reintenta", /Falló: ya no se reintenta/.test(await txt()));
  await pg.click(`[data-act=admResolveOpen][data-k=refund][data-id="${rfe}"]`); await wait(200);
  await pg.click("#fResolve button:not([type])"); await wait(800);   // la app ignora un segundo envío en menos de medio segundo
  ok("Bloque 1: Resuelto a mano exige una nota", (await pg.locator("#rserr").innerText()).length > 3 && (await q("select status from refunds where id=$1", [rfe]))[0].status === "failed");
  await pg.fill("#rsNote", "Le devolví por transferencia"); await pg.click("#fResolve button:not([type])"); await wait(1200);
  const rres = (await q("select r.status, r.resolved_note, u.email from refunds r join auth.users u on u.id = r.resolved_by where r.id=$1", [rfe]))[0];
  ok("Bloque 1: Resuelto a mano queda con la nota y quién lo hizo, sin devolver nada", rres && rres.status === "resolved" && rres.resolved_note === "Le devolví por transferencia" && rres.email === "carla@test.ar"
     && (await q("select count(*)::int c from refunds where reason <> 'admin'"))[0].c === 1 && (await pg.locator(`[data-act=admResolveOpen][data-id="${rfe}"]`).count()) === 0);
  // Bloque 1 (D20): "Devolver" un pago en revisión, con el monto por defecto de lo que falta devolver
  const pov = (await q("select p.id, p.amount from payments p where p.id <> (select payment_id from refunds where id = $1) order by p.id limit 1", [rfe]))[0];
  await db.query("update payments set outcome = 'review', review_reasons = '{amount_over}', review_resolved_at = null where id = $1", [pov.id]);
  await pg.evaluate(() => { S.admRev = null; render() }); await pg.waitForSelector("[data-act=admResolveOpen][data-k=refundNew]", { timeout: 8000 }).catch(() => {}); await wait(300);
  await pg.click(`[data-act=admResolveOpen][data-k=refundNew][data-id="${pov.id}"]`); await wait(300);
  const defAmount = Number(await pg.inputValue("#arAmount"));
  // H08: con centavos no se pide nada (antes "1.000" también se rechazaba; ahora se lee como mil)
  await pg.fill("#arAmount", "500,50"); await pg.fill("#arNote", "Pagó de más"); await pg.click("#fAdmRefund button:not([type])"); await wait(700);
  ok("H08: Devolver con centavos muestra el error y no crea la devolución", /pesos enteros, sin centavos/.test(await pg.textContent("#arerr"))
     && (await q("select count(*)::int c from refunds where reason = 'admin'"))[0].c === 0);
  await pg.fill("#arAmount", "500"); await pg.click("#fAdmRefund button:not([type])"); await wait(1500);
  const rnew = (await q("select amount, reason, note, status from refunds where reason = 'admin'"))[0];
  ok("Bloque 1: Devolver crea la devolución (monto editable, nota) y el pago sale de Para revisar", defAmount > 0 && rnew && rnew.amount === 500 && rnew.note === "Pagó de más"
     && ["pending", "failed"].includes(rnew.status) && (await pg.locator(`[data-act=admResolveOpen][data-k=refundNew][data-id="${pov.id}"]`).count()) === 0);
  // Bloque 2b: una cuenta de Mercado Pago con error en su llave aparece en Para revisar (prestador, cuenta, error, desde cuándo)
  await db.query("select mp_account_error(a.id, 'No se pudo renovar la llave (400)', false) from mp_accounts a join providers p on p.id = a.provider_id where p.name like 'Sofía%' and a.status = 'active'");
  await pg.evaluate(() => { S.admRev = null; render() }); await pg.waitForFunction(() => /Cuenta de Mercado Pago con error/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("2b: Para revisar muestra la cuenta con error: prestador, cuenta, error y desde cuándo", /Cuenta de Mercado Pago con error · Sofía/.test(await txt())
     && (await txt()).includes("No se pudo renovar la llave (400) · desde ") && /Cuenta n° \S+ · cobra las reservas/.test(await txt()));
  await db.query("update mp_accounts set last_error = null where last_error = 'No se pudo renovar la llave (400)'");
  // Paso 1: avisos de Mercado Pago rechazados (por ejemplo, la clave de la firma mal) y un pago recuperado sin aviso
  await db.query("select mp_webhook_event('1999000111', p.id, null, 'bad_signature', 'la firma no coincide con MP_WEBHOOK_SECRET') from providers p where p.name like 'Sofía%'");
  await db.query("select mp_webhook_event('1999000111', p.id, null, 'bad_signature', 'la firma no coincide con MP_WEBHOOK_SECRET') from providers p where p.name like 'Sofía%'");
  await db.query("select mp_webhook_event('1999000111', p.id, null, 'recovered', 'pago aprobado sin aviso: lo encontró la consulta automática') from providers p where p.name like 'Sofía%'");
  await pg.evaluate(() => { S.admRev = null; render() }); await pg.waitForFunction(() => /no están llegando bien/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("Paso 1: Para revisar avisa que los avisos de Mercado Pago no llegan bien (rechazados y pagos sin aviso) y dónde mirar",
     /Los avisos de Mercado Pago no están llegando bien/.test(await txt()) && /2 avisos rechazados en 7 días \(rechazado: la firma no es válida\)/.test(await txt())
     && /1 pago registrado sin aviso/.test(await txt()) && /MP_WEBHOOK_SECRET/.test(await txt()));
  ok("Paso 1: …y la lista de avisos dice el detalle y cuántas veces llegó", /la firma no coincide con MP_WEBHOOK_SECRET\) · [^·]+ · 2 veces/.test(await txt()) && /Pago recuperado · pago 1999000111/.test(await txt()));
  await db.query("delete from mp_webhook_events where mp_payment_id = '1999000111'");
  // 7/11: un pago recuperado sin aviso (informativo) no prende "no están llegando bien" y, una vez visto, en la visita
  // siguiente ya no está
  await db.query("select mp_webhook_event('1999000222', p.id, null, 'recovered', 'pago aprobado sin aviso: lo encontró la consulta automática') from providers p where p.name like 'Sofía%'");
  await pg.evaluate(() => { S.admRev = null; render() }); await pg.waitForFunction(() => /Pago recuperado · pago 1999000222/.test(document.body.textContent), null, { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("7/11: un pago recuperado solo es informativo: se ve en la lista (plegada) y no prende «no están llegando bien»",
     /Pago recuperado · pago 1999000222/.test(await pg.evaluate(() => document.body.textContent)) && !/no están llegando bien/.test(await txt()));
  await pg.reload(); await pg.waitForFunction(() => /Comisión de TuTiempo este mes/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {}); await wait(1200);
  ok("7/11: …y en la visita siguiente ya no aparece (se borra una vez leído)", /Comisión de TuTiempo este mes/.test(await txt()) && !/1999000222/.test(await pg.evaluate(() => document.body.textContent)), new URL(pg.url()).pathname);
  await db.query("delete from mp_webhook_events where mp_payment_id = '1999000222'");
  await pg.evaluate(() => { S.admRev = null; render() }); await wait(600);
  // C41/C42 (V6): los activos sin Mercado Pago, en negrita y con "Ver quiénes"; el filtro y "Avisarle"
  {
    const [nomp] = await q("select id, name from providers where status='active' and name not like 'Sofía%' order by id desc limit 1");
    await db.query("update mp_accounts set status='refunds_only' where provider_id=$1 and status='active'", [nomp.id]);
    await db.query("update provider_private set mp_connected=false where provider_id=$1", [nomp.id]);
    await pg.evaluate(async () => { await api.adminLoad(); S.admT = "res"; render() }); await wait(500);
    // C44 (V6 resto): «Clientes» cuenta solo cuentas de cliente (sin negocios ni admins); los turnos tienen su indicador
    const nCli = (await q("select count(*)::int c from profiles pr where not exists (select 1 from providers p where p.owner_id=pr.id and p.status<>'deleted') and not exists (select 1 from app_admins a where a.user_id=pr.id)"))[0].c;
    const kCli = await pg.evaluate(() => [...document.querySelectorAll(".kpis.adm .kpi")].find((k) => k.querySelector("span")?.textContent.trim() === "Clientes")?.textContent || "");
    ok("C44: «Clientes» cuenta solo las cuentas de cliente, y «Turnos del mes» sigue aparte", kCli.includes(String(nCli)) && /cuentas de cliente/.test(kCli)
       && (await pg.evaluate(() => [...document.querySelectorAll(".kpis.adm .kpi span")].some((x) => x.textContent.trim() === "Turnos del mes"))), kCli + " vs " + nCli);
    ok("C41: el resumen nombra en negrita a los activos sin Mercado Pago, con «Ver quiénes»", !!nomp && (await pg.locator(`b:text-is("${nomp?.name}")`).count()) >= 1, String(nomp?.name));
    await pg.click("[data-act=admT][data-f=nomp]"); await wait(400);
    ok("C42: «Ver quiénes» abre Prestadores con el filtro «Sin Mercado Pago»", (await pg.locator('[data-act=admF][data-f=nomp][aria-pressed=true]').count()) === 1
       && (await pg.locator(".admgrp li").count()) >= 1 && !(await pg.locator(".admgrp").innerText()).includes("Sofía"));
    // v2 (3/11): antes de mandar, el cuadro con el mensaje (editable) y por dónde le llega; Cancelar no manda nada
    await pg.click(`[data-act=admNudge][data-id="${nomp.id}"]`); await wait(300);
    ok("v2: «Avisarle» muestra el mensaje que se va a mandar, editable, y que llega como aviso en la app y push, con Enviar y Cancelar",
       /conectá tu cuenta de Mercado Pago/.test(await pg.inputValue("#admNudgeTxt")) && /aviso en su panel/.test(await pg.locator(".nudgebox").innerText()) && /notificación push/.test(await pg.locator(".nudgebox").innerText())
       && (await pg.locator(".nudgebox [data-act=admNudgeSend]").count()) === 1 && (await pg.locator(".nudgebox [data-act=admNudgeCancel]").count()) === 1);
    await pg.click("[data-act=admNudgeCancel]"); await wait(300);
    ok("v2: Cancelar cierra el cuadro y no manda nada", (await pg.locator(".nudgebox").count()) === 0
       && (await q("select count(*)::int c from provider_notices where provider_id=$1 and kind='mp_connect'", [nomp.id]))[0].c === 0);
    await pg.click(`[data-act=admNudge][data-id="${nomp.id}"]`); await wait(300);
    await pg.fill("#admNudgeTxt", "Hola: conectá Mercado Pago así tus clientes reservan online.");
    await pg.click("[data-act=admNudgeSend]");
    ok("v2: Enviar manda el mensaje editado", await until("select body from provider_notices where provider_id=$1 and kind='mp_connect'", [nomp.id], (r) => r.length === 1 && r[0].body === "Hola: conectá Mercado Pago así tus clientes reservan online."));
    ok("C41/C42: «Avisarle» le deja el aviso para conectar Mercado Pago", await until("select count(*)::int c from provider_notices where provider_id=$1 and kind='mp_connect'", [nomp.id], (r) => r[0].c === 1)
       && (await pg.locator(`li:has([data-act=admOpen][data-id="${nomp.id}"]) .chip:text("Avisado")`).count()) === 1);
    await pg.evaluate(() => { S.admF = "todos"; render() }); await wait(300);
    // v2 (3/11): los avisos del Resumen se pueden borrar (uno, o «Borrar los leídos»), y uno borrado no vuelve
    await pg.evaluate(() => { S.admT = "res"; render() }); await wait(600);
    const keyNomp = await pg.evaluate(() => document.querySelector("li.admal[data-k^='nomp:']")?.dataset.k || "");
    ok("v2: el aviso de los que no conectaron Mercado Pago se puede borrar (✕) y aparece como nuevo la primera vez",
       !!keyNomp && (await pg.locator(`li.admal[data-k="${keyNomp}"] [data-act=admAlertDel]`).count()) === 1 && (await pg.locator(`li.admal.new[data-k="${keyNomp}"]`).count()) === 1);
    ok("v2: al verlo queda marcado como visto en la base", await until("select count(*)::int c from admin_alert_marks where key=$1 and dismissed_at is null", [keyNomp], (r) => r[0].c === 1));
    await pg.click(`li.admal[data-k="${keyNomp}"] [data-act=admAlertDel]`); await wait(500);
    ok("v2: borrado: sale de la lista y queda borrado en la base", (await pg.locator(`li.admal[data-k="${keyNomp}"]`).count()) === 0
       && (await q("select count(*)::int c from admin_alert_marks where key=$1 and dismissed_at is not null", [keyNomp]))[0].c === 1);
    await pg.evaluate(async () => { await api.adminLoad(); render() }); await wait(500);
    ok("v2: al volver a cargar el panel, el aviso borrado no vuelve", (await pg.locator(`li.admal[data-k="${keyNomp}"]`).count()) === 0);
  }
  // v30: prestadores por rubro, notas privadas, eliminar
  await pg.click("[data-act=admT][data-t=prov]"); await wait(400);
  ok("v30: prestadores divididos por rubro", (await pg.locator(".admgrp").count()) >= 1 && (await pg.locator(".admgh").first().innerText()).length > 2);
  const sofi = (await q("select id from providers where name like 'Sofía%'"))[0].id;
  await pg.click(`[data-act=admOpen][data-id="${sofi}"]`); await wait(300);
  await pg.fill("#admNote", "Nota privada de prueba <b>x</b>"); await pg.click("#fNote button[type=submit]"); await wait(1200);
  ok("v30: nota privada guardada en la base y visible en la ficha", (await q("select body from admin_notes where provider_id=$1", [sofi])).length === 1 && (await pg.locator(".admfile .notes li").count()) === 1);
  probing = true; const nleak = await pg.evaluate(async () => { const r = await sb.from("admin_notes").select("*"); return r.error ? -1 : (r.data || []).length }); probing = false;
  ok("v30: la tabla de notas no se lee directo ni siendo admin", nleak <= 0);
  await pg.click("[data-act=admNoteDel]"); await wait(1200);
  ok("v30: borrar nota", (await q("select count(*)::int c from admin_notes where provider_id=$1", [sofi]))[0].c === 0);
  const victim = (await q("select id from providers where status='active' and name not like 'Sofía%' order by id desc limit 1"))[0].id;
  await pg.click(`[data-act=admOpen][data-id="${victim}"]`); await wait(300); await pg.click(`[data-act=admDel][data-id="${victim}"]`); await wait(200);
  await pg.check("#admDelOk"); await pg.click(`[data-act=admDelYes][data-id="${victim}"]`); await wait(1500);
  ok("v30: eliminar prestador desde el panel", (await q("select status from providers where id=$1", [victim]))[0].status === "deleted" && !(await txt()).includes("Sí, eliminar"));
  // v30: balance de TuTiempo
  await pg.click("[data-act=admT][data-t=bal]"); await pg.waitForSelector(".ftbl", { timeout: 8000 }).catch(() => {}); await wait(400);
  const curM = await pg.evaluate(() => TODAY().slice(0, 7));
  ok("v30: balance mes a mes desde la base", (await pg.locator(".ftbl").first().locator("tbody tr").count()) === Number(curM.slice(5)) + 1 && (await txt()).includes("Resultado"));
  await pg.click(`[data-act=admM][data-m="${curM}"]`); await wait(300);
  await pg.fill("#aec", "Hosting"); await pg.fill("#aem", "45000"); await pg.click("#fAdmExp button[type=submit]"); await wait(1500);
  ok("v30: gasto de TuTiempo cargado en la base y en pantalla", (await q("select amount from admin_expenses"))[0].amount === 45000 && (await txt()).includes("Hosting"));
  await pg.click("[data-act=admMn][data-d='-1']"); await wait(1200);
  await pg.click("[data-act=admClose][data-k=month]"); await wait(200); await pg.click("[data-act=admClose][data-k=month]"); await wait(1500);
  ok("v30: cerrar el mes pasado", (await q("select count(*)::int c from admin_closings where kind='month'"))[0].c === 1 && (await pg.locator(".cclosed").count()) === 1);
  await menu("[data-act=asClient][data-to=cuenta]"); await wait(400);
  ok("Bloque D: desde el panel de TuTiempo, Mi perfil vuelve a la cuenta como cliente", (await pg.evaluate(() => S.role === "cliente" && S.view === "cuenta")));
  probing = true; const reuse = await pg.evaluate(async (h) => { const r = await sb.auth.verifyOtp({ token_hash: h, type: "recovery" }); return !!r.error }, (await mailOf("carla@test.ar")).recovery); probing = false;
  ok("el link de recuperación sirve una sola vez", reuse);
  // ---------- Bloque 1 (H23): la prestadora desconecta Mercado Pago ----------
  const pay0 = (await q("select mp_payment_id from payments order by id desc limit 1"))[0].mp_payment_id;
  await db.query("select payment_mp_update($1, 'in_mediation')", [pay0]);   // un reclamo abierto: le llega el aviso
  await pg.goto(BASE); await wait(1200); await menu("[data-act=logout]"); await wait(800);
  await pg.click("footer [data-act=authOpen]"); await wait();
  await pg.fill("#ai_e", "sofia@test.ar"); await pg.fill("#ai_p", "prestador123"); await pg.click("#fLogin button[type=submit]"); await pg.waitForSelector(".bhead"); await wait(800);
  // 4/11: los avisos del profesional, en la campanita de la cabecera
  const proBadge = await pg.locator("nav .bell-n").innerText().catch(() => "");
  await pg.click("nav [data-act=bellToggle]"); await wait(300);
  const bellTxt = await pg.locator(".bellpanel").innerText().catch(() => "");
  ok("Bloque 1: el aviso del reclamo llega al profesional (4/11: en la campanita, con el número)", +proBadge >= 2 && /Ana empezó a seguirte/.test(bellTxt) && /reclamo en Mercado Pago/.test(bellTxt) && !/Ana empezó a seguirte/.test(await txt()), bellTxt.slice(0, 200));
  ok("4/11: el aviso de seguidor nuevo lleva a Seguidores", (await pg.locator(".bellpanel [data-act=bellGo][data-to=seguidores]").count()) >= 1);
  {
    // v2 · Profesional: el texto del aviso usa el ancho de la caja (antes, una columna de 52 px, palabra por palabra)
    const w = await pg.locator(".bellpanel .msgb").first().evaluate((el) => [el.getBoundingClientRect().width, el.closest(".bellpanel").getBoundingClientRect().width]);
    ok("v2: el texto del aviso se lee a lo ancho de la caja", w[0] > w[1] * 0.75, JSON.stringify(w));
  }
  // 7/11: los avisos del profesional funcionan como los del cliente: título, ✕, «Borrar los leídos» y los vistos con «✓ Visto»
  {
    const sofN = "(select id from providers where name like 'Sofía%')";
    ok("7/11: cada aviso del profesional lleva su título y su ✕, y arriba «Borrar los leídos»",
       /Nuevo seguidor/.test(bellTxt) && (await pg.locator(".bellpanel [data-act=noticeDel]").count()) >= 2 && (await pg.locator(".bellpanel [data-act=noticeClear]").count()) === 1);
    const n0 = await pg.locator(".bellpanel li[data-notice]").count();
    const first = await pg.locator(".bellpanel li[data-notice]").first().getAttribute("data-notice");
    await pg.click(`.bellpanel li[data-notice="${first}"] [data-act=noticeDel]`); await wait(800);
    ok("7/11: la ✕ borra ese aviso (queda en la base como borrado) y la campanita sigue abierta",
       (await pg.locator(".bellpanel li[data-notice]").count()) === n0 - 1 && (await q("select dismissed_at is not null d from provider_notices where id = $1", [first]))[0].d);
    await pg.keyboard.press("Escape"); await wait(200);
    await pg.click("nav [data-act=bellToggle]"); await wait(400);
    ok("7/11: al volver a abrirla, los vistos van más pálidos y con «✓ Visto»",
       (await pg.locator(".bellpanel li.seen").count()) === n0 - 1 && /✓ Visto/.test(await pg.locator(".bellpanel").innerText())
       && (await pg.locator(".bellpanel li.seen > div").first().evaluate((el) => +getComputedStyle(el).opacity)) < 1);
    await pg.click(".bellpanel [data-act=noticeClear]"); await wait(1000);
    ok("7/11: «Borrar los leídos» vacía la lista del profesional (y en la base)", (await pg.locator(".bellpanel li[data-notice]").count()) === 0
       && (await q(`select count(*)::int c from provider_notices where provider_id = ${sofN} and dismissed_at is null`))[0].c === 0);
    await pg.keyboard.press("Escape"); await wait(200);
    // (las pruebas de más abajo usan esos avisos: vuelven a la lista)
    await q(`update provider_notices set dismissed_at = null where provider_id = ${sofN}`);
    await pg.evaluate(async () => { await api.refreshCommunity(); render(); }).catch(() => {});
  }
  await wait(1700); await pg.keyboard.press("Escape"); await wait(300);
  {
    // v2 · Profesional: menú en el orden nuevo, todo a la vista y sin flechas; "Ver mi perfil como cliente" en la Agenda
    const tabs = await pg.locator(".btabs [data-btab]").evaluateAll((els) => els.map((el) => [el.dataset.btab, el.querySelector(".bt-l").innerText.trim(), (() => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 40; })()]));
    ok("v2: menú del panel en el orden Agenda, Horarios, Finanzas, Productos, Estadísticas, Clientes, Trabajos, Perfil",
       tabs.map((x) => x[1]).join(",") === "Agenda,Horarios,Finanzas,Productos,Estadísticas,Clientes,Trabajos,Perfil", JSON.stringify(tabs));
    ok("v2: las 8 secciones se ven de entrada, sin desplazar ni flechas", tabs.every((x) => x[2]) && (await pg.locator(".tabarr").count()) === 0
       && (await pg.locator(".btabs").evaluate((el) => el.scrollWidth <= el.clientWidth)));
    await pg.click("[data-btab=agenda]"); await wait(300);
    ok("v2: «Ver mi perfil como cliente» está en la Agenda y no en la cabecera del panel", (await pg.locator(".pb-main [data-act=preview]").count()) === 1 && (await pg.locator(".bhead [data-act=preview], .pb-side > [data-act=preview]").count()) === 0);
    await pg.click("nav .acct-btn"); await pg.waitForSelector("#acctMenu:not([hidden])");
    const m = await pg.locator("#acctMenu").innerText();
    ok("4/11: en el menú de cuenta del profesional, «Mi perfil» (la pestaña Perfil) y «Ajustes» (Seguridad), sin «Ver mi perfil público»",
       /Mi perfil/.test(m) && /Ajustes/.test(m) && !/Ver mi perfil público/.test(m) && (await pg.locator('#acctMenu [data-act=toPanel][data-tab=perfil]').count()) === 1, m);
    await pg.keyboard.press("Escape"); await wait(200);
    await pg.click("[data-btab=horarios]"); await wait(300);
    ok("v2: Horarios ya no tiene «Copiar link» (queda en Trabajos)", (await pg.locator(".pb-main [data-act=copiarLink]").count()) === 0);
    await pg.click("[data-btab=comunidad]"); await wait(300);
    ok("v2: …y Trabajos sí", (await pg.locator(".pb-main [data-act=copiarLink]").count()) === 1);
    for (const [sec, label] of [["hhpanel", "Armar happy hour"], ["avisarpanel", "Avisar a seguidores"]]) {
      await pg.click("[data-btab=stats]"); await wait(400);
      const b = pg.locator(`[data-sec=${sec}]`); await b.scrollIntoViewIfNeeded(); await b.click(); await wait(400);
      const pos = await pg.evaluate((s) => [document.querySelector(".top").getBoundingClientRect().bottom, document.querySelector("." + s).getBoundingClientRect().top], sec);
      ok(`v2: «${label}» deja su sección justo debajo de la cabecera fija`, pos[1] >= pos[0] && pos[1] - pos[0] <= 30, JSON.stringify(pos));
    }
    await pg.click("[data-btab=perfil]"); await wait(300);
    ok("9/11: Perfil tiene el plazo de acreditación en «Cobros con Mercado Pago», con su explicación", (await pg.locator('.mpcobros input[name="pterm"]').count()) === 4 && /Elegí el mismo plazo que tenés en tu cuenta de Mercado Pago/.test(await pg.locator(".mpcobros").innerText()));
    await pg.click("[data-btab=agenda]"); await wait(300);
  }
  ok("Bloque 1: abrir la campanita marca los avisos leídos (4/11; antes, «Entendido»)", (await pg.locator("nav .bell-n").count()) === 0 && (await q("select count(*)::int c from provider_notices n join providers p on p.id=n.provider_id where p.name like 'Sofía%' and n.read_at is null"))[0].c === 0);
  const accBefore = (await q("select id, mp_user_id from mp_accounts where provider_id=$1 and status='active'", [sofi]))[0];
  await pg.click("[data-btab=perfil]"); await wait(300);
  ok("Bloque 1: Mercado Pago conectado, con el número de cuenta (no el texto de la demo)", (await txt()).includes("Mercado Pago conectado") && (await txt()).includes("Cuenta n° " + accBefore.mp_user_id) && !(await txt()).includes("hidro.style.mp"));
  // (cuántos turnos futuros pagados tiene depende de la fecha: el bloqueo de días puede haber cancelado alguno)
  const futurePaid = (await q("select count(*)::int c from bookings where provider_id=$1 and status='confirmed' and source='app' and starts_at > now() and paid_mp > 0", [sofi]))[0].c;
  await pg.click("[data-act=mpDesc]"); await wait(300);
  const ask = await pg.locator(".mpask").innerText().catch(() => "");
  ok("H23: antes de desconectar explica qué pasa (reservas nuevas, turnos confirmados, devoluciones y cuántos turnos pagados tiene)",
     /No vas a poder recibir reservas nuevas con seña/.test(ask) && /Tus turnos ya confirmados siguen en pie/.test(ask) && /se devuelve desde esta cuenta/.test(ask)
     && (futurePaid ? new RegExp(`Tenés ${futurePaid} turnos? futuros? con la seña pagada`).test(ask) : !/con la seña pagada/.test(ask)));
  await pg.click("[data-act=mpDescOk]"); await wait(1500);
  const accAfter = (await q("select status, access_token is not null as key from mp_accounts where id=$1", [accBefore.id]))[0];
  ok("H23: desconecta de verdad: la cuenta queda solo para devoluciones (con su llave) y mp_connected en false",
     accAfter.status === "refunds_only" && accAfter.key && (await q("select mp_connected from provider_private where provider_id=$1", [sofi]))[0].mp_connected === false);
  ok("H23: el prestador ve que hoy no puede cobrar", /Mercado Pago sin conectar/.test(await txt()) && /Hoy no podés cobrar señas/.test(await txt()) && /Sin Mercado Pago conectado/.test(await txt())
     && (!futurePaid || /desde tu cuenta anterior/.test(await txt())));
  await menu("[data-act=salirBarbero]"); await wait(600);
  await pg.goto(BASE + "/p/" + sofi); await pg.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("H23: su perfil público dice que todavía no toma turnos online (con Seguir) y no deja elegir horario",
     /Todavía no toma turnos online/.test(await txt()) && (await pg.locator(".bookbar").count()) === 0 && (await pg.locator("[data-slot]").count()) === 0);
  // D22 (H25): con la cuenta desconectada, una clienta con la tarjeta llena igual puede canjear su premio
  await db.query("update loyalty_cards set stamps = 16 where user_id = (select id from auth.users where email='ana@test.ar') and service_id = $1", [esm]);
  await pg.click("nav [data-act=authOpen]"); await wait();
  await pg.fill("#ai_e", "ana@test.ar"); await pg.fill("#ai_p", "cliente12345"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  await pg.goto(BASE + "/p/" + sofi); await pg.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("D22: sin Mercado Pago, la clienta con la tarjeta llena ve “Solo podés canjear tu premio”", /Solo podés canjear tu premio/.test(await txt()) && !/Todavía no toma turnos online/.test(await txt()));
  await pg.click(".panel [data-svc]"); await wait(400);
  ok("D22: elige el servicio del premio y aparece el selector de horario, sin seña", (await pg.locator("[data-slot]").count()) > 0 && /no lleva seña ni comisión/.test(await txt()));
  const rewardsBefore = (await q("select count(*)::int c from bookings where pay_method = 'reward'"))[0].c;
  await turnoConMargen(pg); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno", { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("D22: en el pago solo queda “Usar mi premio”", (await pg.locator("[data-paym=reward]").count()) === 1 && (await pg.locator("[data-paym=mp]").count()) === 0);
  await pg.click("#fTurno button[type=submit]"); await wait(1500);
  ok("D22: el premio queda reservado sin pago", (await q("select count(*)::int c from bookings where pay_method = 'reward' and status = 'confirmed'"))[0].c === rewardsBefore + 1);
  {
    // 4/11 · Bloque 2: Seguridad → Cambiar contraseña: la actual, la nueva y el código que manda Supabase (reautenticación)
    await pg.goto(BASE + "/cuenta/ajustes"); await pg.waitForSelector("[data-act=changePass]", { timeout: 8000 }).catch(() => {});
    await pg.click("[data-act=changePass]"); await pg.waitForSelector("#np0", { timeout: 8000 }).catch(() => {});
    const reauths = async () => (await (await fetch(BASE + "/__log")).json()).filter((x) => x.reauth).length;
    const r0 = await reauths();
    ok("4/11: Cambiar contraseña pide la actual, la nueva y repetirla", (await pg.locator("#np0").count()) === 1 && (await pg.locator("#np1").count()) === 1 && (await pg.locator("#np2").count()) === 1);
    probing = true;
    await pg.fill("#np0", "no-es-esta-1"); await pg.fill("#np1", "Nueva2026ana"); await pg.fill("#np2", "Nueva2026ana"); await pg.click("#fNewPass button[type=submit]"); await wait(800);
    probing = false;
    ok("4/11: con la contraseña actual equivocada no sigue (y no manda ningún código)", (await pg.locator("#nperr").innerText()).includes("La contraseña actual no es correcta") && (await reauths()) === r0);
    await pg.fill("#np0", "cliente12345"); await pg.click("#fNewPass button[type=submit]"); await pg.waitForSelector("#np_c", { timeout: 8000 }).catch(() => {});
    ok("4/11: con la actual bien, Supabase manda el código de reautenticación y la app lo pide", (await pg.locator("#np_c").count()) === 1 && (await reauths()) === r0 + 1 && /Revisá tu email/.test(await txt()));
    probing = true; await pg.fill("#np_c", "111111"); await pg.click("#fNewPassCode button[type=submit]"); await wait(800); probing = false;
    ok("4/11: con un código equivocado no cambia", (await pg.locator("#nperr").innerText()).includes("El código no es correcto") && (await q("select encrypted_password p from auth.users where email='ana@test.ar'"))[0].p === "cliente12345");
    await pg.fill("#np_c", "123456"); await pg.click("#fNewPassCode button[type=submit]"); await pg.waitForURL(/\/cuenta\/ajustes$/, { timeout: 8000 }).catch(() => {}); await wait(400);
    ok("4/11: con el código bien, la contraseña cambia y sigue con la sesión abierta",
       (await q("select encrypted_password p from auth.users where email='ana@test.ar'"))[0].p === "Nueva2026ana" && new URL(pg.url()).pathname === "/cuenta/ajustes" && (await pg.locator("nav .acct-btn").count()) === 1);
    // la de antes, para lo que sigue
    await db.query("update auth.users set encrypted_password = 'cliente12345' where email = 'ana@test.ar'");
  }
  await menu("[data-act=logout]"); await wait(800);
  // "Volver al panel" cierra la sesión del prestador: se vuelve a ingresar y la app vuelve a Perfil (?volver=)
  await pg.goto(BASE + "/panel/perfil"); await pg.waitForSelector("#fLogin", { timeout: 8000 }).catch(() => {}); await wait(400);
  ok("ingreso: una dirección del panel sin sesión lleva al mismo ingreso, con ?volver=", new URL(pg.url()).pathname === "/ingresar" && new URL(pg.url()).searchParams.get("volver") === "/panel/perfil");
  await pg.fill("#ai_e", "sofia@test.ar"); await pg.fill("#ai_p", "prestador123"); await pg.click("#fLogin button[type=submit]"); await pg.waitForSelector("[data-act=mpConnect]", { timeout: 8000 }).catch(() => {}); await wait(400);
  // vuelta de Mercado Pago sin conectar (mp-oauth → ?mp_connected=0&mp_error=…): al Perfil, con el motivo a la vista
  await pg.goto(BASE + "/?mp_connected=0&mp_error=cuenta_tutiempo"); await pg.waitForSelector(".mp-back", { timeout: 8000 }).catch(() => {}); await wait(400);
  ok("MP: si no se conectó, vuelve al Perfil del panel y dice por qué (la cuenta es la de TuTiempo)", new URL(pg.url()).pathname === "/panel/perfil" && !pg.url().includes("mp_connected")
     && /esa cuenta de Mercado Pago es la de TuTiempo/.test(await txt()) && /Mercado Pago sin conectar/.test(await txt()));
  await pg.goto(BASE + "/?mp_connected=0&mp_error=cualquiera"); await pg.waitForSelector(".mp-back", { timeout: 8000 }).catch(() => {}); await wait(400);
  ok("MP: un motivo desconocido muestra el aviso general (no el texto de la dirección)", /No pudimos conectar tu cuenta de Mercado Pago/.test(await txt()) && !/cualquiera/.test(await txt()));
  await Promise.all([pg.waitForURL(/mp_connected=1/, { timeout: 8000 }).catch(() => {}), pg.click("[data-act=mpConnect]")]); await wait(1500);
  const accRe = (await q("select id from mp_accounts where provider_id=$1 and status='active'", [sofi]))[0];
  ok("H23: reconectar la misma cuenta vuelve a cobrar con la misma fila", accRe && accRe.id === accBefore.id);
  ok("MP: al conectar vuelve al Perfil con Mercado Pago conectado y sin el aviso de error", new URL(pg.url()).pathname === "/panel/perfil"
     && /Mercado Pago conectado/.test(await txt()) && (await pg.locator(".mp-back").count()) === 0);

  // H21: en vivo no se descarta a nadie por cómo se llama (antes "Bruno F." quedaba afuera por parecer relleno de la demo)
  await db.query("insert into provider_clients (provider_id, name) values ($1, 'Bruno F.')", [sofi]);
  await pg.evaluate(async () => { await api.loadMine(); S.role = "barbero"; S.btab = "clientes"; S.cli = null; S.cf = "todos"; S.msgOpen = S.contactOpen = false; render() }); await wait(600);
  ok("H21: un cliente real llamado “Bruno F.” aparece en la lista de clientes", (await pg.locator('.clist [data-cli="Bruno F."]').count()) === 1);
  // ---------- Bloque 2b (H10): alta de prestador sin DNI en los metadatos; DNI y fotos después; activar = verificar ----------
  const ctx2 = await b.newContext({ viewport: { width: 400, height: 900 } }); let p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errs.push(e.message));
  const wait2 = (ms = 400) => p2.waitForTimeout(ms); const txt2 = () => p2.locator("#app").innerText();
  // Registrá tu negocio (aprobado el 1/11): paso 0 la cuenta, después los 5 pasos; la intención viaja en la cuenta
  await p2.goto(BASE + "/registrar-negocio"); await p2.waitForSelector("#fSignup");
  ok("alta: /registrar-negocio sin sesión es Crear cuenta con «Tengo un negocio» elegido, sin celular ni DNI", (await kindOf(p2)) === "biz" && (await p2.locator("#au_t, #dniN").count()) === 0);
  await p2.fill("#au_n", "Nora Nuevas"); await p2.fill("#au_e", "nuevas@test.ar"); await p2.fill("#au_p", "Clave2026xy"); await p2.check("#au_ok", { force: true });
  await p2.click("#fSignup button[type=submit]"); await p2.waitForSelector(".am-mail"); await wait2(300);
  const conf2 = await txt2();
  ok("alta: Revisá tu email, con la línea para quien ya tenía cuenta", conf2.includes("Revisá tu email") && conf2.includes("seguís con tu negocio") && conf2.includes("¿No te llega? Si ya tenías cuenta, ingresá o recuperá tu contraseña.")
     && (await p2.locator(".am-note [data-act=authMode][data-m=in]").count()) === 1 && (await p2.locator(".am-note [data-act=authMode][data-m=forgot]").count()) === 1);
  const meta = (await q("select raw_user_meta_data m from auth.users where email='nuevas@test.ar'"))[0].m;
  ok("alta: la cuenta guarda solo la intención (registrar un negocio), sin datos del negocio ni DNI", meta.tt_pending && meta.tt_pending.a === "negocio" && !meta.provider_reg && !JSON.stringify(meta).includes("dni"));
  ok("alta: todavía no hay negocio (se crea en el paso 1)", (await q("select count(*)::int c from providers p join auth.users u on u.id=p.owner_id where u.email='nuevas@test.ar'"))[0].c === 0);
  // el link del email se abre en otro navegador (otro celular): sigue igual con el paso 1
  await ctx2.close();
  const ctx2b = await b.newContext({ viewport: { width: 400, height: 900 } }); const p2b = await ctx2b.newPage(); p2b.on("pageerror", (e) => errs.push(e.message));
  await p2b.goto(BASE + "/?token_hash=" + (await mailOf("nuevas@test.ar")).signup + "&type=signup"); await p2b.waitForSelector("#fBiz1", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(400);
  ok("alta: el link del email abierto en otro navegador sigue en el paso 1", new URL(p2b.url()).pathname === "/registrar-negocio/1" && (await p2b.isVisible("#fBiz1")));
  ok("alta: la intención se usa una vez y se borra de la cuenta", await until("select raw_user_meta_data m from auth.users where email='nuevas@test.ar'", [], (r) => r[0].m.tt_pending === null || r[0].m.tt_pending === undefined));
  ok("alta: en el celular, «Paso 1 de 5» con la barra", (await p2b.locator(".biz-prog").innerText()).includes("Paso 1 de 5") && !(await p2b.isVisible(".biz-steps")));
  // paso 1 con un error y corregido
  await p2b.fill("#bn", "Uñas Nuevas"); await p2b.click("#fBiz1 button[type=submit]"); await p2b.waitForTimeout(400);
  ok("alta paso 1: sin rubro ni celular lo marca al lado de cada campo y no crea nada", (await p2b.locator("#berr-cats").count()) === 1 && (await p2b.locator("#berr-bt").count()) === 1
     && (await q("select count(*)::int c from providers where name='Uñas Nuevas'"))[0].c === 0);
  await p2b.check("#bc-u", { force: true }); await p2b.fill("#ba", "Hornos 300"); await p2b.fill("#bt", "2284 555666"); await p2b.fill("#bi", "@unas.nuevas");
  await p2b.click("#fBiz1 button[type=submit]"); await p2b.waitForSelector("#fBiz2", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(400);
  const np = (await q("select p.id, p.status, p.instagram, pp.dni_number, pp.phone, ps.setup_done from providers p join provider_private pp on pp.provider_id=p.id join provider_settings ps on ps.provider_id=p.id join auth.users u on u.id=p.owner_id where u.email='nuevas@test.ar'"))[0];
  ok("alta paso 1: crea el negocio pendiente, con el celular privado y el Instagram, sin DNI", np && np.status === "pending" && np.dni_number === null && np.phone === "2284 555666" && np.instagram === "unas.nuevas" && JSON.stringify(np.setup_done) === "[1]");
  ok("alta paso 2: ejemplos de uñas para tocar y agregar", new URL(p2b.url()).pathname === "/registrar-negocio/2" && /Esmaltado semipermanente · 60 min/.test(await p2b.locator(".biz-chips").innerText()));
  await p2b.click("#fBiz2 button[type=submit]"); await p2b.waitForTimeout(400);
  ok("alta paso 2: sin servicios no sigue", new URL(p2b.url()).pathname === "/registrar-negocio/2" && /al menos un servicio/.test(await p2b.locator("#bizErr").innerText()));
  await p2b.click('[data-act=bizEx][data-n="Esmaltado semipermanente"]'); await p2b.fill("#bsp0", "12000");
  await p2b.click("#fBiz2 button[type=submit]"); await p2b.waitForSelector("#fBiz3", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(400);
  ok("alta paso 2: el servicio queda en la base con su duración y precio", (await q("select count(*)::int c from services where provider_id=$1 and name='Esmaltado semipermanente' and duration_min=60 and price=12000 and active", [np.id]))[0].c === 1);
  // sale en el paso 3 y vuelve: la Agenda le muestra lo que falta y "Seguir con el alta" lo lleva al paso 3
  await p2b.goto(BASE + "/"); await p2b.waitForSelector(".btabs", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(500);
  const todo2 = await p2b.locator(".todo").innerText().catch(() => "");
  ok("alta: al volver entra a su Agenda, con «Te falta poco» y lo que falta", new URL(p2b.url()).pathname === "/panel/agenda" && todo2.includes("Te falta poco para recibir reservas") && todo2.includes("Conectar Mercado Pago") && (await p2b.locator(".todo [data-act=bizStart]").count()) === 1, todo2);
  await p2b.click(".todo [data-act=bizStart]"); await p2b.waitForSelector("#fBiz3", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(300);
  ok("alta: «Seguir con el alta» abre el paso 3, donde había quedado", new URL(p2b.url()).pathname === "/registrar-negocio/3");
  ok("alta paso 3: las 4 plantillas", (await p2b.locator("[data-act=bizTpl]").count()) === 4 && /Martes a sábado, 10 a 20/.test(await p2b.locator(".biz-opt").innerText()));
  await p2b.click('[data-act=bizTpl][data-k=ms]'); await p2b.waitForTimeout(200);
  await p2b.click("#fBiz3 button[type=submit]"); await p2b.waitForSelector("[data-act=bizNext]", { timeout: 8000 }).catch(() => {}); await p2b.waitForTimeout(300);
  const hrs = await q("select dow, opens::text o, closes::text c from provider_hours where provider_id=$1 order by dow", [np.id]);
  ok("alta paso 3: martes a sábado de 10 a 20 en la base", hrs.length === 5 && hrs.every((h, i) => h.dow === i + 2 && h.o.startsWith("10:00") && h.c.startsWith("20:00")), JSON.stringify(hrs));
  // 4/11 · Bloque 4: la seña es fija (30%) y el profesional elige su plazo de Mercado Pago (con la tabla del admin)
  ok("4/11: el alta muestra la seña fija del 30% (sin elegir otra ni el total) y los 4 plazos",
     (await p2b.locator("[data-act=bizPay]").count()) === 0 && /Seña: 30% del servicio/.test(await p2b.locator("#app").innerText())
     && (await p2b.locator('input[name="hterm"]').count()) === 4 && (await p2b.locator('input[name="hterm"][value="instant"]').isChecked()));
  ok("4/11: «Seña y cobro» explica que el plazo es el de su cuenta de Mercado Pago y que sin MP no hay reservas",
     /mismo plazo que tenés en tu cuenta de Mercado Pago[\s\S]*Sin Mercado Pago conectado no recibís reservas/.test(await p2b.locator("#app").innerText()));
  await p2b.click('label.termopt:has(input[value="d18"])'); await p2b.click("[data-act=bizNext]"); await p2b.waitForTimeout(800);
  const st2 = (await q("select deposit_pct, pay_mode, payout_term, setup_done from provider_settings where provider_id=$1", [np.id]))[0];
  ok("alta paso 4: seña del 30%, el plazo que eligió (18 días) y se puede seguir sin Mercado Pago", st2.deposit_pct === 30 && st2.pay_mode === "deposit" && st2.payout_term === "d18" && JSON.stringify(st2.setup_done) === "[1,2,3,4]" && new URL(p2b.url()).pathname === "/registrar-negocio/5", JSON.stringify(st2));
  ok("alta paso 5: con «Exigir DNI», pide número, frente y dorso", await p2b.isVisible("#fDni") && await p2b.isVisible("#dniFront") && await p2b.isVisible("#dniBack"));
  ok("D24 (7/11 · Bloque 6): el paso avisa que las fotos se borran al verificar", (await p2b.innerText("body")).includes("Las fotos se borran apenas te verificamos"));
  await p2b.click("[data-act=bizFinish]"); await p2b.waitForTimeout(300);
  ok("alta paso 5: sin el DNI no se envía (y queda guardado para seguir después)", /Para enviarlo falta el número, la foto del frente y la del dorso/.test(await p2b.locator("#bizErr").innerText()));
  p2 = p2b;
  const DNIF = (n) => ({ name: n + ".png", mimeType: "image/png", buffer: PNG.buffer });
  await p2.fill("#dniN", "30111222"); await p2.click("#fDni button[type=submit]"); await wait2(800);
  ok("H10: un DNI de otro prestador se rechaza con un mensaje claro", (await p2.locator("#toast").innerText().catch(() => "")).includes("ya está registrado")
     && (await q("select dni_number from provider_private where provider_id=$1", [np.id]))[0].dni_number === null);
  await p2.fill("#dniN", "33444555"); await p2.click("#fDni button[type=submit]"); await wait2(800);
  ok("H10: el número se guarda directo en provider_private", (await q("select dni_number from provider_private where provider_id=$1", [np.id]))[0].dni_number === "33444555");
  await p2.setInputFiles("#dniFront", DNIF("f")); await wait2(800);
  const uid2 = (await q("select id::text from auth.users where email='nuevas@test.ar'"))[0].id;
  ok("H10: el frente queda en el bucket dni, en su carpeta", (await q("select count(*)::int c from storage.objects where bucket_id='dni' and name like $1", [uid2 + "/frente-%.png"]))[0].c === 1);
  // el admin (Carla) no puede aprobar sin el dorso; con las dos fotos, aprobar = verificar
  const p3 = await ctx.newPage(); p3.on("pageerror", (e) => errs.push(e.message));
  await p3.goto(BASE); await p3.waitForTimeout(1000);
  if (!(await p3.evaluate(() => S.user && S.user.email === "carla@test.ar"))) {
    await p3.evaluate(() => sb.auth.signOut()); await p3.goto(BASE + "/ingresar"); await p3.waitForSelector("#ai_e");
    await p3.fill("#ai_e", "carla@test.ar"); await p3.fill("#ai_p", "Nueva2026zz"); await p3.click("#fLogin button[type=submit]"); await p3.waitForTimeout(1500);
  }
  await p3.goto(BASE + "/admin/prestadores"); await p3.waitForSelector("[data-act=admSet][data-s=active]", { timeout: 8000 }).catch(() => {}); await p3.waitForTimeout(500);
  ok("H10: el admin ve el número y qué fotos faltan", (await p3.locator("#app").innerText()).includes("DNI 33444555 · Frente ✓ · Dorso falta"));
  await p3.click(`[data-act=admSet][data-id="${np.id}"]`); await p3.waitForTimeout(1000);
  ok("H10: sin el dorso no se puede activar", (await q("select status from providers where id=$1", [np.id]))[0].status === "pending"
     && (await p3.locator("#toast").innerText().catch(() => "")).includes("Faltan las fotos del DNI"));
  await p2.setInputFiles("#dniBack", DNIF("d")); await wait2(800);
  await p3.goto(BASE + "/admin/prestadores"); await p3.waitForSelector(`[data-act=admDni][data-id="${np.id}"]`, { timeout: 8000 }).catch(() => {}); await p3.waitForTimeout(500);
  await p3.click(`[data-act=admDni][data-id="${np.id}"]`); await p3.waitForTimeout(800);
  const logDni = await (await fetch(BASE + "/__log")).json();
  ok("H10: el admin ve frente y dorso con URL firmada de 2 minutos", (await p3.locator("a.lnk", { hasText: "Frente" }).count()) === 1 && (await p3.locator("a.lnk", { hasText: "Dorso" }).count()) === 1
     && logDni.filter((x) => x.signed && x.signed.startsWith(uid2)).every((x) => x.expiresIn === 120));
  await p3.click(`[data-act=admSet][data-id="${np.id}"]`); await p3.waitForTimeout(1200);
  const ver = (await q("select p.status, p.dni_verified, pp.dni_verified_at is not null at, (select email from auth.users where id = pp.dni_verified_by) by from providers p join provider_private pp on pp.provider_id=p.id where p.id=$1", [np.id]))[0];
  ok("H10: aprobar = verificar, con quién y cuándo", ver.status === "active" && ver.dni_verified === true && ver.at && ver.by === "carla@test.ar");
  await p2.goto(BASE + "/registrar-negocio/5"); await p2.waitForSelector("[data-act=bizFinish]"); await wait2(300);
  await p2.click("[data-act=bizFinish]"); await p2.waitForURL(/registrar-negocio\/listo/, { timeout: 8000 }).catch(() => {}); await wait2(400);
  ok("alta: con el DNI completo se envía y queda en «¡Listo!» con lo que falta (Mercado Pago)", new URL(p2.url()).pathname === "/registrar-negocio/listo" && /¡Listo/.test(await txt2()) && /Conectar Mercado Pago/.test(await txt2())
     && JSON.stringify((await q("select setup_done from provider_settings where provider_id=$1", [np.id]))[0].setup_done) === "[1,2,3,4,5]");
  await p2.click(".biz-card [data-act=toPanel]"); await p2.waitForSelector(".btabs"); await wait2(500);
  const todoV = await p2.locator(".todo").innerText().catch(() => "");
  ok("Bloque D: verificado, en la Agenda solo falta Mercado Pago (sin la tarjeta vieja)", (await p2.locator(".setup").count()) === 0 && todoV.includes("○ Conectar Mercado Pago") && !todoV.includes("○ Verificación") && !todoV.includes("○ Aprobación") && (await p2.locator(".todo [data-act=mpConnect]").count()) === 1, todoV);
  // ---------- C29 (V5 resto): las tarjetas de sellos se apagan y se encienden desde Comisión ----------
  await p3.goto(BASE + "/admin/comision"); await p3.waitForSelector("[data-act=admStamps]");
  ok("C29: el interruptor de sellos está encendido", (await p3.getAttribute("[data-act=admStamps]", "aria-pressed")) === "true");
  await p3.click("[data-act=admStamps]"); await p3.waitForTimeout(1200);
  ok("C29: el admin apaga las tarjetas de sellos", (await q("select stamps_on from app_settings"))[0].stamps_on === false && (await p3.getAttribute("[data-act=admStamps]", "aria-pressed")) === "false"
     && /no se ven en ningún lado y no se suman sellos/.test(await p3.locator("#app").innerText()));
  await p3.click("[data-act=admStamps]"); await p3.waitForTimeout(1200);
  ok("C29: …y las vuelve a encender", (await q("select stamps_on from app_settings"))[0].stamps_on === true);
  // ---------- Bloque D (D26): "Exigir DNI para aprobar prestadores" apagada desde Comisión ----------
  await p3.goto(BASE + "/admin/comision"); await p3.waitForSelector("[data-act=admReqDni]");
  ok("D26: la opción está activada", (await p3.getAttribute("[data-act=admReqDni]", "aria-pressed")) === "true");
  await p3.click("[data-act=admReqDni]"); await p3.waitForTimeout(1200);
  ok("D26: el admin la apaga", (await q("select require_dni from app_settings"))[0].require_dni === false && (await p3.getAttribute("[data-act=admReqDni]", "aria-pressed")) === "false");
  const ctx4 = await b.newContext({ viewport: { width: 400, height: 900 } }); const p4 = await ctx4.newPage();
  p4.on("pageerror", (e) => errs.push(e.message));
  // D32 / 8/11: el alta desde Crear cuenta cambiando de opción (después de escribir: no se pierde nada) y sin DNI exigido
  await p4.goto(BASE + "/crear-cuenta"); await p4.waitForSelector(".kindpick");
  await p4.click(".kindopt[data-k=client]"); await p4.waitForSelector("#fSignup");
  await p4.fill("#au_n", "Mara Sin DNI"); await p4.fill("#au_e", "sindni@test.ar"); await p4.fill("#au_p", "Clave2026zz");
  await p4.click(".kindsel [data-act=authKind]"); await p4.waitForTimeout(300); await p4.click(".kindopt[data-k=biz]"); await p4.waitForTimeout(300);
  ok("8/11: cambiar a «Tengo un negocio» en /crear-cuenta deja lo escrito (nombre, email y contraseña) y prepara el negocio",
     (await p4.inputValue("#au_n")) === "Mara Sin DNI" && (await p4.inputValue("#au_e")) === "sindni@test.ar" && (await p4.inputValue("#au_p")) === "Clave2026zz"
     && (await p4.evaluate(() => S.pending && S.pending.a)) === "negocio" && /seguir con mi negocio/i.test(await p4.locator("#fSignup button[type=submit]").innerText()) && (await p4.locator("#au_t").count()) === 0);
  await p4.click(".kindsel [data-act=authKind]"); await p4.waitForTimeout(300); await p4.click(".kindopt[data-k=client]"); await p4.waitForTimeout(300);
  ok("8/11: volver a «Quiero reservar turnos» deja la cuenta de cliente (con el celular opcional)", !(await p4.evaluate(() => S.pending)) && (await p4.locator("#au_t").count()) === 1 && (await p4.inputValue("#au_n")) === "Mara Sin DNI");
  await p4.click(".kindsel [data-act=authKind]"); await p4.waitForTimeout(300); await p4.click(".kindopt[data-k=biz]"); await p4.waitForTimeout(300); await p4.check("#au_ok", { force: true });
  await p4.click("#fSignup button[type=submit]"); await p4.waitForTimeout(1200);
  await p4.goto(BASE + "/?token_hash=" + (await mailOf("sindni@test.ar")).signup + "&type=signup"); await p4.waitForSelector("#fBiz1", { timeout: 8000 }).catch(() => {}); await p4.waitForTimeout(400);
  await p4.fill("#bn", "Masajes Sin DNI"); await p4.check("#bc-m", { force: true }); await p4.fill("#bt", "2284 555777"); await p4.click("#fBiz1 button[type=submit]"); await p4.waitForSelector("#fBiz2", { timeout: 8000 }).catch(() => {});
  await p4.click('[data-act=bizEx][data-n="Relajante"]'); await p4.fill("#bsp0", "15000"); await p4.click("#fBiz2 button[type=submit]"); await p4.waitForSelector("#fBiz3", { timeout: 8000 }).catch(() => {});
  await p4.click("#fBiz3 button[type=submit]"); await p4.waitForSelector("[data-act=bizNext]", { timeout: 8000 }).catch(() => {}); await p4.click("[data-act=bizNext]"); await p4.waitForSelector("[data-act=bizFinish]", { timeout: 8000 }).catch(() => {});
  const step5 = await p4.locator(".biz-card").innerText().catch(() => "");
  ok("D26: sin DNI exigido, el paso 5 dice Aprobación de TuTiempo y no pide el DNI", step5.includes("Aprobación de TuTiempo") && (await p4.locator("#fDni").count()) === 0);
  ok("alta paso 3: sin tocar nada queda la plantilla sugerida (lunes a viernes de 9 a 18)", (await q("select count(*)::int c from provider_hours h join providers p on p.id=h.provider_id where p.name='Masajes Sin DNI' and h.opens='09:00' and h.closes='18:00'"))[0].c === 5);
  await p4.click("[data-act=bizFinish]"); await p4.waitForURL(/registrar-negocio\/listo/, { timeout: 8000 }).catch(() => {});
  ok("alta: sin DNI se envía directo", new URL(p4.url()).pathname === "/registrar-negocio/listo");
  const sd = (await q("select p.id from providers p join auth.users u on u.id=p.owner_id where u.email='sindni@test.ar'"))[0];
  await p3.goto(BASE + "/admin/prestadores"); await p3.waitForSelector(`[data-act=admSet][data-id="${sd.id}"]`, { timeout: 8000 }).catch(() => {}); await p3.waitForTimeout(500);
  ok("D26: el admin lo ve en Para aprobar, sin la línea del DNI", (await p3.locator("#app").innerText()).toLowerCase().includes("para aprobar") && (await p3.locator(`[data-act=admDni][data-id="${sd.id}"]`).count()) === 0);
  await p3.click(`[data-act=admSet][data-id="${sd.id}"]`); await p3.waitForTimeout(1200);
  const sv = (await q("select status, dni_verified from providers where id=$1", [sd.id]))[0];
  ok("D26: se aprueba sin DNI y sin el sello de identidad verificada", sv.status === "active" && sv.dni_verified === false);
  await p4.goto(BASE + "/panel/agenda"); await p4.waitForSelector(".btabs"); await p4.waitForTimeout(500);
  const todo4 = await p4.locator(".todo").innerText().catch(() => "");
  ok("D26: aprobado, en la Agenda solo falta Mercado Pago", (await p4.locator(".setup").count()) === 0 && todo4.includes("✓ Aprobación de TuTiempo") && todo4.includes("○ Conectar Mercado Pago"), todo4);
  await p3.goto(BASE + "/admin/comision"); await p3.waitForSelector("[data-act=admReqDni]"); await p3.click("[data-act=admReqDni]"); await p3.waitForTimeout(1200);
  ok("D26: el admin la vuelve a activar", (await q("select require_dni from app_settings"))[0].require_dni === true);
  await ctx4.close();
  await p3.close(); await ctx2b.close();
  // ---------- Ingreso y registro: la acción que pidió ingresar sigue sola ----------
  const ctx6 = await b.newContext({ viewport: { width: 1366, height: 900 } }); const p6 = await ctx6.newPage(); p6.on("pageerror", (e) => errs.push(e.message));
  const sofiaPath = "/" + (await q("select slug from providers where name like 'Sofía%'"))[0].slug;
  await p6.goto(BASE + sofiaPath); await p6.waitForSelector(".sgroup"); await p6.waitForTimeout(400);
  await p6.click("[data-act=seguir]"); await p6.waitForTimeout(300);
  ok("ingreso: en la compu el foco va al primer campo (el email)", (await p6.evaluate(() => document.activeElement && document.activeElement.id)) === "ai_e");
  ok("pendiente: Seguir sin sesión abre la ventana con el ticket «Seguir a…»", (await p6.locator(".authmodal .tk[data-ticket=seguir]").innerText().catch(() => "")).includes("Al ingresar queda hecho") && (await p6.locator("#amTitle").innerText()).includes("Ingresá para seguir"));
  await p6.click(".authmodal [data-act=authMode][data-m=up]"); await p6.waitForTimeout(200);
  ok("pendiente: el ticket sigue en Crear cuenta", (await p6.locator(".authmodal .tk[data-ticket=seguir]").count()) === 1);
  await p6.fill("#au_n", "Luz Pérez"); await p6.fill("#au_e", "luz@test.ar"); await p6.fill("#au_p", "Luz2026clave"); await p6.check("#au_ok", { force: true });
  await p6.click("#fSignup button[type=submit]"); await p6.waitForSelector(".am-mail"); await p6.waitForTimeout(200);
  ok("pendiente: Revisá tu email dice que se retoma lo que estaba haciendo", /seguís donde lo dejaste/.test(await p6.locator(".authmodal").innerText()) && (await p6.locator(".authmodal .tk").count()) === 1);
  await p6.goto(BASE + "/?token_hash=" + (await mailOf("luz@test.ar")).signup + "&type=signup"); await p6.waitForTimeout(1800);
  ok("pendiente: al tocar el link queda siguiendo, en el perfil del prestador", new URL(p6.url()).pathname === sofiaPath
     && (await q("select count(*)::int c from follows f join auth.users u on u.id=f.user_id where u.email='luz@test.ar'"))[0].c === 1);
  // reservar: crea la cuenta desde el ticket y abre el link en otro navegador → directo al pago con ese horario
  await p6.evaluate(() => document.querySelector("[data-act=logout]") ? document.querySelector("[data-act=logout]").click() : null); await p6.waitForTimeout(800);
  await p6.goto(BASE + sofiaPath); await p6.waitForSelector(".sgroup"); await p6.click(".sgroup.seg-u .svci"); await p6.waitForTimeout(200); await turnoConMargen(p6);
  const pick = await p6.evaluate(() => S.slot && { day: S.slot.date, time: S.slot.time });
  await p6.click("[data-act=reservarT]"); await p6.waitForTimeout(300);
  await p6.click(".authmodal [data-act=authMode][data-m=up]"); await p6.waitForTimeout(200);
  await p6.fill("#au_n", "Lola Gómez"); await p6.fill("#au_e", "lola@test.ar"); await p6.fill("#au_p", "Clave2026lg"); await p6.check("#au_ok", { force: true });
  await p6.click("#fSignup button[type=submit]"); await p6.waitForSelector(".am-mail"); await p6.waitForTimeout(200);
  const ctx7 = await b.newContext({ viewport: { width: 390, height: 844 } }); const p7 = await ctx7.newPage(); p7.on("pageerror", (e) => errs.push(e.message));
  await p7.goto(BASE + "/?token_hash=" + (await mailOf("lola@test.ar")).signup + "&type=signup"); await p7.waitForSelector("#fTurno", { timeout: 8000 }).catch(() => {}); await p7.waitForTimeout(300);
  const back7 = new URL(p7.url());
  ok("pendiente: el link del email en otro celular lleva directo a «Confirmá tu turno» con ese horario", (await p7.isVisible("#fTurno")) && back7.pathname === sofiaPath + "/reservar" && back7.searchParams.get("dia") === pick.day && back7.searchParams.get("hora") === pick.time, p7.url());
  await ctx7.close();
  // el horario lo toma otro mientras ingresa: lo dice y deja la ficha en ese día (sin cobrar nada)
  await p6.goto(BASE + "/"); await p6.waitForTimeout(800);
  if (await p6.evaluate(() => !!S.user)) { await p6.evaluate(() => document.querySelector("[data-act=logout]").click()); await p6.waitForTimeout(800); }
  await p6.goto(BASE + sofiaPath); await p6.waitForSelector(".sgroup"); await p6.click(".sgroup.seg-u .svci"); await p6.waitForTimeout(200); await turnoConMargen(p6);
  const pick2 = await p6.evaluate(() => S.slot && { day: S.slot.date, time: S.slot.time });
  await p6.click("[data-act=reservarT]"); await p6.waitForTimeout(300);
  await db.query("insert into bookings (provider_id, client_name, service_name, source, status, starts_at, ends_at) select p.id, 'Ocupado', 'Otro', 'manual', 'confirmed', ($1::date + $2::time) at time zone 'America/Argentina/Buenos_Aires', ($1::date + $2::time + interval '60 minutes') at time zone 'America/Argentina/Buenos_Aires' from providers p where p.name like 'Sofía%'", [pick2.day, pick2.time]);
  const holdsBefore = (await q("select count(*)::int c from bookings where status='hold'"))[0].c;
  await p6.fill("#ai_e", "luz@test.ar"); await p6.fill("#ai_p", "Luz2026clave"); await p6.click("#fLogin button[type=submit]"); await p6.waitForTimeout(1500);
  ok("pendiente: si el horario ya lo tomó otro, lo dice y deja la ficha abierta en ese día, sin cobrar", (await p6.evaluate(() => S.view)) === "perfil" && (await p6.evaluate(() => S.day)) === pick2.day
     && /ya no está libre/i.test(await p6.locator("#toast").innerText().catch(() => "")) && (await q("select count(*)::int c from bookings where status='hold'"))[0].c === holdsBefore,
     JSON.stringify([await p6.evaluate(() => [S.view, S.day, location.pathname]), pick2, await p6.locator("#toast").innerText().catch(() => "")]));
  await ctx6.close();
  // ---------- D33: una cuenta es de cliente o de negocio ----------
  const ctx8 = await b.newContext({ viewport: { width: 1366, height: 900 } }); const p8 = await ctx8.newPage(); p8.on("pageerror", (e) => errs.push(e.message));
  await p8.goto(BASE + "/ingresar"); await p8.waitForSelector("#fLogin");
  await p8.fill("#ai_e", "sofia@test.ar"); await p8.fill("#ai_p", "prestador123"); await p8.click("#fLogin button[type=submit]"); await p8.waitForSelector(".bhead", { timeout: 8000 }).catch(() => {}); await p8.waitForTimeout(400);
  ok("C13: desde /ingresar, el prestador entra a su Agenda", new URL(p8.url()).pathname === "/panel/agenda", p8.url() + " " + (await p8.locator("#app").innerText().catch(() => "")).slice(0, 300));
  await p8.click("nav .acct-btn"); await p8.waitForSelector("#acctMenu:not([hidden])");
  const menu8 = await p8.locator("#acctMenu").innerText();
  ok("D33: el menú de la cuenta de negocio no tiene Mis turnos ni Reservar como cliente", menu8.includes("Mi agenda") && menu8.includes("Ajustes") && !/Reservar como cliente|Mis turnos|Ver mi perfil público/.test(menu8), menu8);
  await p8.keyboard.press("Escape");
  await p8.goto(BASE + "/mis-turnos"); await p8.waitForTimeout(900);
  ok("D33: /mis-turnos con una cuenta de negocio lleva a su Agenda", new URL(p8.url()).pathname === "/panel/agenda");
  // en un perfil: Reservar y Seguir avisan que una cuenta de negocio no puede
  await p8.goto(BASE + sofiaPath); await p8.waitForSelector(".sgroup"); await p8.waitForTimeout(300);
  ok("D33: navegando el sitio, la cuenta de negocio tiene el mismo menú (sin la barra «reservando como cliente»)", (await p8.locator(".asclient").count()) === 0);
  await p8.click(".sgroup.seg-u .svci"); await p8.waitForTimeout(200); await turnoConMargen(p8);
  const pick8 = await p8.evaluate(() => S.slot && { day: S.slot.date, time: S.slot.time });
  await p8.click("[data-act=reservarT]"); await p8.waitForTimeout(300);
  ok("D33: Reservar con una cuenta de negocio: el aviso y la salida a la cuenta personal", (await p8.locator("#amTitle").innerText()).includes("Las cuentas de negocio no pueden reservar")
     && (await p8.locator(".authmodal [data-act=bizSwitch]").innerText()).includes("Cerrar sesión e ingresar con otra cuenta") && !(await p8.isVisible("#fTurno")));
  await p8.click(".authmodal .am-sec [data-act=bizBlockClose]"); await p8.waitForTimeout(200);
  await p8.click("[data-act=seguir]"); await p8.waitForTimeout(300);
  ok("D33: Seguir con una cuenta de negocio: el mismo aviso, y no sigue", (await p8.locator("#amTitle").innerText()).includes("Las cuentas de negocio no pueden reservar")
     && (await q("select count(*)::int c from follows f join auth.users u on u.id=f.user_id where u.email='sofia@test.ar'"))[0].c === 0);
  ok("D33: la base lo rechaza igual (business_account)", /business_account/.test(await p8.evaluate(async () => { const r = await sb.from("follows").insert({ user_id: S.user.id, provider_id: S.pid }); return (r.error && r.error.message) || ""; })));
  await p8.click(".authmodal .am-sec [data-act=bizBlockClose]"); await p8.waitForTimeout(200);
  await p8.click("[data-act=reservarT]"); await p8.waitForTimeout(300);
  await p8.click(".authmodal [data-act=bizSwitch]"); await p8.waitForTimeout(900);
  ok("D33: «Cerrar sesión e ingresar con otra cuenta» cierra la sesión y abre el ingreso con el ticket del turno", (await p8.evaluate(() => !S.user)) && (await p8.locator(".authmodal .tk[data-ticket=reservar]").count()) === 1);
  await p8.fill("#ai_e", "luz@test.ar"); await p8.fill("#ai_p", "Luz2026clave"); await p8.click("#fLogin button[type=submit]"); await p8.waitForSelector("#fTurno", { timeout: 8000 }).catch(() => {}); await p8.waitForTimeout(300);
  ok("D33: con la cuenta personal, la reserva sigue al pago con ese horario", (await p8.isVisible("#fTurno")) && new URL(p8.url()).searchParams.get("hora") === pick8.time);
  // con un ticket pendiente, ingresar con la cuenta de negocio muestra el aviso (la acción no sigue)
  await p8.evaluate(() => document.querySelector("[data-act=logout]").click()); await p8.waitForTimeout(800);
  await p8.goto(BASE + sofiaPath); await p8.waitForSelector(".sgroup"); await p8.waitForTimeout(300);
  await p8.click("[data-act=seguir]"); await p8.waitForTimeout(300);
  await p8.fill("#ai_e", "sofia@test.ar"); await p8.fill("#ai_p", "prestador123"); await p8.click("#fLogin button[type=submit]"); await p8.waitForTimeout(1800);
  ok("D33: ingresar con una cuenta de negocio teniendo un ticket: el aviso y la acción no sigue", (await p8.locator("#amTitle").innerText().catch(() => "")).includes("Las cuentas de negocio no pueden reservar")
     && (await q("select count(*)::int c from follows f join auth.users u on u.id=f.user_id where u.email='sofia@test.ar'"))[0].c === 0);
  await p8.click(".authmodal .am-sec [data-act=bizBlockClose]"); await p8.waitForTimeout(200);
  await p8.click("#logoLink"); await p8.waitForTimeout(400);
  ok("C13: el logo lo lleva a su Agenda", new URL(p8.url()).pathname === "/panel/agenda");
  await p8.goto(BASE + "/"); await p8.waitForSelector(".btabs", { timeout: 8000 }).catch(() => {}); await p8.waitForTimeout(300);
  ok("C13: al abrir la app (en «/») el prestador entra a su Agenda", new URL(p8.url()).pathname === "/panel/agenda");
  ok("alta: un prestador ya dado de alta no ve «Te falta poco»", (await p8.locator(".todo").count()) === 0);
  await p8.goto(BASE + "/sumate"); await p8.waitForTimeout(600);
  ok("alta: /sumate (el alta de antes) a Registrá tu negocio, y con todo hecho a la Agenda", new URL(p8.url()).pathname === "/panel/agenda");
  await ctx8.close();
  // D33: Registrá tu negocio con sesión de cliente: con historial, el negocio va en otra cuenta; sin historial, puede usar esta
  const ctx9 = await b.newContext({ viewport: { width: 1366, height: 900 } }); const p9 = await ctx9.newPage(); p9.on("pageerror", (e) => errs.push(e.message));
  await p9.goto(BASE + "/ingresar"); await p9.waitForSelector("#fLogin");
  await p9.fill("#ai_e", "luz@test.ar"); await p9.fill("#ai_p", "Luz2026clave"); await p9.click("#fLogin button[type=submit]"); await p9.waitForTimeout(1200);
  await p9.click("nav .acct-btn"); await p9.click("#acctMenu [data-act=bizStart]"); await p9.waitForTimeout(1200);
  const choice9 = await p9.locator(".biz-card").innerText().catch(() => "");
  ok("D33: una cuenta que ya se usó como cliente: el negocio va en una cuenta aparte", choice9.includes("Tu negocio va en una cuenta aparte") && choice9.includes("+negocio") && (await p9.locator("[data-act=bizUseThis]").count()) === 0, choice9 + " " + p9.url());
  await p9.click("[data-act=bizNewAccount]"); await p9.waitForSelector("#fSignup", { timeout: 8000 }).catch(() => {}); await p9.waitForTimeout(300);
  ok("D33: «Cerrar sesión y crear la cuenta del negocio» lleva a Crear cuenta sin sesión, con «Tengo un negocio» elegido", (await p9.evaluate(() => !S.user)) && (await kindOf(p9)) === "biz");
  ok("D33: la base no deja registrar un negocio con historial de cliente", /client_history/.test(await p9.evaluate(async () => {
    await sb.auth.signInWithPassword({ email: "luz@test.ar", password: "Luz2026clave" });
    const r = await sb.rpc("register_provider", { p_name: "Luz Negocio", p_address: "x", p_categories: ["u"], p_phone: "2284 1", p_dni: null, p_instagram: null, p_city: "olavarria" });
    await sb.auth.signOut(); return (r.error && r.error.message) || ""; })));
  await db.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('sinhistorial@test.ar', 'Clave2026hh', '{\"full_name\":\"Sin Historial\"}')");
  await p9.goto(BASE + "/ingresar"); await p9.waitForSelector("#fLogin");
  await p9.fill("#ai_e", "sinhistorial@test.ar"); await p9.fill("#ai_p", "Clave2026hh"); await p9.click("#fLogin button[type=submit]"); await p9.waitForTimeout(1200);
  await p9.click("nav .acct-btn"); await p9.click("#acctMenu [data-act=bizStart]"); await p9.waitForTimeout(1200);
  ok("D32/D33: quien no eligió «Tengo un negocio», desde el menú: una cuenta sin historial puede usarse para el negocio", (await p9.locator(".biz-card").innerText().catch(() => "")).includes("¿Usás esta cuenta para tu negocio?"));
  await p9.click("[data-act=bizUseThis]"); await p9.waitForSelector("#fBiz1", { timeout: 8000 }).catch(() => {});
  ok("D33: «Usar esta cuenta para mi negocio» abre el paso 1", new URL(p9.url()).pathname === "/registrar-negocio/1");
  await ctx9.close();
  // D32: "Continuar con Google" con «Tengo un negocio»: la elección viaja a Google (como el ticket) y la cuenta nueva
  // sigue a "Tu negocio"; con «Quiero reservar turnos», una cuenta de cliente que se queda donde estaba
  // una cuenta de Google de antes (sin historial) con «Tengo un negocio»: pasa por la pregunta de D33, no saltea al paso 1
  await db.query("insert into auth.users (email, email_confirmed_at, created_at, raw_user_meta_data) values ('gvieja@test.ar', now(), now() - interval '3 days', '{\"full_name\":\"Vera Vieja\"}')");
  for (const [box, email, name] of [[true, "gnegocio@test.ar", "Gina Negocio"], [false, "gcliente@test.ar", "Gael Cliente"], ["vieja", "gvieja@test.ar", "Vera Vieja"]]) {
    const cg = await b.newContext({ viewport: { width: 400, height: 900 } }); const pgg = await cg.newPage(); pgg.on("pageerror", (e) => errs.push(e.message));
    await fetch(BASE + "/__google?email=" + encodeURIComponent(email) + "&name=" + encodeURIComponent(name));
    await pgg.goto(BASE + "/"); await pgg.waitForSelector(".hero");
    await pgg.click("nav [data-act=authOpen]"); await pgg.waitForSelector(".authmodal #fLogin");
    await pgg.click(".authmodal [data-act=authMode][data-m=up]"); await pgg.waitForSelector(".authmodal .kindpick");
    await pgg.click(`.authmodal .kindopt[data-k=${box ? "biz" : "client"}]`); await pgg.waitForSelector(".authmodal [data-act=google]");
    await Promise.all([pgg.waitForURL(/\/auth\/v1\/authorize|code=|registrar-negocio|\/$/, { timeout: 8000 }).catch(() => {}), pgg.click(".authmodal [data-act=google]")]);
    await pgg.waitForFunction(() => typeof S !== "undefined" && S.user && !S.booting, null, { timeout: 10000 }).catch(() => {});
    await pgg.waitForTimeout(1200);
    const here = new URL(pgg.url());
    if (box === "vieja") {
      ok("D32/D33: Google con «Tengo un negocio» y una cuenta de antes: pregunta si usa esta cuenta para el negocio", here.pathname === "/registrar-negocio/cuenta" && /¿Usás esta cuenta para tu negocio\?/.test(await pgg.locator(".biz-card").innerText().catch(() => "")), pgg.url());
    } else if (box) {
      ok("D32: Google con «Tengo un negocio»: la cuenta nueva sigue a «Tu negocio» (paso 1)", here.pathname === "/registrar-negocio/1" && (await pgg.isVisible("#fBiz1")) && !here.searchParams.get("code"), pgg.url());
    } else {
      ok("D32: Google con «Quiero reservar turnos»: cuenta de cliente, de vuelta en el inicio (sin alta de negocio)", here.pathname === "/" && (await pgg.evaluate(() => !!S.user && !S.pending && !S.barberAuth)) && !(await pgg.locator("#fBiz1").count()), pgg.url());
    }
    ok(`D32: (la vuelta de Google entró con la cuenta ${email})`, (await pgg.evaluate(() => S.user && S.user.email)) === email && JSON.stringify(await (await fetch(BASE + "/__log")).json()).includes(email));
    await cg.close();
  }
  {
    // 4/11 · Bloque 3: seguidores. Sofía en su panel y Ana (clienta) en otra sesión.
    const sofi = (await q("select id, slug from providers where name like 'Sofía%'"))[0];
    await db.query("delete from follows where provider_id = $1", [sofi.id]);
    await db.query("update auth.users set encrypted_password = 'cliente12345', email_confirmed_at = coalesce(email_confirmed_at, now()) where email = 'ana@test.ar'");
    const anaId = (await q("select id from auth.users where email = 'ana@test.ar'"))[0].id;
    const login = async (page, email, pass) => {
      await page.goto(BASE + "/ingresar"); await page.waitForSelector("#ai_e");
      await page.fill("#ai_e", email); await page.fill("#ai_p", pass); await page.click("#fLogin button[type=submit]"); await page.waitForTimeout(1500);
    };
    const ctxS = await b.newContext({ viewport: { width: 400, height: 900 } }); const ps = await ctxS.newPage(); ps.on("pageerror", (e) => errs.push(e.message));
    const ctxA = await b.newContext({ viewport: { width: 400, height: 900 } }); const pa = await ctxA.newPage(); pa.on("pageerror", (e) => errs.push(e.message));
    const stxt = () => ps.locator("#app").innerText();
    const volver = () => ps.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await login(ps, "sofia@test.ar", "prestador123");
    await ps.goto(BASE + "/panel/clientes?ver=seguidores"); await ps.waitForSelector(".ctabs", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(800);
    ok("4/11: Clientes tiene la pestaña Seguidores (con su dirección), vacía al principio",
       (await ps.locator(".ctabs [data-t=seguidores][aria-pressed=true]").count()) === 1 && /Todavía no te sigue nadie/.test(await stxt()) && /Seguidores\s*0/.test(await ps.locator(".ctabs").innerText()));
    // Ana la sigue desde el perfil
    await login(pa, "ana@test.ar", "cliente12345");
    await pa.goto(BASE + "/" + sofi.slug); await pa.waitForSelector("[data-act=seguir]", { timeout: 8000 }).catch(() => {});
    await pa.click("[data-act=seguir]");
    await until("select count(*)::int c from follows where provider_id = $1", [sofi.id], (r) => r[0].c === 1);
    await volver();
    await ps.waitForFunction(() => /Ana/.test(document.querySelector(".folist")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("4/11: quien empieza a seguir aparece en la lista y en el número sin recargar (al volver a la pestaña)",
       /Ana/.test(await ps.locator(".folist").innerText().catch(() => "")) && /Seguidores\s*1/.test(await ps.locator(".ctabs").innerText())
       && (await ps.evaluate(() => S.notices.some((n) => n.kind === "new_follower" && /Ana empezó a seguirte/.test(n.body)))));
    ok("4/11: de cada seguidor se ve el nombre y desde cuándo (sin email ni teléfono)", /Te sigue desde el \d{1,2}\/\d{1,2}/.test(await ps.locator(".folist").innerText()) && !/@/.test(await ps.locator(".folist").innerText()));
    // "Ofrecer" a esa persona
    await ps.click(".folist [data-act=folOffer]"); await ps.waitForSelector("[data-act=folOfferGo]", { timeout: 8000 }).catch(() => {});
    // 8/11 (punto 11): un hueco de mañana en adelante (uno de hoy puede empezar dentro de minutos)
    const hoyF = (await q("select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d"))[0].d;
    const gs = await ps.locator("[data-act=folOfferGo]:not([disabled])").evaluateAll((els) => els.map((el) => el.dataset.g));
    const g1 = gs.find((g) => g.split("|")[0] > hoyF) || gs[0];
    await ps.click(`[data-act=folOfferGo][data-g="${g1}"]`);
    const toOne = await until("select count(*)::int c from slot_offers where provider_id = $1 and target_user = $2", [sofi.id, anaId], (r) => r[0].c === 1);
    ok("4/11: «Ofrecer» a un seguidor le deja un aviso solo a esa persona", toOne
       && (await q("select count(*)::int c from client_messages where kind = 'offer' and user_id = $1", [anaId]))[0].c === 1);
    // Agenda: "Ofrecer" un hueco a todos los seguidores (el primer día con lugar)
    await ps.goto(BASE + "/panel/agenda"); await ps.waitForSelector(".tl, .agwk", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(500);
    // 8/11 (punto 11): desde mañana, así el hueco no empieza dentro de minutos (offer_past si la prueba tarda)
    const hoyOf = (await q("select (now() at time zone 'America/Argentina/Buenos_Aires')::date::text d"))[0].d;
    for (let i = 1; i <= 10 && !(await ps.locator("[data-act=offerGap]:not([disabled])").count()); i++) {
      const d = (await q("select ($1::date + $2::int)::text d", [hoyOf, i]))[0].d;
      await ps.evaluate((x) => { S.aday = x; S.awk = null; render(); }, d); await ps.waitForTimeout(250);
    }
    const g2 = await ps.locator("[data-act=offerGap]:not([disabled])").first().getAttribute("data-g");
    await ps.click(`[data-act=offerGap][data-g="${g2}"]`);
    const toAll = await until("select count(*)::int c from slot_offers where provider_id = $1 and target_user is null", [sofi.id], (r) => r[0].c === 1);
    ok("4/11: «Ofrecer» de la Agenda les llega a los seguidores (aviso en la app con el horario)", toAll
       && (await q("select count(*)::int c from client_messages where kind = 'offer' and user_id = $1", [anaId]))[0].c === 2
       && /Listo: les avisamos a 1 seguidor/.test(await ps.locator(".toast").innerText().catch(() => "")));
    await ps.reload(); await ps.waitForSelector(".tl, .agwk", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(500);
    await ps.evaluate((d) => { S.aday = d; S.awk = null; render(); }, g2.split("|")[0]); await ps.waitForTimeout(300);
    ok("4/11: …y después de recargar sigue marcado «✓ Ofrecido»", /Ofrecido/.test(await ps.locator(`[data-act=offerGap][data-g="${g2}"]`).innerText().catch(() => "")));
    // Ana: el aviso en Mis turnos con "Reservar", que la lleva al perfil ese día
    await pa.goto(BASE + "/"); await pa.waitForSelector("nav [data-act=bellToggle]", { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(500);
    await pa.click("nav [data-act=bellToggle]"); await pa.waitForSelector("[data-act=offerBook]", { timeout: 8000 }).catch(() => {});
    ok("4/11: a la clienta le llega en la campanita «Tengo un turno libre…» con «Reservar»", (await pa.locator("[data-act=offerBook]").count()) === 2
       && /Tengo un turno libre el/.test(await pa.locator(".bellpanel").innerText()));
    const d2 = await pa.locator("[data-act=offerBook]").first().getAttribute("data-d");
    await pa.click("[data-act=offerBook] >> nth=0"); await pa.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(400);
    ok("4/11: «Reservar» abre el perfil con ese día elegido", new URL(pa.url()).pathname === "/" + sofi.slug && (await pa.evaluate(() => S.day)) === d2);
    // Trabajos → "Avisar a tus seguidores": le llega a Ana, con "Ver perfil"
    await ps.goto(BASE + "/panel/trabajos"); await ps.waitForSelector("#postTxt", { timeout: 8000 }).catch(() => {});
    await ps.fill("#postTxt", "Esta semana hay promo de esmaltado"); await ps.click("[data-act=publicar]");
    const news = await until("select count(*)::int c from client_messages where kind = 'news' and user_id = $1", [anaId], (r) => r[0].c === 1);
    ok("4/11: «Avisar a tus seguidores» de Trabajos les llega de verdad (aviso en la app)", news && /Listo: les avisamos a 1 seguidor/.test(await ps.locator(".toast").innerText().catch(() => "")));
    await pa.goto(BASE + "/"); await pa.waitForSelector("nav [data-act=bellToggle]", { timeout: 8000 }).catch(() => {}); await pa.waitForTimeout(500);
    await pa.click("nav [data-act=bellToggle]"); await pa.waitForSelector(".bellpanel .msg-act", { timeout: 8000 }).catch(() => {});
    ok("4/11: …y en la campanita se ve con «Ver perfil»", /Esta semana hay promo de esmaltado/.test(await pa.locator(".bellpanel").innerText()) && (await pa.locator(".bellpanel .msg-act[data-go=perfil]").count()) >= 1);
    await pa.keyboard.press("Escape");
    // 10/11: con la app abierta, otra novedad llega a la campanita sin recargar (al llegar el push, el service worker le
    // avisa a la app con "tt-push"; acá se simula ese mensaje: el recorrido real del service worker lo prueba pwa.js)
    await ps.fill("#postTxt", "Segunda novedad con la app abierta"); await ps.click("[data-act=publicar]");
    await until("select count(*)::int c from client_messages where kind = 'news' and user_id = $1", [anaId], (r) => r[0].c === 2);
    const inboxHas2 = () => pa.evaluate(() => (S.inbox || []).some((msg) => msg.body === "Segunda novedad con la app abierta"));
    const before2 = await inboxHas2();
    await pa.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: { type: "tt-push" } })));
    await pa.waitForFunction(() => (S.inbox || []).some((msg) => msg.body === "Segunda novedad con la app abierta"), null, { timeout: 8000 }).catch(() => {});
    ok("10/11: con la app abierta, la novedad aparece en la campanita sin recargar", !before2 && (await inboxHas2()) && (await pa.locator(".bell-btn .bell-n").count()) >= 1);
    // S19 (8/11): con el negocio suspendido no hay «Avisar a tus seguidores» ni «Ofrecer» (la base también lo rechaza)
    await q("update providers set status = 'suspended' where id = $1", [sofi.id]);
    await ps.goto(BASE + "/panel/trabajos"); await ps.waitForSelector(".avisarpanel", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(500);
    ok("S19: suspendido, Trabajos no deja avisar a los seguidores y dice por qué", (await ps.locator("#postTxt, [data-act=publicar]").count()) === 0
       && /Tu negocio está suspendido: no podés escribirles a tus seguidores/.test(await ps.locator(".avisarpanel").innerText()));
    await ps.goto(BASE + "/panel/clientes?ver=seguidores"); await ps.waitForSelector(".folist", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(400);
    ok("S19: …ni ofrecerle un turno a un seguidor", (await ps.locator(".folist li").count()) >= 1 && (await ps.locator("[data-act=folOffer]").count()) === 0);
    await ps.goto(BASE + "/panel/agenda"); await ps.waitForSelector(".tl, .agwk", { timeout: 8000 }).catch(() => {}); await ps.waitForTimeout(400);
    await ps.evaluate((d) => { S.aday = d; S.awk = null; render(); }, g2.split("|")[0]); await ps.waitForTimeout(300);
    ok("S19: …ni «Ofrecer» los huecos de la Agenda", (await ps.locator(".tl-gap").count()) >= 1 && (await ps.locator("[data-act=offerGap]").count()) === 0
       && /no podés escribirles a tus seguidores ni ofrecerles turnos/.test(await ps.locator(".tl-panel").innerText()));
    await q("update providers set status = 'active' where id = $1", [sofi.id]);
    await pa.goto(BASE + "/" + sofi.slug); await pa.waitForSelector("[data-act=seguir]", { timeout: 8000 }).catch(() => {});
    // Ana deja de seguir: sale de la lista de Sofía
    await pa.waitForSelector("[data-act=seguir]"); await pa.click("[data-act=seguir]");
    await until("select count(*)::int c from follows where provider_id = $1", [sofi.id], (r) => r[0].c === 0);
    await ps.goto(BASE + "/panel/clientes?ver=seguidores"); await ps.waitForSelector(".ctabs"); await ps.waitForTimeout(300);
    await volver();
    await ps.waitForFunction(() => /Todavía no te sigue nadie/.test(document.querySelector("#app")?.innerText || ""), null, { timeout: 8000 }).catch(() => {});
    ok("4/11: quien deja de seguir sale de la lista y del número", /Todavía no te sigue nadie/.test(await stxt()) && /Seguidores\s*0/.test(await ps.locator(".ctabs").innerText()));
    // 10/11: después de dejar de seguir, «Avisar a tus seguidores» ya no le llega
    await ps.goto(BASE + "/panel/trabajos"); await ps.waitForSelector("#postTxt", { timeout: 8000 }).catch(() => {});
    await ps.fill("#postTxt", "Novedad después de dejar de seguir"); await ps.click("[data-act=publicar]"); await ps.waitForTimeout(1500);
    ok("10/11: después de dejar de seguir no le llega nada más", (await q("select count(*)::int c from posts where provider_id = $1 and body = 'Novedad después de dejar de seguir'", [sofi.id]))[0].c === 1
       && (await q("select count(*)::int c from client_messages where user_id = $1 and body = 'Novedad después de dejar de seguir'", [anaId]))[0].c === 0);
    await ctxS.close(); await ctxA.close();
  }
  ok("sin errores de JavaScript", errs.length === 0); if (errs.length) console.log(errs.slice(0, 5), bad);
  ok("sin bloqueos de la CSP", csp.length === 0); if (csp.length) console.log(csp.slice(0, 3));
  await b.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK"); process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2) });

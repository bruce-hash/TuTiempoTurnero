// Prueba end-to-end en navegador real (Chromium) contra Postgres + PostgREST + reglas RLS reales.
// Recorre: listado multirrubro → perfil → login por código → reserva → pago (MP simulado) → cashback →
// panel del prestador (agenda, bloqueo, productos, gastos, rubros/servicios) → cancelación con devolución → seguridad →
// admin ("Para revisar · cobros") → Bloque 1: avisos de cobros y desconectar Mercado Pago.
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
let F = 0; const ok = (n, c, d) => { if (!c) F++; console.log((c ? "OK   " : "FAIL ") + n); if (!c && d) console.log("     ", d) };
(async () => {
  const db = new Client({ connectionString: PG }); await db.connect();
  const q = async (s, a) => (await db.query(s, a)).rows;
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
  // Ingreso y registro (rediseño aprobado el 1/11): un solo "Ingresar"; la ventana es la misma para clientes y prestadores
  ok("ingreso: la cabecera sin sesión tiene solo Ingresar", (await pg.locator("nav [data-act=authOpen]").count()) === 1 && (await pg.locator("nav [data-go=login]").count()) === 0);
  const urlHome = pg.url();
  const opener = pg.locator("nav [data-act=authOpen]");
  await opener.click(); await wait();
  ok("ingreso: abre una ventana sobre la misma página (role=dialog con título)", (await pg.isVisible(".authmodal #fLogin")) && pg.url() === urlHome && (await pg.locator(".grid .card").count()) === 2
     && (await pg.evaluate(() => document.body.classList.contains("am-open"))) && (await pg.getAttribute(".authmodal", "role")) === "dialog" && (await pg.locator("#amTitle").innerText()).length > 0);
  ok("ingreso: sin elegir cliente o prestador (una cuenta = una persona)", (await pg.locator(".am-tabs, [data-act=authSide], #fBarb").count()) === 0 && (await pg.locator(".am-sub").innerText()).includes("Clientes y prestadores entran por acá"));
  ok("ingreso: en el celular no enfoca un campo (no abre el teclado tapando la ventana)", await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains("am-box")));
  ok("ingreso: debajo de Google, la aceptación de los Términos y la Política de privacidad", /Al continuar, aceptás los Términos y la Política de privacidad/.test(await pg.locator(".authmodal .gterms").innerText()) && (await pg.locator(".authmodal .gterms [data-go=terminos]").count()) === 2);
  // el foco no se escapa de la ventana
  for (let i = 0; i < 30; i++) await pg.keyboard.press("Tab");
  ok("ingreso: Tab da la vuelta adentro de la ventana", await pg.evaluate(() => !!document.activeElement.closest(".am-box")));
  await pg.click(".authmodal [data-act=authMode][data-m=up]"); await wait(200);
  ok("ingreso: Crear cuenta adentro de la ventana, con el pie para registrar un negocio", (await pg.isVisible(".authmodal #fSignup")) && pg.url() === urlHome && (await pg.locator(".authmodal .am-foot [data-act=bizStart]").count()) === 1 && (await pg.locator(".authmodal .gterms").count()) === 1);
  await pg.keyboard.press("Escape"); await wait(200);
  ok("ingreso: Escape cierra la ventana y el foco vuelve a Ingresar", (await pg.locator(".authmodal").count()) === 0 && !(await pg.evaluate(() => document.body.classList.contains("am-open")))
     && (await pg.evaluate(() => document.activeElement && document.activeElement.matches("nav [data-act=authOpen]"))));
  await pg.click("footer [data-act=authOpen]"); await wait();
  ok("ingreso: Ingresar del footer abre la misma ventana", await pg.isVisible(".authmodal #fLogin"));
  await pg.click(".authmodal .am-x"); await wait(200);
  ok("ingreso: la cruz cierra la ventana", (await pg.locator(".authmodal").count()) === 0);
  await pg.click("footer [data-act=bizStart]"); await wait();
  ok("ingreso: Registrá tu negocio del footer abre el paso 0 (la cuenta) en la ventana", (await pg.isVisible(".authmodal #fSignup")) && (await pg.locator("#amTitle").innerText()).includes("Registrá tu negocio") && (await pg.locator("#au_t").count()) === 0);
  await pg.mouse.click(5, 5); await wait(200);
  ok("ingreso: tocar afuera cierra la ventana", (await pg.locator(".authmodal").count()) === 0);
  ok("ingreso: el footer dice Ingresar y Registrá tu negocio (sin Acceso prestadores ni Sumate)", /Registrá tu negocio/.test(await pg.locator("footer").innerText()) && !/Acceso prestadores|Sumate/.test(await pg.locator("footer").innerText()));
  ok("ingreso: el inicio tiene la puerta Registrá tu negocio debajo del listado", (await pg.locator("#app .bizcta [data-act=bizStart]").count()) === 1);
  const foot = await pg.locator("footer").innerText();
  const socials = await pg.evaluate(() => [...document.querySelectorAll("footer a[target=_blank]")].map((a) => [a.href, a.rel]));
  ok("V7: footer con teléfono, las cuatro redes (pestaña nueva) y sin Prototipo",
    (await pg.locator('footer a[href="tel:+542284722825"]').count()) === 1 && !/prototipo/i.test(foot) &&
    ["instagram.com/tutiempo.arg", "facebook.com/profile.php?id=61592065464698", "youtube.com/channel/UCMQI8_kVvk_7S7_ceHfiKAg", "tiktok.com/@tutiempo_arg"].every((u) => socials.some(([h, r]) => h.includes(u) && /noopener/.test(r))), JSON.stringify(socials));
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
  await pg.click("[data-quick]"); await wait(200);
  const slotTime = await pg.evaluate(() => S.slot && S.slot.date + " " + S.slot.time);
  await pg.click("[data-act=reservarT]"); await wait();
  ok("pide ingresar para reservar, en la ventana encima del perfil", (await txt()).includes("Ingresá para reservar") && (await pg.isVisible(".authmodal #fLogin")));
  const tk = await pg.locator(".authmodal .tk").innerText().catch(() => "");
  const [slotDay, slotHM] = slotTime.split(" ");
  ok("ingreso: el ticket muestra día, hora, servicio y negocio, y que sigue directo al pago",
     tk.includes(slotHM) && tk.includes(+slotDay.slice(8) + "/" + +slotDay.slice(5, 7)) && /Esmaltado/.test(tk) && /Sofía/.test(tk) && tk.includes("Al ingresar seguís directo al pago"), tk);
  ok("ingreso con Google, email y contraseña", await pg.isVisible("[data-act=google]") && await pg.isVisible("#ai_p"));
  // el código por email es solo para cuentas que ya existen, con el mismo mensaje exista o no
  await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
  ok("ingreso: el ticket sigue en Entrar con un código", (await pg.locator(".authmodal .tk").count()) === 1);
  probing = true; await pg.fill("#le", "nadie.todavia@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc"); await wait(300); probing = false;
  const noAcc = await pg.locator(".am-sub").innerText();
  ok("código por email: un email sin cuenta ve el mismo mensaje y no se crea ninguna cuenta",
     noAcc.includes("Si nadie.todavia@test.ar tiene cuenta, le llega un código") && !(await pg.locator("#lerr").innerText()) && (await q("select count(*)::int c from auth.users where email='nadie.todavia@test.ar'"))[0].c === 0
     && (await (await fetch(BASE + "/__log")).json()).some((x) => x.otp === "nadie.todavia@test.ar" && x.create_user === false));
  await pg.click("[data-act=loginBack]"); await wait(200);
  // Ana ya tiene cuenta (antes el código creaba una cuenta sin aceptar los términos; ahora solo entra a las que existen)
  await db.query("insert into auth.users (email, raw_user_meta_data) values ('ana@test.ar', '{\"full_name\":\"ana\"}')");
  await pg.fill("#le", "ana@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc");
  ok("código por email: el mismo mensaje con una cuenta que existe", (await pg.locator(".am-sub").innerText()).includes("Si ana@test.ar tiene cuenta, le llega un código"));
  probing = true; await pg.fill("#lc", "111111"); await pg.click("#fCode button[type=submit]"); await wait(); probing = false;
  ok("código incorrecto avisa", (await pg.locator("#lerr").innerText()).includes("incorrecto"));
  await pg.fill("#lc", "123456"); await pg.click("#fCode button[type=submit]"); await pg.waitForSelector("#fTurno"); await wait();
  ok("vuelve al pago ya logueado", (await txt()).includes("Confirmá tu turno"));
  ok("checkout: seña obligatoria y el resto en efectivo o Mercado Pago, sin preguntas ni saldo", (await pg.locator("[data-paym=mp]").count()) === 1 && (await pg.locator("[data-paym=cash]").count()) === 1 && !(await pg.locator(".intake").count()) && !(await txt()).includes("Saldo") && (await txt()).includes("$6.000"));
  ok("v30/D30: la comisión va aparte de la seña (20% de la seña = $1.200) y se paga $7.200", (await pg.locator(".feerow").innerText()).includes("20% de la seña") && (await pg.locator(".feerow").innerText()).includes("$1.200") && (await pg.locator("#fTurno .tot").innerText()).includes("$7.200") && (await pg.locator("#fTurno button[type=submit]").innerText()).includes("$7.200"));
  // C52 (V8): el prestador cambia el precio mientras la clienta está en la confirmación
  const holdsAntes = (await q("select count(*)::int c from bookings where status = 'hold'"))[0].c;
  await db.query("update services set price = 14000 where name = 'Esmaltado semipermanente'");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /El precio cambió/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("C52: si el precio cambió, no cobra: muestra el nuevo total (y el de antes) y pide confirmar de nuevo",
     /El precio cambió mientras mirabas: ahora pagás \$8\.400 \(antes \$7\.200\)/.test(await pg.locator("#terr").innerText()) && (await pg.locator("#fTurno .tot").innerText()).includes("$8.400")
     && (await q("select count(*)::int c from bookings where status = 'hold'"))[0].c === holdsAntes && new URL(pg.url()).pathname.endsWith("/reservar"));
  await db.query("update services set price = 12000 where name = 'Esmaltado semipermanente'");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /antes \$8\.400/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("C52: …y si vuelve al precio de antes, lo avisa igual", (await pg.locator("#fTurno .tot").innerText()).includes("$7.200"));
  // D30 (V1): el admin carga los % de Mercado Pago y la prestadora elige "10 días" mientras la clienta está en la confirmación
  await db.query("update app_settings set mp_pct_instant = 7.61, mp_pct_d10 = 5.31");
  await db.query("update provider_settings set payout_term = 'd10' where provider_id = (select id from providers where name like 'Sofía%')");
  await pg.click("#fTurno button[type=submit]"); await pg.waitForFunction(() => /antes \$7\.200/.test(document.querySelector("#terr")?.textContent || ""), null, { timeout: 8000 }).catch(() => {}); await wait(300);
  const fr30 = await pg.locator("#fTurno .feerow").allInnerTexts();
  ok("D30: antes de cobrar avisa el total nuevo con el costo de Mercado Pago ($6.000 + $1.200 + $404 = $7.604)",
     /ahora pagás \$7\.604 \(antes \$7\.200\)/.test(await pg.locator("#terr").innerText()) && (await pg.locator("#fTurno .tot").innerText()).includes("$7.604"));
  ok("D30: el resumen muestra los tres conceptos por separado (seña, comisión de TuTiempo y costo de Mercado Pago con su plazo)",
     fr30.length === 2 && fr30[0].includes("20% de la seña") && fr30[0].includes("$1.200") && /acreditación en 10 días, 5,31% del total/.test(fr30[1]) && fr30[1].includes("$404")
     && (await pg.locator("#fTurno").innerText()).includes("Se suma la comisión de TuTiempo y el costo de Mercado Pago"));
  await Promise.all([pg.waitForURL(/mp=success/).catch(() => {}), pg.click("#fTurno button[type=submit]")]);
  await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("vuelve de Mercado Pago con el turno confirmado", await pg.isVisible(".booked"));
  const bk30 = (await q("select deposit, client_fee, mp_fee, paid_mp, app_fee, paid_mp_fee, status from bookings where client_id = (select id from auth.users where email='ana@test.ar') order by id desc limit 1"))[0];
  ok("D30: en la base: seña completa para la prestadora, comisión de TuTiempo y lo de Mercado Pago aparte",
     bk30 && bk30.status === "confirmed" && bk30.deposit === 6000 && bk30.client_fee === 1200 && bk30.mp_fee === 404 && bk30.paid_mp === 6000 && bk30.app_fee === 1200 && bk30.paid_mp_fee === 404, JSON.stringify(bk30));
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
    const d31 = (await q("select to_char(starts_at at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') d from bookings where client_id = (select id from auth.users where email='ana@test.ar') order by id desc limit 1"))[0].d;
    const hoy31 = (await q("select to_char(now() at time zone 'America/Argentina/Buenos_Aires' + interval '61 minutes', 'YYYY-MM-DD HH24:MI') h"))[0].h;
    const desde31 = d31 === hoy31.slice(0, 10) ? hoy31.slice(11) : "00:00";
    const srv31 = (await q("select to_char(s, 'HH24:MI') t from slot_starts($1, $2::date, 60) s order by s", [sid, d31])).map((r) => r.t).filter((t) => t >= desde31);
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
  ok("v30/D30: el aviso dice seña + comisiones (TuTiempo y Mercado Pago)", (await pg.locator(".booked .bk-must").innerText()).includes("$6.000 + $1.604 de comisiones"));
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
    await pp.click("[data-act=payLogin]"); await pp.waitForSelector("#le", { timeout: 8000 }).catch(() => {}); await pp.waitForTimeout(300);
    ok("Paso 1: “Ingresá para ver tu turno” lleva al ingreso y después vuelve al turno", new URL(pp.url()).pathname === "/ingresar" && new URL(pp.url()).searchParams.get("volver") === `/turno/${ck.booking}`);
    await pp.click("[data-act=authMode][data-m=code]").catch(() => {}); await pp.waitForTimeout(200);
    await pp.fill("#le", "ana@test.ar"); await pp.click("#fMail button[type=submit]"); await pp.waitForSelector("#lc"); await pp.fill("#lc", "123456"); await pp.click("#fCode button[type=submit]");
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
  const bk = await q("select status, deposit, paid_mp, cashback from bookings where client_id = (select id from auth.users where email='ana@test.ar')");
  ok("en la base: confirmado, seña 50% y sin cashback", bk.length === 1 && bk[0].status === "confirmed" && bk[0].deposit === 6000 && bk[0].paid_mp === 6000 && bk[0].cashback === 0);
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
  ok("Bloque D: el menú del cliente tiene Mi perfil, Mis turnos, Registrá tu negocio y Cerrar sesión (sin paneles)", await pg.evaluate(() => [...document.querySelectorAll("#acctMenu [role=menuitem]")].map((b) => b.dataset.go || b.dataset.act).join(",") === "cuenta,misturnos,bizStart,logout"));
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
  await pg.click(".sgroup.seg-d .svci"); await wait(200); await pg.click("[data-quick]"); await wait(200); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno"); await wait();
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
  await menu("[data-go=cuenta]");
  ok("mi perfil muestra a quién sigo, sin saldo", (await txt()).includes("Sofía") && !(await txt()).includes("Saldo TuTiempo"));
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
  const BAD = "Email o contraseña incorrectos. Revisalos o entrá con un código.";
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
  ok("C25: lo cobrado por transferencia queda así en la base y en la caja", (await q("select count(*)::int c from walkins where method='transfer' and amount=4000"))[0].c === 1 && (await txt()).includes("🏦 Transferencia"));
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
  await pg.click("[data-act=closeMonth]"); await wait(800);
  ok("mes cerrado en la base", (await q("select count(*)::int c from cash_closings where kind='month'"))[0].c === 1);
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
  }
  // rubros y servicios: sumar Masajes
  await pg.click("[data-btab=perfil]"); await wait(300);
  await pg.check("#rc-m", { force: true }); await wait(200); await pg.click("[data-act=svcAdd]"); await wait(200);
  const n = await pg.locator(".svcrow3").count();
  await pg.fill(`#sn${n - 1}`, "Masaje relajante"); await pg.fill(`#sd${n - 1}`, "50"); await pg.fill(`#sp${n - 1}`, "17000"); await pg.selectOption(`#sc${n - 1}`, "m");
  await pg.click("#fDatos button[type=submit]"); await wait(1500);
  ok("nuevo rubro y servicio en la base", (await q("select count(*)::int c from provider_categories pc join providers p on p.id=pc.provider_id where p.name like 'Sofía%' and pc.category_id='m'"))[0].c === 1
    && (await q("select count(*)::int c from services where name='Masaje relajante'"))[0].c === 1);
  // horarios
  await pg.click("[data-btab=horarios]"); await wait(300);
  ok("C39/D31: Horarios sin 'Descanso entre turnos' ni 'Cada cuánto empieza un turno', con la regla explicada",
     (await pg.locator("#hbuf, #hst").count()) === 0 && /se suceden según lo que dura el servicio/.test(await pg.locator("#fHorarios").innerText()));
  // C37 (V3b): sin botón Guardar; cada cambio se guarda solo
  await pg.selectOption("#hno", "120"); await wait(1400);
  ok("C37: Horarios se guarda solo al cambiar, sin botón Guardar", (await pg.locator("#fHorarios button[type=submit]").count()) === 0
     && (await q("select notice_min, buffer_min from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'"))[0].notice_min === 120
     && (await pg.locator("#hSaved").innerText()).includes("Guardado"));
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
  const bc = await q("select status, refund_pending, settle_by_provider from bookings where source='app' and pay_method='mp'");
  ok("v31: el turno de Ana se canceló sin devolución automática (la arregla el prestador)", bc[0].status === "cancelled_provider" && bc[0].refund_pending === 0 && bc[0].settle_by_provider === true);
  ok("v31: la lista le dice al prestador que llame, con la seña ($6.000)", /TuTiempo no devuelve la seña/i.test(await pg.locator(".dbdone").innerText()) && (await pg.locator(".dbdone").innerText()).includes("$6.000"));
  ok("al prestador le queda la lista de cancelados", (await pg.locator(".dbdone li").count()) >= 1 && /ana/i.test(await pg.locator(".dbdone").innerText()));
  const cn = await q("select m.body from client_messages m join auth.users u on u.id=m.user_id where u.email='ana@test.ar' and m.kind='cancel'");
  ok("a Ana le llegó el aviso para reprogramar", cn.length >= 1 && cn[0].body.includes("tuvo que cancelar") && cn[0].body.includes("se va a comunicar con vos") && cn[0].body.includes("$6.000"));
  const dayBlk = await q("select count(*)::int c from provider_busy((select id from providers where name like 'Sofía%'), $1::date, $1::date) where day_block", [d]);
  ok("ese día queda Cerrado para los clientes", dayBlk[0].c === 1);
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
  await pg.click("nav [data-act=authOpen]"); await wait(); await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
  ok("V7: Ingresar con código adentro de la capa", (await pg.isVisible(".authmodal #fMail")) && pg.url() === urlProv);
  await pg.fill("#le", "ana@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc"); await pg.fill("#lc", "123456"); await pg.click("#fCode button[type=submit]"); await wait(1200);
  ok("V7: después de ingresar la capa se cierra y queda la misma página", (await pg.evaluate(() => !!S.user)) && (await pg.locator(".authmodal").count()) === 0 && pg.url() === urlProv && (await pg.isVisible(".pcard")), pg.url() + " vs " + urlProv);
  await menu("[data-go=misturnos]"); await wait(800);
  ok("v31: Mis turnos: el turno cancelado por bloqueo dice que el profesional la va a llamar (sin Reprogramar automático)", /canceló el profesional/i.test(await txt()) && /te va a llamar/i.test(await txt()) && (await pg.locator(".delpanel [data-act=rebook]").count()) === 0);
  ok("Mis sellos: tarjeta de Esmaltado 16 de 16, premio listo", (await pg.locator(".stampcard").count()) === 1 && (await pg.locator(".stampcard").innerText()).includes("Esmaltado semipermanente") && (await pg.locator(".stampcard").innerText()).includes("16 de 16") && /premio listo/i.test(await pg.locator(".stampcard").innerText()));
  const tt = (await txt()).toLowerCase(); ok("Mis turnos: primero los próximos, después avisos y sellos", tt.indexOf("próximos") >= 0 && tt.indexOf("próximos") < tt.indexOf("avisos y mensajes") && tt.indexOf("avisos y mensajes") < tt.indexOf("mis sellos"));
  await pg.click("[data-act=useReward]"); await pg.waitForSelector(".pcard"); await wait(800);
  await pg.click("[data-quick]"); await wait(200); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno"); await wait(300);
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
  await pg.click("[data-act=authMode][data-m=up]"); await wait(200);
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
  await pg.click("#app [data-act=toAdmin]"); await pg.waitForSelector(".kpis.adm", { timeout: 8000 }).catch(() => {}); await wait(500);
  ok("admin: tablero con datos reales", (await pg.locator(".kpis.adm .kpi").count()) === 8 && (await pg.locator(".admtop li").count()) >= 2);
  ok("v30: sin la proyección y con el tablero simple (hoy/ayer + 4 semanas)", !(await txt()).includes("cerrás el mes") && (await pg.locator(".admday>div").count()) === 2 && (await pg.locator(".wkrow").count()) === 4 && (await pg.locator(".admbars").count()) === 0);
  await pg.click("[data-act=admT][data-t=com]"); await wait(300);
  ok("admin/D30: comisión de TuTiempo 20% de la seña y Mercado Pago en 0% en los cuatro plazos", (await pg.inputValue("#admCom")) === "20"
     && (await Promise.all(["instant", "d10", "d18", "d35"].map((t) => pg.inputValue("#admMp-" + t)))).every((v) => v === "0"));
  ok("admin: comisión sin botones fijos", (await pg.locator("[data-act=admComQuick]").count()) === 0);
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
  ok("admin/D30: comisiones guardadas en la base (7% de la seña; 7,61 / 5,31 / 4,10 / 1,80)", [fs30.deposit_commission_pct, fs30.mp_pct_instant, fs30.mp_pct_d10, fs30.mp_pct_d18, fs30.mp_pct_d35].map(Number).join() === "7,7.61,5.31,4.1,1.8");
  ok("admin/D30: el ejemplo (corte $20.000, seña 50%, al instante) da $10.000 + $700 + $882 = $11.582", (await pg.locator(".comex .tot").innerText()).includes("$11.582")
     && (await pg.locator(".comex").innerText()).includes("$700") && (await pg.locator(".comex").innerText()).includes("$882"));
  await pg.fill("#admMp-d10", "16"); await pg.click("#fCom button[type=submit]"); await wait(700);   // la app ignora un segundo envío en menos de 450 ms (doble toque)
  ok("admin/D30: Mercado Pago fuera de rango no se guarda", (await pg.locator("#comerr").innerText()).includes("entre 0 y 15") && Number((await q("select mp_pct_d10 from app_settings"))[0].mp_pct_d10) === 5.31);
  await pg.fill("#admCom", "8,5"); await pg.fill("#admMp-d10", "5,31"); await saveCom();
  ok("admin: comisión libre con decimales (8,5% de la seña)", await until("select deposit_commission_pct from app_settings", [], (r) => Number(r[0].deposit_commission_pct) === 8.5, 8000));
  await pg.fill("#admCom", "20"); for (const t of ["instant", "d10", "d18", "d35"]) await pg.fill("#admMp-" + t, "0"); await saveCom();
  await until("select deposit_commission_pct, mp_pct_instant from app_settings", [], (r) => Number(r[0].deposit_commission_pct) === 20 && Number(r[0].mp_pct_instant) === 0, 8000);
  probing = true; const forb = await pg.evaluate(async () => { const r = await sb.from("app_settings").update({ deposit_commission_pct: 1, mp_pct_d10: 9 }).eq("id", true).select(); return (r.data || []).length }); probing = false;
  ok("nadie cambia las comisiones por fuera de la función", forb === 0 && Number((await q("select deposit_commission_pct from app_settings"))[0].deposit_commission_pct) === 20);
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
  await pg.evaluate(() => { S.admRev = null; render() }); await wait(600);
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
  ok("Bloque 1: el panel muestra el aviso del reclamo", /Avisos de cobros/i.test(await txt()) && /reclamo en Mercado Pago/.test(await txt()));
  await pg.click("[data-act=noticesRead]"); await wait(800);
  ok("Bloque 1: Entendido marca el aviso leído", !/Avisos de cobros/i.test(await txt()) && (await q("select count(*)::int c from provider_notices where read_at is null"))[0].c === 0);
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
  await pg.click("nav [data-act=authOpen]"); await wait(); await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
  await pg.fill("#le", "ana@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc"); await pg.fill("#lc", "123456"); await pg.click("#fCode button[type=submit]"); await wait(1200);
  await pg.goto(BASE + "/p/" + sofi); await pg.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("D22: sin Mercado Pago, la clienta con la tarjeta llena ve “Solo podés canjear tu premio”", /Solo podés canjear tu premio/.test(await txt()) && !/Todavía no toma turnos online/.test(await txt()));
  await pg.click(".panel [data-svc]"); await wait(400);
  ok("D22: elige el servicio del premio y aparece el selector de horario, sin seña", (await pg.locator("[data-slot]").count()) > 0 && /no lleva seña ni comisión/.test(await txt()));
  const rewardsBefore = (await q("select count(*)::int c from bookings where pay_method = 'reward'"))[0].c;
  await pg.click("[data-quick]"); await wait(200); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno", { timeout: 8000 }).catch(() => {}); await wait(300);
  ok("D22: en el pago solo queda “Usar mi premio”", (await pg.locator("[data-paym=reward]").count()) === 1 && (await pg.locator("[data-paym=mp]").count()) === 0);
  await pg.click("#fTurno button[type=submit]"); await wait(1500);
  ok("D22: el premio queda reservado sin pago", (await q("select count(*)::int c from bookings where pay_method = 'reward' and status = 'confirmed'"))[0].c === rewardsBefore + 1);
  await menu("[data-act=logout]"); await wait(800);
  // "Volver al panel" cierra la sesión del prestador: se vuelve a ingresar y la app vuelve a Perfil (?volver=)
  await pg.goto(BASE + "/panel/perfil"); await pg.waitForSelector("#fLogin", { timeout: 8000 }).catch(() => {}); await wait(400);
  ok("ingreso: una dirección del panel sin sesión lleva al mismo ingreso, con ?volver=", new URL(pg.url()).pathname === "/ingresar" && new URL(pg.url()).searchParams.get("volver") === "/panel/perfil");
  await pg.fill("#ai_e", "sofia@test.ar"); await pg.fill("#ai_p", "prestador123"); await pg.click("#fLogin button[type=submit]"); await pg.waitForSelector("[data-act=mpConnect]", { timeout: 8000 }).catch(() => {}); await wait(400);
  await Promise.all([pg.waitForURL(/mp_connected=1/, { timeout: 8000 }).catch(() => {}), pg.click("[data-act=mpConnect]")]); await wait(1500);
  const accRe = (await q("select id from mp_accounts where provider_id=$1 and status='active'", [sofi]))[0];
  ok("H23: reconectar la misma cuenta vuelve a cobrar con la misma fila", accRe && accRe.id === accBefore.id);

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
  ok("alta: /registrar-negocio sin sesión es el paso 0 (la cuenta personal), sin celular ni DNI", (await p2.locator("#amTitle").innerText()).includes("Registrá tu negocio") && (await p2.locator("#au_t, #dniN").count()) === 0);
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
  await p2b.click('[data-act=bizPay][data-v="40"]'); await p2b.click('[data-act=bizTerm][data-v=d10]'); await p2b.click("[data-act=bizNext]"); await p2b.waitForTimeout(800);
  const st2 = (await q("select deposit_pct, pay_mode, payout_term, setup_done from provider_settings where provider_id=$1", [np.id]))[0];
  ok("alta paso 4: seña del 40% y plazo de 10 días; se puede seguir sin Mercado Pago", st2.deposit_pct === 40 && st2.pay_mode === "deposit" && st2.payout_term === "d10" && JSON.stringify(st2.setup_done) === "[1,2,3,4]" && new URL(p2b.url()).pathname === "/registrar-negocio/5");
  ok("alta paso 5: con «Exigir DNI», pide número, frente y dorso", await p2b.isVisible("#fDni") && await p2b.isVisible("#dniFront") && await p2b.isVisible("#dniBack"));
  ok("D24: el paso avisa cuánto se guardan las fotos", (await p2b.innerText("body")).includes("Guardamos las fotos hasta 30 días después de verificarte"));
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
  // ---------- Bloque D (D26): "Exigir DNI para aprobar prestadores" apagada desde Comisión ----------
  await p3.goto(BASE + "/admin/comision"); await p3.waitForSelector("[data-act=admReqDni]");
  ok("D26: la opción está activada", (await p3.getAttribute("[data-act=admReqDni]", "aria-pressed")) === "true");
  await p3.click("[data-act=admReqDni]"); await p3.waitForTimeout(1200);
  ok("D26: el admin la apaga", (await q("select require_dni from app_settings"))[0].require_dni === false && (await p3.getAttribute("[data-act=admReqDni]", "aria-pressed")) === "false");
  const ctx4 = await b.newContext({ viewport: { width: 400, height: 900 } }); const p4 = await ctx4.newPage();
  p4.on("pageerror", (e) => errs.push(e.message));
  // el alta desde el pie de Crear cuenta ("¿Tenés un negocio? Registralo") y sin DNI exigido
  await p4.goto(BASE + "/crear-cuenta"); await p4.waitForSelector("#fSignup"); await p4.click(".am-foot [data-act=bizStart]"); await p4.waitForTimeout(300);
  ok("alta: «¿Tenés un negocio? Registralo» pasa al paso 0 sin salir de la página", (await p4.locator("#amTitle").innerText()).includes("Registrá tu negocio"));
  await p4.fill("#au_n", "Mara Sin DNI"); await p4.fill("#au_e", "sindni@test.ar"); await p4.fill("#au_p", "Clave2026zz"); await p4.check("#au_ok", { force: true });
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
  await p6.goto(BASE + sofiaPath); await p6.waitForSelector(".sgroup"); await p6.click(".sgroup.seg-u .svci"); await p6.waitForTimeout(200); await p6.click("[data-quick]"); await p6.waitForTimeout(200);
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
  await p6.goto(BASE + sofiaPath); await p6.waitForSelector(".sgroup"); await p6.click(".sgroup.seg-u .svci"); await p6.waitForTimeout(200); await p6.click("[data-quick]"); await p6.waitForTimeout(200);
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
  ok("D33: el menú de la cuenta de negocio no tiene Mis turnos ni Reservar como cliente", menu8.includes("Mi agenda") && menu8.includes("Ver mi perfil público") && !/Reservar como cliente|Mis turnos/.test(menu8), menu8);
  await p8.keyboard.press("Escape");
  await p8.goto(BASE + "/mis-turnos"); await p8.waitForTimeout(900);
  ok("D33: /mis-turnos con una cuenta de negocio lleva a su Agenda", new URL(p8.url()).pathname === "/panel/agenda");
  // en un perfil: Reservar y Seguir avisan que una cuenta de negocio no puede
  await p8.goto(BASE + sofiaPath); await p8.waitForSelector(".sgroup"); await p8.waitForTimeout(300);
  ok("D33: navegando el sitio, la cuenta de negocio tiene el mismo menú (sin la barra «reservando como cliente»)", (await p8.locator(".asclient").count()) === 0);
  await p8.click(".sgroup.seg-u .svci"); await p8.waitForTimeout(200); await p8.click("[data-quick]"); await p8.waitForTimeout(200);
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
  ok("D33: «Cerrar sesión y crear la cuenta del negocio» lleva al paso 0 sin sesión", (await p9.evaluate(() => !S.user)) && (await p9.locator("#amTitle").innerText()).includes("Registrá tu negocio"));
  ok("D33: la base no deja registrar un negocio con historial de cliente", /client_history/.test(await p9.evaluate(async () => {
    await sb.auth.signInWithPassword({ email: "luz@test.ar", password: "Luz2026clave" });
    const r = await sb.rpc("register_provider", { p_name: "Luz Negocio", p_address: "x", p_categories: ["u"], p_phone: "2284 1", p_dni: null, p_instagram: null, p_city: "olavarria" });
    await sb.auth.signOut(); return (r.error && r.error.message) || ""; })));
  await db.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('sinhistorial@test.ar', 'Clave2026hh', '{\"full_name\":\"Sin Historial\"}')");
  await p9.goto(BASE + "/ingresar"); await p9.waitForSelector("#fLogin");
  await p9.fill("#ai_e", "sinhistorial@test.ar"); await p9.fill("#ai_p", "Clave2026hh"); await p9.click("#fLogin button[type=submit]"); await p9.waitForTimeout(1200);
  await p9.click("#app .bizcta [data-act=bizStart]"); await p9.waitForTimeout(1200);
  ok("D33: una cuenta sin historial puede usarse para el negocio", (await p9.locator(".biz-card").innerText().catch(() => "")).includes("¿Usás esta cuenta para tu negocio?"));
  await p9.click("[data-act=bizUseThis]"); await p9.waitForSelector("#fBiz1", { timeout: 8000 }).catch(() => {});
  ok("D33: «Usar esta cuenta para mi negocio» abre el paso 1", new URL(p9.url()).pathname === "/registrar-negocio/1");
  await ctx9.close();
  ok("sin errores de JavaScript", errs.length === 0); if (errs.length) console.log(errs.slice(0, 5), bad);
  ok("sin bloqueos de la CSP", csp.length === 0); if (csp.length) console.log(csp.slice(0, 3));
  await b.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK"); process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2) });

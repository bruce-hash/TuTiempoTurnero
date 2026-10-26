// Prueba end-to-end en navegador real (Chromium) contra Postgres + PostgREST + reglas RLS reales.
// Recorre: listado multirrubro → perfil → login por código → reserva → pago (MP simulado) → cashback →
// panel del prestador (agenda, bloqueo, productos, gastos, rubros/servicios) → cancelación con devolución → seguridad →
// admin ("Para revisar · cobros") → Bloque 1: avisos de cobros y desconectar Mercado Pago.
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
let F = 0; const ok = (n, c) => { if (!c) F++; console.log((c ? "OK   " : "FAIL ") + n) };
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
  const seg = () => pg.evaluate(() => document.body.dataset.seg);
  // espera hasta que la consulta devuelva algo que cumple la condición (para lo que guarda la app sin avisar cuándo)
  const until = async (sql, args, test, ms = 6000) => { const t0 = Date.now(); let rows; do { rows = await q(sql, args); if (test(rows)) return true; await wait(200) } while (Date.now() - t0 < ms); return false };

  await pg.goto(BASE); await pg.waitForSelector(".grid .card"); await wait();
  ok("modo en vivo: sin barra demo", !(await pg.isVisible(".modebar")) && !(await pg.isVisible(".demo")));
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
  ok("pide ingresar para reservar", (await txt()).includes("Ingresá para reservar"));
  ok("ingreso con Google, email y contraseña", await pg.isVisible("[data-act=google]") && await pg.isVisible("#ai_p"));
  await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
  await pg.fill("#le", "ana@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc");
  probing = true; await pg.fill("#lc", "111111"); await pg.click("#fCode button[type=submit]"); await wait(); probing = false;
  ok("código incorrecto avisa", (await pg.locator("#lerr").innerText()).includes("incorrecto"));
  await pg.fill("#lc", "123456"); await pg.click("#fCode button[type=submit]"); await pg.waitForSelector("#fTurno"); await wait();
  ok("vuelve al pago ya logueado", (await txt()).includes("Confirmá tu turno"));
  ok("checkout: seña obligatoria y el resto en efectivo o Mercado Pago, sin preguntas ni saldo", (await pg.locator("[data-paym=mp]").count()) === 1 && (await pg.locator("[data-paym=cash]").count()) === 1 && !(await pg.locator(".intake").count()) && !(await txt()).includes("Saldo") && (await txt()).includes("$6.000"));
  ok("v30: la comisión va aparte de la seña (10% = $1.200) y se paga $7.200", (await pg.locator(".feerow").innerText()).includes("10%") && (await pg.locator(".feerow").innerText()).includes("$1.200") && (await pg.locator("#fTurno .tot").innerText()).includes("$7.200") && (await pg.locator("#fTurno button[type=submit]").innerText()).includes("$7.200"));
  await Promise.all([pg.waitForURL(/mp=success/).catch(() => {}), pg.click("#fTurno button[type=submit]")]);
  await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("vuelve de Mercado Pago con el turno confirmado", await pg.isVisible(".booked"));
  ok("el aviso principal dice qué servicio pagaste, sin la tarjeta repetida", (await pg.locator(".booked").innerText()).includes("Esmaltado semipermanente") && (await pg.locator(".turnocard").count()) === 0);
  ok("“No voy a poder ir” es un botón como los demás", (await pg.locator(".tacts [data-act=cancelAsk]").count()) === 1);
  const conf = await q("select m.body, m.kind from client_messages m join auth.users u on u.id=m.user_id where u.email='ana@test.ar' and m.kind='conf'");
  ok("aviso de confirmación en la app (sin WhatsApp)", conf.length === 1 && conf[0].body.includes("Sofía Benítez Studio"));
  ok("en la base: comisión cobrada aparte y guardada", (await q("select app_fee, client_fee from bookings where client_id = (select id from auth.users where email='ana@test.ar')"))[0].app_fee === 1200);
  ok("v30: el aviso dice seña + comisión", (await pg.locator(".booked .bk-must").innerText()).includes("$6.000 + $1.200 de comisión"));
  const bk = await q("select status, deposit, paid_mp, cashback from bookings where client_id = (select id from auth.users where email='ana@test.ar')");
  ok("en la base: confirmado, seña 50% y sin cashback", bk.length === 1 && bk[0].status === "confirmed" && bk[0].deposit === 6000 && bk[0].paid_mp === 6000 && bk[0].cashback === 0);
  const bx = await q("select price, addons, intake, buffer_min, extract(epoch from busy_until - ends_at)::int gap, extract(epoch from ends_at - starts_at)::int dur from bookings where client_id = (select id from auth.users where email='ana@test.ar')");
  ok("en la base: precio del servicio y descanso de 10 min", bx[0].price === 12000 && bx[0].addons.length === 0 && bx[0].buffer_min === 10 && bx[0].gap === 600 && bx[0].dur === 60 * 60);
  ok("sin saldo TuTiempo", (await q("select balance from wallets w join auth.users u on u.id=w.user_id where u.email='ana@test.ar'"))[0].balance === 0);
  await pg.click("nav [data-go=misturnos]"); await wait();
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
  await pg.click("nav [data-go=cuenta]"); await wait();
  ok("mi perfil muestra a quién sigo, sin saldo", (await txt()).includes("Sofía") && !(await txt()).includes("Saldo TuTiempo"));
  const PNG = { name: "foto.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAhQZKgAAZHwCArkOvB0AAAAASUVORK5CYII=", "base64") };
  await pg.setInputFiles("#upAv", PNG); await wait(1200);
  const av = await q("select p.avatar_path from profiles p join auth.users u on u.id=p.id where u.email='ana@test.ar'");
  ok("foto de la clienta guardada en su carpeta", !!av[0].avatar_path && av[0].avatar_path.startsWith((await q("select id::text from auth.users where email='ana@test.ar'"))[0].id + "/a-") && (await pg.locator("nav .avbtn img").count()) === 1);
  await pg.click("[data-act=logout]"); await wait();

  // ---------- Prestadora ----------
  await pg.click("[data-go=loginBarbero]"); await wait();
  probing = true; await pg.fill("#be", "sofia@test.ar"); await pg.fill("#bp", "mal"); await pg.click("#fBarb button[type=submit]"); await wait(); probing = false;
  ok("contraseña incorrecta", (await pg.locator("#berr").innerText()).includes("incorrectos"));
  await pg.fill("#bp", "prestador123"); await pg.click("#fBarb button[type=submit]"); await pg.waitForSelector(".bhead"); await wait();
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
  // caja
  await pg.click("[data-btab=caja]"); await pg.click("[data-act=walkOpen]"); await pg.fill("#wpr", "7000"); await pg.click("#fWalk button[type=submit]"); await wait(600);
  ok("servicio sin turno guardado", (await q("select count(*)::int c from walkins"))[0].c === 1);
  // cierre de caja del día
  await pg.click("[data-btab=finanzas]"); await wait(300);
  ok("finanzas: caja del día con lo que entró hoy (sin balance de 7 días)", (await txt()).includes("$7.000") && (await pg.locator("[data-fp=semana]").count()) === 0);
  await pg.fill("#cdCount", "7500"); await pg.click("#fCloseDay button[type=submit]"); await wait(900);
  const cc = await q("select kind, income, cash, counted from cash_closings");
  ok("caja del día cerrada en la base (y te sobran $500)", cc.length === 1 && cc[0].kind === "day" && cc[0].income === 7000 && cc[0].cash === 7000 && cc[0].counted === 7500 && /te sobran \$500/i.test(await txt()));
  await pg.click("[data-fp=mes]"); await wait(300); await pg.fill("#gc", "Alquiler"); await pg.fill("#gm", "150000"); await pg.click("#fGasto button[type=submit]"); await wait(800);
  ok("gasto del mes cargado una vez (sin categoría ni compras de productos)", (await q("select count(*)::int c from expenses where concept='Alquiler' and amount=150000"))[0].c === 1 && (await pg.locator("#gprod").count()) === 0);
  await pg.click("[data-act=closeMonth]"); await wait(800);
  ok("mes cerrado en la base", (await q("select count(*)::int c from cash_closings where kind='month'"))[0].c === 1);
  // rubros y servicios: sumar Masajes
  await pg.click("[data-btab=perfil]"); await wait(300);
  await pg.check("#rc-m", { force: true }); await wait(200); await pg.click("[data-act=svcAdd]"); await wait(200);
  const n = await pg.locator(".svcrow3").count();
  await pg.fill(`#sn${n - 1}`, "Masaje relajante"); await pg.fill(`#sd${n - 1}`, "50"); await pg.fill(`#sp${n - 1}`, "17000"); await pg.selectOption(`#sc${n - 1}`, "m");
  await pg.click("#fDatos button[type=submit]"); await wait(1500);
  ok("nuevo rubro y servicio en la base", (await q("select count(*)::int c from provider_categories pc join providers p on p.id=pc.provider_id where p.name like 'Sofía%' and pc.category_id='m'"))[0].c === 1
    && (await q("select count(*)::int c from services where name='Masaje relajante'"))[0].c === 1);
  // horarios
  await pg.click("[data-btab=horarios]"); await pg.selectOption("#hst", "20"); await pg.click("#fHorarios button[type=submit]"); await wait(800);
  ok("horarios guardados", (await q("select step_min from provider_settings ps join providers p on p.id=ps.provider_id where p.name like 'Sofía%'"))[0].step_min === 20);
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
  await pg.click("[data-act=salirBarbero]"); await wait(600); await pg.click(".segtile.seg-m"); await wait(800);
  ok("ahora aparece también en Masajes", (await pg.locator(".grid .card").innerText()).includes("Sofía"));
  // la clienta ve su tarjeta y reserva el premio gratis
  // los más activos primero
  await db.query("update providers set activity = 50 where name = 'Barbería Max'");
  await pg.evaluate(() => { S.cat = "todos"; S.q = ""; S.list = null; render() }); await wait(1500);
  ok("listado: primero el más activo (Max), sin mostrar el número de servicios", /max/i.test(await pg.locator(".grid .card h3").first().innerText()) && !(await pg.locator(".grid .card").first().innerText()).includes("servicios en los últimos"));
  await db.query("update loyalty_cards set stamps = 16 where user_id = (select id from auth.users where email='ana@test.ar') and service_id = $1", [esm]);
  await pg.click("nav [data-go=login]"); await wait(); await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
  await pg.fill("#le", "ana@test.ar"); await pg.click("#fMail button[type=submit]"); await pg.waitForSelector("#lc"); await pg.fill("#lc", "123456"); await pg.click("#fCode button[type=submit]"); await wait(1200);
  await pg.click("nav [data-go=misturnos]"); await wait(800);
  ok("v31: Mis turnos: el turno cancelado por bloqueo dice que el profesional la va a llamar (sin Reprogramar automático)", /canceló el profesional/i.test(await txt()) && /te va a llamar/i.test(await txt()) && (await pg.locator(".delpanel [data-act=rebook]").count()) === 0);
  ok("Mis sellos: tarjeta de Esmaltado 16 de 16, premio listo", (await pg.locator(".stampcard").count()) === 1 && (await pg.locator(".stampcard").innerText()).includes("Esmaltado semipermanente") && (await pg.locator(".stampcard").innerText()).includes("16 de 16") && /premio listo/i.test(await pg.locator(".stampcard").innerText()));
  const tt = (await txt()).toLowerCase(); ok("Mis turnos: primero los próximos, después avisos y sellos", tt.indexOf("próximos") >= 0 && tt.indexOf("próximos") < tt.indexOf("avisos y mensajes") && tt.indexOf("avisos y mensajes") < tt.indexOf("mis sellos"));
  await pg.click("[data-act=useReward]"); await pg.waitForSelector(".pcard"); await wait(800);
  await pg.click("[data-quick]"); await wait(200); await pg.click("[data-act=reservarT]"); await pg.waitForSelector("#fTurno"); await wait(300);
  ok("checkout con “Usar mi premio”, gratis", (await pg.locator("[data-paym=reward][aria-checked=true]").count()) === 1 && /canjear premio/i.test(await pg.locator("#fTurno button[type=submit]").innerText()));
  await pg.click("#fTurno button[type=submit]"); await pg.waitForSelector(".booked", { timeout: 8000 }).catch(() => {}); await wait(600);
  const rwb = await q("select price, pay_method, status from bookings where pay_method='reward'");
  ok("en la base: turno de premio gratis y sin sellos", rwb.length === 1 && rwb[0].price === 0 && rwb[0].status === "confirmed" && (await anaStamps()) === 0 && (await txt()).includes("Canjeaste tu premio"));
  await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  // cuentas: crear, activar con el link del email, ingresar con contraseña, recuperar y crear contraseña nueva
  const mailOf = async (em) => (await (await fetch(BASE + "/__mail?email=" + encodeURIComponent(em))).json());
  await pg.click("nav [data-go=login]"); await wait(); await pg.click("[data-act=authMode][data-m=up]"); await wait(200);
  await pg.fill("#au_n", "Carla Ruiz"); await pg.fill("#au_e", "carla@test.ar"); await pg.fill("#au_t", "2284 445566"); await pg.fill("#au_p", "Mate2026x"); await pg.fill("#au_p2", "Mate2026x");
  await pg.click("#fSignup button[type=submit]"); await wait(700);   // la app ignora un segundo envío en menos de medio segundo (doble toque)
  ok("crear cuenta pide aceptar términos", (await pg.locator("#aerr").innerText()).includes("términos"));
  await pg.check("#au_ok"); await pg.click("#fSignup button[type=submit]"); await wait(800);
  ok("cuenta creada: pide activarla por email", (await txt()).includes("Activá tu cuenta") && !(await pg.evaluate(() => !!S.user)));
  const pc = await q("select p.full_name, p.phone from profiles p join auth.users u on u.id = p.id where u.email = 'carla@test.ar'");
  ok("en la base: nombre y celular guardados", pc.length === 1 && pc[0].full_name === "Carla Ruiz" && pc[0].phone === "2284 445566");
  probing = true; await pg.goto(BASE + "/?token_hash=" + "f".repeat(32) + "&type=signup"); await wait(1200); probing = false;
  ok("link falso o vencido: no entra", !(await pg.evaluate(() => !!S.user)) && !(await pg.url()).includes("token_hash"));
  await pg.goto(BASE + "/?token_hash=" + (await mailOf("carla@test.ar")).signup + "&type=signup"); await wait(1500);
  ok("link de activación: entra sola y limpia la dirección", (await pg.evaluate(() => S.user && S.user.email)) === "carla@test.ar" && !(await pg.url()).includes("token_hash"));
  await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-go=login]"); await wait();
  probing = true; await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "otra1234"); await pg.click("#fLogin button[type=submit]"); await wait(800); probing = false;
  ok("contraseña incorrecta avisa", (await txt()).includes("Email o contraseña incorrectos"));
  await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "Mate2026x"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  ok("ingresar con email y contraseña", (await pg.evaluate(() => S.user && S.user.name)) === "Carla Ruiz");
  await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-go=login]"); await wait(); await pg.click("[data-act=authMode][data-m=forgot]"); await wait(200);
  await pg.fill("#af_e", "nadie@test.ar"); await pg.click("#fForgot button[type=submit]"); await wait(600);
  ok("recuperar con email inexistente: mismo mensaje", (await txt()).includes("Si nadie@test.ar tiene una cuenta"));
  await pg.click("[data-act=authMode][data-m=in]"); await wait(200); await pg.click("[data-act=authMode][data-m=forgot]"); await wait(200);
  await pg.fill("#af_e", "carla@test.ar"); await pg.click("#fForgot button[type=submit]"); await wait(600);
  await pg.goto(BASE + "/?token_hash=" + (await mailOf("carla@test.ar")).recovery + "&type=recovery"); await wait(1500);
  ok("link de recuperación abre “contraseña nueva”", await pg.isVisible("#fNewPass"));
  await pg.fill("#np1", "Nueva2026zz"); await pg.fill("#np2", "Nueva2026zz"); await pg.click("#fNewPass button[type=submit]"); await wait(1200);
  ok("en la base: contraseña nueva guardada", (await q("select encrypted_password from auth.users where email='carla@test.ar'"))[0].encrypted_password === "Nueva2026zz");
  await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  await pg.click("nav [data-go=login]"); await wait();
  await pg.fill("#ai_e", "carla@test.ar"); await pg.fill("#ai_p", "Nueva2026zz"); await pg.click("#fLogin button[type=submit]"); await wait(1200);
  ok("ingresa con la contraseña nueva", (await pg.evaluate(() => S.user && S.user.email)) === "carla@test.ar");
  // panel de administración (Carla pasa a ser admin)
  await db.query("insert into app_admins (user_id) select id from auth.users where email='carla@test.ar'");
  await pg.goto(BASE); await wait(1500); await pg.click("nav .avbtn"); await wait();
  ok("admin: botón del panel en Mi perfil", (await pg.locator("[data-act=toAdmin]").count()) === 1);
  await pg.click("[data-act=toAdmin]"); await pg.waitForSelector(".kpis.adm", { timeout: 8000 }).catch(() => {}); await wait(500);
  ok("admin: tablero con datos reales", (await pg.locator(".kpis.adm .kpi").count()) === 8 && (await pg.locator(".admtop li").count()) >= 2);
  ok("v30: sin la proyección y con el tablero simple (hoy/ayer + 4 semanas)", !(await txt()).includes("cerrás el mes") && (await pg.locator(".admday>div").count()) === 2 && (await pg.locator(".wkrow").count()) === 4 && (await pg.locator(".admbars").count()) === 0);
  await pg.click("[data-act=admT][data-t=com]"); await wait(300);
  ok("admin: comisión 10% en su pestaña", (await pg.inputValue("#admCom")) === "10");
  ok("admin: comisión sin botones fijos", (await pg.locator("[data-act=admComQuick]").count()) === 0);
  await pg.fill("#admCom", "12"); await pg.click("#fCom button[type=submit]"); await wait(1000);
  ok("admin: comisión guardada en la base (12%)", Number((await q("select commission_pct from app_settings"))[0].commission_pct) === 12);
  await pg.fill("#admCom", "8,5"); await pg.click("#fCom button[type=submit]"); await wait(1000);
  ok("admin: comisión libre con decimales (8,5%)", Number((await q("select commission_pct from app_settings"))[0].commission_pct) === 8.5);
  await pg.fill("#admCom", "10"); await pg.click("#fCom button[type=submit]"); await wait(800);
  probing = true; const forb = await pg.evaluate(async () => { const r = await sb.from("app_settings").update({ commission_pct: 1 }).eq("id", true).select(); return (r.data || []).length }); probing = false;
  ok("nadie cambia la comisión por fuera de la función", forb === 0 && Number((await q("select commission_pct from app_settings"))[0].commission_pct) === 10);
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
  await pg.click("[data-act=salirAdmin]"); await wait(400);
  probing = true; const reuse = await pg.evaluate(async (h) => { const r = await sb.auth.verifyOtp({ token_hash: h, type: "recovery" }); return !!r.error }, (await mailOf("carla@test.ar")).recovery); probing = false;
  ok("el link de recuperación sirve una sola vez", reuse);
  // ---------- Bloque 1 (H23): la prestadora desconecta Mercado Pago ----------
  const pay0 = (await q("select mp_payment_id from payments order by id desc limit 1"))[0].mp_payment_id;
  await db.query("select payment_mp_update($1, 'in_mediation')", [pay0]);   // un reclamo abierto: le llega el aviso
  await pg.goto(BASE); await wait(1200); await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  await pg.click("[data-go=loginBarbero]"); await wait();
  await pg.fill("#be", "sofia@test.ar"); await pg.fill("#bp", "prestador123"); await pg.click("#fBarb button[type=submit]"); await pg.waitForSelector(".bhead"); await wait(800);
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
  await pg.click("[data-act=salirBarbero]"); await wait(600);
  await pg.goto(BASE + "/p/" + sofi); await pg.waitForSelector(".sgroup", { timeout: 8000 }).catch(() => {}); await wait(800);
  ok("H23: su perfil público dice que todavía no toma turnos online (con Seguir) y no deja elegir horario",
     /Todavía no toma turnos online/.test(await txt()) && (await pg.locator(".bookbar").count()) === 0 && (await pg.locator("[data-slot]").count()) === 0);
  // D22 (H25): con la cuenta desconectada, una clienta con la tarjeta llena igual puede canjear su premio
  await db.query("update loyalty_cards set stamps = 16 where user_id = (select id from auth.users where email='ana@test.ar') and service_id = $1", [esm]);
  await pg.click("nav [data-go=login]"); await wait(); await pg.click("[data-act=authMode][data-m=code]"); await wait(200);
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
  await pg.click("nav .avbtn"); await wait(); await pg.click("[data-act=logout]"); await wait(800);
  // "Volver al panel" cierra la sesión del prestador: se vuelve a ingresar y la app vuelve a Perfil (?volver=)
  await pg.goto(BASE + "/panel/perfil"); await pg.waitForSelector("#fBarb", { timeout: 8000 }).catch(() => {}); await wait(400);
  await pg.fill("#be", "sofia@test.ar"); await pg.fill("#bp", "prestador123"); await pg.click("#fBarb button[type=submit]"); await pg.waitForSelector("[data-act=mpConnect]", { timeout: 8000 }).catch(() => {}); await wait(400);
  await Promise.all([pg.waitForURL(/mp_connected=1/, { timeout: 8000 }).catch(() => {}), pg.click("[data-act=mpConnect]")]); await wait(1500);
  const accRe = (await q("select id from mp_accounts where provider_id=$1 and status='active'", [sofi]))[0];
  ok("H23: reconectar la misma cuenta vuelve a cobrar con la misma fila", accRe && accRe.id === accBefore.id);

  // H21: en vivo no se descarta a nadie por cómo se llama (antes "Bruno F." quedaba afuera por parecer relleno de la demo)
  await db.query("insert into provider_clients (provider_id, name) values ($1, 'Bruno F.')", [sofi]);
  await pg.evaluate(async () => { await api.loadMine(); S.role = "barbero"; S.btab = "clientes"; S.cli = null; S.cf = "todos"; S.msgOpen = S.contactOpen = false; render() }); await wait(600);
  ok("H21: un cliente real llamado “Bruno F.” aparece en la lista de clientes", (await pg.locator('.clist [data-cli="Bruno F."]').count()) === 1);
  // ---------- Bloque 2b (H10): alta de prestador sin DNI en los metadatos; DNI y fotos después; activar = verificar ----------
  const ctx2 = await b.newContext({ viewport: { width: 400, height: 900 } }); const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errs.push(e.message));
  const wait2 = (ms = 400) => p2.waitForTimeout(ms); const txt2 = () => p2.locator("#app").innerText();
  await p2.goto(BASE + "/sumate"); await p2.waitForSelector("#fPrest");
  await p2.fill("#pn", "Uñas Nuevas"); await p2.fill("#pe", "nuevas@test.ar"); await p2.fill("#pp", "Nuevas2026x");
  await p2.fill("#ptel", "2284 555666"); await p2.fill("#pd", "33444555");
  const DNIF = (n) => ({ name: n + ".png", mimeType: "image/png", buffer: PNG.buffer });
  await p2.setInputFiles("#pf", DNIF("frente")); await wait2(200); await p2.setInputFiles("#pf2", DNIF("dorso")); await wait2(200);
  await p2.evaluate(() => { document.querySelector("#rr-u").checked = true; document.querySelector("#ptc").checked = true }); await p2.click("#fPrest button[type=submit]"); await wait2(1200);
  ok("H10: alta con confirmación de email: pide cargar el DNI después", (await txt2()).includes("Perfil → Verificación"));
  const meta = (await q("select raw_user_meta_data m from auth.users where email='nuevas@test.ar'"))[0].m;
  ok("H10: el DNI no viaja en los metadatos de la cuenta", meta.provider_reg && meta.provider_reg.name === "Uñas Nuevas" && !JSON.stringify(meta).includes("33444555"));
  await p2.goto(BASE + "/?token_hash=" + (await mailOf("nuevas@test.ar")).signup + "&type=signup"); await wait2(2000);
  const np = (await q("select p.id, p.status, pp.dni_number from providers p join provider_private pp on pp.provider_id=p.id join auth.users u on u.id=p.owner_id where u.email='nuevas@test.ar'"))[0];
  ok("H10: al confirmar se crea el perfil pendiente, todavía sin DNI", np && np.status === "pending" && np.dni_number === null);
  await p2.goto(BASE + "/panel/perfil"); await p2.waitForSelector("#fDni", { timeout: 8000 }).catch(() => {}); await wait2(400);
  ok("H10: Perfil → Verificación pide número, frente y dorso", await p2.isVisible("#fDni") && await p2.isVisible("#dniFront") && await p2.isVisible("#dniBack"));
  ok("D24: Perfil → Verificación avisa cuánto se guardan las fotos", (await p2.innerText("body")).includes("Guardamos las fotos hasta 30 días después de verificarte"));
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
  await p3.close(); await ctx2.close();
  ok("sin errores de JavaScript", errs.length === 0); if (errs.length) console.log(errs.slice(0, 5), bad);
  ok("sin bloqueos de la CSP", csp.length === 0); if (csp.length) console.log(csp.slice(0, 3));
  await b.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK"); process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2) });

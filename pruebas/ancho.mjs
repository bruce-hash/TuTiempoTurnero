// Ninguna pantalla más ancha que la ventana, y nada con `hidden` a la vista (y la respuesta visual del Bloque D): npm run test:ancho
// Recorre la demo (dist-test) en celular (390 px) y compu (1366 px): las pantallas del visitante, del cliente (mis turnos,
// mi perfil, reservar, turno confirmado), las 9 pestañas del panel del prestador y las 4 del admin. En cada una:
//  - el documento no es más ancho que la ventana (si lo es, dice qué elementos se pasan del borde);
//  - todo elemento con el atributo hidden está oculto (un CSS con display le puede ganar: la pastilla #notif vacía).
// 9/11: además, en 320, 375, 390 y 430 px (y textos largos en esos cuatro), en el celular ningún campo con letra menor a
// 16 px (iOS agranda la página al tocarlo y queda agrandada) y la cabecera alineada: la campanita y el menú de cuenta del
// mismo tamaño y con el mismo centro que el logo, en los tres roles, con y sin foto y con y sin el número de avisos.
// Uso: node pruebas/ancho.mjs <carpeta del build de prueba>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const { resolver } = require("./fallback.cjs");
const WEB = path.resolve(process.argv[2] || "dist-test");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".txt": "text/plain" };
const server = http.createServer((req, res) => {
  const { status, file } = resolver(WEB, new URL(req.url, "http://x").pathname);
  if (!file) {
    res.writeHead(status);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((ok) => server.listen(0, ok));
const BASE = `http://localhost:${server.address().port}`;

let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// qué se pasa del borde y qué se ve teniendo hidden
const revisar = (page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const wide = [];
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > width + 1 && getComputedStyle(el).position !== "fixed") {
        wide.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""} (${Math.round(box.right)} px)`);
      }
    }
    const shown = [...document.querySelectorAll("[hidden]")].filter((el) => getComputedStyle(el).display !== "none").map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""));
    return { width, scroll: document.documentElement.scrollWidth, wide: wide.slice(0, 4), shown };
  });

// 9/11: los campos visibles con letra menor a 16 px (en el celular)
const smallFields = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]):not([type=hidden]),select,textarea")]
      .filter((el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} (${getComputedStyle(el).fontSize})`),
  );
// 9/11: la campanita y el menú de cuenta, con el mismo centro que el logo; en el celular, del mismo tamaño (en la compu el
// menú lleva el nombre: misma altura). null si no hay menú de cuenta (sin sesión).
const header = (page, phone) =>
  page.evaluate((phone) => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, cy: Math.round((r.top + r.height / 2) * 10) / 10 };
    };
    const logo = box(".top .logo"), bell = box("nav .bell-btn"), acct = box("nav .acct-btn");
    if (!acct || !logo) return null;
    const same = (a, b) => Math.abs(a - b) <= 0.5;
    const ok = [bell, acct].filter(Boolean).every((b) => Math.abs(b.cy - logo.cy) <= 1)
      && (!bell || (same(bell.h, acct.h) && (!phone || same(bell.w, acct.w))));
    return { ok, detail: JSON.stringify({ logo, bell, acct }) };
  }, phone);

const browser = await chromium.launch();
const WIDTHS = [["celular 320", { width: 320, height: 640 }], ["celular 375", { width: 375, height: 812 }], ["celular", { width: 390, height: 844 }], ["celular 430", { width: 430, height: 932 }], ["compu", { width: 1366, height: 860 }]];
for (const [name, viewport] of WIDTHS) {
  const phone = viewport.width < 1024;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const wait = (ms = 350) => page.waitForTimeout(ms);
  const check = async (screen) => {
    await wait();
    const r = await revisar(page);
    ok(`${name} · ${screen}: no es más ancha que la ventana`, r.scroll <= r.width, `${r.scroll} px en ${r.width} px: ${r.wide.join(", ")}`);
    ok(`${name} · ${screen}: nada con hidden a la vista`, r.shown.length === 0, r.shown.join(", "));
    if (phone) {
      const small = await smallFields(page);
      ok(`${name} · ${screen}: ningún campo con letra menor a 16 px`, small.length === 0, small.join(", "));
    }
    const hd = await header(page, phone);
    if (hd) ok(`${name} · ${screen}: campanita y menú de cuenta alineados con el logo`, hd.ok, hd.detail);
  };
  const go = async (route) => {
    await page.goto(BASE + route);
    await page.waitForFunction(() => (document.querySelector("#app").children.length && !document.querySelector("#app .bootload")));
    await check(route);
  };
  const role = async (r) => {
    await page.evaluate((r) => document.querySelector(`[data-role-view=${r}]`).click(), r);
    await wait(500);
  };

  // visitante
  for (const route of ["/", "/rubro/barberias", "/buscar?q=corte", "/ingresar", "/crear-cuenta", "/sumate", "/registrar-negocio", "/prestadores/ingresar", "/terminos", "/privacidad", "/no-existe"]) await go(route);
  // 9/11: el formulario de Crear cuenta (aparece al elegir una de las dos opciones)
  await go("/crear-cuenta");
  await page.click(".kindopt[data-k=client]");
  await check("crear cuenta · formulario");
  await page.goto(BASE + "/");
  await page.waitForSelector(".grid .card");
  // 4/11: el pie centrado (el mismo espacio a los dos lados de sus bloques)
  const pie = await page.evaluate(() => {
    const inner = document.querySelector("footer .in");
    const cs = getComputedStyle(inner);
    const box = inner.getBoundingClientRect();
    const left = box.left + parseFloat(cs.paddingLeft);
    const right = box.right - parseFloat(cs.paddingRight);
    const blocks = [...inner.children].filter((el) => !el.classList.contains("legal")).map((el) => el.getBoundingClientRect());
    return { izq: Math.round(Math.min(...blocks.map((b) => b.left)) - left), der: Math.round(right - Math.max(...blocks.map((b) => b.right))) };
  });
  ok(`${name} · pie centrado`, Math.abs(pie.izq - pie.der) <= 4, JSON.stringify(pie));
  await page.click(".grid .card [data-go=perfil]");
  await check("perfil del prestador");
  for (const tab of ["works", "reviews"]) {
    await page.evaluate((t) => { S.ptab = t; render(); }, tab);
    await check(`perfil · ${tab}`);
  }
  await page.evaluate(() => { S.ptab = "svc"; render(); });
  // cliente: reservar, turno confirmado, mis turnos, mi perfil
  await page.click("[data-quick]");
  await wait(200);
  await page.click("[data-act=reservarT]");
  await page.fill("#ai_e", "juan.perez@tutiempo.demo");
  await page.fill("#ai_p", "cliente123");
  await page.click("#fLogin button[type=submit]");
  await page.waitForSelector("#fTurno");
  await check("reservar (pago)");
  await page.click("#fTurno button[type=submit]");
  await wait(700);
  await check("turno confirmado");
  await page.click("nav [data-go=misturnos]").catch(() => page.evaluate(() => go("misturnos")));
  await check("mis turnos");
  await page.evaluate(() => go("cuenta"));
  await check("mi perfil");
  // 4/11: la campanita abierta (en el celular, a lo ancho de la pantalla: sin pasarse del borde)
  await page.click("nav [data-act=bellToggle]");
  await page.waitForSelector(".bellpanel");
  await check("campanita (cliente)");
  const bellBox = await page.evaluate(() => { const r = document.querySelector(".bellpanel").getBoundingClientRect(); return [r.left, r.right, document.documentElement.clientWidth]; });
  ok(`${name} · campanita (cliente): la lista entra en la pantalla`, bellBox[0] >= 0 && bellBox[1] <= bellBox[2], JSON.stringify(bellBox));
  await page.keyboard.press("Escape");
  // 4/11 · Bloque 4: Ajustes (solo Seguridad) → Cambiar contraseña (la actual y la nueva; después el código del email)
  await page.evaluate(() => go("ajustes"));
  await check("ajustes");
  await page.click("[data-act=changePass]");
  await check("cambiar contraseña");
  await page.fill("#np0", "cliente123"); await page.fill("#np1", "Nueva2026zz"); await page.fill("#np2", "Nueva2026zz");
  await page.click("#fNewPass button[type=submit]");
  await page.waitForSelector("#np_c");
  await check("cambiar contraseña · código");
  await page.click("[data-act=npCancel]");
  // Registrá tu negocio: los 5 pasos y el final (como un prestador con el alta a medias)
  for (const step of [1, 2, 3, 4, 5, "listo"]) {
    await page.evaluate((n) => { S.role = "cliente"; S.barberAuth = true; S.setupBy = { [S.me || 7]: { steps: [1, 2], status: "pending" } }; S.biz = {}; S.bizStep = n; go("negocio"); }, step);
    await wait(200);
    await check(`registrá tu negocio · paso ${step}`);
  }
  await page.evaluate(() => { S.setupBy = {}; });
  // prestador y admin
  await role("barbero");
  await page.click("nav [data-act=bellToggle]");
  await page.waitForSelector(".bellpanel");
  await check("campanita (profesional)");
  await page.keyboard.press("Escape");
  for (const tab of ["agenda", "finanzas", "clientes", "productos", "horarios", "stats", "comunidad", "perfil"]) {
    await page.click(`[data-btab=${tab}]`);
    await check(`panel · ${tab}`);
  }
  // 9/11: los formularios del panel que se abren con un botón (agendar, bloquear, contacto, mensaje)
  for (const [tab, act] of [["agenda", "manOpen"], ["agenda", "blockOpen"], ["clientes", "contactOpen"], ["clientes", "msgOpen"]]) {
    await page.click(`[data-btab=${tab}]`);
    await wait(200);
    if (await page.locator(`[data-act=${act}]`).count()) {
      await page.click(`[data-act=${act}] >> nth=0`);
      await check(`panel · ${tab} · ${act}`);
    }
  }
  // 4/11 · Bloque 3: Clientes → Seguidores, con "Ofrecer" abierto
  await page.click("[data-btab=clientes]");
  await page.click("[data-act=ctab][data-t=seguidores]");
  await page.waitForSelector(".folist");
  await check("panel · clientes · seguidores");
  await page.click(".folist [data-act=folOffer]");
  await check("panel · clientes · seguidores · ofrecer");
  await role("admin");
  for (const tab of ["res", "prov", "bal", "com"]) {
    await page.click(`[data-act=admT][data-t=${tab}]`);
    await check(`admin · ${tab}`);
  }
  // 9/11: la cabecera en los tres roles, con y sin foto y con y sin el número rojo de avisos
  for (const r of ["cliente", "barbero", "admin"]) {
    await role(r);
    for (const photo of [false, true]) {
      for (const unread of [false, true]) {
        await page.evaluate(([photo, unread]) => {
          const pic = photo ? "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'/%3E" : null;
          if (S.user) S.user.photo = pic;
          const me = (typeof P !== "undefined" ? P : []).find((prov) => prov.id == S.me);
          if (me) me.photo = pic;
          (S.inbox || []).forEach((m) => (m.read = !unread));
          (S.notices || []).forEach((n) => (n.read = !unread));
          if (unread && !(S.notices || []).length) S.notices = [{ id: 9902, kind: "new_follower", body: "Ana empezó a seguirte", at: new Date().toISOString(), read: false }];
          render();
        }, [photo, unread]);
        await wait(150);
        const hd = await header(page, phone);
        ok(`${name} · cabecera ${r}${photo ? " con foto" : " sin foto"}${unread ? " y con avisos sin leer" : ""}: campanita y menú del mismo tamaño y alineados con el logo`, hd && hd.ok, hd ? hd.detail : "sin menú de cuenta");
      }
    }
  }
  ok(`${name}: sin errores de JavaScript`, errors.length === 0, errors.join(" | "));
  await page.close();
}
// 7/11: textos largos (notas de devolución, nombres de servicio, de negocio y de cliente, direcciones, avisos y
// palabras sin espacios) en 390 px, para el cliente, el profesional y el admin: nada se sale de la pantalla
for (const width of [320, 375, 390, 430]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const largo = async (screen) => {
    await page.waitForTimeout(350);
    const r = await revisar(page);
    ok(`textos largos ${width} · ${screen}: no es más ancha que la ventana`, r.scroll <= r.width, `${r.scroll} px en ${r.width} px: ${r.wide.join(", ")}`);
  };
  await page.goto(BASE + "/");
  await page.waitForSelector(".grid .card");
  await page.click(".grid .card [data-go=perfil]");
  await page.click("[data-quick]");
  await page.waitForTimeout(200);
  await page.click("[data-act=reservarT]");
  await page.fill("#ai_e", "juan.perez@tutiempo.demo");
  await page.fill("#ai_p", "cliente123");
  await page.click("#fLogin button[type=submit]");
  await page.waitForSelector("#fTurno");
  await page.evaluate(() => {
    const NEG = "Peluquería, Barbería y Spa Unisex «Los Hermanos Rodríguez Fernández» de Olavarría Centro";
    const SVC = "Corte de cabello largo con lavado, masaje capilar, tratamiento de keratina brasileña y peinado de fiesta";
    P.forEach((prov, i) => {
      prov.name = `${NEG} ${i + 1}`;
      prov.addr = "Avenida Hipólito Yrigoyen 3456, entre Rivadavia y Belgrano, planta alta, Olavarría";
      (prov.svcs || []).forEach((svc) => (svc[0] = `${SVC} · ${svc[0]}`));
    });
    const pasado = (d) => { const x = new Date(Date.now() - d * 864e5); return x.toISOString().slice(0, 10); };
    const base = { pid: P[0].id, dur: 30, price: 10000, paid: 3000, mine: true, cliente: "Juan Pérez", type: "app", src: "app", svc: SVC };
    BOOK.push(
      Object.assign({}, base, { id: 990001, date: pasado(7), time: "17:30", status: "expired", refund: { amount: 5400, status: "done", done: pasado(6), reason: "booking_past" } }),
      Object.assign({}, base, { id: 990002, date: pasado(8), time: "16:00", status: "cancelled", byProv: true, refund: { amount: 5400, status: "pending", reason: "slot_taken" } }),
      Object.assign({}, base, { id: 990003, date: pasado(9), time: "15:00", status: "done" }),
    );
    S.user.email = "juan.perez.rodriguez.gonzalez.fernandez.de.la.torre@tutiempo.demo";
    S.user.name = "Juan Ignacio Pérez Rodríguez González Fernández de la Torre";
    (S.inbox || (S.inbox = [])).unshift({ id: "largo1", name: P[0].name, body: "Te devolvimos $5.400 el 31/10 (tu pago se acreditó después de la hora del turno). Cualquier duda escribinos a soporte.tutiempo.olavarria.atencion.al.cliente@tutiempo.com.ar o entrá a https://prueba.tutiempo.com.ar/mis-turnos/devoluciones/2026/octubre", d: "hoy", kind: "news", pid: P[0].id });
  });
  for (const [view, label] of [["home", "inicio"], ["perfil", "perfil del negocio"], ["checkoutT", "confirmación"], ["misturnos", "mis turnos"], ["cuenta", "mi perfil"]]) {
    await page.evaluate(([v]) => { if (v === "perfil") S.pid = P[0].id; go(v); }, [view]);
    await largo(`cliente · ${label}`);
  }
  await page.evaluate(() => { S.turnoId = 990001; go("turnoOk"); });
  await largo("cliente · turno devuelto");
  await page.click("nav [data-act=bellToggle]");
  await page.waitForSelector(".bellpanel");
  await largo("cliente · campanita");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("[data-role-view=barbero]").click());
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const CLI = "María de los Ángeles Fernández Gutiérrez de Olavarría (la hermana de Juan)";
    BOOK.filter((b) => b.pid == S.me && b.cliente).forEach((b, i) => { b.cliente = `${CLI} ${i}`; b.svc = "Alisado definitivo con keratina brasileña, corte y peinado de fiesta para casamiento"; });
    Object.values(CLIENTS).forEach((c, i) => { if (c && typeof c === "object") c.tel = "2284 555 123 456 789 / 2284 444 987 654"; });
    PRODS.forEach((prod) => (prod.n = "Shampoo reparador profesional para cabellos teñidos y dañados de 1 litro " + prod.n));
    (S.notices || (S.notices = [])).unshift({ id: 9901, kind: "mp_term", body: "Mercado Pago te cobró la comisión de acreditar a 35 días ($117) y en Horarios tenés elegido al instante (pago n° 132456789012345678901234567890). Si tu cuenta de Mercado Pago acredita a 35 días, cambiá el plazo en Horarios.", at: new Date().toISOString(), read: false });
  });
  for (const tab of ["agenda", "finanzas", "clientes", "productos", "horarios", "perfil"]) {
    await page.click(`[data-btab=${tab}]`);
    await largo(`profesional · ${tab}`);
  }
  await page.click("nav [data-act=bellToggle]");
  await page.waitForSelector(".bellpanel");
  await largo("profesional · campanita");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("[data-role-view=admin]").click());
  await page.waitForTimeout(500);
  for (const tab of ["res", "prov", "bal", "com"]) {
    await page.click(`[data-act=admT][data-t=${tab}]`);
    await largo(`admin · ${tab}`);
  }
  ok(`textos largos ${width}: sin errores de JavaScript`, errors.length === 0, errors.join(" | "));
  await page.close();
}
// Bloque D · respuesta visual: con mouse, la tarjeta sube al pasar por encima; con prefers-reduced-motion, no se mueve
for (const motion of ["no-preference", "reduce"]) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 860 }, reducedMotion: motion });
  await page.goto(BASE + "/");
  await page.waitForSelector(".grid .card");
  await page.hover(".grid .card");
  await page.waitForTimeout(300);
  const lift = await page.evaluate(() => getComputedStyle(document.querySelector(".grid .card")).transform);
  ok(`respuesta visual (${motion}): la tarjeta ${motion === "reduce" ? "no se mueve" : "sube"} con el mouse`, motion === "reduce" ? lift === "none" : lift !== "none", lift);
  await page.close();
}
await browser.close();
server.close();
console.log(F ? `${F} FALLAS` : "TODO OK");
process.exit(F ? 1 : 0);

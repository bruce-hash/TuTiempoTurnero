// Ninguna pantalla más ancha que la ventana, y nada con `hidden` a la vista (y la respuesta visual del Bloque D): npm run test:ancho
// Recorre la demo (dist-test) en celular (390 px) y compu (1366 px): las pantallas del visitante, del cliente (mis turnos,
// mi perfil, reservar, turno confirmado), las 9 pestañas del panel del prestador y las 4 del admin. En cada una:
//  - el documento no es más ancho que la ventana (si lo es, dice qué elementos se pasan del borde);
//  - todo elemento con el atributo hidden está oculto (un CSS con display le puede ganar: la pastilla #notif vacía).
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

const browser = await chromium.launch();
for (const [name, viewport] of [["celular", { width: 390, height: 844 }], ["compu", { width: 1366, height: 860 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  const wait = (ms = 350) => page.waitForTimeout(ms);
  const check = async (screen) => {
    await wait();
    const r = await revisar(page);
    ok(`${name} · ${screen}: no es más ancha que la ventana`, r.scroll <= r.width, `${r.scroll} px en ${r.width} px: ${r.wide.join(", ")}`);
    ok(`${name} · ${screen}: nada con hidden a la vista`, r.shown.length === 0, r.shown.join(", "));
  };
  const go = async (route) => {
    await page.goto(BASE + route);
    await page.waitForFunction(() => document.querySelector("#app").children.length);
    await check(route);
  };
  const role = async (r) => {
    await page.evaluate((r) => document.querySelector(`[data-role-view=${r}]`).click(), r);
    await wait(500);
  };

  // visitante
  for (const route of ["/", "/rubro/barberias", "/buscar?q=corte", "/ingresar", "/crear-cuenta", "/sumate", "/prestadores/ingresar", "/terminos", "/no-existe"]) await go(route);
  await page.goto(BASE + "/");
  await page.waitForSelector(".grid .card");
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
  // prestador y admin
  await role("barbero");
  for (const tab of ["agenda", "caja", "finanzas", "clientes", "productos", "horarios", "stats", "comunidad", "perfil"]) {
    await page.click(`[data-btab=${tab}]`);
    await check(`panel · ${tab}`);
  }
  await role("admin");
  for (const tab of ["res", "prov", "bal", "com"]) {
    await page.click(`[data-act=admT][data-t=${tab}]`);
    await check(`admin · ${tab}`);
  }
  ok(`${name}: sin errores de JavaScript`, errors.length === 0, errors.join(" | "));
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

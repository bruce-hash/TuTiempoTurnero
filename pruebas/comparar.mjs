// Comparación en navegador real (Chromium) de la versión de referencia (antes del Bloque A) con la nueva.
// El mismo recorrido, con clics, en las dos: listado, perfil, monto del pago, reserva confirmada, las 9 pestañas del
// panel del prestador y las 4 del panel admin. En cada paso compara el texto de la pantalla y una captura completa.
//   · Modo demo: build viejo sin config.js vs. dist-test/, con el reloj fijo (TT_AHORA).
//   · En vivo: build viejo vs. dist/ (producción), cada uno con su base, PostgREST y e2e_server.js, corriendo a la vez.
// Uso: node pruebas/comparar.mjs [carpeta del build de referencia]   (por defecto .build/referencia/dist; si no existe,
//      lo arma desde el commit de referencia con su propio tools/build.mjs)
// Necesita Postgres (PGHOST, PGPORT, PGUSER, PGPASSWORD) y PostgREST (POSTGREST) para la parte en vivo.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { chromium } from "playwright";
import pg from "pg";
import { levantar } from "./entorno_e2e.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REF = "1368349";
const AHORA = new Date(process.env.TT_AHORA || "2026-10-21T15:00:00-03:00");
const SALIDA = path.join(ROOT, ".build", "comparar");
let fallas = 0;
const linea = (ok, msg) => { if (!ok) fallas++; console.log((ok ? "OK   " : "FAIL ") + msg); };

// ---------- Build de referencia ----------
function referencia() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const dir = path.join(ROOT, ".build", "referencia");
  if (!fs.existsSync(path.join(dir, "dist", "app.js"))) {
    console.log(`Armando el build de referencia (${REF})…`);
    fs.rmSync(dir, { recursive: true, force: true });
    execSync(`git worktree prune && git worktree add --detach ${JSON.stringify(dir)} ${REF}`, { cwd: ROOT, stdio: "ignore" });
    execSync("npm ci --no-audit --no-fund --loglevel=error && node tools/build.mjs", { cwd: dir, stdio: "inherit", env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } });
  }
  return path.join(dir, "dist");
}

// ---------- Servidor estático (modo demo) ----------
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".woff2": "font/woff2" };
// Bloque 2a (H14 y H18, cambios a propósito): la demo ya no usa negocios reales ni precarga el ingreso de prestadores.
// A la versión de referencia se le cambian esos datos por los nuevos al servir su app.js, así las dos muestran los mismos
// nombres, direcciones, iniciales y links; el resto se compara igual.
const RENOMBRES = [
  ['ig:"Hidro.Style"', 'ig:"filo.barber.demo"'], ["Hidro.Style", "Filo Barber Club"], ['addr:"9 de julio 2381"', 'addr:"Alsina 2100"'],
  ['tel:"2284727692"', 'tel:"2284 000123"'], ["Kevin Ortiz", "Tomás Herrera barbero"], ['addr:"Antártida Argentina 4762"', 'addr:"Lavalle 3100"'],
  ["Barbería la fama santiago", "Barbería El Molino"], ['addr:"Rivadavia 2684"', 'addr:"Moreno 2400"'],
  ["Niko_barberr", "Nacho barber"], ['addr:"Islas Malvinas 3974"', 'addr:"Sarmiento 3200"'],
  ["Mary Garcia peluquería", "Marta Ruiz peluquería"], ['addr:"Av. Colon 3794"', 'addr:"Av. Pringles 3800"'],
  ["Carina Saitti", "Valeria Sosa estilista"], ['addr:"Belgrano 2683"', 'addr:"Rufino Fal 2600"'],
  ['tel:"2284 111222"', 'tel:"2284 000456"'], ['ig:"sofi.studio"', 'ig:"sofi.studio.demo"'],
  ['email:"hidro.style@tutiempo.demo",pass:"barbero123"', 'email:"",pass:""'],
  ["hidro.style@tutiempo.demo", "filo@tutiempo.demo"], ["hidro.style.mp", "filo.barber.mp"],
  // Bloque 2b (H22): la barra de la demo nombra el archivo real
  ["completá config.cjs con", "completá config.js con"],
  // Bloque 2b: las cuentas de demo usan el dominio tutiempo.demo, no uno real
  ["juan.perez@gmail.com", "juan.perez@tutiempo.demo"], ["donpepe.barber@gmail.com", "donpepe@tutiempo.demo"],
];
const renombrar = (js) => RENOMBRES.reduce((t, [a, b]) => t.split(a).join(b), js);
function estatico(dir, reescribir) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
      const f = path.join(dir, u === "/" ? "index.html" : path.normalize(u).replace(/^(\.\.[/\\])+/, ""));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": TIPOS[path.extname(f)] || "application/octet-stream" });
      if (reescribir && f.endsWith(".js")) return res.end(reescribir(fs.readFileSync(f, "utf8")));
      fs.createReadStream(f).pipe(res);
    }).listen(0, () => ok({ url: `http://localhost:${s.address().port}`, cerrar: () => s.close() }));
  });
}

// ---------- Recorridos ----------
const PESTANAS = ["agenda", "caja", "finanzas", "clientes", "productos", "horarios", "stats", "comunidad", "perfil"];
const ADMIN = ["res", "prov", "bal", "com"];

async function pagina(browser, { relojFijo }) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.errores = [];
  page.on("pageerror", (e) => page.errores.push(e.message));
  if (relojFijo) await page.clock.setFixedTime(AHORA);
  return page;
}
// Diferencias buscadas desde el Bloque B, iguales en las dos versiones antes de comparar: el link del prestador ("Tu link de
// turnos" y "Sumá seguidores") pasó de tutiempo.com.ar/… escrito a mano al dominio en el que corre la app, y el QR pasó
// de decorativo a uno real con la dirección del perfil (lo prueba pruebas/rutas.mjs). Se reemplazan por un texto y un
// recuadro fijos; el resto de la pantalla se compara igual, texto y píxeles.
async function normalizar(page) {
  await page.evaluate(() => {
    document.querySelectorAll("#app p.lbl").forEach((label) => {
      if (!/^(Tu link de turnos|Sumá seguidores)$/.test(label.textContent.trim())) return;
      const box = label.parentElement;
      const link = [...box.querySelectorAll("p")].find((el) => el !== label && el.style.fontWeight === "700");
      if (link) link.textContent = "LINK DEL PRESTADOR";
      const qr = box.querySelector(".qr");
      if (qr) qr.innerHTML = '<svg width="132" height="132"><rect width="132" height="132" fill="#ccc"/></svg>';
    });
    // Bloque 1 (cambios a propósito): el panel admin suma "Para revisar · cobros" y, en vivo, la tarjeta de Mercado Pago
    // muestra el número de cuenta en lugar del "hidro.style.mp" de la demo (en vivo la versión de referencia lo sigue mostrando)
    document.querySelectorAll("#app p.lbl").forEach((label) => {
      if (/^Para revisar · cobros/i.test(label.textContent.trim())) label.parentElement.remove();
    });
    // Bloque 2b (H24, cambio a propósito): en vivo, la pestaña Comisión suma "Dirección del sitio"
    document.querySelectorAll("#app #fSite").forEach((form) => form.remove());
    // los avisos flotantes (toast, notif) duran unos segundos: según lo rápido que vaya la máquina, el del paso anterior
    // todavía se ve o ya no. No son parte de la pantalla: se esconden en las dos versiones
    // (además display:none: en la versión de referencia el CSS de .notif le gana a hidden y la pastilla vacía se veía siempre)
    document.querySelectorAll("#toast, #notif").forEach((el) => { el.hidden = true; el.style.display = "none"; });
    // la cabecera cambia a propósito (arreglos visuales: en el celular, los botones sin sesión entran en una línea): se
    // esconde en las dos versiones; el contenido (#app) se compara igual, texto y píxeles
    document.querySelectorAll("header.top").forEach((el) => Object.assign(el.style, { visibility: "hidden", height: "96px", overflow: "hidden", boxSizing: "border-box" }));
    // en vivo corre con el reloj real: la línea de "ahora" de la agenda cambia de minuto (y de lugar) entre una captura y otra
    document.querySelectorAll("#app .tl-now").forEach((line) => line.remove());
    document.querySelectorAll("#app .paym small.hint").forEach((hint) => {
      hint.textContent = hint.textContent.replace(/^(hidro\.style\.mp|Cuenta n° \S+) · /, "CUENTA · ");
    });
  });
}
async function foto(page, pasos, nombre) {
  await normalizar(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const texto = await page.locator("#app").innerText();
  const png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
  pasos.push({ nombre, texto, png });
}
const clic = async (page, sel) => { await page.locator(sel).first().click(); await page.waitForTimeout(250); };

async function recorridoDemo(page, url) {
  const pasos = [];
  await page.goto(url);
  await page.waitForSelector(".grid .card");
  await foto(page, pasos, "listado");
  await clic(page, ".grid .card [data-go=perfil]");
  await clic(page, "[data-quick]");
  await foto(page, pasos, "perfil con horario elegido");
  await clic(page, "[data-act=reservarT]");
  await page.fill("#ai_e", "juan.perez@tutiempo.demo");
  await page.fill("#ai_p", "cliente123");
  await clic(page, "#fLogin button[type=submit]");
  await page.waitForSelector("#fTurno");
  await foto(page, pasos, "pago (monto)");
  await clic(page, "#fTurno button[type=submit]");
  await page.waitForTimeout(600);
  await foto(page, pasos, "reserva confirmada");
  await clic(page, "[data-role-view=barbero]");
  for (const t of PESTANAS) { await clic(page, `[data-btab=${t}]`); await foto(page, pasos, `panel · ${t}`); }
  await clic(page, "[data-role-view=admin]");
  for (const t of ADMIN) { await clic(page, `[data-act=admT][data-t=${t}]`); await foto(page, pasos, `admin · ${t}`); }
  return pasos;
}

async function recorridoVivo(browser, url) {
  const pasos = [];
  // clienta: listado, perfil, pago y reserva confirmada (Mercado Pago simulado por e2e_server.js)
  let page = await pagina(browser, { relojFijo: false });
  await page.goto(url);
  await page.waitForSelector(".grid .card");
  await foto(page, pasos, "listado");
  await clic(page, ".grid .card:has-text('Sofía') [data-go=perfil]");
  await page.waitForSelector(".sgroup");
  await clic(page, ".sgroup.seg-u .svci");
  await clic(page, "[data-quick]");
  await foto(page, pasos, "perfil con horario elegido");
  await clic(page, "[data-act=reservarT]");
  await clic(page, "[data-act=authMode][data-m=code]");
  await page.fill("#le", "ana@test.ar");
  await clic(page, "#fMail button[type=submit]");
  await page.waitForSelector("#lc");
  await page.fill("#lc", "123456");
  await clic(page, "#fCode button[type=submit]");
  await page.waitForSelector("#fTurno");
  await foto(page, pasos, "pago (monto)");
  await clic(page, "#fTurno button[type=submit]");
  await page.waitForURL(/mp=success|\/$/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await foto(page, pasos, "reserva confirmada");
  const errores = [...page.errores];
  await page.context().close();
  // prestadora: las 9 pestañas del panel
  page = await pagina(browser, { relojFijo: false });
  await page.goto(url);
  await clic(page, "[data-go=loginBarbero]");
  await page.fill("#be", "sofia@test.ar");
  await page.fill("#bp", "prestador123");
  await clic(page, "#fBarb button[type=submit]");
  await page.waitForSelector(".bhead");
  for (const t of PESTANAS) { await clic(page, `[data-btab=${t}]`); await page.waitForTimeout(300); await foto(page, pasos, `panel · ${t}`); }
  errores.push(...page.errores);
  await page.context().close();
  // admin: las 4 pestañas
  page = await pagina(browser, { relojFijo: false });
  await page.goto(url);
  await clic(page, "[data-go=login]");
  await page.fill("#ai_e", "admin@test.ar");
  await page.fill("#ai_p", "admin12345");
  await clic(page, "#fLogin button[type=submit]");
  await page.waitForTimeout(600);
  await clic(page, "[data-go=cuenta]");
  await clic(page, "[data-act=toAdmin]");
  await page.waitForTimeout(600);
  for (const t of ADMIN) { await clic(page, `[data-act=admT][data-t=${t}]`); await page.waitForTimeout(400); await foto(page, pasos, `admin · ${t}`); }
  errores.push(...page.errores);
  await page.context().close();
  pasos.errores = errores;
  return pasos;
}

// Píxeles distintos entre dos capturas (se compara en el navegador, con canvas): { fuertes, suaves }.
// "suaves" = diferencias de 1 o 2 niveles de color, que Chromium produce a veces en bordes a medio píxel aunque la
// página sea la misma (pasa también comparando una versión contra sí misma); se informan aparte.
const SUAVIZADO_MAX = 100;
async function pixelesDistintos(browser, a, b) {
  if (a.equals(b)) return { fuertes: 0, suaves: 0 };
  const page = await browser.newPage();
  const n = await page.evaluate(async ([x, y]) => {
    const img = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); return i; };
    const [i1, i2] = [await img(x), await img(y)];
    if (i1.width !== i2.width || i1.height !== i2.height) return { fuertes: -1, suaves: 0 };
    const c = document.createElement("canvas"); c.width = i1.width; c.height = i1.height;
    const g = c.getContext("2d");
    g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let fuertes = 0, suaves = 0;
    for (let j = 0; j < d1.length; j += 4) {
      const m = Math.max(Math.abs(d1[j] - d2[j]), Math.abs(d1[j + 1] - d2[j + 1]), Math.abs(d1[j + 2] - d2[j + 2]));
      if (m > 2) fuertes++; else if (m) suaves++;
    }
    return { fuertes, suaves };
  }, [a.toString("base64"), b.toString("base64")]);
  await page.close();
  return n;
}

async function comparar(browser, modo, viejo, nuevo) {
  const dir = path.join(SALIDA, modo);
  fs.mkdirSync(dir, { recursive: true });
  if (viejo.length !== nuevo.length) linea(false, `${modo}: distinta cantidad de pasos (${viejo.length} y ${nuevo.length})`);
  for (let i = 0; i < Math.min(viejo.length, nuevo.length); i++) {
    const a = viejo[i], b = nuevo[i];
    const f = `${String(i + 1).padStart(2, "0")}-${a.nombre.replace(/[^a-z0-9]+/gi, "-")}`;
    const texto = a.texto === b.texto;
    const { fuertes, suaves } = await pixelesDistintos(browser, a.png, b.png);
    const imagenOk = fuertes === 0 && suaves <= SUAVIZADO_MAX;
    if (!texto || !imagenOk) {
      fs.writeFileSync(path.join(dir, f + "-viejo.txt"), a.texto); fs.writeFileSync(path.join(dir, f + "-nuevo.txt"), b.texto);
      fs.writeFileSync(path.join(dir, f + "-viejo.png"), a.png); fs.writeFileSync(path.join(dir, f + "-nuevo.png"), b.png);
    }
    const img = fuertes < 0 ? "IMAGEN DE OTRO TAMAÑO" : fuertes ? `${fuertes} PÍXELES DISTINTOS` : suaves > SUAVIZADO_MAX ? `${suaves} PÍXELES DE SUAVIZADO (máx. ${SUAVIZADO_MAX})` : suaves ? `imagen idéntica salvo ${suaves} píxeles de suavizado (±2 niveles)` : "imagen idéntica";
    linea(texto && imagenOk, `${modo} · ${a.nombre}: ${texto ? "texto idéntico" : "TEXTO DISTINTO"} · ${img} (${a.texto.length} caracteres)`);
  }
}

// ---------- Principal ----------
const VIEJO = referencia();
fs.rmSync(SALIDA, { recursive: true, force: true });
// opciones para que las capturas no dependan del orden de pintado (sin GPU, color sRGB, texto sin suavizado LCD)
const browser = await chromium.launch({ args: ["--disable-gpu", "--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });

// Modo demo
{
  const [sv, sn] = [await estatico(VIEJO, renombrar), await estatico(path.resolve(process.env.COMPARAR_DEMO || path.join(ROOT, "dist-test")))];
  const [pv, pn] = [await pagina(browser, { relojFijo: true }), await pagina(browser, { relojFijo: true })];
  const viejo = await recorridoDemo(pv, sv.url);
  const nuevo = await recorridoDemo(pn, sn.url);
  linea(!pv.errores.length && !pn.errores.length, `demo: sin errores de JavaScript (${[...pv.errores, ...pn.errores].join(" / ").slice(0, 200)})`);
  await comparar(browser, "demo", viejo, nuevo);
  sv.cerrar(); sn.cerrar();
}

// En vivo (si hay Postgres y PostgREST)
if (process.env.PGHOST || process.env.POSTGREST) {
  const entornos = [
    await levantar({ web: VIEJO, puerto: 8791, puertoRest: 3021, base: "tt_cmp_viejo" }),
    await levantar({ web: path.join(ROOT, "dist"), puerto: 8792, puertoRest: 3022, base: "tt_cmp_nuevo" }),
  ];
  for (const e of entornos) {
    // mismo orden del listado en las dos bases y un admin para el panel
    const c = new pg.Client({ connectionString: e.pg });
    await c.connect();
    await c.query("update public.providers set shuffle_key = id");
    await c.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('admin@test.ar', 'admin12345', '{\"full_name\":\"Admin\"}')");
    await c.query("insert into public.app_admins (user_id) select id from auth.users where email = 'admin@test.ar'");
    await c.end();
  }
  const [viejo, nuevo] = await Promise.all(entornos.map((e) => recorridoVivo(browser, e.url)));
  linea(!viejo.errores.length && !nuevo.errores.length, `en vivo: sin errores de JavaScript (${[...viejo.errores, ...nuevo.errores].join(" / ").slice(0, 200)})`);
  await comparar(browser, "en vivo", viejo, nuevo);
  for (const e of entornos) await e.cerrar();
} else console.log("(en vivo: salteado, falta PGHOST/POSTGREST)");

await browser.close();
console.log(fallas ? `${fallas} FALLAS (diferencias en ${path.relative(ROOT, SALIDA)}/)` : "TODO IGUAL");
process.exit(fallas ? 1 : 0);

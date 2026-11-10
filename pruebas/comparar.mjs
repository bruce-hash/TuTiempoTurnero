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
// V4 (C34): la pestaña Caja salió (ahora es la Caja del día de Finanzas): no se compara
const PESTANAS = ["agenda", "finanzas", "clientes", "productos", "horarios", "stats", "comunidad", "perfil"];
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
    // 4/11 (íconos propios, cambio a propósito): los emojis de la interfaz pasaron a ser íconos SVG (src/lib/iconos.js).
    // En las dos versiones, cada emoji de esa lista y cada svg.ic pasan a ser el mismo carácter (■), con el tamaño de
    // letra de donde están; los lugares que cambiaron de forma por el ícono (el círculo arriba de una pantalla, la lupa
    // dentro del buscador) vuelven a la de antes. Va primero: las reglas de abajo reescriben textos enteros.
    // Lo nuevo lo revisan ancho.mjs y las capturas del PR.
    const EMOJI = /(📅|🕒|⏱|💰|🧴|📊|👥|📸|📷|⚙|🔔|👤|↪|🛠|🏪|📲|↻|💈|✂|🌿|💅|✅|✔|❌|✎|🗑|🔍|🔎|📍|🗺|💬|📣|🎟|🎁|⚡|⏳|⛔|🏖|🔒|🔓|⚠|💳|💵|💸|🏦|📱|📞|🪪|✉|🖨|👁|✨|☀|🌤|🌙|😕|🎉|🙅|🗓|📋|📈|📉|🌐|⏸|🛒|🚶|✍|📝|📇|📵|🎂|🔥|🌱|💤|🟢|⚪|🔁|📆)\uFE0F?/gu;
    document.querySelectorAll("svg.ic").forEach((svg) => { const parent = svg.parentNode; svg.replaceWith("■"); parent.normalize(); });
    const walkIc = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walkIc.nextNode(); node; node = walkIc.nextNode()) {
      if (!EMOJI.test(node.nodeValue)) continue;
      EMOJI.lastIndex = 0;
      node.nodeValue = node.parentNode && node.parentNode.tagName === "OPTION" ? node.nodeValue.replace(new RegExp(EMOJI.source + " ?", "gu"), "") : node.nodeValue.replace(EMOJI, "■");
    }
    document.querySelectorAll("#app input[placeholder]").forEach((el) => { el.placeholder = el.placeholder.replace(new RegExp("^" + EMOJI.source + " ", "u"), ""); });
    document.querySelectorAll("#app .hero-ic").forEach((el) => { el.className = ""; el.style.fontSize = "40px"; });
    document.querySelectorAll("#app .search").forEach((el) => { el.style.paddingLeft = "12px"; el.style.backgroundImage = "none"; });
    // v2 (3/11, a propósito): «prestador» → «profesional» y «usuario» → «cliente» en los textos; la referencia dice lo de
    // antes. Se pasa a la palabra nueva en las dos (en la versión de hoy no cambia nada).
    const TERM = [[/Prestadoras/g, "Profesionales"], [/prestadoras/g, "profesionales"], [/Prestadores/g, "Profesionales"], [/prestadores/g, "profesionales"],
      [/Prestadora/g, "Profesional"], [/prestadora/g, "profesional"], [/Prestador/g, "Profesional"], [/prestador/g, "profesional"]];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      if (/restador/.test(node.nodeValue)) node.nodeValue = TERM.reduce((txt, [re, to]) => txt.replace(re, to), node.nodeValue);
    }
    document.querySelectorAll("input[placeholder]").forEach((el) => { el.placeholder = TERM.reduce((txt, [re, to]) => txt.replace(re, to), el.placeholder); });
    // v2 (3/11, a propósito): los avisos del admin se pueden borrar (✕, «Nuevo», «Borrar los leídos») y el panel se llama
    // «Avisos»: se vuelven a la forma de antes («Para revisar», sin botones)
    document.querySelectorAll("#app .admal-h").forEach((head) => {
      const label = head.querySelector(".lbl");
      if (label && label.textContent.trim() === "Avisos") head.replaceWith(Object.assign(document.createElement("p"), { className: "lbl", textContent: "Para revisar" }));
      else head.querySelectorAll("[data-act=admAlertsClear]").forEach((btn) => btn.remove());
    });
    document.querySelectorAll("#app li.admal").forEach((li) => {
      li.querySelectorAll("[data-act=admAlertDel], .chip.warn").forEach((el) => el.remove());
      const inner = li.firstElementChild;
      if (inner && inner.tagName === "DIV" && li.closest(".adm-res > .panel.admalert, .admalert") && !li.closest("details")) {
        while (inner.firstChild) li.insertBefore(inner.firstChild, inner);
        inner.remove();
      }
      li.className = "";
      li.removeAttribute("data-k");
    });
    // D31 (a propósito): el «primer turno libre» de hoy sale de la duración del servicio (antes, de otra grilla): según
    // la hora del CI la referencia ofrece 15:30 y la versión de hoy 16:00. El botón queda con un texto fijo.
    document.querySelectorAll("#app [data-quick]").forEach((btn) => { btn.textContent = "⚡ Primer turno: HORARIO"; });
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
    // Bloque D (D26, cambio a propósito): la pestaña Comisión suma "Verificación" (Exigir DNI para aprobar prestadores)
    document.querySelectorAll("#app [data-act=admReqDni]").forEach((toggle) => toggle.closest(".panel").remove());
    // los avisos flotantes (toast, notif) duran unos segundos: según lo rápido que vaya la máquina, el del paso anterior
    // todavía se ve o ya no. No son parte de la pantalla: se esconden en las dos versiones
    // (además display:none: en la versión de referencia el CSS de .notif le gana a hidden y la pastilla vacía se veía siempre)
    document.querySelectorAll("#toast, #notif").forEach((el) => { el.hidden = true; el.style.display = "none"; });
    // la cabecera cambia a propósito (arreglos visuales: en el celular, los botones sin sesión entran en una línea): se
    // esconde en las dos versiones; el contenido (#app) se compara igual, texto y píxeles
    document.querySelectorAll("header.top").forEach((el) => Object.assign(el.style, { visibility: "hidden", height: "96px", overflow: "hidden", boxSizing: "border-box" }));
    // V7 (C50, C51, cambio a propósito): el footer suma el teléfono y las redes y saca "Prototipo"; se esconde igual que la
    // cabecera (su contenido lo prueba pruebas/e2e.js)
    document.querySelectorAll("footer").forEach((el) => Object.assign(el.style, { visibility: "hidden", height: "360px", overflow: "hidden", boxSizing: "border-box" }));
    // C04 (cambio a propósito): la paleta y la tipografía del manual de marca en el segmento TuTiempo (inicio, admin). En
    // las dos versiones vuelven los colores y la letra de antes, para comparar todo lo demás; la marca nueva la prueban
    // e2e.js (logo, lema) y pwa.js (íconos y colores del manifest), y las capturas del PR.
    if (!document.getElementById("cmp-c04")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="cmp-c04">:root,body[data-seg="n"],.seg-n{--bg:#fafaf9;--fg:#121212;--muted:#4d4c48;--line:#e7e5e4;
        --brand:#121212;--brand-dark:#000;--brand-soft:#f5f5f4;--brand-line:#d6d3d1;--ok:#15803d;--ok-soft:#e7f5ec;--ok-line:#b5e0c3;
        --font-d:var(--font);--d-ls:-.02em;--hero-bg:linear-gradient(180deg,#ffffff,#f3f2ee);--hero-fg:#121212;--hero-muted:#5b5b57;--hero-em:#121212;
        --hero-chip:rgba(0,0,0,.06);--hero-bd:#e5e4df;--bar-bg:#121212;--bar-muted:#b5b5b0;--bar-btn-fg:#121212;--glow:rgba(18,18,18,0.4)}</style>`);
    }
    // 9/11 (cambio a propósito): en el celular, ningún campo con letra menor a 16 px (iOS agrandaba la página al tocarlo):
    // los campos quedan un poco más altos. Se aplica la misma regla a las dos versiones; la prueba ancho.mjs la controla.
    if (!document.getElementById("cmp-16px")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="cmp-16px">@media (max-width:1023px){input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]):not([type=color]),select,textarea{font-size:16px!important}input.otp{font-size:20px!important}.comrow input{font-size:22px!important}.mptab .comrow input{font-size:16px!important}}</style>`);
    }
    // V1 (D30, cambio a propósito): la comisión de TuTiempo pasa a ser un % de la seña y se suma el costo de Mercado Pago:
    // cambian los montos y los textos de la comisión (barra de reserva, política del turnero, confirmación, turno pagado),
    // Horarios suma el plazo de acreditación, la pestaña Comisión es otra y las comisiones de la demo cambian (Resumen y
    // Balance). Esas piezas se neutralizan en las dos versiones; el resto se compara igual. Lo nuevo lo prueba e2e.js.
    const fijo = (sel, t) => document.querySelectorAll(sel).forEach((el) => { el.textContent = t; });
    document.querySelectorAll("#app .pk-pol, #app #fCom, #app .admhero, #app .wkm").forEach((el) => el.remove());
    fijo("#app .bookbar .bb-info span", "SERVICIO · PRECIO · SEÑA");
    fijo("#app #fTurno .paym b", "SEÑA CON MERCADO PAGO");
    fijo("#app #fTurno button[type=submit]", "PAGAR");
    fijo("#app .booked .bk-must", "LO QUE PAGASTE");
    fijo("#app .admday small", "COMISIÓN");
    document.querySelectorAll("#app #fTurno .feerow").forEach((el) => el.closest(".panel")?.remove());
    document.querySelectorAll("#app #fTurno p.note").forEach((el) => { if (/Si cancela el profesional/.test(el.textContent)) el.textContent = "SI NO VAS O SI CANCELA EL PROFESIONAL"; });
    document.querySelectorAll("#app #hpay, #app #hterm").forEach((el) => el.closest(".f")?.remove());
    // 4/11 · Bloque 4 (cambios a propósito): la seña fija y el plazo de Mercado Pago con su tabla, el acceso a "Bloquear
    // días" arriba de Horarios y el calendario de la Caja del día. Lo nuevo lo prueban e2e.js y ancho.mjs.
    document.querySelectorAll("#app .depnote, #app .termpick, #app .hblock, #app .calbtn").forEach((el) => el.remove());
    // 9/11 (cambio a propósito): el plazo de Mercado Pago pasó de Horarios a Perfil → «Cobros con Mercado Pago» (el
    // panel «Cobros» cambia de nombre y el aviso de Horarios lleva ahí). Lo prueban e2e.js y ancho.mjs.
    document.querySelectorAll("#app .mpterm").forEach((el) => el.remove());
    document.querySelectorAll("#fHorarios p.note").forEach((el) => { if (el.querySelector("[data-tab=perfil]")) el.remove(); });
    document.querySelectorAll("#app .panel > .lbl").forEach((el) => { if (/^Cobros( con Mercado Pago)?$/i.test(el.textContent.trim())) el.textContent = "COBROS"; });
    document.querySelectorAll("#app .mpcobros > div").forEach((el) => { if (!el.children.length && !el.textContent.trim()) el.remove(); });
    // 9/11 (arreglos a propósito): las reseñas y los campos de fecha ya no se salen del ancho y los atajos de «Bloquear
    // días» bajan de renglón: las dos versiones con el mismo arreglo (lo controla ancho.mjs en 320, 375, 390 y 430 px)
    document.querySelectorAll("#app .fchips-wrap").forEach((el) => el.classList.remove("fchips-wrap"));
    if (!document.getElementById("cmp-ancho")) {
      document.head.insertAdjacentHTML("beforeend", `<style id="cmp-ancho">.rv{grid-template-columns:minmax(0,1fr)}.f{min-width:0}.f input{min-width:0}</style>`);
    }
    if (document.querySelector("#app [data-act=admM]")) document.querySelectorAll("#app .kpis, #app table").forEach((el) => el.remove());
    // V3 (D31, C39 y C21, cambios a propósito): los horarios se suceden según la duración del servicio y sin descanso, así
    // que cambian los horarios ofrecidos, cuántos libres hay por día y el próximo turno de cada tarjeta; Horarios ya no tiene
    // "Descanso entre turnos" ni "Cada cuánto empieza un turno" (suma la regla explicada) y la Agenda ya no tiene "Cargar
    // servicio sin turno". Se neutraliza en las dos versiones; la regla la prueban test_db.py y e2e.js.
    fijo("#app .nextt", "PRÓXIMO TURNO");
    fijo("#app .nextbar", "PRÓXIMO TURNO");
    document.querySelectorAll("#app .wd").forEach((el) => { el.classList.remove("low", "full"); el.querySelectorAll(".av-bar, small, em").forEach((x) => x.remove()); });
    fijo("#app .pk-body", "HORARIOS DEL DÍA");
    document.querySelectorAll("#app #hbuf, #app #hst").forEach((el) => el.closest(".f")?.remove());
    document.querySelectorAll("#fHorarios p.hint").forEach((el) => { if (/Tus clientes pueden reservar|se suceden según lo que dura/.test(el.textContent)) el.remove(); });
    document.querySelectorAll("#app [data-act=walkFromAgenda]").forEach((el) => el.remove());
    // V3b (C37, C38, C40, cambios a propósito): Horarios se guarda solo (sale el botón Guardar, entra la línea de estado),
    // el happy hour se ve en sus días (Horarios) y como franja en la Agenda, y "Sumá seguidores" suma "Imprimir o guardar
    // el QR en PDF". Se neutraliza en las dos versiones; lo nuevo lo prueban e2e.js y rutas.js.
    document.querySelectorAll("#app #fHorarios button[type=submit], #app #hSaved, #app .hhchip, #app .tl-hh, #app [data-act=qrPrint]").forEach((el) => el.remove());
    document.querySelectorAll("#app [data-act=copiarLink]").forEach((el) => { el.style.marginTop = ""; });
    document.querySelectorAll("#app .tl-top .hint").forEach((el) => { el.textContent = el.textContent.replace(/ · (⚡ |■ )?\s*Happy hour .*$/, ""); });
    // V4 (C25, C32, C33, C35, cambios a propósito): la Caja del día suma Transferencia, editar y borrar cada movimiento
    // y el botón para cargar sin turno; el mes suma su resumen; los meses van con mayúscula y el balance del año en
    // verde o rojo; Productos suma Eliminar. Se neutraliza en las dos versiones; lo nuevo lo prueban e2e.js y test_db.py.
    document.querySelectorAll("#app .msum, #app [data-act=movEdit], #app [data-act=movDel], #app [data-act=walkOpen], #app button[data-btab=caja], #app [data-act=prodDel]").forEach((el) => el.remove());
    document.querySelectorAll("#app .kpi").forEach((el) => { if (/Transferencia/.test(el.textContent)) el.remove(); });
    // la barra de pestañas del panel pierde "Caja" y se corre: transparente en las dos versiones (sigue tocable)
    document.querySelectorAll("#app .btabw").forEach((el) => { el.style.opacity = "0"; });
    // v2 · Profesional (cambios a propósito): el menú del panel pasa a 4 × 2 con íconos y en otro orden (fuera del
    // flujo, transparente y abajo, en las dos versiones: sigue tocable y no corre lo demás); «Ver mi perfil como
    // cliente» pasa de la cabecera (y de Horarios) a la Agenda; Horarios pierde «Tu link de turnos»; Perfil suma la nota
    // del plazo de acreditación. Lo nuevo lo prueban e2e.js y ancho.mjs.
    document.querySelectorAll("#app .btabw").forEach((el) => { Object.assign(el.style, { position: "fixed", left: "0", right: "0", bottom: "0", zIndex: "50" }); el.querySelectorAll(".tabarr").forEach((b) => b.remove()); el.querySelectorAll("button").forEach((b) => { b.textContent = "·"; }); });
    document.querySelectorAll("#app [data-act=preview], #app .mpterm").forEach((el) => el.remove());
    document.querySelectorAll("#app #fHorarios [data-act=copiarLink]").forEach((el) => el.closest(".panel").remove());
    document.querySelectorAll("#app .ftbl b.pos, #app .ftbl b.neg").forEach((el) => el.removeAttribute("class"));
    document.querySelectorAll("#app .pl-acts").forEach((el) => el.replaceWith(...el.childNodes));
    {
      const meses = /\b(Enero|Febrero|Marzo|Abril|Mayo|Junio|Julio|Agosto|Septiembre|Octubre|Noviembre|Diciembre|Ene|Feb|Mar|Abr|May|Jun|Jul|Ago|Sep|Oct|Nov|Dic)\b/g;
      const walker = document.createTreeWalker(document.getElementById("app"), NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        n.textContent = n.textContent.replace(meses, (m) => m.toLowerCase()).replace("desde Finanzas → Caja del día", "desde la pestaña Caja").replace("o cargás algo acá", "o cargás algo en Caja");
      }
    }
    // Ingreso y registro (cambio a propósito): el inicio suma la puerta "Registrá tu negocio" y la Agenda, en lugar de
    // "Activá tu perfil", muestra "Te falta poco" (los prestadores de la comparación ya están dados de alta: no aparece).
    // Se neutraliza en las dos versiones; lo nuevo lo prueban e2e.js y rutas.js.
    document.querySelectorAll("#app .bizcta, #app .asclient, #app .panel.setup, #app .panel.todo").forEach((el) => el.remove());
    // V5 (C26, C28, cambios a propósito): cada trabajo se edita con ✎ (antes ✕) y muestra su nombre sobre la foto; el
    // pedido de reseña salió de los avisos automáticos del panel (sale solo) y la nota lo explica. Se neutraliza en las
    // dos versiones; lo nuevo lo prueban e2e.js y test_db.py.
    document.querySelectorAll("#app .gi-del, #app .gi-cap").forEach((el) => el.remove());
    document.querySelectorAll("#app .mlist li").forEach((li) => { if (/Pedido de reseña/.test(li.textContent)) li.remove(); });
    document.querySelectorAll("#app .panel p.note").forEach((el) => { el.textContent = el.textContent.replace(" El pedido de reseña también sale solo, 2 horas después de cada turno atendido.", ""); });
    // V6 (C41, C42, cambios a propósito): el aviso de los activos sin Mercado Pago nombra a quiénes y suma «Ver quiénes»;
    // Prestadores suma el filtro «Sin Mercado Pago», el texto en negrita y «Avisarle». Se neutraliza en las dos versiones;
    // lo nuevo lo prueban e2e.js y test_db.py.
    document.querySelectorAll("#app .adml li").forEach((li) => { if (li.textContent.trim().startsWith("💳") || /profesional(es activos no conectaron| activo no conectó) Mercado Pago/.test(li.textContent)) li.remove(); });
    document.querySelectorAll("#app [data-act=admNudge], #app [data-act=admF][data-f=nomp]").forEach((el) => el.remove());
    document.querySelectorAll("#app .admact .chip.ok").forEach((el) => { if (/Avisado/.test(el.textContent)) el.remove(); });
    // (sin la negrita y en un solo texto, como antes: dos textos seguidos se pueden dibujar con un píxel de diferencia)
    document.querySelectorAll("#app .ag li span b").forEach((el) => { if (el.textContent === "sin Mercado Pago") { const span = el.parentNode; el.replaceWith("sin Mercado Pago"); span.normalize(); } });
    // V4 resto (C30, C31, C36, cambios a propósito): la Caja del día suma «Antes de cerrar» (y el botón dice «Cerrar
    // igual» si hay pendientes), el mes suma «Gastos fijos» y Productos suma «Vendí uno» y el precio de compra. Se
    // neutraliza en las dos versiones; lo nuevo lo prueban e2e.js y test_db.py.
    document.querySelectorAll("#app .pendday, #app [data-act=prodSell]").forEach((el) => el.remove());
    document.querySelectorAll("#fCloseDay button[type=submit]").forEach((el) => {
      el.textContent = el.textContent.replace(/^Cerrar igual/, "Cerrar la caja");
      if (el.nextElementSibling && el.nextElementSibling.matches("p.note")) el.nextElementSibling.remove();
    });
    // V5 resto (C29, cambio a propósito): la pestaña Comisión suma «Sellos» (las tarjetas para toda la plataforma)
    document.querySelectorAll("#app [data-act=admStamps]").forEach((toggle) => toggle.closest(".panel").remove());
    // V6 resto (C44, cambio a propósito): «Clientes» del Resumen cuenta solo cuentas de cliente y lo dice
    document.querySelectorAll("#app .kpis.adm .kpi").forEach((kpi) => {
      if (kpi.querySelector("span")?.textContent.trim() === "Clientes") kpi.querySelectorAll("b, small").forEach((el) => { el.textContent = "CLIENTES"; });
    });
    // 4/11 · Bloque 3 (D35, cambios a propósito): Clientes suma las pestañas «Clientes / Seguidores» y la nota de
    // «Avisar a tus seguidores» dice qué le llega a cada uno y el tope. Se neutraliza en las dos versiones; lo nuevo lo
    // prueban e2e.js, test_push.py y ancho.mjs.
    document.querySelectorAll("#app .ctabs").forEach((el) => el.remove());
    document.querySelectorAll("#app .avisarpanel p.note").forEach((el) => { el.textContent = "Les llega una notificación con link para reservar."; });
    // 7/11 (cambios a propósito): la Caja del día suma «Vender producto» (producto, cantidad y medio) y Productos muestra el
    // stock con su rótulo «en stock». Se neutraliza en las dos versiones; lo nuevo lo prueban e2e.js y ancho.mjs.
    document.querySelectorAll("#app [data-act=saleOpen], #app .salenote").forEach((el) => el.remove());
    document.querySelectorAll("#app .pl-n").forEach((el) => { el.querySelector("small")?.remove(); el.removeAttribute("class"); });
    document.querySelectorAll("#app .cajabtns").forEach((el) => el.replaceWith(...el.childNodes));
    // 7/11 · Bloque 5 (cambios a propósito): salen el recordatorio de 2 h y el cumpleaños de los avisos automáticos, el
    // filtro «Cumplen este mes» de Clientes y la marca «cumple» de cada cliente. Se neutraliza en las dos versiones; lo
    // nuevo lo prueban test_db.py, test_emails.py y e2e.js.
    document.querySelectorAll("#app .mlist li").forEach((li) => { if (/Recordatorio 2 h antes|El día de su cumpleaños/.test(li.textContent)) li.remove(); });
    document.querySelectorAll("#app [data-cf=cumple]").forEach((el) => el.remove());
    document.querySelectorAll("#app .crow .cr-m > span").forEach((el) => {
      el.querySelectorAll("svg").forEach((svg) => { if (/· $/.test(svg.previousSibling?.textContent || "") && /^\s*cumple/.test(svg.nextSibling?.textContent || "")) svg.remove(); });
      el.textContent = el.textContent.replace(/ · \s*(■ )?cumple$/, "");
    });
    // 7/11 · Feriados (cambio a propósito): Horarios suma «Próximos feriados» y Comisión, «Feriados». Se neutraliza en las
    // dos versiones; lo nuevo lo prueban test_db.py, test_push.py, funciones y e2e.js.
    document.querySelectorAll("#app .holpanel, #app .holpanel-adm").forEach((el) => el.remove());
    // 7/11 (cambio a propósito): cada producto suma «Editar». Se neutraliza en las dos versiones; lo prueba e2e.js.
    document.querySelectorAll("#app [data-act=prodEdit]").forEach((el) => el.remove());
    // en vivo corre con el reloj real: la línea de "ahora" de la agenda cambia de minuto (y de lugar) entre una captura y otra
    document.querySelectorAll("#app .tl-now").forEach((line) => line.remove());
    document.querySelectorAll("#app .paym small.hint").forEach((hint) => {
      hint.textContent = hint.textContent.replace(/^(hidro\.style\.mp|Cuenta n° \S+) · /, "CUENTA · ");
    });
  });
}
async function foto(page, pasos, nombre) {
  // el mouse queda donde fue el último clic: fuera de la pantalla, así ningún hover (Bloque D) entra en la captura
  await page.mouse.move(0, 0);
  // 4/11 (íconos): en la referencia los emojis son más altos que el ■ que los reemplaza, y la pantalla ya se desplazó
  // (al elegir un horario) con esa altura. Se fija lo que está en el medio de la ventana antes de normalizar y después se
  // vuelve a poner en el mismo lugar: así las dos versiones quedan igual de desplazadas (y la barra fija, en su lugar).
  await page.evaluate(() => {
    const el = window.scrollY > 0 && document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const box = el && el.closest("div, section, li, p, form, ul");
    window.__ancla = box ? [box, box.getBoundingClientRect().top] : null;
  });
  await normalizar(page);
  await page.evaluate(() => {
    if (window.__ancla && window.__ancla[0].isConnected) window.scrollBy(0, window.__ancla[0].getBoundingClientRect().top - window.__ancla[1]);
  });
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
  // no el «primer turno libre»: cerca de la hora actual, la versión de referencia (horarios de antes de D31) ofrece
  // horarios que la base de hoy ya no acepta (slot_not_available) y la comparación dependía de la hora del CI. Un día
  // abierto de dentro de 5 días o más y su primer horario (la apertura): el mismo en las dos versiones, a cualquier hora.
  const desde = new Date(Date.now() + 5 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const dia = await page.evaluate((d) => [...document.querySelectorAll("[data-day]")].map((b) => ({ day: b.dataset.day, ok: !b.className.match(/closed|full/) })).find((x) => x.ok && x.day >= d)?.day, desde);
  if (!dia) throw new Error("comparar: no hay un día abierto desde " + desde);
  await clic(page, `[data-day="${dia}"]`);
  await clic(page, "[data-slot]");
  // 10/11 · punto 2 (cambio a propósito): el perfil, el turnero y el pago toman el color del rubro del servicio elegido
  // (Uñas); la referencia seguía con el de donde vino (Pestañas). En las dos versiones, el de Uñas; lo nuevo lo prueba e2e.js
  const rubroDelServicio = async () => {
    await page.evaluate(() => {
      document.body.dataset.seg = "u";
      document.querySelectorAll(".cchip[data-pctx]").forEach((chip) => chip.setAttribute("aria-pressed", String(chip.dataset.pctx === "u")));
    });
    await page.waitForTimeout(400);
  };
  await rubroDelServicio();
  await foto(page, pasos, "perfil con horario elegido");
  await clic(page, "[data-act=reservarT]");
  // 4/11: sin el código por email; con contraseña en las dos versiones
  await page.fill("#ai_e", "ana@test.ar");
  await page.fill("#ai_p", "cliente12345");
  await clic(page, "#fLogin button[type=submit]");
  await page.waitForSelector("#fTurno");
  await rubroDelServicio();
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
  // en la versión de referencia, el acceso de prestadores (#fBarb); en la nueva, el mismo ingreso que todos (va a la Agenda)
  if (await page.locator("header [data-go=loginBarbero]").count()) {
    await clic(page, "header [data-go=loginBarbero]");
    await page.fill("#be", "sofia@test.ar");
    await page.fill("#bp", "prestador123");
    await clic(page, "#fBarb button[type=submit]");
  } else {
    await clic(page, "footer [data-act=authOpen]");
    await page.fill("#ai_e", "sofia@test.ar");
    await page.fill("#ai_p", "prestador123");
    await clic(page, "#fLogin button[type=submit]");
  }
  await page.waitForSelector(".bhead");
  for (const t of PESTANAS) { await clic(page, `[data-btab=${t}]`); await page.waitForTimeout(300); await foto(page, pasos, `panel · ${t}`); }
  errores.push(...page.errores);
  await page.context().close();
  // admin: las 4 pestañas
  page = await pagina(browser, { relojFijo: false });
  await page.goto(url);
  await clic(page, "header [data-go=login], header [data-act=authOpen]");
  await page.fill("#ai_e", "admin@test.ar");
  await page.fill("#ai_p", "admin12345");
  await clic(page, "#fLogin button[type=submit]");
  await page.waitForTimeout(600);
  // Mi perfil: en la versión de referencia, el avatar; en la nueva, desde el menú de cuenta (Bloque D)
  await page.evaluate(() => document.querySelector("#nav .acct-btn")?.click());
  await clic(page, "#nav [data-go=cuenta]");
  await clic(page, "#app [data-act=toAdmin]");
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
    await levantar({ web: VIEJO, puerto: 8791, puertoRest: 3021, base: "tt_cmp_viejo", vueltaVieja: true }),
    await levantar({ web: path.join(ROOT, "dist"), puerto: 8792, puertoRest: 3022, base: "tt_cmp_nuevo" }),
  ];
  for (const e of entornos) {
    // mismo orden del listado en las dos bases y un admin para el panel
    const c = new pg.Client({ connectionString: e.pg });
    await c.connect();
    await c.query("update public.providers set shuffle_key = id");
    await c.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ('admin@test.ar', 'admin12345', '{\"full_name\":\"Admin\"}')");
    await c.query("insert into public.app_admins (user_id) select id from auth.users where email = 'admin@test.ar'");
    // la clienta existe en las dos bases, con contraseña (4/11: ya no hay ingreso con código por email)
    await c.query("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('ana@test.ar', 'cliente12345', now(), '{\"full_name\":\"ana\"}')");
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

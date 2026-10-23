// Prueba del .htaccess real con Apache (Bloque B). Apache ya tiene que estar sirviendo dist/ (con pruebas/apache/httpd.conf):
// en el CI, el contenedor httpd:2.4; en local, `npm run test:htaccess` (pruebas/apache/local.sh, con el apache2 de Ubuntu).
// Comprueba: HTTP → HTTPS con la dirección y la query intactas; rutas profundas → index.html con CSP y HSTS; archivos con
// extensión que no existen → 404; archivos reales con su tipo y su caché; ocultos y de respaldo → 403; los retornos de
// Mercado Pago (?mp=) y de los emails (?token_hash=) llegan sin redirecciones ni cambios.
// Uso: node pruebas/htaccess.mjs <carpeta web> [http://localhost:8080] [https://localhost:8443]
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";

const [WEB, HTTP = "http://localhost:8080", HTTPS = "https://localhost:8443"] = process.argv.slice(2);
if (!WEB) {
  console.error("Uso: node pruebas/htaccess.mjs <carpeta web> [url http] [url https]");
  process.exit(2);
}
const INDEX = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const asset = fs.readdirSync(path.join(WEB, "assets")).find((f) => f.endsWith(".js"));
let fails = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fails++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// pedido sin seguir redirecciones (el certificado de prueba es autofirmado)
function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    lib
      .get(url, { rejectUnauthorized: false }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      await get(HTTPS + "/");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error("Apache no responde en " + HTTPS);
}

await waitUp();
const isIndex = (res) => res.status === 200 && res.body === INDEX && /text\/html/.test(res.headers["content-type"] || "");
const secure = (res) =>
  /default-src 'self'/.test(res.headers["content-security-policy"] || "") &&
  /max-age=31536000/.test(res.headers["strict-transport-security"] || "") &&
  res.headers["x-frame-options"] === "DENY" &&
  res.headers["x-content-type-options"] === "nosniff";

// 1. HTTP → HTTPS, con la dirección y la query como estaban
for (const route of ["/panel/agenda?x=1", "/?mp=success&b=12", "/?token_hash=abc123&type=recovery", "/hidro-style/reservar?servicio=5&dia=2026-10-24&hora=17%3A30"]) {
  const res = await get(HTTP + route);
  const want = "https://" + new URL(HTTP).host + route;
  ok(`HTTP ${route} → 301 a HTTPS con la query intacta`, res.status === 301 && res.headers.location === want, `${res.status} ${res.headers.location}`);
}
// 2. Direcciones de la app → index.html, con CSP, HSTS y los demás encabezados
for (const route of ["/", "/rubro/unas", "/buscar?q=corte", "/hidro-style", "/hidro-style/trabajos", "/p/7", "/turno/12", "/mis-turnos", "/panel/agenda", "/panel/clientes?cliente=3", "/admin/balance/2026-10", "/no-existe", "/functions/v1/mp-webhook"]) {
  const res = await get(HTTPS + route);
  ok(`HTTPS ${route} → index.html con CSP y HSTS`, isIndex(res) && secure(res), `${res.status} ${res.headers["content-type"]}`);
}
const home = await get(HTTPS + "/panel/agenda");
ok("index.html servido por el fallback sin caché larga (no-cache)", /no-cache/.test(home.headers["cache-control"] || ""), home.headers["cache-control"]);
// 3. Retornos de Mercado Pago y de los emails: 200 directo (el navegador conserva la dirección con su query)
for (const route of ["/?mp=success&b=12", "/?token_hash=abc123&type=recovery", "/?mp_connected=1", "/?code=abc&state=xyz"]) {
  const res = await get(HTTPS + route);
  ok(`HTTPS ${route} → 200 sin redirección`, isIndex(res) && !res.headers.location, `${res.status} ${res.headers.location || ""}`);
}
// 4. Archivos con extensión que no existen → 404 (nunca index.html en lugar de un .js o .css)
for (const route of ["/assets/no-existe-12345678.js", "/assets/no-existe.css", "/no-existe.png", "/fonts/no-existe.woff2", "/panel/agenda.js"]) {
  const res = await get(HTTPS + route);
  ok(`HTTPS ${route} → 404`, res.status === 404 && res.body !== INDEX, String(res.status));
}
// 5. Archivos reales: su contenido y tipo; los de assets/ con caché de un año
const js = await get(HTTPS + "/assets/" + asset);
ok("un .js de assets/ → 200 application/javascript con caché de un año", js.status === 200 && /javascript/.test(js.headers["content-type"] || "") && /max-age=31536000/.test(js.headers["cache-control"] || ""), `${js.status} ${js.headers["content-type"]} ${js.headers["cache-control"]}`);
const vendor = await get(HTTPS + "/vendor/supabase.js");
ok("/vendor/supabase.js → 200", vendor.status === 200 && /javascript/.test(vendor.headers["content-type"] || ""));
const robots = await get(HTTPS + "/robots.txt");
ok("/robots.txt → 200", robots.status === 200 && robots.body !== INDEX);
// 6. Ocultos y de respaldo: 403
for (const route of ["/.htaccess", "/.env", "/respaldo.sql", "/notas.md", "/viejo.zip"]) {
  const res = await get(HTTPS + route);
  ok(`HTTPS ${route} → 403`, res.status === 403, String(res.status));
}
// 7. Carpetas: nunca se lista el contenido ni se devuelve la app (Options -Indexes: 403 con mod_autoindex, 404 sin él;
//    sin la barra final, Apache primero redirige a la misma carpeta con barra)
for (const route of ["/assets/", "/fonts"]) {
  let res = await get(HTTPS + route);
  if (res.status === 301 && res.headers.location) res = await get(new URL(res.headers.location, HTTPS).href);
  ok(`HTTPS ${route} → 403/404 sin listado`, [403, 404].includes(res.status) && !/Index of/i.test(res.body) && res.body !== INDEX, String(res.status));
}

console.log(fails ? `${fails} FALLAS` : "TODO OK");
process.exit(fails ? 1 : 0);

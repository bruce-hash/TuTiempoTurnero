// Producción sin demo: falla si el build de producción lleva algo del modo demo.
//  1. Compila producción solo con eliminación de código muerto (sin acortar nombres) y verifica que no quede ninguna
//     declaración de src/demo/ ni de src/api/demo.js: si una sobrevive, es código de demo que llega a producción.
//  2. Revisa dist/ (el build real, minificado): sin window.__TT__, sin la barra de demo y sin datos de ejemplo
//     (nombres de los prestadores de ejemplo, cuentas de demo, datos de siembra del panel).
//  3. Ni src/ ni el seed de ejemplos usan nombres, direcciones o teléfonos de negocios reales (H14).
// Uso: npm run test:sin-demo   (compila dist/ y corre esta prueba)
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const rel = (p) => path.relative(ROOT, p);
const listar = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? listar(path.join(dir, d.name)) : [path.join(dir, d.name)]));
let fallas = 0;
const falla = (msg) => { fallas++; console.log("FAIL " + msg); };
const ok = (msg) => console.log("OK   " + msg);

// ---------- 1. Ninguna declaración de demo sobrevive en producción ----------
const demoFiles = [...listar(path.join(ROOT, "src/demo")), path.join(ROOT, "src/api/demo.js")].filter((f) => f.endsWith(".js"));
const nombres = new Set();
for (const f of demoFiles) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/^(?:export )?(?:async )?(?:function|const|let|var) ([A-Za-z_$][\w$]*)/gm)) nombres.add(m[1]);
}
const tmp = path.join(ROOT, ".build", "analisis-dist");
await build({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  mode: "production",
  logLevel: "error",
  build: { outDir: tmp, emptyOutDir: true, minify: false, rolldownOptions: { output: { minify: "dce-only", codeSplitting: false } } },
});
const analisis = listar(tmp).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
const vivos = [...nombres].filter((n) => new RegExp(`(?<![\\w$.])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(analisis));
if (vivos.length) falla(`código de src/demo/ o src/api/demo.js en producción: ${vivos.join(", ")}`);
else ok(`ninguna de las ${nombres.size} declaraciones de demo llega a producción (${demoFiles.length} archivos)`);

// ---------- 2. dist/ sin ganchos de prueba, sin barra de demo y sin datos de ejemplo ----------
const dist = path.join(ROOT, "dist");
const archivos = listar(dist).filter((f) => /\.(html|js|css)$/.test(f) && !/\/(vendor|config(\.example)?\.js$)/.test(rel(f).replace(/^dist/, "")));
const texto = archivos.map((f) => [rel(f), fs.readFileSync(f, "utf8")]);
const prestadores = [...fs.readFileSync(path.join(ROOT, "src/demo/prestadores.js"), "utf8").matchAll(/^ {4}name: "([^"]+)",$/gm)].map((m) => m[1]);
const marcas = [
  ["window.__TT__ (ganchos de prueba)", "__TT__"],
  ["barra de demo (Ver como)", "Ver como:"],
  ["barra de demo (Reiniciar demo)", "Reiniciar demo"],
  ["aviso de modo demo", "Modo demo:"],
  ...prestadores.map((n) => [`prestador de ejemplo "${n}"`, n]),
];
if (prestadores.length < 5) falla("no pude leer los nombres de los prestadores de ejemplo de src/demo/prestadores.js");
for (const [que, marca] of marcas) {
  const donde = texto.filter(([, t]) => t.includes(marca)).map(([f]) => f);
  if (donde.length) falla(`${que} en ${donde.join(", ")}`);
}
if (!fallas) ok(`dist/ (${archivos.length} archivos) sin ganchos de prueba, sin barra de demo y sin los ${prestadores.length} prestadores de ejemplo`);
// Cuentas de demo (H18, Bloque 2a): ni el formulario de acceso de prestadores ni el perfil traen credenciales de la demo
const CUENTAS = ["tutiempo.demo", "barbero123", "prestador123", "cliente123", "juan.perez@tutiempo.demo"];
for (const marca of CUENTAS) {
  const donde = texto.filter(([, t]) => t.includes(marca)).map(([f]) => f);
  if (donde.length) falla(`cuenta de demo "${marca}" en ${donde.join(", ")}`);
}
if (!fallas) ok(`dist/ sin cuentas de demo (${CUENTAS.join(", ")})`);
// Datos de ejemplo del panel (H14, Bloque 2a): fichas, clientes y finanzas de siembra solo en src/demo/
const SIEMBRA = ["seedStore", "demoClosings", "seedComm"];
const sinCubrir = SIEMBRA.filter((n) => !nombres.has(n));
if (sinCubrir.length) falla(`funciones de siembra fuera de src/demo/: ${sinCubrir.join(", ")}`);
const DATOS = ["Koleston 7.1", "Trabajar cervicales", "Insumos de "];
for (const marca of DATOS) {
  const donde = texto.filter(([, t]) => t.includes(marca)).map(([f]) => f);
  if (donde.length) falla(`dato de ejemplo "${marca}" en ${donde.join(", ")}`);
}
if (!fallas) ok(`siembra (${SIEMBRA.join(", ")}) solo en src/demo/ y sin sus datos en dist/`);
// Emails (Bloque 2b): las cuentas de demo usan solo el dominio tutiempo.demo; fuera de eso, solo los ejemplos de los
// textos de ayuda y el contacto de TuTiempo
const EMAILS_OK = ["contacto@tutiempo.com.ar", "nombre@gmail.com", "tu@email.com"];
const conEmail = [...listar(path.join(ROOT, "src")), path.join(ROOT, "index.html")].filter((f) => /\.(js|html)$/.test(f));
const ajenos = conEmail.flatMap((f) =>
  [...fs.readFileSync(f, "utf8").matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)]
    .map((m) => m[0])
    .filter((email) => !email.endsWith("@tutiempo.demo") && !EMAILS_OK.includes(email))
    .map((email) => `${email} en ${rel(f)}`),
);
if (ajenos.length) falla(`emails de demo con un dominio que no es tutiempo.demo: ${ajenos.join("; ")}`);
else ok("los emails de las cuentas de demo son todos @tutiempo.demo");
// Negocios reales de Olavarría (H14): no aparecen en ningún lado, ni en la demo ni en el seed de ejemplos
const REALES = ["Hidro", "Kevin Ortiz", "la fama", "Niko_barberr", "Mary Garcia", "Carina Saitti", "2284727692",
  "9 de julio 2381", "Antártida Argentina 4762", "Rivadavia 2684", "Islas Malvinas 3974", "Colon 3794", "Belgrano 2683"];
const fuentes = [...listar(path.join(ROOT, "src")), path.join(ROOT, "index.html"), path.join(ROOT, "supabase/seed/ejemplos.NO-USAR-EN-PRODUCCION.sql")]
  .filter((f) => /\.(js|html|css|sql)$/.test(f))
  .map((f) => [rel(f), fs.readFileSync(f, "utf8").toLowerCase()]);
const reales = REALES.flatMap((r) => fuentes.filter(([, t]) => t.includes(r.toLowerCase())).map(([f]) => `"${r}" en ${f}`));
if (reales.length) falla(`datos de negocios reales: ${reales.join("; ")}`);
else ok(`src/, index.html y el seed sin datos de los ${REALES.length} negocios reales que tenía la versión 31`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallas ? `${fallas} FALLAS` : "TODO OK");
process.exit(fallas ? 1 : 0);

// Producción sin demo: falla si el build de producción lleva algo del modo demo.
//  1. Compila producción solo con eliminación de código muerto (sin acortar nombres) y verifica que no quede ninguna
//     declaración de src/demo/ ni de src/api/demo.js: si una sobrevive, es código de demo que llega a producción.
//  2. Revisa dist/ (el build real, minificado): sin window.__TT__, sin la barra de demo y sin datos de ejemplo
//     (nombres de los prestadores de ejemplo, cuentas de demo).
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
// Cuentas de demo. La versión 31 ya trae estas en código que también corre en vivo (H18: el formulario de acceso de
// prestadores arranca con hidro.style@tutiempo.demo / barbero123): se toleran solo esas apariciones, hasta el Bloque 2.
const PENDIENTES_H18 = { "tutiempo.demo": 3, barbero123: 1, prestador123: 0, "juan.perez@gmail.com": 0 };
for (const [marca, tope] of Object.entries(PENDIENTES_H18)) {
  const n = texto.reduce((a, [, t]) => a + t.split(marca).length - 1, 0);
  if (n > tope) falla(`cuenta de demo "${marca}" aparece ${n} veces (máximo ${tope})`);
  else if (n) console.log(`PEND "${marca}" aparece ${n} veces: heredado de la versión 31 (H18, se borra en el Bloque 2)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fallas ? `${fallas} FALLAS` : "TODO OK");
process.exit(fallas ? 1 : 0);

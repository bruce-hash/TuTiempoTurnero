// TuTiempo · build
// Genera la carpeta dist/ (lo que se sube a Hostinger) a partir de src/prototipo.html (la fuente legible).
//   node tools/build.mjs            → dist/ con app.js y app.css minificados
//   node tools/build.mjs --no-minify → dist/ sin minificar (para depurar)
// dist/ NO se versiona: se genera en cada deploy. config.js NO se genera: se copia config.example.js
// solo si dist/config.js no existe, para no pisar las claves reales.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { transform } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src", "prototipo.html");
const STATIC = path.join(ROOT, "src", "static");
const DIST = path.join(ROOT, "dist");
const minify = !process.argv.includes("--no-minify");

const html = fs.readFileSync(SRC, "utf8");
const take = (re, what) => { const m = html.match(re); if (!m) throw new Error(`No encontré ${what} en prototipo.html`); return m[1]; };

// El <head> se limpia de comentarios antes de separarlo (un comentario podría mencionar etiquetas).
const headAll = take(/<head>([\s\S]*?)<\/head>/, "el <head>").replace(/<!--[\s\S]*?-->/g, "");
const cssMatch = headAll.match(/<style>([\s\S]*?)<\/style>/);
if (!cssMatch) throw new Error("No encontré el <style> en el <head> de prototipo.html");
const head = headAll.slice(0, cssMatch.index).trim();
const css = cssMatch[1];
const body = take(/<body>([\s\S]*?)<script src="config\.js"><\/script>/, "el HTML del <body>").trim();
const app = take(/<script src="vendor\/supabase\.js"><\/script>\s*<script>([\s\S]*?)<\/script>\s*<\/body>/, "el <script> de la app");

const js = minify ? (await transform(app, { minify: true, target: "es2017", charset: "utf8" })).code : app;
const cssOut = minify ? (await transform(css, { loader: "css", minify: true })).code : css;
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 10);

fs.rmSync(path.join(DIST, "app.js"), { force: true });
fs.mkdirSync(DIST, { recursive: true });
fs.cpSync(STATIC, DIST, { recursive: true, filter: (p) => !p.endsWith("config.example.js") });
if (!fs.existsSync(path.join(DIST, "config.js"))) fs.copyFileSync(path.join(STATIC, "config.example.js"), path.join(DIST, "config.js"));
fs.writeFileSync(path.join(DIST, "app.js"), js);
fs.writeFileSync(path.join(DIST, "app.css"), cssOut);

const v = hash(js + cssOut);
const index = `<!doctype html>
<html lang="es-AR">
<head>
${head}
<link rel="stylesheet" href="app.css?v=${hash(cssOut)}">
</head>
<body>
${body}
<script src="config.js?v=${v}"></script>
<script src="vendor/supabase.js"></script>
<script src="app.js?v=${v}"></script>
</body>
</html>
`;
fs.writeFileSync(path.join(DIST, "index.html"), index);
console.log(`dist/ listo · app.js ${(js.length / 1024).toFixed(0)} KB · app.css ${(cssOut.length / 1024).toFixed(0)} KB · versión ${v}`);

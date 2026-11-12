// Después de npm run build (lo corre el job de Windows del CI): dist/ completo para Hostinger y sin la demo.
// En Windows las rutas usan "\" y los ids de Vite "/": si se mezclan, la demo entra al build o config.js no se copia.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let fallas = 0;
const ok = (name, cond) => { if (!cond) fallas++; console.log((cond ? "OK   " : "FAIL ") + name); };
const dist = path.join(ROOT, "dist");
ok("dist/ tiene index.html, config.js, .htaccess y assets/", ["index.html", "config.js", ".htaccess", "assets"].every((f) => fs.existsSync(path.join(dist, f))));
ok("dist/ no lleva config.example.js", !fs.existsSync(path.join(dist, "config.example.js")));
const modulos = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, ".build", "modulos-dist.json"), "utf8")));
ok(`el reporte de módulos de src/ no está vacío (${modulos.length})`, modulos.length > 20 && modulos.every((m) => !m.includes("\\")));
// src/demo/index.js (barra "Ver como", datos de ejemplo, reinicio) se reemplaza por un módulo vacío: ni él ni lo que
// solo él importa entran (el resto de src/demo/ lo revisa a fondo pruebas/sin_demo.mjs)
const demo = ["src/demo/index.js", "src/demo/barra.js", "src/demo/sembrar.js", "src/demo/reiniciar.js", "src/demo/prestadores.js"];
ok("la demo (src/demo/index.js, la barra y los datos de ejemplo) no entra al build de producción",
  modulos.includes("src/main.js") && !demo.some((m) => modulos.includes(m)));
console.log(fallas ? `${fallas} FALLAS` : "TODO OK");
process.exit(fallas ? 1 : 0);

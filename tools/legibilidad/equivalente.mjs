// Verificación del Bloque A2 (legibilidad): renombrar variables locales y sumar comentarios no cambia el código.
// Para cada módulo de src/ compara la versión de BASE (el merge de A1) con la actual: las variables locales (todo lo
// que no es de primer nivel) pasan a nombres canónicos por orden de aparición y se descartan los comentarios y el
// formato. El árbol que queda tiene que ser idéntico. Si un nombre nuevo cambia a qué variable se refiere el código
// (choca con otra de afuera), si cambia un nombre de primer nivel, un export, un texto o una sola operación, falla.
// Los archivos que no son JS (CSS, index.html) tienen que quedar idénticos.
// Uso: node tools/legibilidad/equivalente.mjs [archivo…]   (sin argumentos, todos)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const BASE = "9899126";

const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 });
const OMITIR = new Set(["start", "end", "loc", "range", "extra", "comments", "leadingComments", "trailingComments", "innerComments", "__canon"]);

// Árbol del módulo con las variables locales renombradas a v1, v2, … (por orden de declaración).
export function canonico(code) {
  const ast = parse(code, { sourceType: "module", attachComment: false });
  const locales = [];
  traverse(ast, {
    Scope(p) {
      if (p.scope.path.isProgram()) return;
      for (const b of Object.values(p.scope.bindings)) locales.push(b);
    },
  });
  // un binding puede aparecer en dos scopes del mismo nodo (por ejemplo, parámetros): una sola vez
  const vistos = new Set();
  const lista = locales.filter((b) => !vistos.has(b.identifier) && vistos.add(b.identifier)).sort((a, b) => a.identifier.start - b.identifier.start);
  lista.forEach((b, i) => {
    const c = "v" + (i + 1);
    b.identifier.__canon = c;
    for (const r of b.referencePaths) r.node.__canon = c;
    for (const cv of b.constantViolations) {
      const ids = cv.getBindingIdentifiers ? Object.values(cv.getBindingIdentifiers(true)).flat() : [];
      for (const id of ids) if (id.name === b.identifier.name) id.__canon = c;
      if (cv.node.type === "UpdateExpression" && cv.node.argument.type === "Identifier") cv.node.argument.__canon = c;
    }
  });
  const limpiar = (n, clave) => {
    if (Array.isArray(n)) return n.map((x) => limpiar(x));
    if (!n || typeof n !== "object") return n;
    const o = {};
    for (const k of Object.keys(n).sort()) {
      if (OMITIR.has(k)) continue;
      // la clave de una propiedad no es una variable: { a } y { a: nombre } tienen la misma clave "a"
      if ((n.type === "ObjectProperty" || n.type === "ObjectMethod") && k === "key" && !n.computed && n.key.type === "Identifier") { o.key = { type: "Identifier", name: n.key.name }; continue; }
      if (n.type === "ObjectProperty" && k === "shorthand") { o.shorthand = false; continue; }
      o[k] = limpiar(n[k], k);
    }
    if (n.type === "Identifier" && n.__canon) o.name = n.__canon;
    return o;
  };
  return JSON.stringify(limpiar(ast.program));
}

// Variables locales de una sola letra que quedan en el código (para el informe).
export function letrasSueltas(code) {
  const ast = parse(code, { sourceType: "module", attachComment: false });
  const out = [];
  traverse(ast, {
    Scope(p) {
      if (p.scope.path.isProgram()) return;
      for (const [n, b] of Object.entries(p.scope.bindings)) if (/^[A-Za-z_$]$/.test(n) && !out.includes(b)) out.push(b);
    },
  });
  return [...new Set(out)].length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const antes = git(`ls-tree -r --name-only ${BASE} -- src index.html`).trim().split("\n");
  const ahora = git("ls-files -- src index.html").trim().split("\n");
  const pedidos = process.argv.slice(2).map((f) => path.relative(ROOT, path.resolve(f)));
  let fallas = 0, renombrados = 0, quedan = 0, iguales = 0;
  const falla = (m) => { fallas++; console.log("FAIL " + m); };
  for (const f of ahora) if (!antes.includes(f)) falla(`${f}: archivo nuevo (A2 no agrega ni saca módulos)`);
  for (const f of antes) {
    if (pedidos.length && !pedidos.includes(f)) continue;
    if (!fs.existsSync(path.join(ROOT, f))) { falla(`${f}: ya no existe`); continue; }
    const viejo = git(`show ${BASE}:${f}`), nuevo = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (!f.endsWith(".js")) { if (viejo !== nuevo) falla(`${f}: cambió (en A2 solo cambian los .js)`); continue; }
    if (viejo === nuevo) { iguales++; quedan += letrasSueltas(nuevo); continue; }
    if (canonico(viejo) !== canonico(nuevo)) falla(`${f}: el código cambió (no es solo un renombre o un comentario)`);
    else { renombrados++; quedan += letrasSueltas(nuevo); }
  }
  console.log(`${renombrados} módulos con nombres o comentarios nuevos, ${iguales} sin cambios; variables de una letra que quedan: ${quedan}`);
  console.log(fallas ? `${fallas} FALLAS` : "EQUIVALENTE: el código es el mismo que en " + BASE);
  process.exit(fallas ? 1 : 0);
}

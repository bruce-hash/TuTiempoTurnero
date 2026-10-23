// Bloque A2 · renombra variables locales de un módulo según un mapa, editando solo esos nombres (sin reformatear).
//   node tools/legibilidad/renombrar.mjs <archivo> --listar        variables de una letra, por declaración, con su línea
//   node tools/legibilidad/renombrar.mjs <archivo> <mapa.json>      aplica el mapa y verifica la equivalencia
// Mapa: { "<declaración>": { "a": "walk", "i#2": "item" } }. <declaración> es el nombre de la función o variable de
// primer nivel, "click:<acción>" / "submit:<form>" / … para las acciones registradas, "listener:<evento>" para los
// listeners de document y "@<línea>" para otras sentencias. "i#2" = la segunda variable llamada i en esa declaración
// (en orden de aparición); "i" sola = todas las que se llaman i ahí.
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { canonico } from "./equivalente.mjs";
import { execSync } from "node:child_process";

const traverse = traverseModule.default;
const [archivo, modo] = process.argv.slice(2);
if (!archivo || !modo) {
  console.error("Uso: node tools/legibilidad/renombrar.mjs <archivo> --listar | <mapa.json>");
  process.exit(2);
}
const code = fs.readFileSync(archivo, "utf8");
const ast = parse(code, { sourceType: "module" });
const lineOf = (pos) => code.slice(0, pos).split("\n").length;

// clave de cada sentencia de primer nivel
const claveDe = (st) => {
  const d = st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st;
  if (d.type === "FunctionDeclaration") return d.id.name;
  if (d.type === "VariableDeclaration") return d.declarations[0].id.name;
  const e = d.expression;
  if (e && e.type === "CallExpression") {
    const c = code.slice(e.callee.start, e.callee.end);
    const m = c.match(/^register(Click|Submit|Change|Input)$/);
    if (m) {
      const a = e.arguments[0];
      return m[1].toLowerCase() + ":" + (a.type === "StringLiteral" ? a.value : a.elements.map((x) => x.value).join("|"));
    }
    if (c === "document.addEventListener") return "listener:" + e.arguments[0].value;
  }
  return "@" + lineOf(st.start);
};
const top = ast.program.body.filter((s) => s.type !== "ImportDeclaration");
// dentro de un objeto de primer nivel (const x = { … } u Object.assign(LM, { … })), la clave es "<objeto>.<propiedad>"
const objetoDe = (st) => {
  const d = st.type === "ExportNamedDeclaration" && st.declaration ? st.declaration : st;
  if (d.type === "VariableDeclaration" && d.declarations[0].init?.type === "ObjectExpression") return d.declarations[0].init;
  const e = d.expression;
  if (e?.type === "CallExpression" && code.slice(e.callee.start, e.callee.end) === "Object.assign" && e.arguments[1]?.type === "ObjectExpression") return e.arguments[1];
  return null;
};
const claveEn = (pos) => {
  const s = top.find((t) => pos >= t.start && pos < t.end);
  if (!s) return null;
  const obj = objetoDe(s);
  const prop = obj && obj.properties.find((q) => pos >= q.start && pos < q.end && q.key);
  const base = claveDe(s).replace(/^@\d+$/, (k) => (obj ? code.slice(s.expression.arguments[0].start, s.expression.arguments[0].end) : k));
  return prop ? `${base}.${prop.key.name || prop.key.value}` : claveDe(s);
};

// variables locales, en orden de aparición, con su clave y su número de aparición (#k)
const locales = [];
traverse(ast, {
  Scope(p) {
    if (p.scope.path.isProgram()) return;
    for (const b of Object.values(p.scope.bindings)) if (!locales.includes(b)) locales.push(b);
  },
});
locales.sort((a, b) => a.identifier.start - b.identifier.start);
const cuenta = {};
for (const b of locales) {
  b.clave = claveEn(b.identifier.start);
  const k = b.clave + "|" + b.identifier.name;
  cuenta[k] = (cuenta[k] || 0) + 1;
  b.n = cuenta[k];
}

if (modo === "--listar") {
  let actual = null;
  for (const b of locales) {
    if (!/^[A-Za-z_$]$/.test(b.identifier.name)) continue;
    if (b.clave !== actual) { actual = b.clave; console.log(`\n[${actual}]`); }
    const l = lineOf(b.identifier.start);
    const txt = code.split("\n")[l - 1].trim().slice(0, 110);
    const usos = b.referencePaths.length;
    console.log(`  ${b.identifier.name}#${b.n} ${b.kind} L${l} (${usos} usos): ${txt}`);
  }
  process.exit(0);
}

// ---------- Aplicar el mapa ----------
const mapa = JSON.parse(fs.readFileSync(modo, "utf8"));
const nuevoDe = (b) => {
  const m = mapa[b.clave];
  if (!m) return null;
  return m[`${b.identifier.name}#${b.n}`] || m[b.identifier.name] || null;
};
// propiedades abreviadas { a } (en objetos y en desestructuración): la clave tiene que quedar
const abreviadas = new Map();
traverse(ast, {
  ObjectProperty(p) {
    if (!p.node.shorthand) return;
    const v = p.node.value.type === "AssignmentPattern" ? p.node.value.left : p.node.value;
    abreviadas.set(v.start, p.node.key.name);
  },
});
const edits = new Map();
const problemas = [];
const usados = new Set(Object.values(mapa).flatMap((m) => Object.keys(m)));
const aplicados = new Set();
for (const b of locales) {
  const nuevo = nuevoDe(b);
  if (!nuevo || nuevo === b.identifier.name) continue;
  aplicados.add(`${b.clave}:${b.identifier.name}`);
  if (!/^[A-Za-z_$][\w$]*$/.test(nuevo)) problemas.push(`${b.clave}: "${nuevo}" no es un nombre válido`);
  // choques: el nombre nuevo ya se usa en ese alcance o lo usa algo de afuera que quedaría tapado
  const otro = b.scope.getBinding(nuevo);
  if (otro && otro !== b && b.scope.hasOwnBinding(nuevo)) problemas.push(`${b.clave}: ${b.identifier.name} → ${nuevo} choca con otra variable del mismo alcance`);
  b.scope.path.traverse({
    ReferencedIdentifier(r) {
      if (r.node.name === nuevo && r.scope.getBinding(nuevo) !== b) {
        const ob = r.scope.getBinding(nuevo);
        // una variable interna con ese nombre que también se renombra no tapa nada
        if (!ob || nuevoDe(ob) === null || nuevoDe(ob) === nuevo) problemas.push(`${b.clave}: ${b.identifier.name} → ${nuevo} taparía otro "${nuevo}" (línea ${lineOf(r.node.start)})`);
      }
    },
  });
  for (const r of b.referencePaths) {
    const interno = r.scope.getBinding(nuevo);
    if (interno && interno !== b && interno.scope !== b.scope && b.scope.path.isAncestor?.(interno.scope.path) !== false && nuevoDe(interno) === null) {
      if (r.scope.getBinding(b.identifier.name) === b) problemas.push(`${b.clave}: ${b.identifier.name} → ${nuevo}: en la línea ${lineOf(r.node.start)} lo taparía una variable interna "${nuevo}"`);
    }
  }
  const ids = [b.identifier, ...b.referencePaths.map((r) => r.node)];
  for (const cv of b.constantViolations) {
    if (cv.node.type === "UpdateExpression") ids.push(cv.node.argument);
    else for (const id of Object.values(cv.getBindingIdentifiers(true)).flat()) if (id.name === b.identifier.name) ids.push(id);
  }
  for (const id of ids) {
    if (id.type !== "Identifier" || id.name !== b.identifier.name) continue;
    const clave = abreviadas.get(id.start);
    edits.set(id.start, { start: id.start, end: id.end, text: clave !== undefined ? `${clave}: ${nuevo}` : nuevo });
  }
}
for (const [clave, m] of Object.entries(mapa)) for (const k of Object.keys(m)) {
  if (![...aplicados].some((a) => a === `${clave}:${k.replace(/#\d+$/, "")}`)) problemas.push(`el mapa nombra ${clave} → ${k}, que no existe en ${archivo}`);
}
if (problemas.length) {
  console.error(problemas.map((p) => "FAIL " + p).join("\n"));
  process.exit(1);
}
let out = code;
for (const e of [...edits.values()].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
if (canonico(out) !== canonico(code)) {
  console.error("FAIL el resultado no es equivalente (¿un nombre nuevo tapa a otro?). No se escribió nada.");
  process.exit(1);
}
fs.writeFileSync(archivo, out);
console.log(`${archivo}: ${edits.size} cambios de nombre, código equivalente`);

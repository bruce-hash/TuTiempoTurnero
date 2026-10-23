// Verificación de mudanza pura (Bloque A1). Independiente de mudanza.mjs: vuelve a leer src/prototipo.html de la
// versión de referencia (git) y comprueba que cada pieza aparezca con el texto idéntico en algún módulo nuevo.
// Diferencias permitidas, y solo estas:
//   - `export ` delante de una declaración, e `import` arriba de cada módulo;
//   - `store.X` en lugar de X para las variables `let` de primer nivel (y `let X = v` → `store.X = v`);
//   - las ramas de los manejadores dentro de registerClick/Submit/Change/Input(nombre, (…) => { …misma rama… }),
//     con dos espacios menos de sangría;
//   - las excepciones con nombre de EXCEPCIONES (cada una se comprueba con su propia regla y se lista en el informe).
// Además lista todo el código nuevo (lo que no viene de la referencia) y falla si hay algo no previsto.
// Uso: node tools/mudanza/verificar.mjs   (sale con 1 si algo no coincide)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "@babel/parser";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const REF = "1368349";
const html = execSync(`git show ${REF}:src/prototipo.html`, { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 });
const between = (a, b) => { const i = html.indexOf(a) + a.length; return html.slice(i, html.indexOf(b, i)); };
const code = between('<script src="vendor/supabase.js"></script>\n<script>\n', "</script>");
const style = between("<style>\n", "</style>");
const body = between("<body>\n", '<script src="config.js"></script>');
const LINE0 = html.slice(0, html.indexOf(code)).split("\n").length;
const lineOf = (pos) => LINE0 + code.slice(0, pos).split("\n").length - 1;
const ref = parse(code, { sourceType: "script" });
const src = (n) => code.slice(n.start, n.end);
if (/\bstore\./.test(code)) throw new Error("La referencia ya usa store.: la normalización no sería confiable");

// ---------- Variables que pasan a store ----------
const STORE = ref.program.body
  .filter((s) => s.type === "VariableDeclaration" && s.kind === "let")
  .flatMap((s) => s.declarations.map((d) => d.id.name))
  .filter((n) => n !== "S");
const storeRe = new RegExp(`\\b(${STORE.join("|")}): store\\.\\1\\b|\\bstore\\.(${STORE.join("|")})\\b`, "g");
const norm = (t) => t.replace(storeRe, (m, a, b) => a || b).replace(/^export /, "");
const fromStoreDecl = (t) => t.replace(new RegExp(`^store\\.(${STORE.join("|")}) = `), "let $1 = ");

// ---------- Módulos nuevos ----------
const listar = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(path.join(d, e.name)) : [path.join(d, e.name)]));
const mods = listar(path.join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => {
  const t = fs.readFileSync(f, "utf8");
  return { file: path.relative(ROOT, f), text: t, ast: parse(t, { sourceType: "module" }) };
});
const piezas = []; // sentencias de primer nivel de los módulos nuevos (sin import)
for (const m of mods) for (const s of m.ast.program.body) {
  if (s.type === "ImportDeclaration") continue;
  piezas.push({ mod: m.file, node: s, text: m.text.slice(s.start, s.end), usada: false });
}
const registros = new Map(); // "click:nombre" → {pieza, body}
for (const p of piezas) {
  const e = p.node.expression;
  if (!e || e.type !== "CallExpression" || !/^register(Click|Submit|Change|Input)$/.test(e.callee.name)) continue;
  const ev = e.callee.name.slice(8).toLowerCase();
  const arg = e.arguments[0];
  const names = arg.type === "StringLiteral" ? [arg.value] : arg.elements.map((x) => x.value);
  const fn = e.arguments[1];
  const t = mods.find((m) => m.file === p.mod).text;
  for (const n of names) registros.set(`${ev}:${n}`, { p, body: t.slice(fn.body.start, fn.body.end), names });
}

let fallas = 0;
const falla = (m) => { fallas++; console.log("FAIL " + m); };
const excepciones = [];
const exc = (clave, detalle) => excepciones.push({ clave, detalle });
const reindent = (t) => t.replace(/\n/g, "\n  ");

// Reglas de las excepciones con nombre: cómo se ve el original en el código nuevo.
const EXCEPCIONES = {
  P: { detalle: "const P = [ejemplos] → P.push(...[ejemplos]) en src/demo/prestadores.js; P (vacío) vive en src/store.js",
    nuevo: (t) => t.replace(/^const P = /, "P.push(...").replace(/;$/, ");") },
  LIVE: { detalle: "const LIVE = (…) → const CONFIG_OK = (…) y const LIVE = import.meta.env.VITE_DEMO ? CONFIG_OK : true",
    nuevo: (t) => t.replace(/^const LIVE =/, "const CONFIG_OK =") + "\nconst LIVE = import.meta.env.VITE_DEMO ? CONFIG_OK : true;" },
  sb: { detalle: "const sb = LIVE ? … → const sb = CONFIG_OK ? … (sin config.js válido no se crea el cliente)",
    nuevo: (t) => t.replace(/^const sb = LIVE\n/, "const sb = CONFIG_OK\n") },
  "@11896": { detalle: "reinicio de la demo: S = fresh(); → resetState(); (S es un export let de src/state.js)",
    nuevo: (t) => t.replace("    S = fresh();\n", "    resetState();\n") },
  "@12064": { detalle: "boot(); → ganchos de prueba (solo VITE_TEST_HOOKS), aviso si falta config.js (solo producción) y boot()", nuevo: null },
};
// Sentencias nuevas previstas (pegamento), por módulo: [módulo, prefijo del texto]
const NUEVAS = [
  ["src/store.js", "export const store = {"], ["src/store.js", "export const P = [];"],
  ["src/state.js", "export function resetState() {"],
  ["src/config.js", "export const LIVE = import.meta.env.VITE_DEMO ? CONFIG_OK : true;"],
  ["src/actions/registro.js", ""], ["src/ganchos-prueba.js", ""], ["src/demo/barra.js", ""],
  ["src/api/live/index.js", "export const liveApi = {\n  ...liveLectura,"],
  ["src/main.js", "function faltaConfig() {"], ["src/main.js", "if (import.meta.env.VITE_TEST_HOOKS) {"],
  ["src/main.js", "if (!CONFIG_OK && !import.meta.env.VITE_DEMO) {"],
];

// ---------- 1. Sentencias de primer nivel ----------
const keyOf = (st) => (st.type === "FunctionDeclaration" ? st.id.name : st.type === "VariableDeclaration" ? st.declarations[0].id.name : "@" + lineOf(st.start));
const isHandler = (st) => st.type === "ExpressionStatement" && st.expression.type === "CallExpression" && src(st.expression.callee) === "document.addEventListener";
const buscar = (want) => piezas.find((p) => !p.usada && (norm(p.text) === want || norm(fromStoreDecl(p.text)) === want));
let iguales = 0;
for (const st of ref.program.body) {
  const key = keyOf(st), t = src(st);
  if (isHandler(st) || key === "liveApi" || key === "@4034") continue;
  const ex = EXCEPCIONES[key];
  if (ex) {
    if (ex.nuevo) {
      const p = buscar(ex.nuevo(t)) || piezas.find((q) => !q.usada && norm(q.text) === ex.nuevo(t).replace(/^const LIVE =/, "const LIVE ="));
      // LIVE ocupa dos sentencias en el módulo nuevo
      if (key === "LIVE") {
        const [a, b] = ex.nuevo(t).split("\nconst LIVE = ");
        const pa = piezas.find((q) => !q.usada && norm(q.text) === a), pb = piezas.find((q) => !q.usada && norm(q.text) === "const LIVE = " + b);
        if (!pa || !pb) { falla(`${key}: no coincide con su regla de excepción`); continue; }
        pa.usada = pb.usada = true;
        exc(key, `${ex.detalle} (${pa.mod})`);
        continue;
      }
      if (!p) { falla(`${key} (línea ${lineOf(st.start)}): no coincide con su regla de excepción`); continue; }
      p.usada = true;
      exc(key, `${ex.detalle} (${p.mod})`);
    } else exc(key, ex.detalle);
    continue;
  }
  const p = buscar(t);
  if (!p) { falla(`${key} (línea ${lineOf(st.start)}) no aparece idéntico en ningún módulo`); continue; }
  p.usada = true;
  iguales++;
}

// ---------- 2. Objetos partidos: liveApi y Object.assign(LM, …) ----------
let props = 0;
for (const st of ref.program.body) {
  const key = keyOf(st);
  if (key !== "liveApi" && key !== "@4034") continue;
  const obj = key === "liveApi" ? st.declarations[0].init : st.expression.arguments[1];
  const partes = piezas.filter((p) => {
    const n = p.node;
    if (key === "liveApi") return n.type === "ExportNamedDeclaration" && /^live[A-Z]\w*$/.test(n.declaration?.declarations?.[0]?.id?.name || "") && n.declaration.declarations[0].id.name !== "liveApi" && p.mod.startsWith("src/api/live/");
    return n.type === "ExpressionStatement" && p.text.startsWith("Object.assign(LM, {");
  });
  const nuevos = partes.flatMap((p) => {
    const o = key === "liveApi" ? p.node.declaration.declarations[0].init : p.node.expression.arguments[1];
    const t = mods.find((m) => m.file === p.mod).text;
    return o.properties.map((q) => norm(t.slice(q.start, q.end)));
  });
  const viejos = obj.properties.map((q) => src(q));
  // cada propiedad una sola vez, con el mismo texto; dentro de cada módulo, en el orden original
  const idx = nuevos.map((t) => viejos.indexOf(t));
  let bien = idx.every((i) => i >= 0) && new Set(idx).size === viejos.length && idx.length === viejos.length;
  let k0 = 0;
  for (const p of partes) {
    const n = (key === "liveApi" ? p.node.declaration.declarations[0].init : p.node.expression.arguments[1]).properties.length;
    const tramo = idx.slice(k0, k0 + n);
    if (tramo.some((v, i) => i && v < tramo[i - 1])) bien = false;
    k0 += n;
  }
  if (key === "liveApi") {
    // la composición { ...liveLectura, ...liveCuenta, … } tiene que dar el orden original
    const comp = piezas.find((p) => p.mod === "src/api/live/index.js" && p.text.startsWith("export const liveApi = {"));
    const orden = comp ? [...comp.text.matchAll(/\.\.\.(live\w+),/g)].map((m) => m[1]) : [];
    const porNombre = Object.fromEntries(partes.map((p) => [p.node.declaration.declarations[0].id.name, p]));
    const t = (p) => mods.find((m) => m.file === p.mod).text;
    const final = orden.flatMap((n) => porNombre[n] ? porNombre[n].node.declaration.declarations[0].init.properties.map((q) => norm(t(porNombre[n]).slice(q.start, q.end))) : ["?"]);
    if (JSON.stringify(final) !== JSON.stringify(viejos)) bien = false;
    else if (comp) comp.usada = true;
  }
  if (!bien) falla(`${key}: las propiedades no coinciden (mismo texto, una vez cada una, en orden)`);
  else { partes.forEach((p) => (p.usada = true)); props += viejos.length; }
  exc(key === "liveApi" ? "liveApi" : "Object.assign(LM, …)", `partido en ${partes.length} módulos por propiedades (${viejos.length} propiedades, mismo texto y orden): ${partes.map((p) => p.mod).join(", ")}`);
}

// ---------- 3. Manejadores: ramas registradas y despachador ----------
// Nombres de acción que prueba una condición: v === "a", a || b || …, ["a","b"].includes(v), e.target.id === "f" || …
// (y v === "a" && otra condición, que marca la acción con "?").
const actOf = (t) => {
  if (t.type === "BinaryExpression" && t.operator === "===" && t.right.type === "StringLiteral") {
    const l = src(t.left);
    return l === "v" || l === "e.target.id" ? [t.right.value] : null;
  }
  if (t.type === "LogicalExpression" && t.operator === "||") { const a = actOf(t.left), b = actOf(t.right); return a && b ? [...a, ...b] : null; }
  if (t.type === "LogicalExpression" && t.operator === "&&") { const a = actOf(t.left); return a && a.length === 1 ? ["?" + a[0]] : null; }
  if (t.type === "CallExpression" && src(t.callee).endsWith("].includes") && src(t.arguments[0] || {start: 0, end: 0}) === "v") return t.callee.object.elements.map((x) => x.value);
  return null;
};
let ramas = 0;
const LISTENER = { click: "src/actions/toques.js", submit: "src/actions/formularios.js", change: "src/actions/cambios.js", input: "src/actions/cambios.js", keydown: "src/actions/cambios.js" };
for (const st of ref.program.body) {
  if (!isHandler(st)) continue;
  const ev = st.expression.arguments[0].value, fnBody = st.expression.arguments[1].body.body;
  const quitar = []; // rangos de ramas que salen del listener
  let afterV = ev !== "click";
  const porAccion = new Map();
  for (const s of fnBody) {
    if (ev === "click" && src(s) === "const v = x.dataset.act;") { afterV = true; continue; }
    if (!afterV || s.type !== "IfStatement" || ev === "keydown") continue;
    const chain = [];
    let c = s;
    while (c && c.type === "IfStatement") { chain.push(c); c = c.alternate; }
    const acts = chain.map((x) => actOf(x.test));
    if (c || acts.some((a) => !a)) continue;
    quitar.push(s);
    chain.forEach((x, i) => {
      const names = acts[i].map((a) => a.replace(/^\?/, ""));
      const k = names.join("|");
      if (!porAccion.has(k)) porAccion.set(k, { names, parts: [] });
      porAccion.get(k).parts.push(x);
    });
  }
  for (const [k, g] of porAccion) {
    const r = registros.get(`${ev}:${g.names[0]}`);
    if (!r || JSON.stringify(r.names) !== JSON.stringify(g.names)) { falla(`${ev}:${k} no está registrada con esos nombres`); continue; }
    r.p.usada = true;
    const nuevo = norm(reindent(r.body));
    if (g.parts.length === 1 && !src(g.parts[0].test).includes("&&")) {
      if (nuevo !== src(g.parts[0].consequent)) falla(`${ev}:${k}: el cuerpo registrado no es idéntico a la rama original`);
    } else {
      const want = g.parts.map((x) => `if (${src(x.test)}) ${src(x.consequent)}`).join(" else ");
      const sq = (t) => t.replace(/\s+/g, " ");
      if (sq(nuevo) !== sq(`{ ${want} }`)) falla(`${ev}:${k}: la rama con condición no coincide`);
      else exc(`${ev}:${k}`, "misma acción en dos ramas (if / else if): la función registrada conserva las dos condiciones y cuerpos (solo cambia la sangría)");
    }
    ramas++;
  }
  // el listener: el original sin las ramas debe ser igual al nuevo sin el despacho
  const DISP = {
    click: "const accion = CLICK.get(v);\n  if (accion) {\n    accion(e, x, v);\n  }",
    submit: "const accion = SUBMIT.get(e.target.id);\n  if (accion) {\n    accion(e);\n  }",
    change: "const accion = CHANGE.get(e.target.id);\n  if (accion) {\n    accion(e);\n    return;\n  }",
    input: "const accion = INPUT.get(e.target.id);\n  if (accion) {\n    accion(e);\n    return;\n  }",
  }[ev];
  let viejo = "", pos = st.start;
  for (const q of quitar) { viejo += code.slice(pos, q.start).replace(/\n *$/, ""); pos = q.end; }
  viejo += code.slice(pos, st.end);
  const l = piezas.find((p) => p.mod === LISTENER[ev] && p.text.startsWith(`document.addEventListener("${ev}"`));
  if (!l) { falla(`no encontré el listener de ${ev}`); continue; }
  let nuevo = norm(l.text);
  if (DISP) {
    if (!nuevo.includes(DISP)) { falla(`${ev}: el listener no tiene el despacho esperado`); continue; }
    nuevo = nuevo.replace(/\n *$/, "").replace(new RegExp("\\n *" + DISP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "");
  }
  if (nuevo !== viejo) falla(`${ev}: el listener (sin ramas) no es idéntico al original`);
  else { l.usada = true; if (DISP) exc(`listener ${ev}`, `mismo texto; donde estaban las ${quitar.length} ramas por acción queda el despacho al registro (${LISTENER[ev]})`); }
}

// ---------- 4. CSS, HTML y barra de la demo ----------
const main = mods.find((m) => m.file === "src/main.js").text;
const css = [...main.matchAll(/^import "\.\/(styles\/[^"]+\.css)";$/gm)].map((m) => fs.readFileSync(path.join(ROOT, "src", m[1]), "utf8")).join("");
if (css.replace(/url\(\/fonts\//g, "url(fonts/") !== style) falla("el CSS (en el orden de main.js) no es idéntico al <style> original");
else exc("CSS", "mismo texto y orden, partido en archivos; url(fonts/…) → url(/fonts/…) porque el CSS compilado queda en /assets/");
const idx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const barra = body.match(/<div class="demo">[\s\S]*?<\/div><\/div>\n\n/)[0];
const bodyNuevo = idx.slice(idx.indexOf("<body>\n") + 7, idx.indexOf('<script src="config.js"></script>'));
if (bodyNuevo !== body.replace(barra, "")) falla("el <body> de index.html no es el original sin la barra de la demo");
const barraJs = fs.readFileSync(path.join(ROOT, "src/demo/barra.js"), "utf8");
if (!barraJs.includes(JSON.stringify(barra.replace(/\n\n$/, "\n")))) falla("src/demo/barra.js no inserta la barra original");
else exc("barra de la demo", "sale de index.html; src/demo/barra.js la inserta igual (mismo HTML, mismo lugar), solo en el modo demo");

// Valores iniciales en producción de lo que en la demo arranca con datos de ejemplo
{
  const st = fs.readFileSync(path.join(ROOT, "src/store.js"), "utf8");
  const ini = st.match(/export const store = \{([\s\S]*?)\n\};/);
  if (!ini) falla("src/store.js sin el objeto store");
  else exc("COMM, COMMBY", `en producción arrancan como {${ini[1].replace(/\s*\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim()}} (antes, con las reseñas y fotos de ejemplo); en demo, igual que antes (src/demo/estado.js)`);
}

// ---------- 5. Código nuevo ----------
const nuevas = piezas.filter((p) => !p.usada);
const prevista = (p) => NUEVAS.some(([m, pre]) => p.mod === m && norm(p.text).startsWith(pre.replace(/^export /, "")));
const sorpresa = nuevas.filter((p) => !prevista(p));
for (const p of sorpresa) falla(`código nuevo no previsto en ${p.mod}: ${p.text.split("\n")[0].slice(0, 90)}`);

// ---------- Informe ----------
const sal = {
  referencia: REF,
  sentencias_identicas: iguales,
  propiedades_identicas: props,
  ramas_identicas: ramas,
  variables_en_store: STORE,
  excepciones,
  codigo_nuevo: nuevas.map((p) => `${p.mod}: ${p.text.split("\n")[0].slice(0, 100)}`),
};
fs.mkdirSync(path.join(ROOT, ".build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".build", "verificacion-mudanza.json"), JSON.stringify(sal, null, 2) + "\n");
console.log(`Referencia ${REF}: ${iguales} sentencias de primer nivel idénticas, ${props} propiedades de objetos partidos y ${ramas} ramas de manejadores.`);
console.log(`${STORE.length} variables pasan a store.X.`);
console.log(`Excepciones (${excepciones.length}):`);
for (const e of excepciones) console.log(`  · ${e.clave}: ${e.detalle}`);
console.log(`Código nuevo (${nuevas.length} sentencias, todas previstas: pegamento de módulos):`);
for (const p of nuevas) console.log(`  + ${p.mod}: ${p.text.split("\n")[0].slice(0, 90)}`);
console.log(fallas ? `${fallas} FALLAS` : "MUDANZA PURA: TODO OK");
process.exit(fallas ? 1 : 0);

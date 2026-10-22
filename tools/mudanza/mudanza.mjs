// Mudanza mecánica del Bloque A1: parte el <script>, el <style> y el HTML de src/prototipo.html (versión de
// referencia, leída de git) en módulos ES según tools/mudanza/mapa.mjs, sin reescribir el código.
// Cambios de texto que hace, y solo esos:
//   - las variables `let` de primer nivel que se reasignan pasan a `store.X` (`let X = v` → `store.X = v`);
//   - `export` delante de lo que otro módulo usa, e `import` arriba de cada módulo;
//   - las ramas de los manejadores de click/submit/change/input pasan a funciones registradas por acción;
//   - liveApi y el Object.assign(LM, …) se parten por propiedades;
//   - casos puntuales listados en EXCEPCIONES (los revisa tools/mudanza/verificar.mjs).
// Uso: node tools/mudanza/mudanza.mjs   (escribe index.html, src/ y borra lo generado antes)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { MODULOS, PARTIR, ACCIONES, CSS, REFERENCIA } from "./mapa.mjs";

const traverse = traverseModule.default;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const html = execSync(`git show ${REFERENCIA}:src/prototipo.html`, { cwd: ROOT, encoding: "utf8", maxBuffer: 64e6 });

// ---------- Partes del HTML ----------
const cut = (a, b, from = 0) => {
  const i = html.indexOf(a, from);
  const j = html.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`No encontré ${a} … ${b}`);
  return [i + a.length, j];
};
const [h0, h1] = cut("<head>\n", "<style>\n");
const head = html.slice(h0, h1).replace(/<!--[\s\S]*?-->\n?/g, "");
const [c0, c1] = cut("<style>\n", "</style>");
const style = html.slice(c0, c1);
const [b0, b1] = cut("<body>\n", '<script src="config.js"></script>');
const body = html.slice(b0, b1);
const [s0, s1] = cut('<script src="vendor/supabase.js"></script>\n<script>\n', "</script>");
const code = html.slice(s0, s1);
const LINE0 = html.slice(0, s0).split("\n").length; // línea del archivo donde empieza el código (1 = primera)
const lineOf = (pos) => LINE0 + code.slice(0, pos).split("\n").length - 1;

// La barra de la demo sale del HTML: la arma src/demo/barra.js solo en el modo demo.
const BARRA_RE = /<div class="demo">[\s\S]*?<\/div><\/div>\n\n/;
const barra = body.match(BARRA_RE)[0];
const bodyApp = body.replace(BARRA_RE, "");

// ---------- Análisis del script ----------
const ast = parse(code, { sourceType: "script", ranges: true });
const top = ast.program.body;
const keyOf = (st) =>
  st.type === "FunctionDeclaration" ? st.id.name : st.type === "VariableDeclaration" ? st.declarations[0].id.name : "@" + lineOf(st.start);
for (let i = 1; i < top.length; i++) {
  const gap = code.slice(top[i - 1].end, top[i].start);
  if (gap.trim()) throw new Error(`Hay texto entre sentencias (línea ${lineOf(top[i].start)}): ${gap.trim().slice(0, 60)}`);
}
const moduleOfKey = {};
for (const [mod, keys] of Object.entries(MODULOS)) for (const k of keys) {
  if (moduleOfKey[k]) throw new Error(`${k} está en dos módulos`);
  moduleOfKey[k] = mod;
}
let programScope;
traverse(ast, { Program(p) { programScope = p.scope; p.stop(); } });
const B = programScope.bindings;
const STORE_VARS = Object.keys(B).filter((n) => B[n].kind === "let" && n !== "S").sort();

// ---------- Ediciones de texto (posiciones en `code`) ----------
const edits = [];
const edit = (start, end, text, why) => {
  // X++ figura a la vez como referencia y como reasignación: la misma edición se anota una sola vez
  if (!edits.some((e) => e.start === start && e.end === end && e.text === text)) edits.push({ start, end, text, why });
};
for (const n of STORE_VARS) {
  const b = B[n];
  const decl = b.path.parentPath.node; // VariableDeclaration
  if (decl.declarations.length !== 1 || !b.path.node.init) throw new Error(`Declaración rara de ${n}`);
  edit(decl.start, b.path.node.id.end, `store.${n}`, "store");
  for (const r of b.referencePaths) {
    if (r.parent.type === "ObjectProperty" && r.parent.shorthand) edit(r.parent.start, r.parent.end, `${n}: store.${n}`, "store");
    else edit(r.node.start, r.node.end, `store.${n}`, "store");
  }
  for (const cv of b.constantViolations) {
    const id = cv.node.type === "AssignmentExpression" ? cv.node.left : cv.node.type === "UpdateExpression" ? cv.node.argument : null;
    if (!id || id.type !== "Identifier") throw new Error(`Asignación rara a ${n} en la línea ${lineOf(cv.node.start)}`);
    edit(id.start, id.end, `store.${n}`, "store");
  }
}
// S: se exporta con `let` (los demás módulos ven siempre el valor actual) y el reinicio de la demo usa resetState().
for (const cv of B.S.constantViolations) {
  if (code.slice(cv.node.start, cv.node.end) !== "S = fresh()") throw new Error("Asignación inesperada a S");
  edit(cv.node.start, cv.node.end, "resetState()", "S = fresh() → resetState()");
}
// P: los prestadores de ejemplo se cargan en el array compartido (src/store.js) solo en el modo demo.
{
  const d = B.P.path.parentPath.node;
  edit(d.start, B.P.path.node.init.start, "P.push(...", "P de ejemplo → P.push(...)");
  edit(B.P.path.node.init.end, d.end, ");", "P de ejemplo → P.push(...)");
}
// LIVE: en producción siempre en vivo; la demo solo existe en los builds con VITE_DEMO. sb depende de la configuración.
{
  const d = B.LIVE.path.parentPath.node;
  edit(d.start, B.LIVE.path.node.id.end, "const CONFIG_OK", "LIVE → CONFIG_OK");
  edit(d.end, d.end, "\nconst LIVE = import.meta.env.VITE_DEMO ? CONFIG_OK : true;", "LIVE en producción = true");
  const sb = B.sb.path.node.init;
  if (code.slice(sb.test.start, sb.test.end) !== "LIVE") throw new Error("sb cambió");
  edit(sb.test.start, sb.test.end, "CONFIG_OK", "sb: LIVE → CONFIG_OK");
}
edits.sort((a, b) => a.start - b.start || a.end - b.end);
for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw new Error(`Ediciones superpuestas en la línea ${lineOf(edits[i].start)}`);

// Texto de [start, end) con las ediciones aplicadas y los "huecos" reemplazados.
function textOf(start, end, holes = []) {
  const ev = [...edits.filter((e) => e.start >= start && e.end <= end), ...holes.map((h) => ({ ...h, hole: true }))]
    .sort((a, b) => a.start - b.start);
  let out = "", pos = start;
  for (const e of ev) {
    if (e.start < pos) continue; // ediciones dentro de un hueco: van con el hueco
    out += code.slice(pos, e.start) + e.text;
    pos = e.end;
  }
  return out + code.slice(pos, end);
}
const dedent = (t, n) => t.replace(new RegExp(`\n {${n}}`, "g"), "\n");

// ---------- Segmentos: cada pedazo de código va a un módulo ----------
// {start, end, mod, kind, key, render()} ; las referencias a otros módulos se resuelven por posición.
const segs = [];
const HANDLERS = { click: "src/actions/toques.js", submit: "src/actions/formularios.js", change: "src/actions/cambios.js", input: "src/actions/cambios.js", keydown: "src/actions/cambios.js" };
const REG = { click: ["registerClick", "CLICK"], submit: ["registerSubmit", "SUBMIT"], change: ["registerChange", "CHANGE"], input: ["registerInput", "INPUT"] };
const actionModule = {};
for (const [mod, g] of Object.entries(ACCIONES)) for (const [ev, names] of Object.entries(g)) for (const n of names) {
  if (actionModule[ev + ":" + n]) throw new Error(`Acción ${ev}:${n} en dos módulos`);
  actionModule[ev + ":" + n] = mod;
}
const usedActions = new Set();
const excepciones = [];

const isAct = (t, v) => {
  if (t.type === "BinaryExpression" && t.operator === "===" && t.left.type === "Identifier" && t.left.name === v && t.right.type === "StringLiteral") return [t.right.value];
  if (t.type === "LogicalExpression" && t.operator === "||") { const a = isAct(t.left, v), b = isAct(t.right, v); return a && b ? [...a, ...b] : null; }
  if (t.type === "CallExpression" && t.callee.type === "MemberExpression" && t.callee.property.name === "includes" && t.callee.object.type === "ArrayExpression" && t.arguments[0]?.type === "Identifier" && t.arguments[0].name === v) return t.callee.object.elements.map((e) => e.value);
  if (t.type === "LogicalExpression" && t.operator === "&&") { const a = isAct(t.left, v); return a ? a.map((x) => "?" + x) : null; } // acción con condición extra
  return null;
};
const isId = (t) => {
  const s = code.slice(t.start, t.end);
  const ids = [...s.matchAll(/e\.target\.id === "([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  return ids.length && s === ids.map((i) => `e.target.id === "${i}"`).join(" || ") ? ids : null;
};

for (const st of top) {
  const key = keyOf(st);
  const isHandler = st.type === "ExpressionStatement" && st.expression.type === "CallExpression" && code.slice(st.expression.callee.start, st.expression.callee.end) === "document.addEventListener";
  if (isHandler) {
    const ev = st.expression.arguments[0].value, fn = st.expression.arguments[1], stmts = fn.body.body;
    const holes = [];
    if (ev === "keydown") { segs.push({ start: st.start, end: st.end, mod: HANDLERS[ev], kind: "handler", key, holes }); continue; }
    // ramas por acción
    let v = null;
    const branches = []; // {acts, start, end, test, block}
    for (const s of stmts) {
      if (ev === "click" && s.type === "VariableDeclaration" && code.slice(s.start, s.end) === "const v = x.dataset.act;") { v = "v"; continue; }
      if (s.type !== "IfStatement") continue;
      if (ev === "click" && !v) continue;
      // cadena if / else if
      const chain = [];
      let cur = s, ok = true;
      while (cur && cur.type === "IfStatement") {
        const acts = ev === "click" ? isAct(cur.test, v) : isId(cur.test);
        if (!acts) ok = false;
        chain.push({ acts, test: cur.test, block: cur.consequent });
        cur = cur.alternate;
      }
      if (!ok || cur) { if (ev === "click") throw new Error(`Rama no reconocida en click, línea ${lineOf(s.start)}`); continue; }
      branches.push({ start: s.start, end: s.end, chain });
    }
    // reemplazo de las ramas por el despacho
    const [regFn, mapName] = REG[ev];
    const disp = {
      click: "const accion = CLICK.get(v);\n  if (accion) {\n    accion(e, x, v);\n  }",
      submit: "const accion = SUBMIT.get(e.target.id);\n  if (accion) {\n    accion(e);\n  }",
      change: "const accion = CHANGE.get(e.target.id);\n  if (accion) {\n    accion(e);\n    return;\n  }",
      input: "const accion = INPUT.get(e.target.id);\n  if (accion) {\n    accion(e);\n    return;\n  }",
    }[ev];
    // la primera rama se reemplaza por el despacho; las demás desaparecen junto con el salto de línea que las precede
    branches.forEach((b, i) => {
      if (i === 0) return holes.push({ start: b.start, end: b.end, text: disp });
      const prevEnd = b.start - code.slice(0, b.start).match(/\n *$/)[0].length;
      holes.push({ start: prevEnd, end: b.end, text: "" });
    });
    segs.push({ start: st.start, end: st.end, mod: HANDLERS[ev], kind: "handler", key, holes, ev, mapName });
    // cada acción a su módulo: una función por rama (o por grupo de ramas de la misma acción)
    const byAct = new Map();
    for (const b of branches) for (const c of b.chain) {
      const names = c.acts.map((a) => a.replace(/^\?/, ""));
      const k = names.join("|");
      if (!byAct.has(k)) byAct.set(k, { names, parts: [], start: c.test.start, end: c.block.end });
      const g = byAct.get(k);
      g.parts.push(c);
      g.end = c.block.end;
    }
    for (const [k, g] of byAct) {
      const mods = new Set(g.names.map((n) => actionModule[ev + ":" + n]));
      if (mods.size !== 1 || mods.has(undefined)) throw new Error(`Acción ${ev}:${k} sin módulo (o en varios)`);
      g.names.forEach((n) => usedActions.add(ev + ":" + n));
      const mod = [...mods][0];
      const params = ev === "click" ? "(e, x, v)" : "(e)";
      const nm = g.names.length > 1 ? `[${g.names.map((n) => JSON.stringify(n)).join(", ")}]` : JSON.stringify(g.names[0]);
      const pure = g.parts.length === 1 && !g.parts[0].acts.some((a) => a.startsWith("?"));
      segs.push({
        start: g.start, end: g.end, mod, kind: "branch", key: `${ev}:${k}`, ev,
        render: () => {
          if (pure) return `${regFn}(${nm}, ${params} => ${dedent(textOf(g.parts[0].block.start, g.parts[0].block.end), 2)});`;
          // misma acción en varias ramas (o con condición): se conserva el if / else if original adentro
          excepciones.push({ tipo: "rama con condición", clave: `${ev}:${k}`, detalle: "la función conserva el if / else if original de esa acción" });
          const inner = g.parts.map((c) => `if (${dedent(textOf(c.test.start, c.test.end), 2)}) ${dedent(textOf(c.block.start, c.block.end), 2)}`).join(" else ");
          return `${regFn}(${nm}, ${params} => {\n  ${inner.replace(/\n/g, "\n  ")}\n});`;
        },
      });
    }
    continue;
  }
  if (PARTIR[key]) {
    const obj = key === "liveApi" ? B.liveApi.path.node.init : st.expression.arguments[1];
    const props = obj.properties;
    const leads = props.map((p, i) => {
      const from = i === 0 ? obj.start + 1 : code.indexOf(",", props[i - 1].end) + 1;
      return { from, p };
    });
    const seen = new Set();
    for (const [mod, names] of Object.entries(PARTIR[key])) {
      const part = leads.filter(({ p }) => names.includes(p.key.name));
      if (part.length !== names.length) throw new Error(`Faltan propiedades de ${key} en ${mod}`);
      part.forEach(({ p }) => seen.add(p.key.name));
      const base = path.basename(mod, ".js");
      const ident = "live" + base.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
      const first = part[0].p.start, last = part[part.length - 1].p.end;
      segs.push({
        start: first, end: last, mod, kind: "part", key: `${key}:${base}`, ident,
        render: () => {
          const inner = part.map(({ from, p }) => textOf(from, p.end) + ",").join("");
          return key === "liveApi" ? `export const ${ident} = {${inner}\n};` : `Object.assign(LM, {${inner}\n});`;
        },
      });
    }
    if (seen.size !== props.length) throw new Error(`Propiedades de ${key} sin módulo: ${props.map((p) => p.key.name).filter((n) => !seen.has(n))}`);
    if (key === "liveApi") {
      const parts = Object.keys(PARTIR.liveApi).map((m) => "live" + path.basename(m, ".js").split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(""));
      segs.push({ start: st.start, end: st.end, mod: moduleOfKey[key], kind: "compose", key, render: () => `const liveApi = {\n${parts.map((p) => `  ...${p},`).join("\n")}\n};` });
      excepciones.push({ tipo: "objeto partido", clave: "liveApi", detalle: `se arma con ${parts.join(", ")} (mismas propiedades, mismo orden)` });
    } else excepciones.push({ tipo: "objeto partido", clave: "Object.assign(LM, …)", detalle: `cuatro Object.assign(LM, …) en ${Object.keys(PARTIR[key]).join(", ")}` });
    continue;
  }
  const mod = moduleOfKey[key];
  if (!mod) throw new Error(`Sin módulo: ${key} (línea ${lineOf(st.start)})`);
  segs.push({ start: st.start, end: st.end, mod, kind: "stmt", key });
}
for (const k of Object.keys(moduleOfKey)) if (!segs.some((s) => s.key === k)) throw new Error(`El mapa nombra ${k}, que no existe`);
for (const k of Object.keys(actionModule)) if (!usedActions.has(k)) throw new Error(`El mapa nombra la acción ${k}, que no existe`);

// ---------- Dónde vive cada nombre y quién lo usa ----------
const segAt = (pos) => {
  let best = null;
  for (const s of segs) if (s.kind !== "compose" && pos >= s.start && pos < s.end && (!best || s.end - s.start < best.end - best.start)) best = s;
  return best;
};
const home = {};
for (const [n, b] of Object.entries(B)) {
  if (STORE_VARS.includes(n)) continue;
  home[n] = n === "P" ? "src/store.js" : n === "LIVE" ? "src/config.js" : n === "liveApi" ? "src/api/live/index.js" : segAt(b.path.node.start).mod;
}
// Ninguna rama puede usar variables locales del manejador salvo los parámetros que recibe (e, x, v).
{
  const handlerFns = new Set(segs.filter((s) => s.kind === "handler").map((s) => top.find((t) => t.start === s.start).expression.arguments[1]));
  traverse(ast, {
    ReferencedIdentifier(p) {
      const b = p.scope.getBinding(p.node.name);
      if (!b || !handlerFns.has(b.scope.block)) return;
      const s = segAt(p.node.start);
      if (s.kind === "branch" && !(s.ev === "click" ? ["e", "x", "v"] : ["e"]).includes(p.node.name))
        throw new Error(`La rama ${s.key} usa la variable local ${p.node.name} del manejador`);
    },
  });
}
home.CONFIG_OK = "src/config.js";
const imports = {}; // mod → Map(fromMod → Set(nombres))
const addImport = (mod, from, name) => {
  if (mod === from) return;
  ((imports[mod] ||= new Map()).get(from) || imports[mod].set(from, new Set()).get(from)).add(name);
};
const exported = new Set();
for (const [n, b] of Object.entries(B)) {
  if (STORE_VARS.includes(n)) continue;
  for (const r of [...b.referencePaths, ...b.constantViolations]) {
    const s = segAt(r.node.start);
    // el envoltorio de un objeto partido (Object.assign(LM, …) / const liveApi =) lo arma el script con sus import
    if (!s && top.some((t) => PARTIR[keyOf(t)] && r.node.start >= t.start && r.node.start < t.end)) continue;
    if (!s) throw new Error(`Referencia a ${n} fuera de todo segmento (línea ${lineOf(r.node.start)})`);
    if (n === "S" && r.parent && code.slice(r.parent.start, r.parent.end) === "S = fresh()") { addImport(s.mod, "src/state.js", "resetState"); continue; }
    if (s.mod !== home[n]) { addImport(s.mod, home[n], n); exported.add(n); }
  }
}
// store: los módulos que nombran store.X
for (const e of edits.filter((e) => e.why === "store")) addImport(segAt(e.start).mod, "src/store.js", "store");
// LIVE vive en config.js con su nuevo nombre; sb usa CONFIG_OK
addImport("src/main.js", "src/config.js", "CONFIG_OK");
exported.add("CONFIG_OK");

// ---------- Armado de los módulos ----------
const files = {}; // ruta → [{pos, text}]
const put = (mod, pos, text) => (files[mod] ||= []).push({ pos, text });
const EXPORTABLE = (st) => st.type === "FunctionDeclaration" || st.type === "VariableDeclaration" || st.type === "ClassDeclaration";
for (const s of segs) {
  let text;
  if (s.render) text = s.render();
  else if (s.kind === "handler") text = textOf(s.start, s.end, s.holes);
  else {
    text = textOf(s.start, s.end);
    const st = top.find((t) => t.start === s.start);
    const names = st.type === "VariableDeclaration" ? st.declarations.map((d) => d.id.name) : st.type === "FunctionDeclaration" ? [st.id.name] : [];
    const isStore = names.some((n) => STORE_VARS.includes(n));
    if (EXPORTABLE(st) && !isStore && (names.some((n) => exported.has(n) && home[n] === s.mod) || names.includes("S") || names.includes("LIVE"))) {
      if (names.includes("LIVE")) text = text.replace("const CONFIG_OK", "export const CONFIG_OK").replace("\nconst LIVE =", "\nexport const LIVE =");
      else text = "export " + text;
    }
  }
  put(s.mod, s.start, text);
}
for (const s of segs.filter((s) => s.kind === "part")) {
  if (s.key.startsWith("liveApi")) addImport("src/api/live/index.js", s.mod, s.ident);
  else addImport(s.mod, "src/api/live/index.js", "LM");
}
exported.add("LM");
for (const s of segs.filter((s) => s.kind === "branch")) addImport(s.mod, "src/actions/registro.js", REG[s.ev][0]);
for (const s of segs.filter((s) => s.kind === "handler" && s.mapName)) addImport(s.mod, "src/actions/registro.js", s.mapName);

// Re-exportar desde el módulo de origen lo que se importa (por ejemplo LM, que ahora lo usan los m-*.js)
const exportedNames = new Set([...exported]);

// ---------- Módulos nuevos (pegamento) ----------
const STORE_DEMO_INIT = { COMM: "{ followers: 0, reviews: [], media: [] }", COMMBY: "{}" };
put("src/store.js", -2,
  `// Datos en memoria que comparten los módulos (antes eran variables globales \`let\` del script único).\n` +
  `// Cada módulo los lee y los reasigna como store.X. Los valores iniciales se cargan en el módulo de cada uno.\n` +
  `export const store = {\n` +
  `  // en producción arrancan vacíos; en el modo demo los carga src/demo/estado.js\n` +
  Object.entries(STORE_DEMO_INIT).map(([k, v]) => `  ${k}: ${v},\n`).join("") +
  `};\n` +
  `// Prestadores cargados (en vivo, los que trae la base; en el modo demo, además, los de ejemplo).\n` +
  `export const P = [];`);
excepciones.push({ tipo: "valor inicial en producción", clave: "COMM, COMMBY", detalle: `en producción arrancan como ${Object.values(STORE_DEMO_INIT).join(" y ")} (antes, con las reseñas y fotos de ejemplo); en demo, igual que antes` });
put("src/state.js", 1e9, "// Reinicio de la demo: S pasa a ser un estado nuevo (los módulos que importan S ven el nuevo).\nexport function resetState() {\n  S = fresh();\n}");
put("src/router.js", 0, "// Enrutador (Bloque B).");
put("src/actions/registro.js", 0,
  `// Registro de acciones: cada pantalla registra las suyas (data-act o id del formulario → función).\n` +
  `// Los listeners de document (toques.js, formularios.js, cambios.js) buscan acá qué función corresponde.\n` +
  `export const CLICK = new Map();\nexport const SUBMIT = new Map();\nexport const CHANGE = new Map();\nexport const INPUT = new Map();\n` +
  `function register(map, names, fn) {\n  for (const name of [].concat(names)) {\n    if (map.has(name)) {\n      throw new Error("Acción registrada dos veces: " + name);\n    }\n    map.set(name, fn);\n  }\n}\n` +
  `export const registerClick = (names, fn) => register(CLICK, names, fn);\n` +
  `export const registerSubmit = (names, fn) => register(SUBMIT, names, fn);\n` +
  `export const registerChange = (names, fn) => register(CHANGE, names, fn);\n` +
  `export const registerInput = (names, fn) => register(INPUT, names, fn);`);
put("src/demo/barra.js", 0,
  `// Barra del prototipo ("Ver como" y "Reiniciar demo"): solo en el modo demo, en el mismo lugar que estaba en el HTML.\n` +
  `document.querySelector("noscript").insertAdjacentHTML(\n  "afterend",\n  ${JSON.stringify(barra.replace(/\n\n$/, "\n"))},\n);`);
put("src/demo/index.js", 0,
  `// Modo demo (solo en los builds con VITE_DEMO): barra, datos de ejemplo y reinicio, en el mismo orden que en el\n` +
  `// script único. Lo importa src/main.js al final de sus import, antes de boot(); en producción es un módulo vacío.\n` +
  `import "./barra.js";\nimport "./prestadores.js";\nimport "./sembrar.js";\nimport "./estado.js";\nimport "./reiniciar.js";`);

// main.js: estilos, acciones (cada módulo registra las suyas), ganchos de prueba, demo y arranque
const actionMods = [...new Set([...Object.keys(ACCIONES), ...Object.values(HANDLERS)])].sort();
put("src/main.js", -3,
  CSS.map(([f]) => `import "./${path.relative("src", f)}";`).join("\n") + "\n" +
  actionMods.map((f) => `import "./${path.relative("src", f)}";`).join("\n") + "\n" +
  `import { exponerParaPruebas } from "./ganchos-prueba.js";`);
const mainBoot = segs.find((s) => s.key === "@12064");
mainBoot.render = () =>
  `if (import.meta.env.VITE_TEST_HOOKS) {\n  exponerParaPruebas();\n}\n` +
  `if (!CONFIG_OK && !import.meta.env.VITE_DEMO) {\n  faltaConfig();\n} else {\n  boot();\n}`;
files["src/main.js"] = files["src/main.js"].filter((f) => f.pos !== mainBoot.start);
put("src/main.js", mainBoot.start, mainBoot.render());
put("src/main.js", mainBoot.start - 1,
  `// Producción sin config.js completo: en vez de la demo, un aviso claro (la demo no viaja en el build de producción).\n` +
  `function faltaConfig() {\n  document.getElementById("app").innerHTML =\n` +
  `    '<section class="in" style="padding:48px 0"><h1 class="h1">Falta configurar el sitio</h1><p class="hint">Completá config.js con la URL y la clave anon del proyecto de Supabase.</p></section>';\n}`);
excepciones.push({ tipo: "arranque", clave: "boot();", detalle: "main.js: ganchos de prueba (solo VITE_TEST_HOOKS), demo antes de boot (vacía en producción) y aviso si falta config.js en producción" });
excepciones.push({ tipo: "módulo nuevo", clave: "src/demo/barra.js", detalle: "la barra \"Ver como\" sale de index.html y se inserta igual, solo en demo" });

// Ganchos para las pruebas: expone todo lo exportado, S y store, como el script único (window.S, window.BOOK, …).
const SIDE_EFFECT_DEMO = ["barra", "prestadores", "sembrar", "estado", "reiniciar", "index"].map((n) => `"!./demo/${n}.js"`);
put("src/ganchos-prueba.js", 0,
  `// Solo en los builds de desarrollo y de prueba (VITE_TEST_HOOKS): expone el estado y las funciones de la app como\n` +
  `// globales, igual que en el script único, para crawl.js, e2e.js y comparar.js. Producción no lo incluye.\n` +
  `import { store } from "./store.js";\n\n` +
  `const STORE_VARS = ${JSON.stringify(STORE_VARS)};\n\n` +
  `export function exponerParaPruebas() {\n` +
  `  const modulos = import.meta.glob(["./**/*.js", "!./main.js", "!./ganchos-prueba.js", ${SIDE_EFFECT_DEMO.join(", ")}], { eager: true });\n` +
  `  const desde = {};\n` +
  `  for (const m of Object.values(modulos)) {\n    for (const k of Object.keys(m)) {\n      desde[k] = m;\n    }\n  }\n` +
  `  const nombres = [...Object.keys(desde), ...STORE_VARS];\n` +
  `  const tt = {};\n` +
  `  for (const k of nombres) {\n` +
  `    const get = () => (k in desde ? desde[k][k] : store[k]);\n` +
  `    const set = (v) => {\n      if (STORE_VARS.includes(k)) {\n        store[k] = v;\n      } else {\n        throw new Error("No se puede reasignar " + k);\n      }\n    };\n` +
  `    Object.defineProperty(tt, k, { get, set, enumerable: true });\n` +
  `    if (!(k in window)) {\n      Object.defineProperty(window, k, { get, set, configurable: true });\n    }\n` +
  `  }\n` +
  `  window.__TT__ = tt;\n}`);
excepciones.push({ tipo: "módulo nuevo", clave: "src/ganchos-prueba.js", detalle: "window.__TT__ y globales para las pruebas; solo en los builds de desarrollo y de prueba" });

// ---------- Escritura ----------
const relImport = (from, to) => { let r = path.relative(path.dirname(from), to); if (!r.startsWith(".")) r = "./" + r; return r; };
for (const dir of ["src/lib", "src/api", "src/ui", "src/views", "src/actions", "src/demo", "src/styles"]) fs.rmSync(path.join(ROOT, dir), { recursive: true, force: true });
for (const f of ["src/main.js", "src/config.js", "src/state.js", "src/store.js", "src/router.js", "src/ganchos-prueba.js"]) fs.rmSync(path.join(ROOT, f), { force: true });
const sizes = {};
for (const [mod, parts] of Object.entries(files)) {
  parts.sort((a, b) => a.pos - b.pos);
  let out = "";
  const imp = imports[mod];
  if (imp) {
    const lines = [...imp.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([from, names]) => `import { ${[...names].sort().join(", ")} } from "${relImport(mod, from)}";`);
    // los import de main.js (estilos y acciones) van primero
    const head = parts[0].pos < 0 ? parts.shift() : null;
    out = (head ? head.text + "\n" : "") + lines.join("\n") + "\n";
    // la demo se importa al final: corre después de todos los módulos de la app y antes de boot(), como en el script
    // único. En producción vite.config.mjs reemplaza src/demo/index.js por un módulo vacío.
    if (mod === "src/main.js") out += 'import "./demo/index.js";\n';
    out += "\n";
  } else if (parts[0].pos < 0) out = parts.shift().text + "\n\n";
  out += parts.map((p) => p.text).join("\n") + "\n";
  // export de lo que otros módulos importan y no quedó exportado (por ejemplo LM)
  if (mod === "src/api/live/index.js") out = out.replace("\nconst LM = ", "\nexport const LM = ").replace("\nconst liveApi = ", "\nexport const liveApi = ");
  const file = path.join(ROOT, mod);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  sizes[mod] = out.split("\n").length - 1;
}

// CSS: mismo texto y orden; las fuentes pasan a /fonts/ (el CSS final queda en /assets/).
const cssLines = style.split("\n");
CSS.forEach(([f, from], i) => {
  const to = i + 1 < CSS.length ? CSS[i + 1][1] - 1 : cssLines.length;
  let t = cssLines.slice(from - 1, to).join("\n");
  if (!t.endsWith("\n")) t += "\n";
  if (f.endsWith("fuentes.css")) t = t.replace(/url\(fonts\//g, "url(/fonts/");
  fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, f), t);
  sizes[f] = t.split("\n").length - 1;
});
excepciones.push({ tipo: "CSS", clave: "src/styles/fuentes.css", detalle: "url(fonts/…) → url(/fonts/…): el CSS compilado queda en /assets/" });

// index.html: el mismo <head> (sin el comentario del prototipo) y el mismo <body> sin la barra de la demo.
fs.writeFileSync(path.join(ROOT, "index.html"),
  `<!doctype html>\n<html lang="es-AR">\n<head>\n${head}</head>\n<body>\n${bodyApp}` +
  `<script src="config.js"></script>\n<script src="vendor/supabase.js"></script>\n<script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`);

fs.mkdirSync(path.join(ROOT, ".build"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".build/mudanza-salida.json"), JSON.stringify({ referencia: REFERENCIA, storeVars: STORE_VARS, excepciones, lineas: sizes }, null, 2) + "\n");
const big = Object.entries(sizes).filter(([, n]) => n > 400);
console.log(`${Object.keys(sizes).length} archivos · ${STORE_VARS.length} variables en store · ${segs.filter((s) => s.kind === "branch").length} acciones registradas`);
if (big.length) console.log("Más de 400 líneas:", big.map(([f, n]) => `${f} (${n})`).join(", "));

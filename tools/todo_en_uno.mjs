// TuTiempo · TODO_EN_UNO.sql
// Genera supabase/TODO_EN_UNO.sql concatenando supabase/migrations/*.sql en orden (el nombre empieza con la fecha,
// así que el orden alfabético es el de la CLI de Supabase). Cada archivo va precedido por una línea con su nombre.
//   node tools/todo_en_uno.mjs          → regenera TODO_EN_UNO.sql
//   node tools/todo_en_uno.mjs --check  → no escribe nada; sale con 1 si TODO_EN_UNO.sql no es idéntico a las migraciones
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MIG = path.join(ROOT, "supabase", "migrations");
const OUT = path.join(ROOT, "supabase", "TODO_EN_UNO.sql");
const check = process.argv.includes("--check");

const files = fs.readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const bad = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
if (bad.length) {
  console.error(`Migraciones con nombre fuera del formato de la CLI (AAAAMMDDHHMMSS_nombre.sql): ${bad.join(", ")}`);
  process.exit(1);
}

let sql = "-- TuTiempo · esquema completo en un solo archivo (pegar en Supabase → SQL Editor → Run)\n\n";
for (const f of files) sql += `-- ===================== ${f} =====================\n${fs.readFileSync(path.join(MIG, f), "utf8")}\n`;

if (check) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (cur !== sql) {
    console.error("supabase/TODO_EN_UNO.sql NO coincide con supabase/migrations/. Regeneralo con: npm run sql:build");
    process.exit(1);
  }
  console.log(`TODO_EN_UNO.sql idéntico a las ${files.length} migraciones`);
} else {
  fs.writeFileSync(OUT, sql);
  console.log(`TODO_EN_UNO.sql regenerado con ${files.length} migraciones`);
}

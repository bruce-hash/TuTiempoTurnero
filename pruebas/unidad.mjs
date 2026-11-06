// Pruebas unitarias de las reglas de los formularios (sin navegador): npm run test:unidad
//  - H08: parsePesos (src/lib/montos.js) con los formatos que se aceptan y los que se rechazan, y que todos los campos de
//    montos de la app pasen por parsePesos.
//  - H24: siteUrl (src/lib/sitio.js), la dirección del sitio: solo https:// y el dominio.
//  - D30: chargeFor (src/lib/cobro.js), lo que paga el cliente al reservar: la misma cuenta que charge_parts en la base.
//  - Ingreso y registro: cleanPending (src/lib/pendiente.js), la acción pendiente que vuelve de sessionStorage o de los
//    datos de la cuenta: solo lo esperado, con el formato esperado, y vence a las 2 horas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chargeFor } from "../src/lib/cobro.js";
import { parsePesos } from "../src/lib/montos.js";
import { SITE_URL_RE, siteUrl } from "../src/lib/sitio.js";
import { cleanPending } from "../src/lib/pendiente.js";
import { checkSplit, restSplit } from "../src/lib/resto.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};

// ---------- H08 · montos ----------
const accepted = { "1.500": 1500, "12.000": 12000, "$ 2.000": 2000, "12500": 12500, "$12.500": 12500, " 500 ": 500, "1.250.000": 1250000, "0": 0, "": 0 };
for (const [raw, want] of Object.entries(accepted)) {
  ok(`H08: "${raw}" = ${want}`, parsePesos(raw) === want, String(parsePesos(raw)));
}
for (const raw of ["1500,50", "1,5", "1.50", "1.5000", "12,500", "1.500,00", "-500", "1e3", "12.5", "1..500", ".500", "500.", "doce"]) {
  ok(`H08: "${raw}" se rechaza`, Number.isNaN(parsePesos(raw)), String(parsePesos(raw)));
}

// cada campo de montos de la app se lee con parsePesos (servicios, adicionales, productos, gastos, caja, admin y Devolver)
const MONEY_INPUTS = {
  "src/views/prestador/perfil.js": ["sp", "ap"], // precio del servicio y de cada adicional
  "src/actions/prestador-productos.js": ["bc", "pnp"], // costo de compra y precio del producto
  "src/actions/prestador-finanzas.js": ["gm"], // gasto
  "src/actions/prestador-caja.js": ["wpr"], // servicio sin turno (el efectivo contado: counted, abajo)
  "src/actions/admin-balance.js": ["aem"], // gasto del admin
  "src/actions/admin.js": ["arAmount"], // Devolver en Para revisar
};
for (const [file, ids] of Object.entries(MONEY_INPUTS)) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  for (const id of ids) {
    const read = new RegExp(`parsePesos\\(\\$\\("#${id}["+]`).test(src) || new RegExp(`#${id}\\$\\{index\\}[^\\n]*parsePesos`).test(src);
    ok(`H08: el campo #${id} (${file}) se lee con parsePesos`, read);
  }
}
ok("H08: el efectivo contado de la caja se lee con parsePesos",
  /parsePesos\(counted\)/.test(fs.readFileSync(path.join(ROOT, "src/actions/prestador-caja.js"), "utf8")));
// ningún monto se lee a mano (lo que H08 corrigió: borrar todo lo que no sea número)
const actions = fs.readdirSync(path.join(ROOT, "src/actions")).map((f) => fs.readFileSync(path.join(ROOT, "src/actions", f), "utf8")).join("\n");
ok("H08: ningún formulario borra a mano lo que no es número de un monto", !/replace\(\/\\D\/g, ""\)[^\n]*(amount|price|cost|monto)/i.test(actions));

// ---------- H24 · dirección del sitio ----------
const goodUrls = { "https://tutiempo.com.ar": "https://tutiempo.com.ar", "https://prueba.tutiempo.com.ar": "https://prueba.tutiempo.com.ar",
  " HTTPS://Prueba.TuTiempo.com.ar ": "https://prueba.tutiempo.com.ar", "https://mi-sitio.ar": "https://mi-sitio.ar" };
for (const [raw, want] of Object.entries(goodUrls)) ok(`H24: "${raw}" se acepta como ${want}`, siteUrl(raw) === want, String(siteUrl(raw)));
const badUrls = ["http://tutiempo.com.ar", "tutiempo.com.ar", "https://tutiempo.com.ar/", "https://tutiempo.com.ar/panel",
  "https://tutiempo.com.ar?x=1", "https://tutiempo.com.ar#a", "https://tutiempo.com.ar:8443", "https://localhost",
  "https://-tutiempo.com.ar", "https://tutiempo..com.ar", "https://tu tiempo.com.ar", "https://usuario@tutiempo.com.ar",
  "https://tutiempo.com.ar.", "javascript:alert(1)", "", "https://" + "a".repeat(90) + ".com.ar"];
for (const raw of badUrls) ok(`H24: "${raw.length > 40 ? raw.slice(0, 40) + "…" : raw}" se rechaza`, siteUrl(raw) === null, String(siteUrl(raw)));

// la base usa la misma regla (public.site_url_ok en la migración)
const mig = fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => fs.readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8")).join("\n");
const dbRe = [...mig.matchAll(/function public\.site_url_ok[\s\S]*?p_url ~ '([^']+)'/g)].pop();
ok("H24: la base valida con la misma expresión que el frontend", dbRe && dbRe[1] === SITE_URL_RE.source.replace(/\\\//g, "/"),
  dbRe ? dbRe[1] : "no está site_url_ok");

// ---------- D30 · seña + comisión de TuTiempo + costo de Mercado Pago ----------
// los 12 ejemplos de la propuesta aprobada (docs/06): servicio de $10.000, 7% de TuTiempo, señas 30/40/50%, los 4 plazos
const D30 = { "3000|7.61": 3475, "3000|5.31": 3391, "3000|4.1": 3348, "3000|1.8": 3269, "4000|7.61": 4633, "4000|5.31": 4521,
  "4000|4.1": 4463, "4000|1.8": 4359, "5000|7.61": 5791, "5000|5.31": 5651, "5000|4.1": 5579, "5000|1.8": 5449 };
const d30bad = Object.entries(D30).filter(([k, want]) => { const [dep, mp] = k.split("|").map(Number); return chargeFor(dep, 7, mp).total !== want; });
ok("D30: los 12 ejemplos de la propuesta dan el total aprobado", !d30bad.length, d30bad.map(([k]) => k).join(", "));
const c50 = chargeFor(5000, 7, 7.61);
ok("D30: seña $5.000, 7% y al instante: $350 de TuTiempo + $441 de Mercado Pago = $5.791", c50.fee === 350 && c50.mp === 441 && c50.total === 5791);
ok("D30: con Mercado Pago en 0% no se suma nada", JSON.stringify(chargeFor(5000, 7, 0)) === JSON.stringify({ deposit: 5000, fee: 350, mp: 0, total: 5350 }));
ok("D30: sin seña no se cobra nada", chargeFor(0, 7, 7.61).total === 0);
// con números enteros: ningún total queda abajo de lo que tiene que recibir el prestador, para cualquier seña
let d30low = 0;
for (let dep = 100; dep <= 60000; dep += 37) for (const mp of [1.8, 4.1, 5.31, 7.61, 15]) {
  const c = chargeFor(dep, 7, mp);
  if (c.total - Math.round((c.total * mp) / 100) - c.fee < dep - 1 || c.total - 1 - c.fee - ((c.total - 1) * mp) / 100 >= dep) d30low++;
}
ok("D30: el total es el mínimo que deja la seña completa (sin quedarse corto ni pasarse un peso)", d30low === 0, String(d30low));
// la base hace la misma cuenta: charge_parts usa las mismas operaciones enteras
const migD30 = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261101120000_cobro_d30.sql"), "utf8");
ok("D30: charge_parts de la base usa la misma cuenta (comisión al peso, total redondeado para arriba)",
  migD30.includes("fee := (dep * c100 + 5000) / 10000;") && migD30.includes("total := ((dep + fee) * 10000 + d - 1) / d;"));

// ---------- D34 · la comisión de TuTiempo es un % del PRECIO del turno (no de la seña) ----------
const d34 = chargeFor(5000, 7, 0, 10000);
ok("D34: corte $10.000, seña 50% ($5.000), 7% del total = $700 → con Mercado Pago en 0% el cliente paga $5.700",
  JSON.stringify(d34) === JSON.stringify({ deposit: 5000, fee: 700, mp: 0, total: 5700 }));
const d34mp = chargeFor(5000, 7, 7.61, 10000);
ok("D34: con Mercado Pago al instante (7,61%): ⌈5.700 / 0,9239⌉ = $6.170 ($470 de Mercado Pago)", d34mp.fee === 700 && d34mp.total === 6170 && d34mp.mp === 470);
const D34 = { "3000|7.61": 4005, "3000|5.31": 3908, "3000|4.1": 3859, "3000|1.8": 3768, "4000|7.61": 5088, "4000|5.31": 4964,
  "4000|4.1": 4901, "4000|1.8": 4787, "5000|7.61": 6170, "5000|5.31": 6020, "5000|4.1": 5944, "5000|1.8": 5805 };
const d34bad = Object.entries(D34).filter(([k, want]) => { const [dep, mp] = k.split("|").map(Number); return chargeFor(dep, 7, mp, 10000).total !== want; });
ok("D34: los 12 ejemplos de docs/06 (servicio de $10.000, 7% del total) dan el total de la tabla", !d34bad.length, d34bad.map(([k]) => k).join(", "));
ok("D34: el premio (sin seña) no paga comisión", chargeFor(0, 7, 0, 10000).total === 0);
ok("D34: pagando el total, la comisión es la misma que sobre el precio", chargeFor(10000, 7, 0).fee === 700 && chargeFor(10000, 7, 0, 10000).fee === 700);
const migD34 = fs.readFileSync(path.join(ROOT, "supabase/migrations/20261103040000_comision_total.sql"), "utf8");
ok("D34: charge_parts(seña, precio, …) de la base hace la misma cuenta y book_slot le pasa el precio final",
  migD34.includes("fee := (base * c100 + 5000) / 10000;") && migD34.includes("total := ((dep + fee) * 10000 + d - 1) / d;")
  && migD34.includes("public.charge_parts(dep, v_price, v_cpct, v_mpct)"));

// ---------- Ingreso y registro · la acción pendiente ----------
const now = Date.now();
const res = { a: "reservar", pid: 7, svc: "12", day: "2026-11-03", time: "09:30", at: now };
ok("pendiente: una reserva válida pasa entera", JSON.stringify(cleanPending(res)) === JSON.stringify({ a: "reservar", at: now, pid: 7, svc: "12", day: "2026-11-03", time: "09:30" }));
ok("pendiente: seguir y lista solo llevan lo suyo", JSON.stringify(cleanPending({ a: "seguir", pid: "7", day: "x", at: now, extra: 1 })) === JSON.stringify({ a: "seguir", at: now, pid: 7 })
  && JSON.stringify(cleanPending({ a: "lista", pid: 7, day: "2026-11-03", at: now })) === JSON.stringify({ a: "lista", at: now, pid: 7, day: "2026-11-03" }));
ok("pendiente: negocio no lleva prestador", JSON.stringify(cleanPending({ a: "negocio", pid: 9, at: now })) === JSON.stringify({ a: "negocio", at: now }));
for (const [why, raw] of [
  ["acción desconocida", { a: "pagar", pid: 7, at: now }],
  ["sin fecha", { a: "seguir", pid: 7 }],
  ["vencida (más de 2 horas)", { a: "seguir", pid: 7, at: now - 2 * 3600e3 - 1000 }],
  ["del futuro", { a: "seguir", pid: 7, at: now + 3600e3 }],
  ["prestador que no es un número", { a: "seguir", pid: "7;drop", at: now }],
  ["día mal escrito", { ...res, day: "3/11/2026" }],
  ["hora mal escrita", { ...res, time: "9:30" }],
  ["servicio muy largo", { ...res, svc: "x".repeat(200) }],
  ["no es un objeto", "reservar"],
]) {
  ok(`pendiente: se descarta (${why})`, cleanPending(raw) === null);
}

// V4b · "Cargar diferencia": revisar las dos partes del resto antes de mandarlas (la base vuelve a controlar)
const E = "Efectivo", T = "Transferencia";
ok("resto: $3.000 efectivo + $2.000 transferencia de $5.000 está bien", checkSplit(5000, [{ medio: E, m: 3000 }, { medio: T, m: 2000 }]) === null);
ok("resto: menos que el resto también (lo que falta queda sin cobrar)", checkSplit(5000, [{ medio: E, m: 3000 }, { medio: T, m: 1000 }]) === null);
ok("resto: pasarse del resto no", /no puede pasar del resto \(\$5\.000\)/.test(checkSplit(5000, [{ medio: E, m: 3000 }, { medio: T, m: 2001 }])));
ok("resto: dos veces el mismo medio no", checkSplit(5000, [{ medio: E, m: 3000 }, { medio: E, m: 2000 }]) === "Elegí dos medios distintos.");
ok("resto: un monto vacío o en 0 no", /cuánto te pagó/.test(checkSplit(5000, [{ medio: E, m: 3000 }, { medio: T, m: 0 }])));
ok("resto: un monto con centavos no", /sin centavos/.test(checkSplit(5000, [{ medio: E, m: NaN }, { medio: T, m: 2000 }])));
const sp = restSplit({ price: 10000, paid: 5000, restParts: [[E, 3000], [T, 1500]] });
ok("resto: las partes y lo que quedó sin cobrar", sp.parts.length === 2 && sp.parts[1].m === 1500 && sp.missing === 500);
ok("resto: sin partes, el resto entero en lo que eligió el cliente", JSON.stringify(restSplit({ price: 10000, paid: 5000, src: "app", pay: "cash" })) === JSON.stringify({ parts: [{ medio: E, m: 5000 }], missing: 0 }));
ok("resto: sin partes, el medio que anotó el prestador", restSplit({ price: 4000, paid: 0, src: "manual", restMethod: "transfer" }).parts[0].medio === T);

// 4/11 · íconos propios: la interfaz no vuelve a usar emojis (van ic("nombre"), src/lib/iconos.js). Se permiten solo en
// comentarios, en el dato que marca un día bloqueado ("🏖️ " al principio del servicio) y en el mensaje de ejemplo de
// cumpleaños (lo escribe el profesional). La demo (src/demo/) no entra al build de producción.
{
  const PICTO = /[\u{1F300}-\u{1FAFF}\u2600-\u26FF\u2700-\u27BF\u2B50\u23F0-\u23FF]/u;
  const TYPO = new Set(["✓", "✕", "★", "☆", "✗"]);
  const ALLOWED = [/isDayBlock = /, /svc: "🏖️ " \+ reason/, /run\.why\.replace\(\/\^🏖️/, /svc\.replace\(\/\^🏖️/, /¡Feliz cumpleaños, \{nombre\}! 🎉/];
  const found = [];
  const scanDir = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        if (name !== "demo") scanDir(full);
      } else if (/\.(js|html)$/.test(name) && !full.endsWith(path.join("lib", "iconos.js"))) {
        fs.readFileSync(full, "utf8").split("\n").forEach((line, i) => {
          const code = line.trim().startsWith("//") ? "" : line.replace(/\/\/ .*$/, "");
          const hits = [...code].filter((ch) => PICTO.test(ch) && !TYPO.has(ch));
          if (hits.length && !ALLOWED.some((re) => re.test(line))) found.push(`${path.relative(ROOT, full)}:${i + 1} ${hits.join("")}`);
        });
      }
    }
  };
  scanDir(path.join(ROOT, "src"));
  ok("íconos: la interfaz no usa emojis (ic() de src/lib/iconos.js)", found.length === 0, found.slice(0, 8).join(" · "));
}

console.log(F ? `${F} FALLAS` : "TODO OK");
process.exit(F ? 1 : 0);

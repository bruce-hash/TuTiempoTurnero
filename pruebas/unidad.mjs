// Pruebas unitarias de las reglas de los formularios (sin navegador): npm run test:unidad
//  - H08: parsePesos (src/lib/montos.js) con los formatos que se aceptan y los que se rechazan, y que todos los campos de
//    montos de la app pasen por parsePesos.
//  - H24: siteUrl (src/lib/sitio.js), la dirección del sitio: solo https:// y el dominio.
//  - D30: chargeFor (src/lib/cobro.js), lo que paga el cliente al reservar: la misma cuenta que charge_parts en la base.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chargeFor } from "../src/lib/cobro.js";
import { parsePesos } from "../src/lib/montos.js";
import { SITE_URL_RE, siteUrl } from "../src/lib/sitio.js";

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

console.log(F ? `${F} FALLAS` : "TODO OK");
process.exit(F ? 1 : 0);

// Íconos de la app instalable (Bloque C) con el isotipo del manual de marca (C04, src/marca/isotipo.svg):
// node tools/iconos.mjs
// Escribe en public/icons/:
//   icon-192.png e icon-512.png (fondo crema redondeado, para el manifest)
//   maskable-512.png (a sangre, con el isotipo dentro de la zona segura del 80% para Android)
//   apple-touch-icon.png (180, a sangre: iOS redondea solo)
//   badge-96.png (blanco sobre transparente: el iconito de la barra de notificaciones en Android)
//   logo-email.png (el imagotipo a 2x, sobre transparente: el encabezado de los emails, que no muestran SVG)
// Se corre una vez y los PNG quedan en el repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "icons");
const read = (name) => fs.readFileSync(path.join(ROOT, "src", "marca", name), "utf8").trim();
const ISO = read("isotipo.svg");
const IMAGO = read("imagotipo.svg");
const CREMA = "#F8F5F1";
// el isotipo centrado, con el ancho (en % del lado) que le toca a cada ícono
const square = (size, width, bg, radius, iso = ISO) =>
  `<div style="width:${size}px;height:${size}px;display:grid;place-items:center;${bg ? `background:${bg};` : ""}border-radius:${radius}%">` +
  iso.replace("<svg ", `<svg style="width:${width}%;height:auto;display:block" `) + "</div>";
const white = ISO.replace(/fill="#[0-9A-Fa-f]{6}"/g, 'fill="#fff"');
const ICONS = [
  ["icon-192.png", 192, 192, square(192, 78, CREMA, 22)],
  ["icon-512.png", 512, 512, square(512, 78, CREMA, 22)],
  ["maskable-512.png", 512, 512, square(512, 62, CREMA, 0)],
  ["apple-touch-icon.png", 180, 180, square(180, 74, CREMA, 0)],
  ["badge-96.png", 96, 96, square(96, 92, null, 0, white)],
  ["logo-email.png", 320, 215, IMAGO.replace("<svg ", '<svg style="width:320px;height:215px;display:block" ')],
];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [name, w, h, markup] of ICONS) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
  console.log(name, `${w}x${h}`);
}
await browser.close();

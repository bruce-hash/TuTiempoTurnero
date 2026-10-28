// Bloque C · íconos de la app instalable, desde el reloj del logo (src/ui/iconos.js): node tools/iconos.mjs
// Escribe en public/icons/: icon-192.png e icon-512.png (redondeados, para el manifest), maskable-512.png (a sangre, con el
// reloj dentro de la zona segura del 80% para Android), apple-touch-icon.png (180, a sangre: iOS redondea solo) y
// badge-96.png (blanco sobre transparente: el iconito de la barra de notificaciones en Android). Se corre una vez y los
// PNG quedan en el repo.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const clock = (stroke, scale) => {
  const r = 9 * scale, w = 2.4 * scale;
  return `<circle cx="16" cy="16" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"/>` +
    `<path d="M16 ${16 - 5 * scale}v${5.5 * scale}l${3.5 * scale} ${2.2 * scale}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const svg = (bg, rx, scale, stroke = "#fff") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${bg ? `<rect width="32" height="32" rx="${rx}" fill="${bg}"/>` : ""}${clock(stroke, scale)}</svg>`;
const ICONS = [
  ["icon-192.png", 192, svg("#121212", 9, 1)],
  ["icon-512.png", 512, svg("#121212", 9, 1)],
  ["maskable-512.png", 512, svg("#121212", 0, 0.8)],
  ["apple-touch-icon.png", 180, svg("#121212", 0, 0.95)],
  ["badge-96.png", 96, svg(null, 0, 1.25)],
];
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [name, size, markup] of ICONS) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  console.log(name, size);
}
await browser.close();

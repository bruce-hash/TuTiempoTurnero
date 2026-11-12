import { addDays, dkey } from "../lib/fechas.js";

// Solo la demo: quienes siguen al prestador de ejemplo (Clientes → Seguidores). Juan P. es la cuenta de cliente de la demo.
const NAMES = [
  ["Juan P.", 3, true],
  ["Lucía M.", 6, false],
  ["Sofía R.", 11, true],
  ["Martín G.", 19, false],
  ["Carla D.", 33, false],
  ["Nico F.", 47, true],
];
export function demoFollowers() {
  return NAMES.map(([name, ago, client], index) => ({
    id: "demo-" + index,
    name,
    photo: null,
    since: dkey(addDays(-ago)) + "T12:00:00-03:00",
    client,
  }));
}

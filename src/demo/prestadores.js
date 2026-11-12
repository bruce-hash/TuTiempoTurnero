import { isReservedSlug } from "../lib/rutas.js";
import { P } from "../store.js";

// Prestadores de ejemplo de la demo: todos ficticios (nombres, direcciones, teléfonos e Instagram), ninguno es un
// negocio real de Olavarría (H14). Los teléfonos empiezan con 0 después de la característica: no existen.
P.push(...[
  {
    id: 7,
    cats: ["b"],
    name: "Filo Barber Club",
    addr: "Alsina 2100",
    tel: "2284 000123",
    ig: "filo.barber.demo",
    hue: 221,
    svcs: [
      ["Corte de cabello y barba", 30, 12500, "b"],
      ["Corte de cabello", 25, 1e4, "b"],
      ["Arreglo de barba", 15, 6e3, "b"],
    ],
  },
  {
    id: 9,
    cats: ["b"],
    name: "Tomás Herrera barbero",
    addr: "Lavalle 3100",
    hue: 262,
    svcs: [
      ["Corte de cabello", 25, 12e3, "b"],
      ["Corte y barba", 35, 15e3, "b"],
    ],
  },
  {
    id: 15,
    cats: ["b"],
    name: "Barbería El Molino",
    addr: "Moreno 2400",
    hue: 12,
    svcs: [["Corte premium", 40, 22e3, "b"]],
  },
  {
    id: 18,
    cats: ["b"],
    name: "Nacho barber",
    addr: "Sarmiento 3200",
    hue: 168,
    svcs: [
      ["Corte de cabello", 25, 12500, "b"],
      ["Corte + perfilado de barba", 35, 15500, "b"],
    ],
  },
  {
    id: 12,
    cats: ["p"],
    name: "Marta Ruiz peluquería",
    addr: "Av. Pringles 3800",
    hue: 330,
    svcs: [["Color y corte", 120, 62500, "p"]],
  },
  {
    id: 16,
    cats: ["p"],
    name: "Valeria Sosa estilista",
    addr: "Rufino Fal 2600",
    hue: 38,
    svcs: [["Color y corte", 120, 5e4, "p"]],
  },
  {
    id: 21,
    cats: ["l", "u", "d"],
    name: "Sofía Benítez Studio",
    addr: "Belgrano 1200",
    tel: "2284 000456",
    ig: "sofi.studio.demo",
    hue: 280,
    svcs: [
      ["Extensiones pelo a pelo", 120, 3e4, "l"],
      ["Lifting de pestañas", 60, 15e3, "l"],
      ["Esmaltado semipermanente", 60, 12e3, "u"],
      ["Uñas esculpidas", 90, 18e3, "u"],
      ["Depilación de cejas", 20, 4500, "d"],
      ["Depilación piernas completas", 40, 11e3, "d"],
    ],
  },
  {
    id: 22,
    cats: ["m", "d"],
    name: "Espacio Calma",
    addr: "San Martín 2950",
    hue: 150,
    svcs: [
      ["Masaje descontracturante", 60, 2e4, "m"],
      ["Masaje relajante", 50, 17e3, "m"],
      ["Piedras calientes", 75, 24e3, "m"],
      ["Depilación definitiva · sesión", 30, 15e3, "d"],
    ],
  },
  {
    id: 23,
    cats: ["m"],
    name: "Lucía Ferreyra masoterapia",
    addr: "Necochea 3500",
    hue: 120,
    svcs: [
      ["Masaje terapéutico", 60, 18e3, "m"],
      ["Drenaje linfático", 60, 19e3, "m"],
    ],
  },
  {
    id: 24,
    cats: ["l"],
    name: "Mirada Lash Studio",
    addr: "Vicente López 2100",
    hue: 270,
    svcs: [
      ["Volumen ruso", 150, 38e3, "l"],
      ["Mantenimiento de extensiones", 60, 16e3, "l"],
    ],
  },
  {
    id: 25,
    cats: ["u"],
    name: "Nails by Agus",
    addr: "Hornos 3300",
    hue: 15,
    svcs: [
      ["Kapping gel", 60, 13e3, "u"],
      ["Manicura rusa", 75, 16e3, "u"],
      ["Pedicura spa", 60, 14e3, "u"],
    ],
  },
  {
    id: 26,
    cats: ["d"],
    name: "Piel Suave Depilación",
    addr: "Dorrego 2800",
    hue: 40,
    svcs: [
      ["Cera · piernas completas", 40, 1e4, "d"],
      ["Láser diodo · axilas", 20, 9e3, "d"],
    ],
  },
  {
    id: 27,
    cats: ["b", "p"],
    name: "Estudio Norte",
    addr: "Colón 4100",
    hue: 200,
    svcs: [
      ["Corte masculino", 30, 11e3, "b"],
      ["Barba con toalla caliente", 20, 7e3, "b"],
      ["Corte y brushing", 60, 22e3, "p"],
      ["Color global", 120, 45e3, "p"],
    ],
  },
]);
const JOBS30 = {
  7: 48,
  9: 35,
  15: 22,
  18: 29,
  12: 17,
  16: 12,
  21: 41,
  22: 26,
  23: 15,
  24: 19,
  25: 33,
  26: 9,
  27: 21,
};
P.forEach((prov) => {
  prov.jobs30 = JOBS30[prov.id] || 0;
});
// slug de cada prestador de ejemplo, armado del nombre igual que register_provider en la base (sin acentos, guiones,
// y con sufijo si ya está tomado o es una palabra reservada)
P.forEach((prov) => {
  const base =
    prov.name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "prestador";
  let slug = base;
  for (let n = 1; isReservedSlug(slug) || P.some((other) => other !== prov && other.slug === slug); n++) {
    slug = base + "-" + n;
  }
  prov.slug = slug;
});

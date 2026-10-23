import { S } from "../state.js";

// Rubros: [id, nombre en plural, en singular, ícono]. CAT los indexa por id; "n" es el genérico (sin rubro).
export const CATS = [
  ["b", "Barberías", "Barbería", "💈"],
  ["p", "Peluquerías", "Peluquería", "✂"],
  ["m", "Masajes", "Masajes", "🌿"],
  ["l", "Pestañas", "Pestañas", "👁"],
  ["u", "Uñas", "Uñas", "💅"],
  ["d", "Depilación", "Depilación", "✨"],
];
export const CAT = Object.fromEntries(
  CATS.map((row) => [
    row[0],
    {
      id: row[0],
      name: row[1],
      one: row[2],
      ic: row[3],
    },
  ]),
);
CAT.n = {
  id: "n",
  name: "Servicios",
  one: "Servicios",
  ic: "•",
};
export const catInfo = (id) => CAT[id] || CAT.n;
export const catName = (id) => catInfo(id).one;
// Rubro con el que se muestra un prestador: el que se está mirando (ctx o el filtro del listado) si lo tiene; si no,
// su rubro principal.
export const pcat = (prov, ctx) => {
  const want = ctx || S.cat;
  if (prov && prov.cats && prov.cats.includes(want)) {
    return want;
  } else {
    return (prov && prov.cats && prov.cats[0]) || "n";
  }
};
export const RAMP = '<span class="ramp" aria-hidden="true">' + "<i></i>".repeat(10) + "</span>";
// Valores de cada rubro: retoque sugerido en días (every), indicación y descanso de ejemplo, opciones de repetición
// (reps), adicionales (add) y preguntas (q) de ejemplo, campos de la ficha del cliente, productos y mensaje para volver.
// "n" (sin rubro) usa los de barbería.
export const RUBRO = {
  b: {
    every: 21,
    note: "",
    buffer: 0,
    reps: [0, 2, 3, 4],
    add: [
      ["Lavado", 1500, 10],
      ["Diseño de cejas", 2e3, 10],
    ],
    q: [["estilo", "¿Qué te hacés?", ["Lo de siempre", "Fade", "Clásico", "Tijera", "Rapado"]]],
    ficha: [
      ["corte", "Cómo le gusta el corte"],
      ["barba", "Barba"],
      ["prod", "Productos que usa"],
    ],
    back: "te toca el corte",
    prods: [
      ["Pomada mate", 9e3, 6, 3],
      ["Cera brillo", 7500, 2, 3],
      ["Aceite para barba", 8500, 5, 2],
    ],
  },
  p: {
    every: 45,
    note: "Si es color, vení con el pelo sin lavar de 24 h.",
    buffer: 10,
    reps: [0, 4, 6],
    add: [
      ["Lavado y brushing", 5e3, 25],
      ["Keratina express", 9e3, 20],
      ["Corte de puntas", 4e3, 15],
    ],
    q: [
      ["largo", "Largo de tu pelo", ["Corto", "Medio", "Largo"]],
      ["color", "¿Tenés coloración previa?", ["No", "Sí, de menos de 2 meses", "Sí, de más de 2 meses"]],
      ["alergia", "¿Alergia a algún tinte?", ["No", "Sí"]],
    ],
    ficha: [
      ["formula", "Fórmula de color (marca, tono, oxidante)"],
      ["tecnica", "Técnica y corte"],
      ["cuero", "Cuero cabelludo / alergias"],
    ],
    back: "te toca retocar",
    prods: [
      ["Shampoo matizador", 14e3, 5, 2],
      ["Máscara reparadora", 16e3, 4, 2],
      ["Protector térmico", 12e3, 3, 2],
    ],
  },
  m: {
    every: 14,
    note: "Llegá 10 minutos antes. Evitá comidas pesadas 2 h antes.",
    buffer: 15,
    reps: [0, 1, 2, 4],
    add: [
      ["Aromaterapia", 2500, 0],
      ["Piedras calientes", 5e3, 15],
      ["Reflexología de pies", 4e3, 15],
    ],
    q: [
      ["presion", "¿Qué presión preferís?", ["Suave", "Media", "Fuerte"]],
      ["zona", "¿Alguna zona a evitar o lesión?", "text"],
      ["embarazo", "¿Estás embarazada?", ["No", "Sí"]],
    ],
    ficha: [
      ["presion", "Presión preferida"],
      ["zonas", "Zonas a trabajar / evitar"],
      ["salud", "Observaciones de salud"],
    ],
    back: "te toca tu sesión",
    prods: [
      ["Aceite de almendras", 9e3, 6, 2],
      ["Vela de masajes", 11e3, 4, 2],
      ["Crema relajante", 1e4, 3, 2],
    ],
  },
  l: {
    every: 21,
    note: "Vení sin maquillaje en los ojos y sin lentes de contacto.",
    buffer: 10,
    reps: [0, 2, 3],
    add: [
      ["Retiro de extensiones", 4e3, 20],
      ["Laminado de cejas", 9e3, 30],
      ["Tinte de pestañas", 3500, 10],
    ],
    q: [
      ["primera", "¿Es tu primera vez con extensiones?", ["No", "Sí"]],
      ["estilo", "Estilo que buscás", ["Natural", "Ojo de gato", "Muñeca", "Volumen"]],
      ["sensible", "¿Ojos sensibles o alergias?", ["No", "Sí"]],
    ],
    ficha: [
      ["mapa", "Mapa: estilo, curvatura y largos"],
      ["adhesivo", "Adhesivo usado / sensibilidad"],
      ["ultimo", "Notas del último relleno"],
    ],
    back: "te toca el relleno",
    prods: [
      ["Sérum de pestañas", 15e3, 4, 2],
      ["Cepillo limpiador", 3e3, 10, 3],
      ["Espuma de limpieza", 8e3, 5, 2],
    ],
  },
  u: {
    every: 21,
    note: "Si tenés esmaltado o esculpidas de otro lugar, sumá el retiro como adicional.",
    buffer: 10,
    reps: [0, 2, 3],
    add: [
      ["Retiro de semipermanente", 2e3, 15],
      ["Retiro de esculpidas", 4e3, 30],
      ["Nail art (2 uñas)", 1500, 10],
      ["Francesita", 2e3, 10],
    ],
    q: [
      ["forma", "Forma", ["Almendra", "Cuadrada", "Redonda", "Coffin", "Stiletto"]],
      ["largo", "Largo", ["Corto", "Medio", "Largo"]],
      ["diseno", "¿Qué diseño o color querés?", "text"],
    ],
    ficha: [
      ["forma", "Forma y largo"],
      ["colores", "Colores y diseños que le gustan"],
      ["unas", "Estado de uñas y cutículas"],
    ],
    back: "te toca el mantenimiento",
    prods: [
      ["Aceite de cutículas", 5e3, 10, 3],
      ["Top coat", 7e3, 6, 2],
      ["Lima profesional", 2500, 12, 4],
    ],
  },
  d: {
    every: 28,
    note: "Cera: vello de 5 mm y sin cremas ese día. Láser: rasurá 24 h antes y no tomes sol 15 días antes.",
    buffer: 5,
    reps: [0, 4, 6],
    add: [
      ["Cavado completo", 4e3, 10],
      ["Bozo", 1500, 5],
      ["Axilas", 2500, 10],
    ],
    q: [
      ["sol", "¿Tomaste sol en los últimos 15 días?", ["No", "Sí"]],
      ["piel", "Tono de piel", ["Muy clara", "Clara", "Media", "Morena", "Oscura"]],
      ["medica", "¿Tomás medicación que dé sensibilidad al sol?", ["No", "Sí", "No sé"]],
    ],
    ficha: [
      ["fototipo", "Fototipo"],
      ["zonas", "Zonas y número de sesión"],
      ["reacciones", "Reacciones de la piel"],
    ],
    back: "te toca la próxima sesión",
    prods: [
      ["Crema post depilación", 8e3, 6, 2],
      ["Exfoliante corporal", 9500, 4, 2],
      ["Gel de aloe", 6e3, 8, 3],
    ],
  },
};
RUBRO.n = RUBRO.b;

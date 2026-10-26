import { pr } from "../lib/prestadores.js";

const WORKS = {
  b: ["Fade + barba", "Corte clásico", "Perfilado"],
  p: ["Balayage", "Corte en capas", "Brushing"],
  m: ["Sala de masajes", "Piedras calientes", "Aromaterapia"],
  l: ["Pelo a pelo", "Volumen ruso", "Lifting"],
  u: ["Nail art", "Esculpidas", "Semipermanente"],
  d: ["Cabina", "Cera tibia", "Láser"],
};
// comunidad de ejemplo de un prestador (seguidores, reseñas, trabajos), inventada a partir del rubro. Solo la demo (H14).
export function seedComm(pid) {
  const prov = pr(pid) || {
    cats: ["n"],
    hue: 0,
    name: "",
  };
  const cat = prov.cats[0];
  const hue = +prov.hue || 0;
  const reviewsByCat = {
    b: [
      ["Martín G.", 5, "Impecable el fade y súper puntual."],
      ["Leandro S.", 4, "Muy buen corte, el lugar es cómodo."],
    ],
    p: [
      ["Florencia A.", 5, "Me hizo el balayage que quería, divino."],
      ["Silvia P.", 5, "Atención de diez, el color quedó parejo."],
    ],
    m: [
      ["Laura B.", 5, "Salí nueva. La presión justa y el lugar muy tranquilo."],
      ["Graciela F.", 4, "Muy buen masaje descontracturante."],
    ],
    l: [
      ["Valentina R.", 5, "Las extensiones me duraron un montón. Súper prolija."],
      ["Martina G.", 5, "El lifting quedó natural, como pedí."],
    ],
    u: [
      ["Camila S.", 5, "El semipermanente me duró tres semanas perfecto."],
      ["Rocío P.", 4, "Muy lindo diseño, volvería."],
    ],
    d: [
      ["Julieta M.", 5, "Casi no dolió y es muy higiénico todo."],
      ["Daniela M.", 4, "Me explicó bien cómo cuidarme después del láser."],
    ],
  };
  return {
    followers: 20 + ((pid * 37) % 90),
    reviews: (reviewsByCat[cat] || reviewsByCat.b).map((review, index) => ({
      n: review[0],
      s: review[1],
      t: review[2],
      d: index ? "hace 3 semanas" : "hace 4 días",
      reply: "",
    })),
    media: (WORKS[cat] || ["Trabajo", "Trabajo", "Trabajo"]).map((label, index) => ({
      label: label,
      hue: (hue + index * 25) % 360,
    })),
  };
}

import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { pr } from "../../lib/prestadores.js";
import { store } from "../../store.js";
import { gallery, rating, reviewsHtml } from "../../ui/resenas.js";

const WORKS = {
  b: ["Fade + barba", "Corte clásico", "Perfilado"],
  p: ["Balayage", "Corte en capas", "Brushing"],
  m: ["Sala de masajes", "Piedras calientes", "Aromaterapia"],
  l: ["Pelo a pelo", "Volumen ruso", "Lifting"],
  u: ["Nail art", "Esculpidas", "Semipermanente"],
  d: ["Cabina", "Cera tibia", "Láser"],
};
function seedComm(pid) {
  const a = pr(pid) || {
    cats: ["n"],
    hue: 0,
    name: "",
  };
  const t = a.cats[0];
  const s = +a.hue || 0;
  if (LIVE) {
    return {
      followers: 0,
      reviews: [],
      media: [],
    };
  }
  const n = {
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
    reviews: (n[t] || n.b).map((o, i) => ({
      n: o[0],
      s: o[1],
      t: o[2],
      d: i ? "hace 3 semanas" : "hace 4 días",
      reply: "",
    })),
    media: (WORKS[t] || ["Trabajo", "Trabajo", "Trabajo"]).map((o, i) => ({
      label: o,
      hue: (s + i * 25) % 360,
    })),
  };
}
export const comm = (e) => (store.COMMBY[e] ||= seedComm(e));
export function vBComunidad(e) {
  return `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><p class="lbl" style="margin:0">Mis trabajos</p>${store.COMM.media.length ? '<button class="btn btn-ghost btn-sm" data-act="story" data-i="0">▶ Ver como historia</button>' : ""}</div>
   <p class="note" style="text-align:left;margin:4px 0 10px">Tus clientes los ven en tu perfil y como historias.</p>${gallery(true)}</div>
  <div class="stats2"><div><b>${store.COMM.followers}</b><span>Seguidores</span></div><div><b>${rating().toFixed(1)} ★</b><span>${store.COMM.reviews.length} reseñas</span></div><div><b>${store.COMM.media.length}</b><span>Fotos y videos</span></div></div>
  <div class="panel"><p class="lbl">Avisar a tus seguidores</p>
   <div class="f" style="margin-bottom:10px"><label for="postTxt">Mensaje</label><textarea id="postTxt" placeholder="Ej: Hoy me quedan lugares de 15 a 17 h"></textarea></div>
   <button class="btn btn-pri btn-block" data-act="publicar">Enviar a ${store.COMM.followers} seguidores</button>
   <p class="note" style="margin-top:6px">Les llega una notificación con link para reservar.</p></div>
  <div class="panel"><p class="lbl">Reseñas de clientes</p>${reviewsHtml(true)}</div>
  <div class="panel" style="text-align:center"><p class="lbl">Sumá seguidores</p><div class="qr" aria-hidden="true">${qr()}</div><p style="margin:8px 0 2px;font-weight:700">tutiempo.com.ar/${esc(e.slug || "p/" + e.id)}</p><p class="note">Imprimí el QR para el espejo y poné el link en tu bio de Instagram.</p>
   <button class="btn btn-ghost btn-block" data-act="copiarLink">Copiar link</button></div>`;
}
function qr() {
  let e = "";
  const a = (t, s) =>
    `<rect x="${t}" y="${s}" width="7" height="7"/><rect x="${t + 1}" y="${s + 1}" width="5" height="5" fill="#fff"/><rect x="${t + 2}" y="${s + 2}" width="3" height="3"/>`;
  for (let t = 0; t < 21; t++) {
    for (let s = 0; s < 21; s++) {
      if ((!(s < 8) || !(t < 8)) && (!(s > 12) || !(t < 8)) && (!(s < 8) || !(t > 12))) {
        if ((s * 7 + t * 13 + s * t) % 5 < 2) {
          e += `<rect x="${s}" y="${t}" width="1" height="1"/>`;
        }
      }
    }
  }
  return `<svg viewBox="-1 -1 23 23" width="132" height="132" fill="#0f172a" style="background:#fff">${a(0, 0)}${a(14, 0)}${a(0, 14)}${e}</svg>`;
}

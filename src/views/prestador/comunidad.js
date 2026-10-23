import qrcode from "qrcode-generator";
import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { pr } from "../../lib/prestadores.js";
import { profileLinkText, profileUrl } from "../../router.js";
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
// comunidad del prestador (seguidores, reseñas, trabajos). En vivo arranca vacía y la completa la carga del
// perfil; en la demo se inventa a partir del rubro.
function seedComm(pid) {
  const prov = pr(pid) || {
    cats: ["n"],
    hue: 0,
    name: "",
  };
  const cat = prov.cats[0];
  const hue = +prov.hue || 0;
  if (LIVE) {
    return {
      followers: 0,
      reviews: [],
      media: [],
    };
  }
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
// comunidad de un prestador, creada la primera vez que se pide
export const comm = (pid) => (store.COMMBY[pid] ||= seedComm(pid));
export function vBComunidad(prov) {
  return `<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><p class="lbl" style="margin:0">Mis trabajos</p>${store.COMM.media.length ? '<button class="btn btn-ghost btn-sm" data-act="story" data-i="0">▶ Ver como historia</button>' : ""}</div>
   <p class="note" style="text-align:left;margin:4px 0 10px">Tus clientes los ven en tu perfil y como historias.</p>${gallery(true)}</div>
  <div class="stats2"><div><b>${store.COMM.followers}</b><span>Seguidores</span></div><div><b>${rating().toFixed(1)} ★</b><span>${store.COMM.reviews.length} reseñas</span></div><div><b>${store.COMM.media.length}</b><span>Fotos y videos</span></div></div>
  <div class="panel"><p class="lbl">Avisar a tus seguidores</p>
   <div class="f" style="margin-bottom:10px"><label for="postTxt">Mensaje</label><textarea id="postTxt" placeholder="Ej: Hoy me quedan lugares de 15 a 17 h"></textarea></div>
   <button class="btn btn-pri btn-block" data-act="publicar">Enviar a ${store.COMM.followers} seguidores</button>
   <p class="note" style="margin-top:6px">Les llega una notificación con link para reservar.</p></div>
  <div class="panel"><p class="lbl">Reseñas de clientes</p>${reviewsHtml(true)}</div>
  <div class="panel" style="text-align:center"><p class="lbl">Sumá seguidores</p><div class="qr" aria-hidden="true">${qr(profileUrl(prov))}</div><p style="margin:8px 0 2px;font-weight:700">${esc(profileLinkText(prov))}</p><p class="note">Imprimí el QR para el espejo y poné el link en tu bio de Instagram.</p>
   <button class="btn btn-ghost btn-block" data-act="copiarLink">Copiar link</button></div>`;
}
// QR con la dirección del perfil (Bloque B), con qrcode-generator 2.0.4 (MIT, ver docs/licencias.md): corrección de
// errores media y 4 módulos de margen blanco, como pide el estándar para que lo lean todas las cámaras
function qr(url) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  let dark = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (code.isDark(row, col)) {
        dark += `M${col} ${row}h1v1h-1z`;
      }
    }
  }
  return `<svg viewBox="-4 -4 ${size + 8} ${size + 8}" width="132" height="132" shape-rendering="crispEdges" style="background:#fff"><path fill="#0f172a" d="${dark}"/></svg>`;
}

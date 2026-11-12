// 10/11 · punto 6 (antes solo en la Agenda, agenda-al-dia.js) y 12/11 para todo lo que se pone al día solo (la campanita
// del cliente, volver a la app): si la pantalla se redibuja entre que el dedo (o el mouse) baja y sube, lo tocado se
// reemplaza por uno nuevo y el navegador no manda el toque: había que tocar dos veces («toco la campanita y no abre»).
// Mientras hay un toque en curso (y un instante después) no se redibuja; los datos nuevos quedan guardados y se dibujan
// apenas termina el toque.
import { render } from "../ui/render.js";

let pointerDown = false;
let lastUp = 0;
let deferred = null;
let timer = 0;
export const touching = () => pointerDown || Date.now() - lastUp < 600;
// lo que quedó pendiente se dibuja apenas no hay toque; si el dedo sigue apoyado, lo dibuja el pointerup
function flushLater(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!deferred) {
      return;
    }
    if (touching()) {
      if (!pointerDown) {
        flushLater(650);
      }
      return;
    }
    const canDraw = deferred;
    deferred = null;
    if (canDraw()) {
      render();
    }
  }, ms);
}
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", () => (pointerDown = true), true);
  const up = () => {
    pointerDown = false;
    lastUp = Date.now();
    if (deferred) {
      flushLater(700);
    }
  };
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
}
// dibuja ahora, o apenas termine el toque en curso (si para entonces todavía se puede: canDraw). 12/11: también cuando
// lo piden en el instante después de soltar (antes quedaba esperando el próximo toque)
export function drawSoon(canDraw = () => true) {
  if (touching()) {
    deferred = canDraw;
    if (!pointerDown) {
      flushLater(650);
    }
    return;
  }
  deferred = null;
  render();
}

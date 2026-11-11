// 11/11 · División del código: las partes grandes de la app se bajan recién cuando hacen falta (import() dinámico), así
// el que entra a reservar no carga el panel del profesional ni el de TuTiempo. Cada parte (src/partes/*.js) trae sus
// vistas y registra sus acciones al cargarse.
// - part(nombre): el módulo si ya está; si no, empieza a bajarlo, devuelve null y vuelve a dibujar cuando llega.
// - loadPart(nombre): la promesa del módulo (para una acción que necesita algo de la parte).
// - loadAllParts(): todas (un toque o un formulario cuya acción todavía no está registrada: ver src/actions/toques.js).
// La app instalada las tiene sin conexión: el service worker guarda todos los archivos del build (vite.config.mjs).
import { render } from "./ui/render.js";

const LOADERS = {
  panel: () => import("./partes/panel.js"),
  admin: () => import("./partes/admin.js"),
  negocio: () => import("./partes/negocio.js"),
};
const ready = {};
const loading = {};

export function loadPart(name) {
  if (ready[name]) {
    return Promise.resolve(ready[name]);
  }
  loading[name] ||= LOADERS[name]()
    .then((mod) => {
      ready[name] = mod;
      return mod;
    })
    .catch((err) => {
      // sin conexión y sin la parte en la caché: se puede volver a intentar
      delete loading[name];
      throw err;
    });
  return loading[name];
}

export function part(name) {
  if (ready[name]) {
    return ready[name];
  }
  loadPart(name).then(
    () => render(),
    () => {
      failed[name] = true;
      render();
    },
  );
  return null;
}
// una parte que no se pudo bajar (sin conexión): la pantalla lo dice en vez de quedarse cargando
const failed = {};
export const partFailed = (name) => !!failed[name] && !ready[name];
export const retryPart = (name) => {
  delete failed[name];
  render();
};

export const loadAllParts = () => Promise.all(Object.keys(LOADERS).map((name) => loadPart(name).catch(() => null)));

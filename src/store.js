// Datos en memoria que comparten los módulos (antes eran variables globales `let` del script único).
// Cada módulo los lee y los reasigna como store.X. Los valores iniciales se cargan en el módulo de cada uno.
export const store = {
  // en producción arrancan vacíos; en el modo demo los carga src/demo/estado.js
  COMM: { followers: 0, reviews: [], media: [] },
  COMMBY: {},
};
// Prestadores cargados (en vivo, los que trae la base; en el modo demo, además, los de ejemplo).
export const P = [];



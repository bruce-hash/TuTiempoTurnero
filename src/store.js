// Datos en memoria que comparten los módulos (antes eran variables globales `let` del script único).
// Cada módulo los lee y los reasigna como store.X. Los valores iniciales se cargan en el módulo de cada uno.
export const store = {
  // 12/11: cuántas veces se tocó la lista de avisos del cliente en pantalla (leídos, borrados): una respuesta de
  // my_messages pedida antes de un cambio no lo pisa (api/live/admin.js, myMessages)
  INBOX_EDIT: 0,
  // de qué cuenta son los avisos de S.inbox
  INBOX_FOR: null,
  // en producción arrancan vacíos; en el modo demo los carga src/demo/estado.js
  // 4/11: quienes siguen al prestador (Clientes → Seguidores); null hasta que se piden
  FOLLOWERS: null,
  // D45: Clientes → Bloqueados ({id, name, photo, since, client})
  BLOCKED: [],
  COMM: { followers: 0, reviews: [], media: [] },
  COMMBY: {},
};
// Prestadores cargados (en vivo, los que trae la base; en el modo demo, además, los de ejemplo).
export const P = [];



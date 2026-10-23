import { cfg, nextFree } from "../lib/turnero.js";
import { S } from "../state.js";

// datos de la tarjeta de un prestador en el listado: precio desde, próximo horario y happy hour.
// En vivo vienen precalculados en prov.card por rubro; en la demo se calculan acá.
export function cardInfo(prov, cat) {
  if (prov.card && prov.card[S.cat || "todos"]) {
    const card = prov.card[S.cat || "todos"];
    return {
      min: card.min,
      minName: card.minName,
      happy: card.happy,
      next: card.next,
      multi: prov.svcs.length > 1 || !!card.minName,
    };
  }
  const ofCat = prov.svcs.filter((svc) => svc[3] === cat);
  const pool = ofCat.length ? ofCat : prov.svcs;
  if (!pool.length) {
    return {
      min: 0,
      minName: "",
      happy: 0,
      next: null,
    };
  }
  const cheapest = pool.reduce((best, svc) => (svc[2] < best[2] ? svc : best), pool[0]);
  const next = nextFree(prov.id, cheapest[1]);
  const conf = cfg(prov.id);
  return {
    min: cheapest[2],
    minName: cheapest[0],
    happy: conf.on && conf.happy.on ? conf.happy.pct : 0,
    next: next,
    multi: pool.length > 1,
  };
}

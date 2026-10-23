import { TODAY, addDays, dkey } from "./fechas.js";
import { pr } from "./prestadores.js";
import { RUBRO } from "./rubros.js";
import { S } from "../state.js";
import { store } from "../store.js";

// Retoque sugerido (días), indicación previa y adicionales de ejemplo de algunos servicios, por nombre.
const META = {
  "Corte premium": [
    21,
    "",
    [
      ["Lavado con masaje capilar", 3e3, 10],
      ["Barba con toalla caliente", 4e3, 15],
    ],
  ],
  "Arreglo de barba": [14, "", [["Toalla caliente", 1500, 5]]],
  "Barba con toalla caliente": [14, "", [["Aceite y bálsamo", 1500, 0]]],
  "Corte y brushing": [45, "", null],
  "Lifting de pestañas": [
    42,
    "Vení sin maquillaje en los ojos. No mojes las pestañas por 24 h después.",
    [
      ["Tinte de pestañas", 3500, 10],
      ["Laminado de cejas", 9e3, 30],
    ],
  ],
  "Volumen ruso": [21, null, null],
  "Pedicura spa": [
    30,
    "Vení con calzado abierto si te hacés semipermanente.",
    [
      ["Semipermanente en pies", 3500, 20],
      ["Parafina", 3e3, 10],
    ],
  ],
  "Kapping gel": [21, null, null],
  "Drenaje linfático": [7, "Tomá agua antes y después de la sesión.", [["Presoterapia", 5e3, 20]]],
  "Depilación de cejas": [21, "", [["Perfilado con hilo", 1500, 10]]],
  "Láser diodo · axilas": [
    42,
    "Rasurá 24 h antes. No tomes sol 15 días antes ni después.",
    [
      ["Bozo con láser", 3e3, 10],
      ["Cavado con láser", 8e3, 15],
    ],
  ],
  "Depilación definitiva · sesión": [
    42,
    "Rasurá 24 h antes. No tomes sol 15 días antes ni después.",
    [["Zona extra", 6e3, 15]],
  ],
};
// Cada servicio es [nombre, minutos, precio, rubro, id, meta]; meta = { every, note, add } se completa la primera vez
// con lo del servicio o, si no tiene, con lo de su rubro.
export function svcMeta(svc) {
  if (svc[5]) {
    return svc[5];
  }
  const rubro = RUBRO[svc[3]] || RUBRO.b;
  const meta = META[svc[0]] || [];
  svc[5] = {
    every: meta[0] ?? rubro.every,
    note: meta[1] ?? rubro.note,
    add: (meta[2] || rubro.add).map((addon) => addon.slice(0, 3).concat([null])),
  };
  return svc[5];
}
const rq = (cat) => (RUBRO[cat] || RUBRO.b).q;
// Adicionales elegidos (S.adds) del servicio seleccionado (S.svc), y su precio y duración totales.
export function selAdds(prov) {
  const svc = prov && prov.svcs[S.svc];
  if (!svc) {
    return [];
  }
  const addons = svcMeta(svc).add;
  return (S.adds || []).filter((idx) => addons[idx]).map((idx) => addons[idx]);
}
export const selPrice = (prov) => {
  const svc = prov.svcs[S.svc];
  if (svc) {
    return svc[2] + selAdds(prov).reduce((sum, addon) => sum + addon[1], 0);
  } else {
    return 0;
  }
};
export const selDur = (prov) => {
  const svc = prov.svcs[S.svc];
  if (svc) {
    return svc[1] + selAdds(prov).reduce((sum, addon) => sum + addon[2], 0);
  } else {
    return 30;
  }
};
// Turnos ya hechos cuyo retoque vence en los próximos 7 días (o ya venció), sin otro turno reservado con ese prestador.
function dueRetouches() {
  if (!S.user) {
    return [];
  }
  const today = TODAY();
  const due = [];
  const seen = {};
  store.BOOK.filter((booking) => booking.mine && booking.status === "done")
    .sort((left, right) => (right.date + right.time).localeCompare(left.date + left.time))
    .forEach((booking) => {
      const key = booking.pid + "|" + booking.svc;
      if (seen[key]) {
        return;
      }
      seen[key] = 1;
      const prov = pr(booking.pid);
      if (!prov || prov.deleted) {
        return;
      }
      const svc = prov.svcs.find((item) => item[0] === booking.svc);
      const every = svc ? svcMeta(svc).every : booking.every || 0;
      if (!every) {
        return;
      }
      const dueDate = dkey(addDays(every, booking.date));
      if (
        dueDate <= dkey(addDays(7)) &&
        !store.BOOK.some((other) => other.mine && other.pid == booking.pid && other.status === "confirmed" && other.date >= today)
      ) {
        due.push({
          b: booking,
          p: prov,
          due: dueDate < today ? today : dueDate,
          late: dueDate < today,
        });
      }
    });
  return due;
}
export const PREP = (cat, svc) => (svc ? svcMeta(svc).note : "");
// Avisos para el prestador según las respuestas previas del cliente.
function intakeAlerts(cat, answers) {
  const alerts = [];
  if (answers) {
    if (cat === "l" && answers.primera === "Sí") {
      alerts.push("Primera vez: hacé la prueba de alergia al adhesivo");
    }
    if (cat === "m" && answers.embarazo === "Sí") {
      alerts.push("Embarazada: adaptá posición y técnica");
    }
    if (cat === "d" && answers.sol === "Sí") {
      alerts.push("Tomó sol hace poco: no hacer láser");
    }
    if (cat === "d" && answers.medica && answers.medica !== "No") {
      alerts.push("Revisar medicación antes del láser");
    }
    if (cat === "p" && answers.alergia === "Sí") {
      alerts.push("Alergia a tintes: hacer prueba de mechón 48 h antes");
    }
    if (cat === "l" && answers.sensible === "Sí") {
      alerts.push("Ojos sensibles: usar adhesivo para piel sensible");
    }
  }
  return alerts;
}

import { TODAY, addDays, dkey } from "./fechas.js";
import { pr } from "./prestadores.js";
import { RUBRO } from "./rubros.js";
import { S } from "../state.js";
import { store } from "../store.js";

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
export function svcMeta(e) {
  if (e[5]) {
    return e[5];
  }
  const a = RUBRO[e[3]] || RUBRO.b;
  const t = META[e[0]] || [];
  e[5] = {
    every: t[0] ?? a.every,
    note: t[1] ?? a.note,
    add: (t[2] || a.add).map((s) => s.slice(0, 3).concat([null])),
  };
  return e[5];
}
const rq = (e) => (RUBRO[e] || RUBRO.b).q;
export function selAdds(e) {
  const a = e && e.svcs[S.svc];
  if (!a) {
    return [];
  }
  const t = svcMeta(a).add;
  return (S.adds || []).filter((s) => t[s]).map((s) => t[s]);
}
export const selPrice = (e) => {
  const a = e.svcs[S.svc];
  if (a) {
    return a[2] + selAdds(e).reduce((t, s) => t + s[1], 0);
  } else {
    return 0;
  }
};
export const selDur = (e) => {
  const a = e.svcs[S.svc];
  if (a) {
    return a[1] + selAdds(e).reduce((t, s) => t + s[2], 0);
  } else {
    return 30;
  }
};
function dueRetouches() {
  if (!S.user) {
    return [];
  }
  const e = TODAY();
  const a = [];
  const t = {};
  store.BOOK.filter((s) => s.mine && s.status === "done")
    .sort((s, n) => (n.date + n.time).localeCompare(s.date + s.time))
    .forEach((s) => {
      const n = s.pid + "|" + s.svc;
      if (t[n]) {
        return;
      }
      t[n] = 1;
      const o = pr(s.pid);
      if (!o || o.deleted) {
        return;
      }
      const i = o.svcs.find((d) => d[0] === s.svc);
      const l = i ? svcMeta(i).every : s.every || 0;
      if (!l) {
        return;
      }
      const c = dkey(addDays(l, s.date));
      if (
        c <= dkey(addDays(7)) &&
        !store.BOOK.some((d) => d.mine && d.pid == s.pid && d.status === "confirmed" && d.date >= e)
      ) {
        a.push({
          b: s,
          p: o,
          due: c < e ? e : c,
          late: c < e,
        });
      }
    });
  return a;
}
export const PREP = (e, a) => (a ? svcMeta(a).note : "");
function intakeAlerts(cat, a) {
  const t = [];
  if (a) {
    if (cat === "l" && a.primera === "Sí") {
      t.push("Primera vez: hacé la prueba de alergia al adhesivo");
    }
    if (cat === "m" && a.embarazo === "Sí") {
      t.push("Embarazada: adaptá posición y técnica");
    }
    if (cat === "d" && a.sol === "Sí") {
      t.push("Tomó sol hace poco: no hacer láser");
    }
    if (cat === "d" && a.medica && a.medica !== "No") {
      t.push("Revisar medicación antes del láser");
    }
    if (cat === "p" && a.alergia === "Sí") {
      t.push("Alergia a tintes: hacer prueba de mechón 48 h antes");
    }
    if (cat === "l" && a.sensible === "Sí") {
      t.push("Ojos sensibles: usar adhesivo para piel sensible");
    }
  }
  return t;
}

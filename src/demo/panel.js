import { feeFor } from "../lib/dinero.js";
import { addDays, dkey, prevMonthDay } from "../lib/fechas.js";
import { store } from "../store.js";
import { MSG_DEF } from "../views/prestador/mensajes.js";
import { demoClosings } from "../views/prestador/panel.js";

export function seedFees() {
  store.BOOK.forEach((e) => {
    if (e.src === "app" && e.type !== "block" && e.fee == null && (e.paid || 0) > 0) {
      e.fee = feeFor(e.price);
    }
  });
}
export function seedExtra() {
  store.GID = 1;
  store.MSGS = MSG_DEF();
  store.PRODS = [
    {
      n: "Pomada mate",
      p: 9e3,
      stock: 6,
      min: 3,
    },
    {
      n: "Cera brillo",
      p: 7500,
      stock: 2,
      min: 3,
    },
    {
      n: "Aceite para barba",
      p: 8500,
      stock: 5,
      min: 2,
    },
    {
      n: "Shampoo anticaspa",
      p: 11e3,
      stock: 4,
      min: 2,
    },
  ];
  Object.entries({
    "Pablo M.": {
      last: 13,
      spend: 9500,
      tel: "2284 512301",
      notes: "Fade 1 a los costados, tijera arriba. Prefiere la mañana.",
      bday: "03-22",
    },
    "Ezequiel R.": {
      last: 21,
      spend: 12500,
      tel: "2284 448122",
      notes: "Barba perfilada, sin degradé.",
      bday: "10-28",
    },
    "Sergio L.": {
      last: 30,
      spend: 1e4,
      tel: "2284 600913",
      notes: "Faltó 2 veces sin avisar.",
      bday: "",
    },
    "Tomás V.": {
      last: 40,
      spend: 12500,
      tel: "2284 555091",
      notes: "",
      bday: "10-19",
    },
    "Ana B. (para su hijo)": {
      last: 28,
      spend: 1e4,
      tel: "2284 701442",
      notes: "El nene tiene 7 años. Corte con máquina 3.",
      bday: "",
    },
    "Raúl F.": {
      last: 21,
      spend: 1e4,
      tel: "2284 433210",
      notes: "Corte clásico con tijera. Viene con el nieto.",
      bday: "12-02",
    },
    "Nicolás D.": {
      last: 35,
      spend: 6e3,
      tel: "2284 512777",
      notes: "",
      bday: "",
    },
    "Federico A.": {
      last: 14,
      spend: 12500,
      tel: "2284 489321",
      notes: "Raya al costado izquierdo.",
      bday: "",
    },
    "Hernán S.": {
      last: null,
      spend: 0,
      tel: "2284 590044",
      notes: "Cliente nuevo, vino por Instagram.",
      bday: "",
    },
    "Gonzalo T.": {
      last: 25,
      spend: 1e4,
      tel: "2284 455102",
      notes: "",
      bday: "10-30",
    },
    "Marcos D.": {
      v: 6,
      n: 0,
      last: 48,
      spend: 12500,
      tel: "2284 522908",
      notes: "Fade alto. Venía cada 3 semanas.",
      bday: "",
    },
    "Julián P.": {
      v: 9,
      n: 0,
      last: 62,
      spend: 1e4,
      tel: "2284 610277",
      notes: "Corte clásico con tijera.",
      bday: "11-05",
    },
    "Esteban R.": {
      v: 3,
      n: 1,
      last: 41,
      spend: 12500,
      tel: "2284 433890",
      notes: "",
      bday: "",
    },
  }).forEach(([a, t]) => {
    store.CLIENTS[a] = Object.assign(
      {
        v: 0,
        n: 0,
      },
      store.CLIENTS[a] || {},
      t,
    );
  });
  Object.keys(store.CLIENTS).forEach((a) => {
    const t = store.CLIENTS[a];
    if (t.last === void 0) {
      t.last = 7 + ((a.length * 13) % 20);
    }
    t.spend ||= 12500;
    t.tel ||= "2284 5" + String(1e4 + a.length * 731).slice(-5);
    if (t.notes === void 0) {
      t.notes = "";
    }
    if (t.bday === void 0) {
      t.bday = "";
    }
  });
  store.CLOSINGS = {};
  store.FIN = [];
  for (let a = 29; a >= 1; a--) {
    const t = dkey(addDays(-a));
    const s = /* @__PURE__ */ new Date(t + "T12:00:00").getDay();
    const n = ((a * 37) % 11) / 10;
    if (s === 0) {
      store.FIN.push({
        date: t,
        app: 0,
        man: 0,
        walk: 0,
        prod: 0,
      });
      continue;
    }
    const o = s === 6 ? 0.55 : s === 5 ? 1.25 : 1;
    store.FIN.push({
      date: t,
      app: Math.round(((22e3 + n * 18e3) * o) / 100) * 100,
      man: Math.round(((15e3 + n * 9e3) * o) / 100) * 100,
      walk: Math.round(((12e3 + (1 - n) * 15e3) * o) / 100) * 100,
      prod: a % 3 === 0 ? 9e3 : 0,
    });
  }
  store.CLOSINGS = demoClosings(store.FIN);
  store.GASTOS = [
    {
      id: store.GID++,
      c: "Alquiler del local",
      m: 18e4,
      cat: "Alquiler",
      d: prevMonthDay(5),
    },
    {
      id: store.GID++,
      c: "Luz",
      m: 21e3,
      cat: "Servicios",
      d: prevMonthDay(8),
    },
    {
      id: store.GID++,
      c: "Internet",
      m: 15e3,
      cat: "Servicios",
      d: prevMonthDay(8),
    },
    {
      id: store.GID++,
      c: "Alquiler del local",
      m: 18e4,
      cat: "Alquiler",
      d: dkey(addDays(-12)),
    },
    {
      id: store.GID++,
      c: "Productos (distribuidora)",
      m: 45e3,
      cat: "Productos",
      d: dkey(addDays(-6)),
    },
    {
      id: store.GID++,
      c: "Luz",
      m: 22e3,
      cat: "Servicios",
      d: dkey(addDays(-3)),
    },
    {
      id: store.GID++,
      c: "Hojas y navajas",
      m: 8500,
      cat: "Insumos",
      d: dkey(addDays(-1)),
    },
  ];
}

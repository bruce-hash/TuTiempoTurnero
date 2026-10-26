import { feeFor } from "../lib/dinero.js";
import { TODAY, addDays, dkey, prevMonthDay } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { RUBRO, catName } from "../lib/rubros.js";
import { store } from "../store.js";
import { MSG_DEF } from "../views/prestador/mensajes.js";

// cierres de caja de ejemplo: todos los días del mes con movimientos, menos los dos últimos
export function demoClosings(fin) {
  const closings = {};
  const today = TODAY();
  const days = fin.filter(
    (day) => day.date.slice(0, 7) === today.slice(0, 7) && day.date < today && day.app + day.man + day.walk + day.prod > 0,
  );
  days.slice(0, Math.max(0, days.length - 2)).forEach((day) => {
    const income = day.app + day.man + day.walk + day.prod;
    closings["day|" + day.date] = {
      income: income,
      cash: Math.round(income * 0.55),
      mp: income - Math.round(income * 0.55),
      counted: null,
      at: "21:0" + (day.date.slice(-1) % 10),
    };
  });
  return closings;
}
// datos de ejemplo del panel de un prestador (clientes, últimos 29 días de finanzas, productos, gastos, avisos).
// Solo la demo (H14): en vivo el panel arranca vacío y lo llena la base.
export function seedStore(pid) {
  const clients = {};
  store.BOOK.filter((booking) => booking.pid == pid && booking.cliente && booking.type !== "block").forEach((booking, index) => {
    clients[booking.cliente] = {
      v: 2 + (index % 5),
      n: 0,
      last: 7 + index * 3,
      spend: booking.price,
      tel: "2284 4" + String(1e4 + index * 731).slice(-5),
      notes: "",
      bday: "",
    };
  });
  const fin = [];
  for (let daysAgo = 29; daysAgo >= 1; daysAgo--) {
    const date = dkey(addDays(-daysAgo));
    const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
    const factor = ((daysAgo * pid) % 11) / 10;
    fin.push(
      dow === 0
        ? {
            date: date,
            app: 0,
            man: 0,
            walk: 0,
            prod: 0,
          }
        : {
            date: date,
            app: Math.round((18e3 + factor * 15e3) / 100) * 100,
            man: Math.round((9e3 + factor * 7e3) / 100) * 100,
            walk: Math.round((6e3 + (1 - factor) * 9e3) / 100) * 100,
            prod: daysAgo % 4 === 0 ? 6e3 : 0,
          },
    );
  }
  const cat = (
    pr(pid) || {
      cats: ["b"],
    }
  ).cats[0];
  const rubro = RUBRO[cat] || RUBRO.b;
  const profileByCat = {
    b: {
      corte: "Fade 1 a los costados, tijera arriba",
      barba: "Perfilada, sin degradé",
    },
    p: {
      formula: "Koleston 7.1 + oxidante 20 vol",
      tecnica: "Balayage, corte en capas",
    },
    m: {
      presion: "Fuerte",
      zonas: "Trabajar cervicales; evitar lumbar",
      salud: "Contractura crónica en hombros",
    },
    l: {
      mapa: "Ojo de gato · C · 9-12 mm",
      adhesivo: "Sensitive, sin molestias",
    },
    u: {
      forma: "Almendra media",
      colores: "Nudes y rojo",
      unas: "Cutículas secas",
    },
    d: {
      fototipo: "III",
      zonas: "Piernas completas · sesión 3 de 8",
      reacciones: "Leve enrojecimiento",
    },
  };
  Object.keys(clients)
    .slice(0, 2)
    .forEach((name) => {
      clients[name].profile = Object.assign({}, profileByCat[cat] || {});
      clients[name].notes = "";
    });
  return {
    CLOSINGS: demoClosings(fin),
    CLIENTS: clients,
    PRODS: rubro.prods.map((row) => ({
      n: row[0],
      p: row[1],
      stock: row[2],
      min: row[3],
    })),
    GASTOS: [
      {
        id: store.GID++,
        c: "Alquiler",
        m: 12e4,
        cat: "Alquiler",
        d: dkey(addDays(-10)),
      },
      {
        id: store.GID++,
        c: "Insumos de " + catName(cat).toLowerCase(),
        m: 35e3,
        cat: "Insumos",
        d: dkey(addDays(-4)),
      },
    ],
    FIN: fin,
    MSGS: MSG_DEF(cat),
    walk: [],
    earn: 0,
    jobs: 0,
    mp: "none",
  };
}

// comisión de los turnos de ejemplo pagados por la app, para que las finanzas y el admin la descuenten
export function seedFees() {
  store.BOOK.forEach((booking) => {
    if (booking.src === "app" && booking.type !== "block" && booking.fee == null && (booking.paid || 0) > 0) {
      booking.fee = feeFor(booking.price);
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
  }).forEach(([name, data]) => {
    store.CLIENTS[name] = Object.assign(
      {
        v: 0,
        n: 0,
      },
      store.CLIENTS[name] || {},
      data,
    );
  });
  Object.keys(store.CLIENTS).forEach((name) => {
    const client = store.CLIENTS[name];
    if (client.last === void 0) {
      client.last = 7 + ((name.length * 13) % 20);
    }
    client.spend ||= 12500;
    client.tel ||= "2284 5" + String(1e4 + name.length * 731).slice(-5);
    if (client.notes === void 0) {
      client.notes = "";
    }
    if (client.bday === void 0) {
      client.bday = "";
    }
  });
  store.CLOSINGS = {};
  store.FIN = [];
  for (let daysAgo = 29; daysAgo >= 1; daysAgo--) {
    const date = dkey(addDays(-daysAgo));
    const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
    const factor = ((daysAgo * 37) % 11) / 10;
    if (dow === 0) {
      store.FIN.push({
        date: date,
        app: 0,
        man: 0,
        walk: 0,
        prod: 0,
      });
      continue;
    }
    const dayFactor = dow === 6 ? 0.55 : dow === 5 ? 1.25 : 1;
    store.FIN.push({
      date: date,
      app: Math.round(((22e3 + factor * 18e3) * dayFactor) / 100) * 100,
      man: Math.round(((15e3 + factor * 9e3) * dayFactor) / 100) * 100,
      walk: Math.round(((12e3 + (1 - factor) * 15e3) * dayFactor) / 100) * 100,
      prod: daysAgo % 3 === 0 ? 9e3 : 0,
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

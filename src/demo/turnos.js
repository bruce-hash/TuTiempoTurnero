import { TODAY, addDays, dkey } from "../lib/fechas.js";
import { P, store } from "../store.js";

export function seedTurnos() {
  store.CFGS = {};
  store.WAIT = [];
  store.BID = 1;
  store.SID = 1;
  store.BOOK = [];
  store.CLIENTS = {
    "Pablo M.": {
      v: 12,
      n: 0,
    },
    "Ezequiel R.": {
      v: 3,
      n: 0,
    },
    "Sergio L.": {
      v: 4,
      n: 2,
    },
    "Tomás V.": {
      v: 1,
      n: 0,
    },
    "Ana B. (para su hijo)": {
      v: 6,
      n: 0,
    },
    "Raúl F.": {
      v: 9,
      n: 0,
    },
    "Nicolás D.": {
      v: 2,
      n: 1,
    },
    "Federico A.": {
      v: 7,
      n: 0,
    },
    "Hernán S.": {
      v: 0,
      n: 0,
    },
    "Gonzalo T.": {
      v: 5,
      n: 0,
    },
  };
  const e = TODAY();
  const a = dkey(addDays(1));
  const t = dkey(addDays(2));
  const s = dkey(addDays(3));
  const n = (d, p, w, y, k, h, j, b, g) =>
    store.BOOK.push(
      Object.assign(
        {
          id: store.BID++,
          pid: 7,
          date: d,
          time: p,
          dur: w,
          svc: y,
          price: k,
          cliente: h,
          src: j,
          type: b || "local",
          status: "confirmed",
          paid: j === "app" ? Math.round(k * 0.5) : 0,
          att: false,
          late: 0,
          disc: 0,
        },
        g || {},
      ),
    );
  n(e, "10:00", 25, "Corte de cabello", 8e3, "Pablo M.", "app", "local", {
    att: true,
    disc: 20,
  });
  n(e, "11:30", 30, "Corte de cabello y barba", 12500, "Ezequiel R.", "manual", "local", {
    att: true,
  });
  n(e, "17:00", 25, "Corte de cabello", 1e4, "Sergio L.", "app", "local", {
    paid: 1e4,
  });
  n(e, "18:00", 30, "Corte de cabello y barba", 12500, "Tomás V.", "app", "local", {
    att: true,
  });
  n(e, "19:30", 25, "Corte de cabello", 1e4, "Ana B. (para su hijo)", "app", "local", {
    att: true,
  });
  n(a, "09:30", 25, "Corte de cabello", 1e4, "Raúl F.", "app", "local", {
    att: true,
  });
  n(a, "16:00", 15, "Arreglo de barba", 6e3, "Nicolás D.", "app");
  n(a, "18:30", 30, "Corte de cabello y barba", 12500, "Federico A.", "manual", "local", {
    att: true,
  });
  n(t, "10:00", 30, "Corte de cabello y barba", 1e4, "Hernán S.", "app", "local", {
    disc: 20,
  });
  n(s, "18:00", 25, "Corte de cabello", 1e4, "Gonzalo T.", "app");
  ["17:00", "17:30", "18:00", "19:00", "19:30", "20:00", "20:30"].forEach((d, p) => {
    const w = ["Lucas", "Matías", "Bruno", "Iván", "Leo", "Nahuel", "Franco"][p] + " " + "ABCDEFG"[p] + ".";
    store.CLIENTS[w] = {
      v: 2 + p,
      n: 0,
    };
    n(a, d, 30, "Corte de cabello y barba", 12500, w, "app", "local", {
      att: p % 2 === 0,
    });
  });
  const o = (d, p, w, y, k, h, j, b) =>
    store.BOOK.push({
      id: store.BID++,
      pid: d,
      date: p,
      time: w,
      dur: y,
      svc: k,
      price: h,
      cliente: j,
      src: b,
      type: "local",
      status: "confirmed",
      paid: b === "app" ? Math.round(h * 0.5) : 0,
      att: b === "app",
      late: 0,
      disc: 0,
    });
  o(21, e, "10:00", 120, "Extensiones pelo a pelo", 3e4, "Valentina R.", "app");
  store.BOOK[store.BOOK.length - 1].intake = {
    primera: "Sí",
    estilo: "Ojo de gato",
    sensible: "No",
  };
  o(21, e, "15:00", 60, "Esmaltado semipermanente", 12e3, "Camila S.", "app");
  o(21, e, "16:30", 20, "Depilación de cejas", 4500, "Julieta M.", "manual");
  o(21, a, "09:00", 90, "Uñas esculpidas", 18e3, "Rocío P.", "app");
  store.BOOK[store.BOOK.length - 1].intake = {
    forma: "Coffin",
    largo: "Largo",
    diseno: "Baby boomer",
  };
  store.BOOK[store.BOOK.length - 1].addons = [["Retiro de esculpidas", 4e3, 30]];
  o(21, a, "17:00", 60, "Lifting de pestañas", 15e3, "Martina G.", "app");
  o(22, a, "10:00", 60, "Masaje descontracturante", 2e4, "Laura B.", "app");
  o(22, t, "18:00", 75, "Piedras calientes", 24e3, "Graciela F.", "app");
  const i = [
    "Micaela T.",
    "Agustina L.",
    "Paula R.",
    "Sol M.",
    "Lorena V.",
    "Franco D.",
    "Gustavo P.",
    "Brenda S.",
    "Natalia C.",
    "Cecilia H.",
    "Romina A.",
    "Javier O.",
  ];
  const l = {
    b: {
      estilo: "Fade",
    },
    p: {
      largo: "Largo",
      color: "Sí, de más de 2 meses",
      alergia: "No",
    },
    m: {
      presion: "Media",
      zona: "Hombro derecho",
      embarazo: "No",
    },
    l: {
      primera: "Sí",
      estilo: "Natural",
      sensible: "No",
    },
    u: {
      forma: "Almendra",
      largo: "Medio",
      diseno: "Nude con brillo",
    },
    d: {
      sol: "No",
      piel: "Clara",
      medica: "No",
    },
  };
  P.filter((d) => ![7, 21].includes(d.id)).forEach((d, p) => {
    d.svcs.slice(0, 3).forEach((w, y) => {
      const k = [e, a, t][y];
      const h = ["10:00", "16:00", "18:00"][(p + y) % 3];
      if (!store.BOOK.some((j) => j.pid === d.id && j.date === k && j.time === h)) {
        store.BOOK.push({
          id: store.BID++,
          pid: d.id,
          date: k,
          time: h,
          dur: w[1],
          svc: w[0],
          price: w[2],
          cliente: i[(p * 3 + y) % i.length],
          src: y === 1 ? "manual" : "app",
          type: "local",
          status: "confirmed",
          paid: y === 1 ? 0 : Math.round(w[2] * 0.5),
          att: y !== 2,
          late: 0,
          disc: 0,
          cat: w[3],
          intake: l[w[3]] || {},
        });
      }
    });
  });
  const c = (d, p, w, y, k) =>
    store.BOOK.push({
      id: store.BID++,
      pid: p,
      date: dkey(addDays(-d)),
      time: "17:00",
      dur: 60,
      svc: w,
      price: y,
      cliente: "Juan P.",
      src: "app",
      type: "local",
      status: "done",
      paid: Math.round(y * 0.5),
      mine: true,
      att: true,
      late: 0,
      disc: 0,
      cat: k,
    });
  c(19, 21, "Esmaltado semipermanente", 12e3, "u");
  c(26, 7, "Corte de cabello", 1e4, "b");
  c(40, 22, "Masaje relajante", 17e3, "m");
}

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
  const today = TODAY();
  const tomorrow = dkey(addDays(1));
  const in2 = dkey(addDays(2));
  const in3 = dkey(addDays(3));
  // turno de ejemplo en Hidro.Style (prestador 7); los de la app pagaron la seña del 50 %
  const addHidro = (date, time, dur, svc, price, client, src, type, extra) =>
    store.BOOK.push(
      Object.assign(
        {
          id: store.BID++,
          pid: 7,
          date: date,
          time: time,
          dur: dur,
          svc: svc,
          price: price,
          cliente: client,
          src: src,
          type: type || "local",
          status: "confirmed",
          paid: src === "app" ? Math.round(price * 0.5) : 0,
          att: false,
          late: 0,
          disc: 0,
        },
        extra || {},
      ),
    );
  addHidro(today, "10:00", 25, "Corte de cabello", 8e3, "Pablo M.", "app", "local", {
    att: true,
    disc: 20,
  });
  addHidro(today, "11:30", 30, "Corte de cabello y barba", 12500, "Ezequiel R.", "manual", "local", {
    att: true,
  });
  addHidro(today, "17:00", 25, "Corte de cabello", 1e4, "Sergio L.", "app", "local", {
    paid: 1e4,
  });
  addHidro(today, "18:00", 30, "Corte de cabello y barba", 12500, "Tomás V.", "app", "local", {
    att: true,
  });
  addHidro(today, "19:30", 25, "Corte de cabello", 1e4, "Ana B. (para su hijo)", "app", "local", {
    att: true,
  });
  addHidro(tomorrow, "09:30", 25, "Corte de cabello", 1e4, "Raúl F.", "app", "local", {
    att: true,
  });
  addHidro(tomorrow, "16:00", 15, "Arreglo de barba", 6e3, "Nicolás D.", "app");
  addHidro(tomorrow, "18:30", 30, "Corte de cabello y barba", 12500, "Federico A.", "manual", "local", {
    att: true,
  });
  addHidro(in2, "10:00", 30, "Corte de cabello y barba", 1e4, "Hernán S.", "app", "local", {
    disc: 20,
  });
  addHidro(in3, "18:00", 25, "Corte de cabello", 1e4, "Gonzalo T.", "app");
  ["17:00", "17:30", "18:00", "19:00", "19:30", "20:00", "20:30"].forEach((time, index) => {
    const name = ["Lucas", "Matías", "Bruno", "Iván", "Leo", "Nahuel", "Franco"][index] + " " + "ABCDEFG"[index] + ".";
    store.CLIENTS[name] = {
      v: 2 + index,
      n: 0,
    };
    addHidro(tomorrow, time, 30, "Corte de cabello y barba", 12500, name, "app", "local", {
      att: index % 2 === 0,
    });
  });
  const addOther = (pid, date, time, dur, svc, price, client, src) =>
    store.BOOK.push({
      id: store.BID++,
      pid: pid,
      date: date,
      time: time,
      dur: dur,
      svc: svc,
      price: price,
      cliente: client,
      src: src,
      type: "local",
      status: "confirmed",
      paid: src === "app" ? Math.round(price * 0.5) : 0,
      att: src === "app",
      late: 0,
      disc: 0,
    });
  addOther(21, today, "10:00", 120, "Extensiones pelo a pelo", 3e4, "Valentina R.", "app");
  store.BOOK[store.BOOK.length - 1].intake = {
    primera: "Sí",
    estilo: "Ojo de gato",
    sensible: "No",
  };
  addOther(21, today, "15:00", 60, "Esmaltado semipermanente", 12e3, "Camila S.", "app");
  addOther(21, today, "16:30", 20, "Depilación de cejas", 4500, "Julieta M.", "manual");
  addOther(21, tomorrow, "09:00", 90, "Uñas esculpidas", 18e3, "Rocío P.", "app");
  store.BOOK[store.BOOK.length - 1].intake = {
    forma: "Coffin",
    largo: "Largo",
    diseno: "Baby boomer",
  };
  store.BOOK[store.BOOK.length - 1].addons = [["Retiro de esculpidas", 4e3, 30]];
  addOther(21, tomorrow, "17:00", 60, "Lifting de pestañas", 15e3, "Martina G.", "app");
  addOther(22, tomorrow, "10:00", 60, "Masaje descontracturante", 2e4, "Laura B.", "app");
  addOther(22, in2, "18:00", 75, "Piedras calientes", 24e3, "Graciela F.", "app");
  const names = [
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
  const intakeByCat = {
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
  P.filter((prov) => ![7, 21].includes(prov.id)).forEach((prov, provIndex) => {
    prov.svcs.slice(0, 3).forEach((svc, svcIndex) => {
      const date = [today, tomorrow, in2][svcIndex];
      const time = ["10:00", "16:00", "18:00"][(provIndex + svcIndex) % 3];
      if (!store.BOOK.some((item) => item.pid === prov.id && item.date === date && item.time === time)) {
        store.BOOK.push({
          id: store.BID++,
          pid: prov.id,
          date: date,
          time: time,
          dur: svc[1],
          svc: svc[0],
          price: svc[2],
          cliente: names[(provIndex * 3 + svcIndex) % names.length],
          src: svcIndex === 1 ? "manual" : "app",
          type: "local",
          status: "confirmed",
          paid: svcIndex === 1 ? 0 : Math.round(svc[2] * 0.5),
          att: svcIndex !== 2,
          late: 0,
          disc: 0,
          cat: svc[3],
          intake: intakeByCat[svc[3]] || {},
        });
      }
    });
  });
  // turnos pasados del cliente de ejemplo (Juan P.), para su historial y sus sellos
  const addMine = (daysAgo, pid, svc, price, extra) =>
    store.BOOK.push({
      id: store.BID++,
      pid: pid,
      date: dkey(addDays(-daysAgo)),
      time: "17:00",
      dur: 60,
      svc: svc,
      price: price,
      cliente: "Juan P.",
      src: "app",
      type: "local",
      status: "done",
      paid: Math.round(price * 0.5),
      mine: true,
      att: true,
      late: 0,
      disc: 0,
      cat: extra,
    });
  addMine(19, 21, "Esmaltado semipermanente", 12e3, "u");
  addMine(26, 7, "Corte de cabello", 1e4, "b");
  addMine(40, 22, "Masaje relajante", 17e3, "m");
}

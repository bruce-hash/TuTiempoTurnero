import { S } from "../state.js";
import { store } from "../store.js";

export const demoUsers0 = () => ({
  "juan.perez@gmail.com": {
    name: "Juan Pérez",
    pass: "cliente123",
    tel: "2284 555123",
  },
});
export const demoInbox0 = () => [
  {
    id: 1,
    pid: 22,
    name: "Espacio Calma",
    hue: 150,
    body: "¡Hola Juan! Esta semana tenemos 15% off en masajes descontracturantes. ¿Te reservo un lugar?",
    d: "hace 2 días",
    read: false,
  },
];
export const demoStamps0 = () => ({
  7: {
    "Juan P.": {
      "Corte de cabello": 14,
      "Corte de cabello y barba": 4,
    },
  },
  21: {
    "Juan P.": {
      "Esmaltado semipermanente": 6,
    },
  },
  22: {
    "Juan P.": {
      "Masaje relajante": 15,
    },
  },
});
export function demoStash() {
  store.DEMO_ST[store.DEMO_OWNER] = {
    wallet: S.wallet,
    wmov: S.wmov,
    followingBy: S.followingBy,
    tel: S.form.tel,
  };
  S.stashed = true;
}
export function demoSignIn(email, name) {
  email = String(email).toLowerCase();
  if (store.DEMO_OWNER !== email) {
    if (!S.stashed) {
      demoStash();
    }
    store.BOOK.forEach((booking) => {
      if (booking.mine) {
        booking.mine = false;
        booking.demoOwner = store.DEMO_OWNER;
      }
    });
    store.BOOK.forEach((booking) => {
      if (booking.demoOwner === email) {
        booking.mine = true;
        delete booking.demoOwner;
      }
    });
    store.DEMO_OWNER = email;
    store.DEMO_ST[email] ||= {
      wallet: 0,
      wmov: [],
      followingBy: {},
      tel: (store.DEMO_USERS[email] || {}).tel || "",
    };
  }
  const st = store.DEMO_ST[email];
  if (st) {
    S.wallet = st.wallet;
    S.wmov = st.wmov;
    S.followingBy = st.followingBy;
    S.form.tel = st.tel;
  }
  S.stashed = false;
  S.user = {
    name: name || (store.DEMO_USERS[email] || {}).name || email.split("@")[0],
    email: email,
    photo: (store.DEMO_USERS[email] || {}).photo || null,
  };
  S.inbox = email === "juan.perez@gmail.com" ? store.DEMO_INBOX : [];
  S.inboxSeen = false;
}

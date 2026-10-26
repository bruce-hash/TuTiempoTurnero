import { demoPending0 } from "./admin.js";
import { demoInbox0, demoStamps0, demoUsers0 } from "./usuarios.js";
import { store } from "../store.js";

store.COMM = {
  followers: 128,
  reviews: [
    {
      n: "Martín G.",
      s: 5,
      t: "Puntual y prolijo. Me consiguió turno el sábado y me salvó el casamiento.",
      d: "hace 2 días",
      reply: "",
    },
    {
      n: "Lucía R.",
      s: 5,
      t: "Le cortó a mi papá con mucha paciencia. Excelente trato.",
      d: "hace 1 semana",
      reply: "¡Gracias Lucía! Saludos a tu papá.",
    },
    {
      n: "Diego P.",
      s: 4,
      t: "Muy buen corte. Me atendió 10 minutos tarde pero avisó.",
      d: "hace 2 semanas",
      reply: "",
    },
  ],
  media: [
    {
      label: "Fade + barba",
      hue: 221,
    },
    {
      label: "Corte clásico",
      hue: 200,
    },
    {
      label: "Perfilado",
      hue: 245,
    },
    {
      label: "Antes / después",
      hue: 180,
      video: true,
    },
  ],
};
store.COMMBY = {
  7: store.COMM,
};
store.DEMO_PENDING = demoPending0();
store.DEMO_NOTES = {};
store.DEMO_AEXP = [];
store.DEMO_ACL = {};
store.AEID = 1;
store.NID = 1;
store.ADM_READY = false;
store.DEMO_USERS = demoUsers0();
store.DEMO_OWNER = "juan.perez@tutiempo.demo";
store.DEMO_ST = {};
store.DEMO_INBOX = demoInbox0();
store.DEMO_STAMPS = demoStamps0();

import { LIVE } from "../config.js";
import { demoPending0 } from "./admin.js";
import { seedExtra, seedFees } from "./panel.js";
import { seedTurnos } from "./turnos.js";
import { demoInbox0, demoStamps0, demoUsers0 } from "./usuarios.js";
import { $ } from "../lib/dom.js";
import { S, fresh } from "../state.js";
import { P, store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { STORE } from "../views/prestador/panel.js";

const P0 = JSON.stringify(P);
const COMM0 = JSON.stringify(store.COMM);
$("#reset").addEventListener("click", () => {
  if (!LIVE) {
    P.length = 0;
    JSON.parse(P0).forEach((e) => P.push(e));
    for (const e in STORE) {
      delete STORE[e];
    }
    resetState();
    store.DEMO_PENDING = demoPending0();
    store.ADM_READY = false;
    store.NID = 1;
    store.AEID = 1;
    store.COMISION = 0.1;
    store.DEMO_USERS = demoUsers0();
    store.DEMO_OWNER = "juan.perez@gmail.com";
    store.DEMO_ST = {};
    store.DEMO_INBOX = demoInbox0();
    store.DEMO_STAMPS = demoStamps0();
    seedTurnos();
    seedExtra();
    seedFees();
    store.COMM = JSON.parse(COMM0);
    store.COMMBY = {
      7: store.COMM,
    };
    render();
    window.scrollTo(0, 0);
    toast("Demo reiniciada");
  }
});

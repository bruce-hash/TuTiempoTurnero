import { DEMO_FEES, seedExtra, seedFees } from "./panel.js";
import { store } from "../store.js";
import { seedTurnos } from "./turnos.js";

store.FEES = DEMO_FEES();
seedTurnos();
seedExtra();
seedFees();

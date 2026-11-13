import { demoApi } from "./demo.js";
import { liveApi } from "./live/index.js";
// 13/11: las escrituras de api.m (Object.assign sobre liveApi.m). Van acá, después de live/index.js (que define liveApi.m),
// y no allá: si live/index.js las importara, correrían antes de que exista liveApi.m. Hasta el 11/11 entraban de rebote
// con src/ganchos-prueba.js; desde la división del código (que lo saca de producción) faltaban en dist/ (las pruebas usan
// el build de prueba, que sí lo trae). pruebas/sin_demo.mjs controla que estén.
import "./live/m-cliente.js";
import "./live/m-perfil.js";
import "./live/m-panel.js";
import "./live/m-admin.js";
import { LIVE } from "../config.js";

// En producción siempre liveApi (LIVE es true y la demo no viaja en el build).
export const api = LIVE ? liveApi : demoApi;

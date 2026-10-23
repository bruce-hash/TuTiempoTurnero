import { demoApi } from "./demo.js";
import { liveApi } from "./live/index.js";
import { LIVE } from "../config.js";

// En producción siempre liveApi (LIVE es true y la demo no viaja en el build).
export const api = LIVE ? liveApi : demoApi;

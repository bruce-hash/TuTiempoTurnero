import { demoApi } from "./demo.js";
import { liveApi } from "./live/index.js";
import { LIVE } from "../config.js";

export const api = LIVE ? liveApi : demoApi;

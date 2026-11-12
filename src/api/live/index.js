import { liveAdmin } from "./admin.js";
import { liveCuenta } from "./cuenta.js";
import { liveLectura } from "./lectura.js";
import { livePanel } from "./panel.js";

export const liveApi = {
  ...liveLectura,
  ...liveCuenta,
  ...liveAdmin,
  ...livePanel,
};
export const LM = liveApi.m;

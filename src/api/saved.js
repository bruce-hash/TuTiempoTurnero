import { liveApi } from "./live/index.js";
import { LIVE } from "../config.js";
import { errMsg } from "../lib/errores.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

export async function call(e) {
  const a = await e;
  if (a && a.error) {
    throw a.error;
  }
  if (a) {
    return a.data;
  } else {
    return null;
  }
}
export function saved(promise, okMsg) {
  if (LIVE) {
    return Promise.resolve(promise)
      .then((t) => {
        if (t && t.error) {
          throw t.error;
        }
        if (okMsg) {
          toast(okMsg);
        }
        return t && t.data;
      })
      .catch(async (t) => {
        toast("No se pudo guardar: " + errMsg(t));
        try {
          if (S.role === "barbero" && S.me) {
            await liveApi.loadMine();
          } else {
            await Promise.all([liveApi.myBookings(), liveApi.wallet()]);
          }
        } catch (s) {}
        render();
        throw Object.assign(new Error(errMsg(t)), {
          __shown: true,
        });
      });
  } else {
    return Promise.resolve();
  }
}

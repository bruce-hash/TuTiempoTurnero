import { liveApi } from "./live/index.js";
import { LIVE } from "../config.js";
import { errMsg } from "../lib/errores.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// Resultado de una consulta de Supabase: los datos, o el error como excepción.
export async function call(query) {
  const res = await query;
  if (res && res.error) {
    throw res.error;
  }
  if (res) {
    return res.data;
  } else {
    return null;
  }
}
// Toda escritura pasa por acá (api.m.*). En vivo: avisa si se guardó; si falló, avisa, vuelve a cargar los datos de la
// base para no mostrar algo que no se guardó y corta la cadena (con __shown, para no avisar dos veces). En la demo no
// hay nada que guardar.
export function saved(promise, okMsg) {
  if (LIVE) {
    return Promise.resolve(promise)
      .then((res) => {
        if (res && res.error) {
          throw res.error;
        }
        if (okMsg) {
          toast(okMsg);
        }
        return res && res.data;
      })
      .catch(async (err) => {
        toast("No se pudo guardar: " + errMsg(err));
        try {
          if (S.role === "barbero" && S.me) {
            await liveApi.loadMine();
          } else {
            await Promise.all([liveApi.myBookings(), liveApi.wallet()]);
          }
        } catch (reloadErr) {}
        render();
        throw Object.assign(new Error(errMsg(err)), {
          __shown: true,
        });
      });
  } else {
    return Promise.resolve();
  }
}

import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { bizStartPath } from "../lib/alta.js";
import { clearPending } from "../lib/pendiente.js";
import { pr } from "../lib/prestadores.js";
import { refreshPrices } from "../lib/precios.js";
import { navigate, profilePath } from "../router.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { setFollow } from "./navegacion.js";
import { joinWaitlist } from "./reserva.js";
import { blockBusiness } from "./cuentas.js";
import { isBusiness } from "../lib/cuentas.js";

// Ingreso y registro: después de ingresar (o de tocar el link del email), sigue sola la acción que pidió ingresar.
//   reservar → la confirmación del turno con ese horario (si ya lo tomó otro, la ficha en ese día para elegir otro;
//              no se cobra nada); seguir → queda siguiendo; lista → queda anotado; negocio → el primer paso que falta.
export async function resumePending() {
  const pending = S.pending;
  clearPending();
  if (!pending) {
    return;
  }
  if (pending.a === "negocio") {
    await navigate(bizStartPath());
    return;
  }
  // D33: con una cuenta de negocio la acción de cliente no sigue: el aviso, con la salida a la cuenta personal
  if (isBusiness()) {
    await navigate("/panel/agenda");
    blockBusiness(null, pending);
    return;
  }
  let prov = pr(pending.pid);
  // para reservar, los horarios libres de este momento (mientras ingresaba, el horario lo pudo tomar otro)
  if (LIVE && (!prov || !prov.full || pending.a === "reservar")) {
    prov = (await api.loadProvider(pending.pid, true).catch(() => null)) || prov;
  }
  if (!prov) {
    await navigate("/");
    return;
  }
  const base = profilePath(prov, pending.pid);
  if (pending.a === "reservar") {
    await navigate(base + "/reservar?" + new URLSearchParams({ servicio: pending.svc, dia: pending.day, hora: pending.time }));
    // C52: los precios del momento en la confirmación
    refreshPrices()
      .then((changed) => changed && S.view === "checkoutT" && render())
      .catch(() => {});
    return;
  }
  await navigate(base);
  if (pending.a === "seguir") {
    setFollow(pending.pid, true);
  } else if (pending.a === "lista") {
    S.day = pending.day;
    joinWaitlist(pending.pid, pending.day);
  }
  render();
}

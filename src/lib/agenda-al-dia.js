import { api } from "../api/index.js";
import { pending } from "../api/saved.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { typing } from "./precios.js";

// C22 (V3b): la Agenda del prestador se pone al día sola cada 30 segundos y al volver a la pestaña, sin Realtime: vuelve
// a pedir los turnos y dibuja de nuevo solo si cambió algo (un turno nuevo, uno cancelado o reprogramado).
const EVERY = 30000;

// no se toca la pantalla mientras el prestador está haciendo algo: guardando, con el formulario de turno manual o de
// bloqueo abierto, o escribiendo en un campo
const busy = () => pending.n > 0 || S.manOpen || S.blockOpen || typing();
const onAgenda = () => S.role === "barbero" && S.btab === "agenda" && !!S.me;

let running = false;
export async function refreshAgendaNow() {
  if (!LIVE || running || document.visibilityState !== "visible" || !onAgenda() || busy()) {
    return false;
  }
  running = true;
  try {
    const changed = await api.refreshAgenda();
    // mientras llegaba la respuesta pudo cambiar de pestaña o abrir un formulario
    if (changed && onAgenda() && !busy()) {
      render();
    }
    return changed;
  } catch {
    return false;
  } finally {
    running = false;
  }
}

export function startAgendaRefresh() {
  if (!LIVE) {
    return;
  }
  document.addEventListener("visibilitychange", () => refreshAgendaNow());
  setInterval(() => refreshAgendaNow(), EVERY);
}

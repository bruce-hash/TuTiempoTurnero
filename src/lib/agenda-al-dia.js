import { api } from "../api/index.js";
import { pending } from "../api/saved.js";
import { LIVE } from "../config.js";
import { S } from "../state.js";
import { typing } from "./precios.js";
import { drawSoon as drawAfterTouch } from "./dibujar.js";

// C22 (V3b): la Agenda del prestador se pone al día sola cada 30 segundos y al volver a la pestaña, sin Realtime: vuelve
// a pedir los turnos y dibuja de nuevo solo si cambió algo (un turno nuevo, uno cancelado o reprogramado).
const EVERY = 30000;

// no se toca la pantalla mientras el prestador está haciendo algo: guardando, con el formulario de turno manual o de
// bloqueo abierto, o escribiendo en un campo
const busy = () => pending.n > 0 || S.manOpen || S.blockOpen || typing();

// 10/11 · punto 6: no se redibuja en medio de un toque (src/lib/dibujar.js)
const drawSoon = () => drawAfterTouch(() => !busy());
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
      drawSoon();
    }
    return changed;
  } catch {
    return false;
  } finally {
    running = false;
  }
}

// 4/11 · Bloque 3: en cualquier pestaña del panel, el número de seguidores y los avisos ("Nuevo seguidor") al día; con
// Clientes → Seguidores abierta, también la lista (quien siguió o dejó de seguir). Antes se cargaban una vez al entrar.
let community = false;
export async function refreshCommunityNow() {
  if (!LIVE || community || document.visibilityState !== "visible" || S.role !== "barbero" || !S.me || busy()) {
    return false;
  }
  community = true;
  try {
    const changed = await api.refreshCommunity();
    const onFollowers = S.btab === "clientes" && S.ctab === "seguidores";
    if (changed && onFollowers) {
      await api.followers().catch(() => {});
    }
    if (changed && S.role === "barbero" && !busy()) {
      drawSoon();
    }
    return changed;
  } catch {
    return false;
  } finally {
    community = false;
  }
}

export function startAgendaRefresh() {
  if (!LIVE) {
    return;
  }
  document.addEventListener("visibilitychange", () => {
    refreshAgendaNow();
    refreshCommunityNow();
  });
  setInterval(() => {
    refreshAgendaNow();
    refreshCommunityNow();
  }, EVERY);
}

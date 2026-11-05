import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { dayLabel } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// 4/11 · Bloque 3: ofrecer un hueco libre (day "AAAA-MM-DD", from y to "HH:MM"). Sin user, a todos los seguidores
// (Agenda → "Ofrecer"); con user, a ese seguidor (Clientes → Seguidores → "Ofrecer turno"). Les llega un aviso en la app y
// un push con el horario y "Reservar". La base controla que siga libre y los límites (offer_slot); si falla, saved() avisa.
export async function sendOffer(day, from, to, user, name) {
  const key = day + "|" + from;
  if (!user && !(store.COMM.followers > 0)) {
    toast("Todavía no tenés seguidores: compartí tu perfil para que te sigan y les llegue lo que ofrecés.");
    return false;
  }
  let res;
  try {
    res = await api.m.offerSlot(day, from, to, user || null);
  } catch {
    return false; // saved() ya avisó por qué
  }
  const sent = LIVE ? (res && res.sent) || 0 : user ? 1 : store.COMM.followers;
  if (user) {
    S.offeredTo[user + "|" + key] = true;
  } else {
    S.offered[key] = true;
  }
  const when = `${dayLabel(day).toLowerCase()} de ${from} a ${to}`;
  toast(
    user
      ? `Listo: le avisamos a ${name || "tu seguidor"} que tenés lugar ${when}.`
      : sent
        ? `Listo: les avisamos a ${sent} seguidor${sent === 1 ? "" : "es"} que tenés lugar ${when}.`
        : "No le llegó a nadie: ya no tenés seguidores.",
  );
  render();
  return true;
}

// 10/11 · punto 4: «Deshacer asistió» en la ficha del turno (src/views/prestador/deshacer.js). Vuelve a Confirmado o pasa a
// No vino; se borra lo cobrado en el local, se resta el sello que sumó y la ficha del cliente vuelve a como estaba.
// La base controla todo (undo_attendance): caja cerrada, sello ya canjeado. Nunca hay devolución de Mercado Pago.
import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { ME, pr } from "../lib/prestadores.js";
import { cli } from "../lib/turnero.js";
import { TODAY } from "../lib/fechas.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { cliStamps, setCliStamps } from "../ui/sellos.js";
import { toast } from "../ui/toast.js";
import { feeOf } from "../views/prestador/finanzas.js";
import { cajaClosed } from "../views/prestador/deshacer.js";

const findBooking = (id) => store.BOOK.find((item) => String(item.id) === String(id));

registerClick("undoAsk", (ev, el, act) => {
  const booking = findBooking(el.dataset.id);
  if (!booking || booking.status !== "done" || cajaClosed(booking)) {
    return;
  }
  S.undoAsk = booking.id;
  S.undoTo = "confirmed";
  S.restEd = null;
  S.restSplit = null;
  S.undoCheck = LIVE ? { id: booking.id, loading: true } : null;
  render();
  if (LIVE) {
    api
      .undoCheck(booking.id)
      .then((check) => {
        if (S.undoAsk === booking.id) {
          S.undoCheck = { id: booking.id, stamp: check && check.stamp, dayClosed: !!(check && check.day_closed) };
          render();
        }
      })
      .catch(() => {
        S.undoCheck = null;
        render();
      });
  }
});
registerClick("undoTo", (ev, el, act) => {
  S.undoTo = el.dataset.to === "noshow" ? "noshow" : "confirmed";
  render();
});
registerClick("undoNo", (ev, el, act) => {
  S.undoAsk = null;
  S.undoCheck = null;
  render();
});
registerClick("undoYes", (ev, el, act) => {
  const booking = findBooking(el.dataset.id);
  if (!booking || booking.status !== "done") {
    return;
  }
  const to = S.undoTo === "noshow" ? "noshow" : "confirmed";
  booking.status = to;
  booking.restParts = null;
  booking.restMethod = null;
  if (booking.cliente) {
    const stats = cli(booking.cliente);
    stats.v = Math.max((stats.v || 0) - 1, 0);
    if (to === "noshow") {
      stats.n = (stats.n || 0) + 1;
    }
  }
  if (booking.stamped) {
    const svc = pr(ME()).svcs.find((row) => row[0] === booking.svc);
    if (svc) {
      setCliStamps(booking.cliente, svc, Math.max(cliStamps(booking.cliente, svc) - 1, 0));
    }
    booking.stamped = false;
  }
  if (booking.date === TODAY()) {
    S.jobsToday = Math.max((S.jobsToday || 0) - 1, 0);
    S.earnToday = (S.earnToday || 0) - (booking.price - (booking.src === "app" ? feeOf(booking) : 0));
  }
  S.undoAsk = null;
  S.undoCheck = null;
  api.m.undoAttendance(booking, to);
  toast(to === "noshow" ? `Listo: ${booking.cliente || "el turno"} quedó como «No vino».` : "Listo: el turno volvió a Confirmado.");
  render();
});

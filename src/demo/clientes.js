import { daysAgo } from "../lib/fechas.js";
import { cli } from "../lib/turnero.js";
import { store } from "../store.js";

// Solo la demo (H21): clientes del panel de ejemplo. Suma los que reservaron por la app y todavía no estaban (con sus
// visitas) y saca los nombres de relleno de la agenda de ejemplo ("Lucas A.", "R"…), que no son clientes.
const FILLER = /^(Lucas|Matías|Bruno|Iván|Leo|Nahuel|Franco) [A-G]\.$/;
export function demoClients(pid) {
  store.BOOK.forEach((booking) => {
    if (booking.pid != pid || booking.src !== "app" || !booking.cliente || store.CLIENTS[booking.cliente] || booking.status === "cancelled") {
      return;
    }
    const done = store.BOOK.filter((item) => item.pid == pid && item.cliente === booking.cliente && item.status === "done");
    const stats = cli(booking.cliente);
    stats.v = done.length;
    stats.spend = done.length ? Math.round(done.reduce((sum, item) => sum + item.price, 0) / done.length) : booking.price;
    stats.last = done.length
      ? daysAgo(
          done
            .map((item) => item.date)
            .sort()
            .pop(),
        )
      : null;
    stats.app = true;
  });
  return Object.keys(store.CLIENTS).filter((name) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(name) && name !== "R" && !FILLER.test(name));
}

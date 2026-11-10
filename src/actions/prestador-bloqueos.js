import { registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { money } from "../lib/dinero.js";
import { TODAY } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { clientUser, upcomingOf } from "../views/prestador/bloqueos.js";
import { loadFollowers } from "../views/prestador/seguidores.js";
import { DEMO_CLIENT } from "../demo/bloqueos.js";

// D45 (punto 10): Eliminar de la lista y Bloquear (Clientes del panel), Bloquear desde Seguidores y Desbloquear.

const top = () => window.scrollTo(0, 0);
// punto final, sin repetirlo si el nombre ya termina en punto («Juan P.»)
const dot = (text) => (text.endsWith(".") ? text : text + ".");
// en la demo, el perfil del profesional deja de mostrarle horarios a la cuenta de cliente de ejemplo si la bloqueó
const demoSync = () => {
  if (!LIVE) {
    pr(ME()).demoBlocked = (store.BLOCKED || []).some((row) => row.name === DEMO_CLIENT);
  }
};
// la ficha abierta: «Eliminar de mi lista» (k=del) o «Bloquear» (k=block)
registerClick("cliAsk", (ev, el, act) => {
  const name = S.cli;
  if (!name || !store.CLIENTS[name]) {
    return;
  }
  S.cliAsk = { kind: el.dataset.k === "block" ? "block" : "del", name, user: clientUser(name), label: name };
  render();
  top();
});
registerClick("cliAskBack", (ev, el, act) => {
  S.cliAsk = null;
  render();
});
// «Bloquear» en una fila de Seguidores: si ya reservó, en su ficha (con sus turnos); si no, debajo de la fila
registerClick("folBlock", (ev, el, act) => {
  const fol = (store.FOLLOWERS || []).find((item) => item.id === el.dataset.id);
  if (!fol) {
    return;
  }
  const name = LIVE
    ? fol.client && Object.keys(store.CLIENTS).find((key) => store.CLIENTS[key].id === fol.client)
    : fol.client && store.CLIENTS[fol.name] && fol.name;
  if (name) {
    S.cli = name;
    S.ctab = "clientes";
    S.cliAsk = { kind: "block", name, user: clientUser(name), label: name };
    render();
    top();
    return;
  }
  S.offerFor = null;
  S.cliAsk = S.cliAsk && S.cliAsk.fol === fol.id ? null : { kind: "block", fol: fol.id, user: LIVE ? fol.id : "demo:" + fol.name, label: fol.name, name: null };
  render();
});
// los turnos cancelados al eliminar o bloquear, en la Agenda (la base ya registró la devolución, D08)
function cancelLocal(list) {
  list.forEach((booking) => {
    booking.status = "cancelled";
    booking.byProv = true;
    booking.refund = (booking.paid || 0) + (booking.fee || 0) + (booking.mpFee || 0);
  });
  return list.reduce((sum, booking) => sum + booking.refund, 0);
}
const cancelTxt = (list, refund) =>
  list.length ? ` Cancelamos ${list.length} turno${list.length > 1 ? "s" : ""}${refund ? ` y le devolvemos ${money(refund)}` : ""}.` : "";
// confirmar: data-c="1" cancela sus turnos futuros, "0" los deja (sin turnos, no lleva)
registerClick("cliDo", (ev, el, act) => {
  const target = S.cliAsk;
  if (!target) {
    return;
  }
  const list = upcomingOf(target);
  const cancel = list.length ? el.dataset.c === "1" : null;
  const client = target.name ? store.CLIENTS[target.name] : null;
  const done = () => {
    const refund = cancel ? cancelLocal(list) : 0;
    if (target.kind === "del") {
      if (target.user) {
        client.hidden = true;
      } else {
        delete store.CLIENTS[target.name];
      }
      toast((target.user ? `Sacaste a ${target.label} de tu lista.` : dot(`Borraste el contacto ${target.label}`)) + cancelTxt(cancel ? list : [], refund));
    } else {
      if (client) {
        client.blocked = true;
      }
      if (!LIVE) {
        store.BLOCKED = [{ id: target.user, name: target.label, photo: null, since: TODAY(), client: client ? client.id || true : null }].concat(store.BLOCKED || []);
        if ((store.FOLLOWERS || []).some((fol) => fol.name === target.label)) {
          store.COMM.followers = Math.max(0, (store.COMM.followers || 0) - 1);
        }
        demoSync();
      }
      toast(`Bloqueaste a ${target.label}: lo encontrás en Clientes → Bloqueados.` + cancelTxt(cancel ? list : [], refund));
    }
    S.cli = null;
    S.cliAsk = null;
    render();
    top();
  };
  if (!LIVE) {
    done();
    return;
  }
  el.disabled = true;
  const call = target.kind === "del" ? api.m.removeClient(client, cancel) : api.m.blockClient(target.user, cancel);
  call
    .then(async () => {
      done();
      if (target.kind === "block") {
        // la lista de bloqueados y la de seguidores (la base le borró el seguimiento), al día
        await api.blocked().catch(() => {});
        loadFollowers(true);
        render();
      }
    })
    .catch(() => {
      el.disabled = false;
    });
});
// Desbloquear (en Bloqueados o en su ficha): vuelve enseguida a Clientes si ya había reservado, sin avisarle nada
registerClick("unblock", (ev, el, act) => {
  const id = el.dataset.id;
  const row = (store.BLOCKED || []).find((item) => item.id === id);
  const name = row ? row.name : "";
  const local = () => {
    store.BLOCKED = (store.BLOCKED || []).filter((item) => item.id !== id);
    Object.keys(store.CLIENTS).forEach((key) => {
      if (clientUser(key) === id) {
        store.CLIENTS[key].blocked = false;
      }
    });
    demoSync();
    toast(`Desbloqueaste${name ? " a " + name : ""}. Ya puede volver a reservarte.`);
    if (S.ctab === "bloqueados" && !store.BLOCKED.length) {
      S.ctab = "clientes";
    }
    render();
  };
  if (!LIVE) {
    local();
    return;
  }
  el.disabled = true;
  api.m
    .unblockClient(id)
    .then(local)
    .catch(() => {
      el.disabled = false;
    });
});

import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { pctTxt } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, nowHM } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { refundPay } from "../lib/saldo.js";
import { S } from "../state.js";
import { P, store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { pushCancel } from "../views/prestador/bloqueo-dias.js";

registerClick("admV", (ev, el, act) => {
  S.admV = el.dataset.v;
  render();
  return;
});
registerClick("admT", (ev, el, act) => {
  S.admT = el.dataset.t;
  S.admOpen = null;
  S.admDel = null;
  S.admM = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("admG", (ev, el, act) => {
  S.admG = el.dataset.g;
  render();
  return;
});
registerClick("admOpen", (ev, el, act) => {
  const id = +el.dataset.id;
  S.admOpen = S.admOpen === id ? null : id;
  S.admDel = null;
  render();
  return;
});
registerClick("admDel", (ev, el, act) => {
  S.admDel = +el.dataset.id;
  render();
  return;
});
registerClick("admDelNo", (ev, el, act) => {
  S.admDel = null;
  render();
  return;
});
// eliminar prestador: en vivo lo hace la base (cancela sus turnos futuros y devuelve todo); en la demo se
// simula lo mismo y queda una nota en su ficha
registerClick("admDelYes", (ev, el, act) => {
  const id = +el.dataset.id;
  if (!$("#admDelOk") || !$("#admDelOk").checked) {
    toast("Marcá “Entiendo que no se puede deshacer”.");
    return;
  }
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminDeleteProvider(id)
      .then((res) => {
        const cancelled = (res && res.cancelled) || 0;
        S.admDel = null;
        S.admOpen = null;
        S.list = null;
        S.counts = null;
        toast(
          `Prestador eliminado.${cancelled ? ` Cancelamos ${cancelled} turno${cancelled > 1 ? "s" : ""} y les devolvemos todo a los clientes.` : ""}`,
        );
        return api.adminLoad();
      })
      .then(render)
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  S.admDel = null;
  S.admOpen = null;
  if (store.DEMO_PENDING.some((item) => item.id === id)) {
    store.DEMO_PENDING = store.DEMO_PENDING.filter((item) => item.id !== id);
    toast("Solicitud eliminada.");
    render();
    return;
  }
  const prov = pr(id);
  if (!prov) {
    return;
  }
  prov.deleted = true;
  S.list = null;
  S.counts = null;
  let count = 0;
  store.BOOK.forEach((booking) => {
    if (
      booking.pid == id &&
      booking.status === "confirmed" &&
      booking.type !== "block" &&
      booking.date + booking.time >= TODAY() + nowHM()
    ) {
      booking.status = "cancelled";
      booking.byProv = true;
      booking.refund = (booking.paid || 0) + (booking.fee || 0);
      if (booking.mine) {
        pushCancel(booking);
        refundPay(booking, booking.svc + " en " + prov.name);
      }
      count++;
    }
  });
  (store.DEMO_NOTES[id] ||= []).unshift({
    id: store.NID++,
    body: "Eliminado por el administrador.",
    d: TODAY(),
    t: nowHM(),
  });
  toast(
    `${prov.name} fue eliminado.${count ? ` Cancelamos ${count} turno${count > 1 ? "s" : ""} y les devolvemos todo a los clientes.` : ""}`,
  );
  render();
  return;
});
registerClick("admNoteDel", (ev, el, act) => {
  const id = +el.dataset.id;
  const pid = +el.dataset.p;
  if (LIVE) {
    api.m
      .adminDelNote(id)
      .then(() => api.adminLoad())
      .then(() => {
        toast("Nota borrada.");
        render();
      })
      .catch(() => {});
    return;
  }
  store.DEMO_NOTES[pid] = (store.DEMO_NOTES[pid] || []).filter((note) => note.id !== id);
  toast("Nota borrada.");
  render();
  return;
});
registerClick("admF", (ev, el, act) => {
  S.admF = el.dataset.f;
  render();
  return;
});
registerClick("admDni", (ev, el, act) => {
  const prov = ((S.adm && S.adm.providers) || []).find((item) => item.id === +el.dataset.id);
  if (!prov || !prov.owner) {
    return;
  }
  api.m
    .adminDni(prov.owner)
    .then((urls) => {
      S.admDni = {
        id: prov.id,
        urls: urls,
      };
      render();
    })
    .catch(() => {});
  return;
});
// activar o suspender (suspender pide un segundo toque); en la demo, activar una solicitud la convierte en prestador
registerClick("admSet", (ev, el, act) => {
  const id = +el.dataset.id;
  const status = el.dataset.s;
  if (status === "suspended" && S.admAsk !== id) {
    S.admAsk = id;
    toast("Tocá de nuevo para suspenderlo: deja de aparecer y nadie puede reservarle.");
    setTimeout(() => {
      S.admAsk = null;
    }, 3500);
    return;
  }
  S.admAsk = null;
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminSetProvider(id, status, status === "active" ? true : null)
      .then(() => api.adminLoad())
      .then(() => {
        toast(status === "active" ? "Prestador activo." : "Prestador suspendido.");
        render();
      })
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  const pending = store.DEMO_PENDING.find((item) => item.id === id);
  if (pending) {
    store.DEMO_PENDING = store.DEMO_PENDING.filter((item) => item.id !== id);
    P.push({
      id: id,
      name: pending.name,
      addr: pending.addr,
      hue: (id * 47) % 360,
      cats: pending.cats,
      svcs: [["Servicio principal", 45, 9e3, pending.cats[0]]],
      status: "active",
      verified: true,
    });
    S.list = null;
    S.counts = null;
  } else {
    const prov = pr(id);
    if (prov) {
      prov.status = status;
      S.list = null;
      S.counts = null;
    }
  }
  toast(
    status === "active"
      ? "Prestador activo: ya aparece en TuTiempo."
      : "Prestador suspendido: ya no aparece ni se le puede reservar.",
  );
  render();
  return;
});
registerInput("admQ", (ev) => {
  S.admQ = ev.target.value;
  const query = ev.target.value.toLowerCase();
  document.querySelectorAll(".admlist li").forEach((row) => {
    const name = row.querySelector("b");
    row.hidden = !!name && !name.textContent.toLowerCase().includes(query);
  });
  return;
});
// comisión de la plataforma: de 0 a 30 %, con hasta dos decimales
registerSubmit("fCom", (ev) => {
  const text = String($("#admCom").value).trim().replace("%", "").replace(",", ".");
  const value = /^\d{1,2}(\.\d{1,2})?$/.test(text) ? parseFloat(text) : NaN;
  const showErr = (msg) => {
    $("#comerr").textContent = msg;
  };
  if (!isFinite(value) || value < 0 || value > 30) {
    return showErr("Escribí un porcentaje entre 0 y 30 (por ejemplo 10 u 8,5).");
  }
  const pct = Math.round(value * 100) / 100;
  if (LIVE) {
    api.m
      .adminSetCommission(pct)
      .then(() => api.adminLoad())
      .then(() => {
        toast(`Comisión guardada: ${pctTxt(pct)}%.`);
        render();
      })
      .catch(() => {});
    return;
  }
  store.COMISION = pct / 100;
  toast(`Comisión guardada: ${pctTxt(pct)}%. Se aplica a las reservas nuevas.`);
  render();
  return;
});
// "Para revisar · cobros" (Bloque 1, D20): Reintentar una devolución y "Resuelto a mano" (con nota; no devuelve nada)
registerClick("admRetry", (ev, el, act) => {
  const id = +el.dataset.id;
  if (LIVE) {
    api.m
      .adminRefundRetry(id)
      .then(() => api.adminReview())
      .then(() => {
        toast("La devolución vuelve a intentarse en los próximos minutos.");
        render();
      })
      .catch(() => {});
    return;
  }
  store.DEMO_REV.refunds = store.DEMO_REV.refunds.filter((refund) => refund.id !== id);
  toast("La devolución vuelve a intentarse en los próximos minutos.");
  render();
});
registerClick("admResolveOpen", (ev, el, act) => {
  S.admResolve = { k: el.dataset.k, id: +el.dataset.id };
  render();
});
registerClick("admResolveNo", (ev, el, act) => {
  S.admResolve = null;
  render();
});
registerSubmit("fResolve", (ev) => {
  const kind = ev.target.dataset.k;
  const id = +ev.target.dataset.id;
  const note = String($("#rsNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 500);
  if (note.length < 3) {
    $("#rserr").textContent = "Escribí cómo se resolvió.";
    return;
  }
  const done = () => {
    S.admResolve = null;
    toast("Marcado como resuelto a mano.");
    render();
  };
  if (LIVE) {
    api.m
      .adminResolve(kind, id, note)
      .then(() => api.adminReview())
      .then(done)
      .catch(() => {});
    return;
  }
  const list = kind === "refund" ? "refunds" : "payments";
  store.DEMO_REV[list] = store.DEMO_REV[list].filter((item) => item.id !== id);
  done();
});
// "Devolver" un pago en revisión (D20): monto entero en pesos y nota obligatoria
registerSubmit("fAdmRefund", (ev) => {
  const id = +ev.target.dataset.id;
  const raw = String($("#arAmount").value || "").trim();
  const amount = /^\d+$/.test(raw) ? +raw : 0;
  const note = String($("#arNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 500);
  if (amount <= 0) {
    $("#arerr").textContent = "Escribí el monto en pesos, sin puntos ni decimales.";
    return;
  }
  if (note.length < 3) {
    $("#arerr").textContent = "Escribí por qué devolvés.";
    return;
  }
  const done = () => {
    S.admResolve = null;
    toast("Devolución pedida: sale en los próximos minutos.");
    render();
  };
  if (LIVE) {
    api.m
      .adminRefundCreate(id, amount, note)
      .then(() => api.adminReview())
      .then(done)
      .catch(() => {});
    return;
  }
  store.DEMO_REV.payments = store.DEMO_REV.payments.filter((item) => item.id !== id);
  done();
});
registerSubmit("fNote", (ev) => {
  const pid = +ev.target.dataset.p;
  const body = String($("#admNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 1e3);
  if (!body) {
    $("#noteerr").textContent = "Escribí la nota.";
    return;
  }
  if (LIVE) {
    api.m
      .adminAddNote(pid, body)
      .then(() => api.adminLoad())
      .then(() => {
        toast("Nota guardada. Solo la ves vos.");
        render();
      })
      .catch(() => {});
    return;
  }
  (store.DEMO_NOTES[pid] ||= []).unshift({
    id: store.NID++,
    body: body,
    d: TODAY(),
    t: nowHM(),
  });
  toast("Nota guardada. Solo la ves vos.");
  render();
  return;
});

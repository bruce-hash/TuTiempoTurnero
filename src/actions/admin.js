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

registerClick("admV", (e, x, v) => {
  S.admV = x.dataset.v;
  render();
  return;
});
registerClick("admT", (e, x, v) => {
  S.admT = x.dataset.t;
  S.admOpen = null;
  S.admDel = null;
  S.admM = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("admG", (e, x, v) => {
  S.admG = x.dataset.g;
  render();
  return;
});
registerClick("admOpen", (e, x, v) => {
  const r = +x.dataset.id;
  S.admOpen = S.admOpen === r ? null : r;
  S.admDel = null;
  render();
  return;
});
registerClick("admDel", (e, x, v) => {
  S.admDel = +x.dataset.id;
  render();
  return;
});
registerClick("admDelNo", (e, x, v) => {
  S.admDel = null;
  render();
  return;
});
registerClick("admDelYes", (e, x, v) => {
  const r = +x.dataset.id;
  if (!$("#admDelOk") || !$("#admDelOk").checked) {
    toast("Marcá “Entiendo que no se puede deshacer”.");
    return;
  }
  if (LIVE) {
    x.disabled = true;
    api.m
      .adminDeleteProvider(r)
      .then((u) => {
        const E = (u && u.cancelled) || 0;
        S.admDel = null;
        S.admOpen = null;
        S.list = null;
        S.counts = null;
        toast(
          `Prestador eliminado.${E ? ` Cancelamos ${E} turno${E > 1 ? "s" : ""} y les devolvemos todo a los clientes.` : ""}`,
        );
        return api.adminLoad();
      })
      .then(render)
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  S.admDel = null;
  S.admOpen = null;
  if (store.DEMO_PENDING.some((u) => u.id === r)) {
    store.DEMO_PENDING = store.DEMO_PENDING.filter((u) => u.id !== r);
    toast("Solicitud eliminada.");
    render();
    return;
  }
  const m = pr(r);
  if (!m) {
    return;
  }
  m.deleted = true;
  S.list = null;
  S.counts = null;
  let f = 0;
  store.BOOK.forEach((u) => {
    if (
      u.pid == r &&
      u.status === "confirmed" &&
      u.type !== "block" &&
      u.date + u.time >= TODAY() + nowHM()
    ) {
      u.status = "cancelled";
      u.byProv = true;
      u.refund = (u.paid || 0) + (u.fee || 0);
      if (u.mine) {
        pushCancel(u);
        refundPay(u, u.svc + " en " + m.name);
      }
      f++;
    }
  });
  (store.DEMO_NOTES[r] ||= []).unshift({
    id: store.NID++,
    body: "Eliminado por el administrador.",
    d: TODAY(),
    t: nowHM(),
  });
  toast(
    `${m.name} fue eliminado.${f ? ` Cancelamos ${f} turno${f > 1 ? "s" : ""} y les devolvemos todo a los clientes.` : ""}`,
  );
  render();
  return;
});
registerClick("admNoteDel", (e, x, v) => {
  const r = +x.dataset.id;
  const m = +x.dataset.p;
  if (LIVE) {
    api.m
      .adminDelNote(r)
      .then(() => api.adminLoad())
      .then(() => {
        toast("Nota borrada.");
        render();
      })
      .catch(() => {});
    return;
  }
  store.DEMO_NOTES[m] = (store.DEMO_NOTES[m] || []).filter((f) => f.id !== r);
  toast("Nota borrada.");
  render();
  return;
});
registerClick("admF", (e, x, v) => {
  S.admF = x.dataset.f;
  render();
  return;
});
registerClick("admDni", (e, x, v) => {
  const r = ((S.adm && S.adm.providers) || []).find((m) => m.id === +x.dataset.id);
  if (!r || !r.owner) {
    return;
  }
  api.m
    .adminDni(r.owner)
    .then((m) => {
      S.admDni = {
        id: r.id,
        urls: m,
      };
      render();
    })
    .catch(() => {});
  return;
});
registerClick("admSet", (e, x, v) => {
  const r = +x.dataset.id;
  const m = x.dataset.s;
  if (m === "suspended" && S.admAsk !== r) {
    S.admAsk = r;
    toast("Tocá de nuevo para suspenderlo: deja de aparecer y nadie puede reservarle.");
    setTimeout(() => {
      S.admAsk = null;
    }, 3500);
    return;
  }
  S.admAsk = null;
  if (LIVE) {
    x.disabled = true;
    api.m
      .adminSetProvider(r, m, m === "active" ? true : null)
      .then(() => api.adminLoad())
      .then(() => {
        toast(m === "active" ? "Prestador activo." : "Prestador suspendido.");
        render();
      })
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  const f = store.DEMO_PENDING.find((u) => u.id === r);
  if (f) {
    store.DEMO_PENDING = store.DEMO_PENDING.filter((u) => u.id !== r);
    P.push({
      id: r,
      name: f.name,
      addr: f.addr,
      hue: (r * 47) % 360,
      cats: f.cats,
      svcs: [["Servicio principal", 45, 9e3, f.cats[0]]],
      status: "active",
      verified: true,
    });
    S.list = null;
    S.counts = null;
  } else {
    const u = pr(r);
    if (u) {
      u.status = m;
      S.list = null;
      S.counts = null;
    }
  }
  toast(
    m === "active"
      ? "Prestador activo: ya aparece en TuTiempo."
      : "Prestador suspendido: ya no aparece ni se le puede reservar.",
  );
  render();
  return;
});
registerInput("admQ", (e) => {
  S.admQ = e.target.value;
  const a = e.target.value.toLowerCase();
  document.querySelectorAll(".admlist li").forEach((t) => {
    const s = t.querySelector("b");
    t.hidden = !!s && !s.textContent.toLowerCase().includes(a);
  });
  return;
});
registerSubmit("fCom", (e) => {
  const a = String($("#admCom").value).trim().replace("%", "").replace(",", ".");
  const t = /^\d{1,2}(\.\d{1,2})?$/.test(a) ? parseFloat(a) : NaN;
  const s = (o) => {
    $("#comerr").textContent = o;
  };
  if (!isFinite(t) || t < 0 || t > 30) {
    return s("Escribí un porcentaje entre 0 y 30 (por ejemplo 10 u 8,5).");
  }
  const n = Math.round(t * 100) / 100;
  if (LIVE) {
    api.m
      .adminSetCommission(n)
      .then(() => api.adminLoad())
      .then(() => {
        toast(`Comisión guardada: ${pctTxt(n)}%.`);
        render();
      })
      .catch(() => {});
    return;
  }
  store.COMISION = n / 100;
  toast(`Comisión guardada: ${pctTxt(n)}%. Se aplica a las reservas nuevas.`);
  render();
  return;
});
registerSubmit("fNote", (e) => {
  const a = +e.target.dataset.p;
  const t = String($("#admNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 1e3);
  if (!t) {
    $("#noteerr").textContent = "Escribí la nota.";
    return;
  }
  if (LIVE) {
    api.m
      .adminAddNote(a, t)
      .then(() => api.adminLoad())
      .then(() => {
        toast("Nota guardada. Solo la ves vos.");
        render();
      })
      .catch(() => {});
    return;
  }
  (store.DEMO_NOTES[a] ||= []).unshift({
    id: store.NID++,
    body: t,
    d: TODAY(),
    t: nowHM(),
  });
  toast("Nota guardada. Solo la ves vos.");
  render();
  return;
});

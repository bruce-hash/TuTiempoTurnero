import { dismissAlerts, readShownKeys } from "../lib/avisos-admin.js";
import { NUDGE_TEXT } from "../views/admin/prestadores.js";
import { registerClick, registerInput, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { MP_TERMS } from "../lib/cobro.js";
import { PESOS_ERR, parsePesos, pctTxt } from "../lib/dinero.js";
import { $ } from "../lib/dom.js";
import { TODAY, nowHM } from "../lib/fechas.js";
import { pr } from "../lib/prestadores.js";
import { SITE_URL_ERR, siteUrl } from "../lib/sitio.js";
import { dniRequired } from "../lib/verificacion.js";
import { S } from "../state.js";
import { stampsOn } from "../ui/sellos.js";
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
  // "Ver quiénes" (activos sin Mercado Pago) abre Prestadores con ese filtro
  if (el.dataset.f) {
    S.admF = el.dataset.f;
  }
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
          `Profesional eliminado.${cancelled ? ` Cancelamos ${cancelled} turno${cancelled > 1 ? "s" : ""} y les devolvemos todo a los clientes.` : ""}`,
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
      booking.refund = (booking.paid || 0) + (booking.fee || 0) + (booking.mpFee || 0);
      if (booking.mine) {
        pushCancel(booking);
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
// C41/C42 (V6): "Avisarle" a un prestador activo sin Mercado Pago: le llega un aviso en la app y por push con el camino
// para conectarlo (uno por día; en la demo solo se marca)
// v2 (3/11): «Avisarle» abre un cuadro con el mensaje (editable) y por dónde le llega, con Enviar y Cancelar
registerClick("admNudge", (ev, el, act) => {
  S.admNudgeAsk = { id: +el.dataset.id, body: NUDGE_TEXT };
  render();
  const box = $("#admNudgeTxt");
  if (box) {
    box.focus();
  }
});
registerClick("admNudgeCancel", (ev, el, act) => {
  S.admNudgeAsk = null;
  render();
});
registerClick("admNudgeSend", (ev, el, act) => {
  const ask = S.admNudgeAsk;
  if (!ask) {
    return;
  }
  const body = (($("#admNudgeTxt") || {}).value || "").trim();
  if (body.length < 10 || body.length > 500) {
    const err = $("#admNudgeErr");
    if (err) {
      err.textContent = "El mensaje tiene que tener entre 10 y 500 letras.";
    }
    return;
  }
  const id = ask.id;
  const done = (sent) => {
    S.admNudgeAsk = null;
    S.admNudged = { ...(S.admNudged || {}), [id]: true };
    toast(sent ? "Listo: le llegó el aviso en su panel y una notificación al celular." : "Ya le avisamos hoy: mañana le podés volver a avisar.");
    render();
  };
  if (!LIVE) {
    return done(true);
  }
  el.disabled = true;
  api.m
    .adminNudgeMp({ id, body: body === NUDGE_TEXT ? null : body })
    .then((res) => done(!res || res.sent !== false))
    .catch(() => {
      el.disabled = false;
    });
});
// v2 (3/11): borrar avisos del panel de TuTiempo (uno, o todos los que ya estaban leídos)
registerClick("admAlertDel", (ev, el, act) => {
  dismissAlerts([el.dataset.k]).then(() => render()).catch(() => {});
});
registerClick("admAlertsClear", (ev, el, act) => {
  const keys = readShownKeys();
  if (!keys.length) {
    return toast("No hay avisos leídos para borrar.");
  }
  dismissAlerts(keys).then(() => {
    toast(keys.length === 1 ? "Borramos 1 aviso." : `Borramos ${keys.length} avisos.`);
    render();
  }).catch(() => {});
});
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
        toast(status === "active" ? "Profesional activo." : "Profesional suspendido.");
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
      // sin DNI exigido (D26), se aprueba sin el sello de identidad verificada
      verified: dniRequired(),
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
      ? "Profesional activo: ya aparece en TuTiempo."
      : "Profesional suspendido: ya no aparece ni se le puede reservar.",
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
// D34: comisión de TuTiempo (% del precio del turno, de 0 a 30) y % de Mercado Pago por plazo (de 0 a 15), con hasta dos decimales
registerSubmit("fCom", (ev) => {
  const read = (id, max) => {
    const text = String(($("#" + id) || {}).value || "").trim().replace("%", "").replace(",", ".");
    const value = /^\d{1,2}(\.\d{1,2})?$/.test(text) ? parseFloat(text) : NaN;
    return isFinite(value) && value >= 0 && value <= max ? Math.round(value * 100) / 100 : null;
  };
  const showErr = (msg) => {
    $("#comerr").textContent = msg;
  };
  const pct = read("admCom", 30);
  if (pct == null) {
    return showErr("La comisión de TuTiempo va entre 0 y 30 (por ejemplo 7 u 8,5).");
  }
  const mp = {};
  for (const [term, name] of MP_TERMS) {
    mp[term] = read("admMp-" + term, 15);
    if (mp[term] == null) {
      return showErr(`Mercado Pago, ${name.toLowerCase()}: un porcentaje entre 0 y 15 (por ejemplo 7,61).`);
    }
  }
  if (LIVE) {
    api.m
      .adminSetFees(pct, mp)
      .then(() => api.adminLoad())
      .then(() => {
        toast(`Comisiones guardadas: TuTiempo ${pctTxt(pct)}% del servicio. Se aplican a las reservas nuevas.`);
        render();
      })
      .catch(() => {});
    return;
  }
  store.FEES = { commission: pct, mp: mp };
  toast(`Comisiones guardadas: TuTiempo ${pctTxt(pct)}% del servicio. Se aplican a las reservas nuevas.`);
  render();
  return;
});
// Bloque D (D26): "Exigir DNI para aprobar prestadores"
registerClick("admReqDni", (ev, el, act) => {
  const on = !dniRequired();
  const done = () => {
    toast(on ? "Listo: para aprobar a un profesional hace falta su DNI." : "Listo: los profesionales nuevos se aprueban sin DNI.");
    render();
  };
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminSetRequireDni(on)
      .then(() => api.adminLoad())
      .then(done)
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  S.requireDni = on;
  done();
});
// C29 (V5 resto): tarjetas de sellos para toda la plataforma
registerClick("admStamps", (ev, el, act) => {
  const on = !stampsOn();
  const done = () => {
    toast(on ? "Listo: las tarjetas de sellos volvieron, como estaban." : "Listo: las tarjetas de sellos quedan apagadas (los datos se guardan).");
    render();
  };
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminSetStamps(on)
      .then(() => api.requireDni())
      .then(done)
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  S.stampsOn = on;
  done();
});
// dirección del sitio (H24): solo en vivo; https:// y el dominio, nada más (la base vuelve a validarla)
registerSubmit("fSite", (ev) => {
  const url = siteUrl($("#admSite").value);
  if (!url) {
    $("#siteerr").textContent = SITE_URL_ERR;
    return;
  }
  api.m
    .adminSetSiteUrl(url)
    .then(() => api.adminLoad())
    .then(() => {
      toast("Dirección guardada: los avisos nuevos usan " + url + ".");
      render();
    })
    .catch(() => {});
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
// "Reprocesar" un pago en revisión por un error inesperado (H27): solo en vivo (la demo no lo ofrece)
registerSubmit("fReprocess", (ev) => {
  const id = +ev.target.dataset.id;
  const note = String($("#rpNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 500);
  if (note.length < 3) {
    $("#rperr").textContent = "Escribí por qué lo reprocesás.";
    return;
  }
  api.m
    .adminReprocess(id, note)
    .then(() => api.adminReview())
    .then(() => {
      S.admResolve = null;
      toast("Pago reprocesado.");
      render();
    })
    .catch(() => {});
});
// "Devolver" un pago en revisión (D20): monto entero en pesos y nota obligatoria
registerSubmit("fAdmRefund", (ev) => {
  const id = +ev.target.dataset.id;
  const amount = parsePesos($("#arAmount").value);
  const note = String($("#arNote").value || "")
    .replace(/[\u0000-\u001f]/g, " ")
    .trim()
    .slice(0, 500);
  if (isNaN(amount)) {
    $("#arerr").textContent = PESOS_ERR;
    return;
  }
  if (amount <= 0) {
    $("#arerr").textContent = "Escribí cuánto devolvés.";
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
// 7/11 · Feriados (D39): corregir o agregar, borrar, confirmar el año y volver a traer la lista de la fuente
const holYear = (day) => (S.admHol || []).find((y) => String(y.year) === day.slice(0, 4));
function holReload(msg) {
  const done = () => {
    toast(msg);
    render();
  };
  if (LIVE) {
    return api.adminHolidays().then(done);
  }
  done();
  return Promise.resolve();
}
registerSubmit("fHol", (ev) => {
  const day = $("#holD").value;
  const name = $("#holN").value.trim().replace(/[<>]/g, "").slice(0, 80);
  const kind = $("#holK").value;
  const showErr = (msg) => {
    $("#holerr").textContent = msg;
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return showErr("Elegí la fecha.");
  }
  if (!name) {
    return showErr("Escribí el nombre del feriado.");
  }
  if (LIVE) {
    api.m
      .adminHolidaySave(day, name, kind)
      .then(() => holReload("Feriado guardado."))
      .catch(() => {});
    return;
  }
  const year = holYear(day);
  if (!year) {
    return showErr("Solo el año en curso y el siguiente.");
  }
  year.days = year.days.filter((h) => h.day !== day).concat([{ day, name, kind, source: "admin" }]).sort((a, b) => a.day.localeCompare(b.day));
  holReload("Feriado guardado.");
});
registerClick("admHolDel", (ev, el, act) => {
  const day = el.dataset.d;
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminHolidayDelete(day)
      .then(() => holReload("Feriado borrado."))
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  const year = holYear(day);
  if (year) {
    year.days = year.days.filter((h) => h.day !== day);
  }
  holReload("Feriado borrado.");
});
registerClick("admHolConfirm", (ev, el, act) => {
  const y = +el.dataset.y;
  const msg = `Listo: los feriados de ${y} quedan confirmados. Esos días quedan cerrados para todos los profesionales (los abren desde Horarios).`;
  if (LIVE) {
    el.disabled = true;
    api.m
      .adminHolidaysConfirm(y)
      .then(() => holReload(msg))
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  const year = (S.admHol || []).find((item) => item.year === y);
  if (year) {
    year.confirmed_at = new Date().toISOString();
    year.source_changed = false;
  }
  holReload(msg);
});
// solo en vivo: pide holidays-sync (la respuesta llega en unos segundos; se vuelve a pedir la lista)
registerClick("admHolFetch", (ev, el, act) => {
  el.disabled = true;
  api.m
    .adminHolidaysFetch()
    .then((asked) => {
      if (!asked) {
        toast("No se pudo pedir: falta configurar la dirección y la clave del cron en Vault (docs/02).");
        el.disabled = false;
        return;
      }
      toast("Pedido a la fuente. En unos segundos se actualiza la lista.");
      setTimeout(() => holReload("Lista de feriados actualizada.").catch(() => {}), 6000);
    })
    .catch(() => {
      el.disabled = false;
    });
});

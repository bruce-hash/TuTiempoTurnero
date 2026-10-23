import { CLICK } from "./registro.js";
import { readIntake } from "./reserva.js";
import { api } from "../api/index.js";
import { H } from "../lib/compat.js";
import { $ } from "../lib/dom.js";
import { TODAY, addDays, dkey, pad } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { selDur } from "../lib/servicios.js";
import { cfg, freeCount, slotsFor } from "../lib/turnero.js";
import { S } from "../state.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";
import { SMAX } from "../views/prestador/estadisticas.js";
import { ymk } from "../views/prestador/finanzas.js";
import { PRESETS } from "../views/prestador/horarios.js";
import { selectBtab } from "../views/prestador/panel.js";

// un solo listener de toques: primero los atributos de navegación y selección (data-go, data-svc, data-day,
// data-slot…), que cambian el estado y vuelven a dibujar; al final, data-act busca la acción en el registro
document.addEventListener("click", (ev) => {
  const roleBtn = ev.target.closest("[data-role-view]");
  if (roleBtn) {
    S.role = roleBtn.dataset.roleView;
    if (S.role === "barbero") {
      S.barberAuth = true;
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  const goEl = ev.target.closest("[data-go]");
  if (goEl) {
    ev.preventDefault();
    if (goEl.dataset.go === "perfil") {
      S.pctx = goEl.dataset.ctx || null;
      S.svc = 0;
      S.day = null;
      S.slot = null;
    }
    go(goEl.dataset.go, goEl.dataset.id);
    return;
  }
  const pctxEl = ev.target.closest("[data-pctx]");
  if (pctxEl) {
    S.pctx = pctxEl.dataset.pctx;
    if (S.view === "perfil" && S.role === "cliente") {
      const prov = pr(S.pid);
      const idx = prov.svcs.findIndex((svc) => svc[3] === S.pctx);
      if (idx >= 0 && prov.svcs[S.svc] && prov.svcs[S.svc][3] !== S.pctx) {
        S.svc = idx;
      }
    }
    render();
    return;
  }
  const svcEl = ev.target.closest("[data-svc]");
  if (svcEl) {
    if (S.svc !== +svcEl.dataset.svc) {
      S.adds = [];
      S.intake = {};
    }
    S.svc = +svcEl.dataset.svc;
    render();
    return;
  }
  const iqEl = ev.target.closest("[data-iqk]");
  if (iqEl) {
    readIntake();
    S.intake = S.intake || {};
    const key = iqEl.dataset.iqk;
    S.intake[key] = S.intake[key] === iqEl.dataset.iqv ? void 0 : iqEl.dataset.iqv;
    if (S.intake[key] === void 0) {
      delete S.intake[key];
    }
    render();
    return;
  }
  {
    const payEl = ev.target.closest("[data-paym]");
    if (payEl) {
      S.payM = payEl.dataset.paym;
      render();
      return;
    }
  }
  const rateEl = ev.target.closest("[data-rate]");
  if (rateEl) {
    S.rateN = +rateEl.dataset.rate;
    const text = ($("#rateTxt") || {}).value || "";
    render();
    const box = $("#rateTxt");
    if (box) {
      box.value = text;
    }
    return;
  }
  const tabEl = ev.target.closest("[data-btab]");
  if (tabEl) {
    selectBtab(tabEl.dataset.btab);
    return;
  }
  const cfEl = ev.target.closest("[data-cf]");
  if (cfEl) {
    S.cf = S.cf === cfEl.dataset.cf && cfEl.dataset.cf !== "todos" ? "todos" : cfEl.dataset.cf;
    render();
    return;
  }
  const cliEl = ev.target.closest("[data-cli]");
  if (cliEl) {
    S.cli = cliEl.dataset.cli;
    S.btab = "clientes";
    render();
    window.scrollTo(0, 0);
    return;
  }
  const fpEl = ev.target.closest("[data-fp]");
  if (fpEl) {
    S.fp = fpEl.dataset.fp;
    if (fpEl.dataset.fp === "dia" && S.btab !== "finanzas") {
      S.btab = "finanzas";
    }
    render();
    return;
  }
  const catEl = ev.target.closest("[data-cat]");
  if (catEl) {
    S.cat = catEl.dataset.cat;
    S.q = "";
    render();
    return;
  }
  const presetEl = ev.target.closest("[data-preset]");
  if (presetEl) {
    const preset = PRESETS.find((row) => row[0] === presetEl.dataset.preset);
    const conf = cfg(ME());
    [1, 2, 3, 4, 5].forEach((dow) => {
      conf.days[dow] = {
        on: true,
        m: H({}, preset[3]),
        t: H({}, preset[4]),
      };
    });
    api.m.saveSettings(conf);
    S.hErr = null;
    toast(`Lunes a viernes: ${preset[1].toLowerCase()} (${preset[2]}). Ya se ve en tu agenda.`);
    render();
    return;
  }
  const hhpEl = ev.target.closest("[data-hhp]");
  if (hhpEl) {
    $("#hhp").value = hhpEl.dataset.hhp;
    document.querySelectorAll("[data-hhp]").forEach((btn) => btn.setAttribute("aria-pressed", btn === hhpEl));
    return;
  }
  const svEl = ev.target.closest("[data-sv]");
  if (svEl) {
    S.sv = svEl.dataset.sv;
    render();
    return;
  }
  const swkEl = ev.target.closest("[data-swk]");
  if (swkEl) {
    S.swk = Math.min(0, (S.swk || 0) + +swkEl.dataset.swk);
    render();
    return;
  }
  const smoEl = ev.target.closest("[data-smo]");
  if (smoEl) {
    S.smo = Math.min(SMAX(), (S.smo || 0) + +smoEl.dataset.smo);
    render();
    return;
  }
  const syrEl = ev.target.closest("[data-syr]");
  if (syrEl) {
    S.syr = +syrEl.dataset.syr;
    render();
    return;
  }
  const fmEl = ev.target.closest("[data-fm]");
  if (fmEl) {
    const current = ymk(TODAY());
    let [year, month] = (S.fm && S.fm <= current ? S.fm : current).split("-").map(Number);
    month += +fmEl.dataset.fm;
    if (month < 1) {
      month = 12;
      year--;
    }
    if (month > 12) {
      month = 1;
      year++;
    }
    const ym = year + "-" + pad(month);
    S.fm = ym > current ? current : ym;
    render();
    return;
  }
  const fyEl = ev.target.closest("[data-fy]");
  if (fyEl) {
    S.fy = +fyEl.dataset.fy;
    render();
    return;
  }
  const dayEl = ev.target.closest("[data-day]");
  if (dayEl) {
    S.day = dayEl.dataset.day;
    S.slot = null;
    render();
    return;
  }
  const quickEl = ev.target.closest("[data-quick]");
  if (quickEl) {
    const [date, time] = quickEl.dataset.quick.split("|");
    const days = [];
    for (let offset = 0; offset < cfg(S.pid).ahead; offset++) {
      days.push(dkey(addDays(offset)));
    }
    S.day = date;
    S.wk = Math.floor(days.indexOf(date) / 7);
    S.slot = {
      date: date,
      time: time,
    };
    render();
    return;
  }
  const wkEl = ev.target.closest("[data-wk]");
  if (wkEl) {
    S.wk = Math.max(0, (S.wk || 0) + +wkEl.dataset.wk);
    const conf = cfg(S.pid);
    const days = [];
    for (let offset = 0; offset < conf.ahead; offset++) {
      days.push(dkey(addDays(offset)));
    }
    const week = days.slice(S.wk * 7, S.wk * 7 + 7);
    const dur = selDur(pr(S.pid));
    S.day =
      week.find((day) => freeCount(S.pid, day, dur, S.reprog) > 0) ||
      week.find((day) => !slotsFor(S.pid, day, dur).closed) ||
      week[0];
    S.slot = null;
    render();
    return;
  }
  const slotEl = ev.target.closest("[data-slot]");
  if (slotEl) {
    S.slot = {
      date: S.day,
      time: slotEl.dataset.slot,
    };
    render();
    return;
  }
  const repEl = ev.target.closest("[data-rep]");
  if (repEl) {
    S.rep = +repEl.dataset.rep;
    render();
    return;
  }
  const selEl = ev.target.closest("[data-sel]");
  if (selEl) {
    S.sel = String(S.sel) === selEl.dataset.sel ? null : selEl.dataset.sel;
    S.bAsk = null;
    render();
    const detail = $(".detail");
    if (detail && detail.scrollIntoView) {
      detail.scrollIntoView({
        block: "nearest",
      });
    }
    return;
  }
  const awkEl = ev.target.closest("[data-awk]");
  if (awkEl) {
    const days = [];
    for (let offset = 0; offset < 31; offset++) {
      days.push(dkey(addDays(offset)));
    }
    S.awk = Math.max(0, Math.min(Math.ceil(days.length / 7) - 1, (S.awk || 0) + +awkEl.dataset.awk));
    S.aday = days[S.awk * 7];
    S.bAsk = null;
    S.sel = null;
    S.manOpen = false;
    S.blockOpen = false;
    render();
    return;
  }
  const adayEl = ev.target.closest("[data-aday]");
  if (adayEl) {
    S.aday = adayEl.dataset.aday;
    S.bAsk = null;
    S.sel = null;
    S.manOpen = false;
    S.blockOpen = false;
    render();
    return;
  }
  const medioEl = ev.target.closest("[data-medio]");
  if (medioEl) {
    S.walkMedio = medioEl.dataset.medio;
    document.querySelectorAll("[data-medio]").forEach((btn) => btn.setAttribute("aria-pressed", btn === medioEl));
    return;
  }
  const actEl = ev.target.closest("[data-act]");
  if (!actEl) {
    return;
  }
  // en la vista previa del perfil solo se puede salir
  if (
    S.role === "barbero" &&
    S.preview &&
    actEl.dataset.act !== "exitPreview" &&
    actEl.dataset.act !== "salirBarbero"
  ) {
    toast("Es una vista previa: así lo ve un cliente. Para volver, tocá “Volver al panel”.");
    return;
  }
  const act = actEl.dataset.act;
  const accion = CLICK.get(act);
  if (accion) {
    accion(ev, actEl, act);
  }
});

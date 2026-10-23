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

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-role-view]");
  if (a) {
    S.role = a.dataset.roleView;
    if (S.role === "barbero") {
      S.barberAuth = true;
    }
    render();
    window.scrollTo(0, 0);
    return;
  }
  const t = e.target.closest("[data-go]");
  if (t) {
    e.preventDefault();
    if (t.dataset.go === "perfil") {
      S.pctx = t.dataset.ctx || null;
      S.svc = 0;
      S.day = null;
      S.slot = null;
    }
    go(t.dataset.go, t.dataset.id);
    return;
  }
  const s = e.target.closest("[data-pctx]");
  if (s) {
    S.pctx = s.dataset.pctx;
    if (S.view === "perfil" && S.role === "cliente") {
      const r = pr(S.pid);
      const m = r.svcs.findIndex((f) => f[3] === S.pctx);
      if (m >= 0 && r.svcs[S.svc] && r.svcs[S.svc][3] !== S.pctx) {
        S.svc = m;
      }
    }
    render();
    return;
  }
  const n = e.target.closest("[data-svc]");
  if (n) {
    if (S.svc !== +n.dataset.svc) {
      S.adds = [];
      S.intake = {};
    }
    S.svc = +n.dataset.svc;
    render();
    return;
  }
  const o = e.target.closest("[data-iqk]");
  if (o) {
    readIntake();
    S.intake = S.intake || {};
    const r = o.dataset.iqk;
    S.intake[r] = S.intake[r] === o.dataset.iqv ? void 0 : o.dataset.iqv;
    if (S.intake[r] === void 0) {
      delete S.intake[r];
    }
    render();
    return;
  }
  {
    const r = e.target.closest("[data-paym]");
    if (r) {
      S.payM = r.dataset.paym;
      render();
      return;
    }
  }
  const i = e.target.closest("[data-rate]");
  if (i) {
    S.rateN = +i.dataset.rate;
    const r = ($("#rateTxt") || {}).value || "";
    render();
    const m = $("#rateTxt");
    if (m) {
      m.value = r;
    }
    return;
  }
  const l = e.target.closest("[data-btab]");
  if (l) {
    selectBtab(l.dataset.btab);
    return;
  }
  const c = e.target.closest("[data-cf]");
  if (c) {
    S.cf = S.cf === c.dataset.cf && c.dataset.cf !== "todos" ? "todos" : c.dataset.cf;
    render();
    return;
  }
  const d = e.target.closest("[data-cli]");
  if (d) {
    S.cli = d.dataset.cli;
    S.btab = "clientes";
    render();
    window.scrollTo(0, 0);
    return;
  }
  const p = e.target.closest("[data-fp]");
  if (p) {
    S.fp = p.dataset.fp;
    if (p.dataset.fp === "dia" && S.btab !== "finanzas") {
      S.btab = "finanzas";
    }
    render();
    return;
  }
  const w = e.target.closest("[data-cat]");
  if (w) {
    S.cat = w.dataset.cat;
    S.q = "";
    render();
    return;
  }
  const y = e.target.closest("[data-preset]");
  if (y) {
    const r = PRESETS.find((f) => f[0] === y.dataset.preset);
    const m = cfg(ME());
    [1, 2, 3, 4, 5].forEach((f) => {
      m.days[f] = {
        on: true,
        m: H({}, r[3]),
        t: H({}, r[4]),
      };
    });
    api.m.saveSettings(m);
    S.hErr = null;
    toast(`Lunes a viernes: ${r[1].toLowerCase()} (${r[2]}). Ya se ve en tu agenda.`);
    render();
    return;
  }
  const k = e.target.closest("[data-hhp]");
  if (k) {
    $("#hhp").value = k.dataset.hhp;
    document.querySelectorAll("[data-hhp]").forEach((r) => r.setAttribute("aria-pressed", r === k));
    return;
  }
  const h = e.target.closest("[data-sv]");
  if (h) {
    S.sv = h.dataset.sv;
    render();
    return;
  }
  const j = e.target.closest("[data-swk]");
  if (j) {
    S.swk = Math.min(0, (S.swk || 0) + +j.dataset.swk);
    render();
    return;
  }
  const b = e.target.closest("[data-smo]");
  if (b) {
    S.smo = Math.min(SMAX(), (S.smo || 0) + +b.dataset.smo);
    render();
    return;
  }
  const g = e.target.closest("[data-syr]");
  if (g) {
    S.syr = +g.dataset.syr;
    render();
    return;
  }
  const M = e.target.closest("[data-fm]");
  if (M) {
    const r = ymk(TODAY());
    let [m, f] = (S.fm && S.fm <= r ? S.fm : r).split("-").map(Number);
    f += +M.dataset.fm;
    if (f < 1) {
      f = 12;
      m--;
    }
    if (f > 12) {
      f = 1;
      m++;
    }
    const u = m + "-" + pad(f);
    S.fm = u > r ? r : u;
    render();
    return;
  }
  const _ = e.target.closest("[data-fy]");
  if (_) {
    S.fy = +_.dataset.fy;
    render();
    return;
  }
  const D = e.target.closest("[data-day]");
  if (D) {
    S.day = D.dataset.day;
    S.slot = null;
    render();
    return;
  }
  const q = e.target.closest("[data-quick]");
  if (q) {
    const [r, m] = q.dataset.quick.split("|");
    const f = [];
    for (let u = 0; u < cfg(S.pid).ahead; u++) {
      f.push(dkey(addDays(u)));
    }
    S.day = r;
    S.wk = Math.floor(f.indexOf(r) / 7);
    S.slot = {
      date: r,
      time: m,
    };
    render();
    return;
  }
  const C = e.target.closest("[data-wk]");
  if (C) {
    S.wk = Math.max(0, (S.wk || 0) + +C.dataset.wk);
    const r = cfg(S.pid);
    const m = [];
    for (let E = 0; E < r.ahead; E++) {
      m.push(dkey(addDays(E)));
    }
    const f = m.slice(S.wk * 7, S.wk * 7 + 7);
    const u = selDur(pr(S.pid));
    S.day =
      f.find((E) => freeCount(S.pid, E, u, S.reprog) > 0) ||
      f.find((E) => !slotsFor(S.pid, E, u).closed) ||
      f[0];
    S.slot = null;
    render();
    return;
  }
  const T = e.target.closest("[data-slot]");
  if (T) {
    S.slot = {
      date: S.day,
      time: T.dataset.slot,
    };
    render();
    return;
  }
  const A = e.target.closest("[data-rep]");
  if (A) {
    S.rep = +A.dataset.rep;
    render();
    return;
  }
  const L = e.target.closest("[data-sel]");
  if (L) {
    S.sel = String(S.sel) === L.dataset.sel ? null : L.dataset.sel;
    S.bAsk = null;
    render();
    const r = $(".detail");
    if (r && r.scrollIntoView) {
      r.scrollIntoView({
        block: "nearest",
      });
    }
    return;
  }
  const I = e.target.closest("[data-awk]");
  if (I) {
    const r = [];
    for (let m = 0; m < 31; m++) {
      r.push(dkey(addDays(m)));
    }
    S.awk = Math.max(0, Math.min(Math.ceil(r.length / 7) - 1, (S.awk || 0) + +I.dataset.awk));
    S.aday = r[S.awk * 7];
    S.bAsk = null;
    S.sel = null;
    S.manOpen = false;
    S.blockOpen = false;
    render();
    return;
  }
  const z = e.target.closest("[data-aday]");
  if (z) {
    S.aday = z.dataset.aday;
    S.bAsk = null;
    S.sel = null;
    S.manOpen = false;
    S.blockOpen = false;
    render();
    return;
  }
  const G = e.target.closest("[data-medio]");
  if (G) {
    S.walkMedio = G.dataset.medio;
    document.querySelectorAll("[data-medio]").forEach((r) => r.setAttribute("aria-pressed", r === G));
    return;
  }
  const x = e.target.closest("[data-act]");
  if (!x) {
    return;
  }
  if (
    S.role === "barbero" &&
    S.preview &&
    x.dataset.act !== "exitPreview" &&
    x.dataset.act !== "salirBarbero"
  ) {
    toast("Es una vista previa: así lo ve un cliente. Para volver, tocá “Volver al panel”.");
    return;
  }
  const v = x.dataset.act;
  const accion = CLICK.get(v);
  if (accion) {
    accion(e, x, v);
  }
});

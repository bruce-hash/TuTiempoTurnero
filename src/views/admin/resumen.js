import { money, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dm } from "../../lib/fechas.js";
import { CATS } from "../../lib/rubros.js";
import { admIc } from "./admin.js";

export function admRes(e) {
  const a = e.st;
  const t = +a.commission_pct;
  const s = e.pv.filter((C) => C.status === "pending");
  const n = (C, T) => {
    C = +C || 0;
    T = +T || 0;
    if (!T) {
      return "";
    }
    const A = Math.round(((C - T) / T) * 100);
    return `<em class="dl">${A >= 0 ? "▲" : "▼"} ${Math.abs(A)}% vs. mes pasado</em>`;
  };
  const o = (C, T, A, L) =>
    `<div class="kpi"><span>${C}</span><b>${T}</b>${L || ""}${A ? `<small>${A}</small>` : ""}</div>`;
  const i = +a.bookings_month || 0;
  const l = i ? Math.round(+a.gross_month / i) : 0;
  const c = i ? Math.round((+a.no_show_month / i) * 100) : 0;
  const d = (a.by_day || []).map((C) => ({
    day: String(C.day).slice(0, 10),
    n: +C.n || 0,
    gross: +C.gross || 0,
    fee: +C.fee || 0,
  }));
  const p = [0, 1, 2, 3]
    .map((C) => {
      const T = d.slice(Math.max(0, d.length - (C + 1) * 7), Math.max(0, d.length - C * 7));
      const A = {
        n: 0,
        gross: 0,
        fee: 0,
        from: T.length ? T[0].day : "",
        to: T.length ? T[T.length - 1].day : "",
      };
      T.forEach((L) => {
        A.n += L.n;
        A.gross += L.gross;
        A.fee += L.fee;
      });
      return A;
    })
    .filter((C) => C.from);
  const w = Math.max(1, ...p.map((C) => C.n));
  const y = ["Últimos 7 días", "La semana anterior", "Hace 2 semanas", "Hace 3 semanas"];
  const k = d[d.length - 1] || {
    n: 0,
    fee: 0,
  };
  const h = d[d.length - 2] || {
    n: 0,
    fee: 0,
  };
  const j = [
    s.length
      ? `🪪 <b>${s.length}</b> prestador${s.length > 1 ? "es esperan" : " espera"} la verificación del DNI. <button class="lnk" data-act="admT" data-t="prov">Revisar</button>`
      : "",
    +a.mp_missing
      ? `💳 <b>${a.mp_missing}</b> prestador${+a.mp_missing > 1 ? "es activos no conectaron" : " activo no conectó"} Mercado Pago: no pueden cobrar señas.`
      : "",
    +a.providers_suspended
      ? `⛔ <b>${a.providers_suspended}</b> suspendido${+a.providers_suspended > 1 ? "s" : ""}.`
      : "",
    c >= 8 ? `⚠ Las faltas llegan al ${c}% de los turnos del mes.` : "",
  ].filter(Boolean);
  const b = a.by_category_month || {};
  const g = a.by_category || {};
  const M = Math.max(1, ...CATS.map(([C]) => +b[C] || 0));
  const _ = p[0];
  const D = p[1];
  const q = _ && D && D.n ? Math.round(((_.n - D.n) / D.n) * 100) : null;
  return `<div class="kpi big admhero"><span>Comisión de TuTiempo este mes (${pctTxt(t)}%)</span><b>${money(+a.commission_month || 0)}</b>${n(a.commission_month, a.commission_prev)}</div>
   ${j.length ? `<div class="panel admalert"><p class="lbl">Para revisar</p><ul class="adml">${j.map((C) => `<li>${C}</li>`).join("")}</ul></div>` : ""}
   <div class="admday"><div><span>Hoy</span><b>${k.n} turno${k.n === 1 ? "" : "s"}</b><small>Comisión ${money(k.fee)}</small></div><div><span>Ayer</span><b>${h.n} turno${h.n === 1 ? "" : "s"}</b><small>Comisión ${money(h.fee)}</small></div></div>
   <div class="panel"><p class="lbl">Cómo vienen las semanas</p>
    <div class="wks">${p
      .map(
        (
          C,
          T,
        ) => `<div class="wkrow${T === 0 ? " cur" : ""}"><div class="wkh"><b>${y[T]}</b><span>${dm(C.from)} al ${dm(C.to)}</span></div><div class="wkv"><b>${C.n}</b><span>turnos</span></div>
      <div class="wkbar" aria-hidden="true"><i style="width:${Math.round((C.n / w) * 100)}%"></i></div><p class="wkm">Facturado <b>${money(C.gross)}</b> · Comisión <b>${money(C.fee)}</b></p></div>`,
      )
      .join("")}</div>
    ${q != null ? `<p class="note wknote">${q >= 0 ? "📈" : "📉"} En los últimos 7 días hubo <b>${Math.abs(q)}% ${q >= 0 ? "más" : "menos"}</b> turnos que la semana anterior.</p>` : ""}</div>
   <div class="kpis adm">${o("Facturado por la app", money(+a.gross_month || 0), "este mes", n(a.gross_month, a.gross_prev))}${o("Turnos del mes", i, "", n(i, a.bookings_prev))}
    ${o("Ticket promedio", money(l), "por turno")}${o("Señas cobradas", money(+a.deposits_month || 0), "para los prestadores")}
    ${o("Prestadores activos", a.providers_active, `+${a.new_providers_month || 0} nuevos este mes`)}${o("Clientes", a.clients, `+${a.new_clients_month || 0} nuevos este mes`)}
    ${o("Faltas", c + "%", `${a.no_show_month || 0} turno${+a.no_show_month == 1 ? "" : "s"} sin aviso`)}${o("Cancelaciones", +a.cancelled_month || 0, "avisaron que no iban")}</div>
   <div class="panel"><p class="lbl">Los más activos · últimos 30 días</p><ol class="ag admtop">${(a.top || []).map((C, T) => `<li><span class="rankn">${T + 1}</span><div><b>${esc(C.name)}</b><span>${admIc(C.cats)} ${C.activity} servicio${+C.activity == 1 ? "" : "s"} hechos</span></div><b>${C.activity}</b></li>`).join("") || "<li><span></span><div><span>Todavía no hay servicios hechos.</span></div></li>"}</ol>
    <p class="note" style="text-align:left;margin:8px 0 0">Así se ordenan en la app: primero los que más servicios hacen.</p></div>
   <div class="panel"><p class="lbl">Rubros · turnos del mes</p>${CATS.map(([C, T, A, L]) => {
     const I = +b[C] || 0;
     return `<div class="srow"><div class="srow-h"><span>${L} ${T} <span class="hint">· ${+g[C] || 0} prestador${+g[C] == 1 ? "" : "es"}</span></span><b>${I}</b></div><div class="sbar"><i style="width:${Math.round((I / M) * 100)}%;background:var(--brand)"></i></div></div>`;
   }).join("")}</div>`;
}

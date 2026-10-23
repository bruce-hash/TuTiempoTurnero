import { money, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dm } from "../../lib/fechas.js";
import { CATS } from "../../lib/rubros.js";
import { admIc } from "./admin.js";
import { admReview } from "./revisar.js";

// resumen del admin: comisión del mes, alertas, hoy y ayer, últimas 4 semanas, indicadores, más activos y rubros
export function admRes(data) {
  const st = data.st;
  const pct = +st.commission_pct;
  const pending = data.pv.filter((prov) => prov.status === "pending");
  // variación contra el mes pasado
  const delta = (now, prev) => {
    now = +now || 0;
    prev = +prev || 0;
    if (!prev) {
      return "";
    }
    const change = Math.round(((now - prev) / prev) * 100);
    return `<em class="dl">${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}% vs. mes pasado</em>`;
  };
  const kpi = (label, value, sub, extra) =>
    `<div class="kpi"><span>${label}</span><b>${value}</b>${extra || ""}${sub ? `<small>${sub}</small>` : ""}</div>`;
  const nMonth = +st.bookings_month || 0;
  const ticket = nMonth ? Math.round(+st.gross_month / nMonth) : 0;
  const nsPct = nMonth ? Math.round((+st.no_show_month / nMonth) * 100) : 0;
  const days = (st.by_day || []).map((row) => ({
    day: String(row.day).slice(0, 10),
    n: +row.n || 0,
    gross: +row.gross || 0,
    fee: +row.fee || 0,
  }));
  // by_day trae los últimos 30 días: se agrupan de a 7 desde hoy para atrás
  const weeks = [0, 1, 2, 3]
    .map((weeksAgo) => {
      const wdays = days.slice(Math.max(0, days.length - (weeksAgo + 1) * 7), Math.max(0, days.length - weeksAgo * 7));
      const week = {
        n: 0,
        gross: 0,
        fee: 0,
        from: wdays.length ? wdays[0].day : "",
        to: wdays.length ? wdays[wdays.length - 1].day : "",
      };
      wdays.forEach((day) => {
        week.n += day.n;
        week.gross += day.gross;
        week.fee += day.fee;
      });
      return week;
    })
    .filter((week) => week.from);
  const maxN = Math.max(1, ...weeks.map((week) => week.n));
  const labels = ["Últimos 7 días", "La semana anterior", "Hace 2 semanas", "Hace 3 semanas"];
  const today = days[days.length - 1] || {
    n: 0,
    fee: 0,
  };
  const yesterday = days[days.length - 2] || {
    n: 0,
    fee: 0,
  };
  const alerts = [
    pending.length
      ? `🪪 <b>${pending.length}</b> prestador${pending.length > 1 ? "es esperan" : " espera"} la verificación del DNI. <button class="lnk" data-act="admT" data-t="prov">Revisar</button>`
      : "",
    +st.mp_missing
      ? `💳 <b>${st.mp_missing}</b> prestador${+st.mp_missing > 1 ? "es activos no conectaron" : " activo no conectó"} Mercado Pago: no pueden cobrar señas.`
      : "",
    +st.providers_suspended
      ? `⛔ <b>${st.providers_suspended}</b> suspendido${+st.providers_suspended > 1 ? "s" : ""}.`
      : "",
    nsPct >= 8 ? `⚠ Las faltas llegan al ${nsPct}% de los turnos del mes.` : "",
  ].filter(Boolean);
  const byCatMonth = st.by_category_month || {};
  const byCat = st.by_category || {};
  const maxCat = Math.max(1, ...CATS.map(([cat]) => +byCatMonth[cat] || 0));
  const thisWeek = weeks[0];
  const lastWeek = weeks[1];
  const trend = thisWeek && lastWeek && lastWeek.n ? Math.round(((thisWeek.n - lastWeek.n) / lastWeek.n) * 100) : null;
  return `<div class="kpi big admhero"><span>Comisión de TuTiempo este mes (${pctTxt(pct)}%)</span><b>${money(+st.commission_month || 0)}</b>${delta(st.commission_month, st.commission_prev)}</div>
   ${alerts.length ? `<div class="panel admalert"><p class="lbl">Para revisar</p><ul class="adml">${alerts.map((alert) => `<li>${alert}</li>`).join("")}</ul></div>` : ""}
   ${admReview()}
   <div class="admday"><div><span>Hoy</span><b>${today.n} turno${today.n === 1 ? "" : "s"}</b><small>Comisión ${money(today.fee)}</small></div><div><span>Ayer</span><b>${yesterday.n} turno${yesterday.n === 1 ? "" : "s"}</b><small>Comisión ${money(yesterday.fee)}</small></div></div>
   <div class="panel"><p class="lbl">Cómo vienen las semanas</p>
    <div class="wks">${weeks
      .map(
        (
          week,
          index,
        ) => `<div class="wkrow${index === 0 ? " cur" : ""}"><div class="wkh"><b>${labels[index]}</b><span>${dm(week.from)} al ${dm(week.to)}</span></div><div class="wkv"><b>${week.n}</b><span>turnos</span></div>
      <div class="wkbar" aria-hidden="true"><i style="width:${Math.round((week.n / maxN) * 100)}%"></i></div><p class="wkm">Facturado <b>${money(week.gross)}</b> · Comisión <b>${money(week.fee)}</b></p></div>`,
      )
      .join("")}</div>
    ${trend != null ? `<p class="note wknote">${trend >= 0 ? "📈" : "📉"} En los últimos 7 días hubo <b>${Math.abs(trend)}% ${trend >= 0 ? "más" : "menos"}</b> turnos que la semana anterior.</p>` : ""}</div>
   <div class="kpis adm">${kpi("Facturado por la app", money(+st.gross_month || 0), "este mes", delta(st.gross_month, st.gross_prev))}${kpi("Turnos del mes", nMonth, "", delta(nMonth, st.bookings_prev))}
    ${kpi("Ticket promedio", money(ticket), "por turno")}${kpi("Señas cobradas", money(+st.deposits_month || 0), "para los prestadores")}
    ${kpi("Prestadores activos", st.providers_active, `+${st.new_providers_month || 0} nuevos este mes`)}${kpi("Clientes", st.clients, `+${st.new_clients_month || 0} nuevos este mes`)}
    ${kpi("Faltas", nsPct + "%", `${st.no_show_month || 0} turno${+st.no_show_month == 1 ? "" : "s"} sin aviso`)}${kpi("Cancelaciones", +st.cancelled_month || 0, "avisaron que no iban")}</div>
   <div class="panel"><p class="lbl">Los más activos · últimos 30 días</p><ol class="ag admtop">${(st.top || []).map((prov, index) => `<li><span class="rankn">${index + 1}</span><div><b>${esc(prov.name)}</b><span>${admIc(prov.cats)} ${prov.activity} servicio${+prov.activity == 1 ? "" : "s"} hechos</span></div><b>${prov.activity}</b></li>`).join("") || "<li><span></span><div><span>Todavía no hay servicios hechos.</span></div></li>"}</ol>
    <p class="note" style="text-align:left;margin:8px 0 0">Así se ordenan en la app: primero los que más servicios hacen.</p></div>
   <div class="panel"><p class="lbl">Rubros · turnos del mes</p>${CATS.map(([cat, plural, one, icon]) => {
     const count = +byCatMonth[cat] || 0;
     return `<div class="srow"><div class="srow-h"><span>${icon} ${plural} <span class="hint">· ${+byCat[cat] || 0} prestador${+byCat[cat] == 1 ? "" : "es"}</span></span><b>${count}</b></div><div class="sbar"><i style="width:${Math.round((count / maxCat) * 100)}%;background:var(--brand)"></i></div></div>`;
   }).join("")}</div>`;
}

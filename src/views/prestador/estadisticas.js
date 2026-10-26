import { LIVE } from "../../config.js";
import { DOW, MESES, NOW, TODAY, addDays, dayLabel, dkey, pad, toMin } from "../../lib/fechas.js";
import { ME } from "../../lib/prestadores.js";
import { busy, cfg, ranges } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { YEARS } from "./finanzas.js";
import { DNAME } from "./horarios.js";
import { demoMonthTotals, demoOcc } from "../../demo/estadisticas.js";

store.OCCD = {};
store.MTOT = {};
// horas (0 a 23) en las que el prestador trabaja algún día de la semana
function workHours() {
  const conf = cfg(ME());
  const hours = /* @__PURE__ */ new Set();
  for (let dow = 0; dow < 7; dow++) {
    ranges(conf, dow).forEach(([from, to]) => {
      for (let hour = Math.floor(from / 60); hour * 60 < to; hour++) {
        hours.add(hour);
      }
    });
  }
  return [...hours].sort((one, other) => one - other);
}
// porcentaje ocupado de una hora de un día (null si no trabaja). Hoy y adelante, desde la agenda; en vivo, los días
// pasados vienen de la base (store.OCCD); en la demo se inventan con una fórmula.
function occAt(date, hour) {
  const conf = cfg(ME());
  const dow = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (!ranges(conf, dow).some(([from, to]) => hour * 60 >= from && hour * 60 < to)) {
    return null;
  }
  const used = busy(ME(), date)
    .filter((item) => item.type !== "block")
    .reduce((sum, item) => {
      const start = toMin(item.time);
      const end = start + item.dur;
      return sum + Math.max(0, Math.min(end, hour * 60 + 60) - Math.max(start, hour * 60));
    }, 0);
  const real = Math.min(100, Math.round((used / 60) * 100));
  if (date > TODAY()) {
    return real;
  }
  if (LIVE) {
    if (date === TODAY()) {
      return real;
    } else {
      return Math.min(100, Math.round(((store.OCCD[date + "|" + hour] || 0) / 60) * 100));
    }
  }
  return demoOcc(date, dow, hour, real);
}
const dayOcc = (date) => {
  const occs = workHours()
    .map((hour) => occAt(date, hour))
    .filter((occ) => occ != null);
  if (occs.length) {
    return Math.round(occs.reduce((sum, occ) => sum + occ, 0) / occs.length);
  } else {
    return null;
  }
};
const occCls = (pct) => (pct == null ? "cl" : pct < 35 ? "lo" : pct < 60 ? "md" : pct < 80 ? "hi" : "fu");
// lunes de la semana actual (off = semanas para adelante o para atrás)
function weekStart(off) {
  const monday = addDays(0);
  const dow = monday.getDay();
  monday.setDate(monday.getDate() - ((dow + 6) % 7) + off * 7);
  return monday;
}
// ocupación promedio de ese día de la semana y hora en las últimas 4 semanas
function patt(dow, hour) {
  let sum = 0;
  let count = 0;
  const monday = weekStart(0);
  for (let weeksAgo = 1; weeksAgo <= 4; weeksAgo++) {
    const date = new Date(monday);
    date.setDate(date.getDate() - weeksAgo * 7 + ((dow + 6) % 7));
    const occ = occAt(dkey(date), hour);
    if (occ != null) {
      sum += occ;
      count++;
    }
  }
  if (count) {
    return Math.round(sum / count);
  } else {
    return null;
  }
}
// franjas de 2 horas con su ocupación promedio; las 4 más tranquilas quedan marcadas como sugerencia
function quietWindows() {
  const conf = cfg(ME());
  const windows = [];
  [1, 2, 3, 4, 5, 6, 0].forEach((dow) =>
    ranges(conf, dow).forEach(([from, to]) => {
      for (let hour = Math.ceil(from / 60); hour * 60 + 60 <= to; hour += 2) {
        const endHour = Math.min(hour + 2, Math.floor(to / 60));
        const occs = [];
        for (let slotHour = hour; slotHour < endHour; slotHour++) {
          const occ = patt(dow, slotHour);
          if (occ != null) {
            occs.push(occ);
          }
        }
        if (occs.length) {
          windows.push({
            key: dow + "|" + pad(hour),
            dow: dow,
            h: hour,
            e: endHour,
            v: Math.round(occs.reduce((sum, occ) => sum + occ, 0) / occs.length),
          });
        }
      }
    }),
  );
  const quietest = [...windows]
    .sort((one, other) => one.v - other.v)
    .slice(0, 4)
    .map((win) => win.key);
  windows.forEach((win) => (win.sug = quietest.includes(win.key)));
  return windows;
}
export const SMAX = () => (2028 - NOW().getFullYear()) * 12 + (11 - NOW().getMonth());
// pestaña Estadísticas: mapa de calor de la semana, calendario del mes u ocupación del año, y horarios flojos
export function vBStats() {
  const view = S.sv || "semana";
  const hours = workHours();
  const tabs = `<div class="seg3" role="group" aria-label="Vista"><button data-sv="semana" aria-pressed="${view === "semana"}">Semana</button><button data-sv="mes" aria-pressed="${view === "mes"}">Mes</button><button data-sv="anio" aria-pressed="${view === "anio"}">Año</button></div>`;
  const legend =
    '<div class="oleg"><span><i class="oc lo"></i>Libre</span><span><i class="oc md"></i>Medio</span><span><i class="oc hi"></i>Casi lleno</span><span><i class="oc fu"></i>Lleno</span><span><i class="oc cl"></i>No trabajás</span></div>';
  let body = "";
  if (view === "semana") {
    const weekOff = S.swk || 0;
    const monday = weekStart(weekOff);
    const days = Array.from(
      {
        length: 7,
      },
      (slot, index) => {
        const date = new Date(monday);
        date.setDate(date.getDate() + index);
        return dkey(date);
      },
    );
    const shortDate = (date) => {
      const jsDate = /* @__PURE__ */ new Date(date + "T12:00:00");
      return jsDate.getDate() + " " + MESES[jsDate.getMonth()].slice(0, 3);
    };
    const isFuture = (date) => date > TODAY();
    const occs = days
      .map((date) => (isFuture(date) ? null : dayOcc(date)))
      .map((occ, index) => [occ, index])
      .filter((pair) => pair[0] != null);
    const quietest = occs.length ? occs.reduce((best, pair) => (pair[0] < best[0] ? pair : best)) : null;
    const busiest = occs.length ? occs.reduce((best, pair) => (pair[0] > best[0] ? pair : best)) : null;
    const byHour = hours
      .map((hour) => {
        const occs = days
          .filter((date) => !isFuture(date))
          .map((date) => occAt(date, hour))
          .filter((occ) => occ != null);
        return [hour, occs.length ? occs.reduce((sum, occ) => sum + occ, 0) / occs.length : null];
      })
      .filter((pair) => pair[1] != null);
    const quietHour = byHour.length ? byHour.reduce((best, pair) => (pair[1] < best[1] ? pair : best)) : null;
    body = `<div class="wnav"><button class="pk-nav" data-swk="-1" aria-label="Semana anterior">‹</button><div><b>${weekOff === 0 ? "Esta semana" : weekOff === -1 ? "Semana pasada" : "Hace " + -weekOff + " semanas"}</b><span>Lunes ${shortDate(days[0])} al domingo ${shortDate(days[6])}</span></div><button class="pk-nav" data-swk="1" ${weekOff >= 0 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div>
    ${quietest ? `<p class="insight">Tu día más tranquilo: <b>${DNAME[/* @__PURE__ */ new Date(days[quietest[1]] + "T12:00:00").getDay()].toLowerCase()}</b> (${quietest[0]}%). El más lleno: <b>${DNAME[/* @__PURE__ */ new Date(days[busiest[1]] + "T12:00:00").getDay()].toLowerCase()}</b> (${busiest[0]}%). La hora más floja: <b>${quietHour[0]} h</b>.</p>` : ""}
    <div class="hm2wrap"><table class="hm2"><thead><tr><th></th>${days
      .map((date) => {
        const jsDate = /* @__PURE__ */ new Date(date + "T12:00:00");
        return `<th class="${date === TODAY() ? "today" : ""}">${DOW[jsDate.getDay()]}<span>${jsDate.getDate()}</span></th>`;
      })
      .join("")}</tr></thead>
     <tbody>${hours
       .map(
         (hour) =>
           `<tr><th>${hour} h</th>${days
             .map((date) => {
               const occ = occAt(date, hour);
               const future = isFuture(date) && occ != null;
               return `<td><span class="oc ${future ? "fut" : occCls(occ)}" title="${dayLabel(date)} ${hour} h: ${occ == null ? "no trabajás" : future ? "todavía no pasó" : occ + "% ocupado"}"></span></td>`;
             })
             .join("")}</tr>`,
       )
       .join("")}
     </tbody></table></div>
    <p class="note" style="margin-top:6px">El color muestra qué tan ocupada estuvo cada hora: cuanto más oscuro, más gente. Los días que todavía no pasaron quedan en blanco.</p>`;
  } else if (view === "mes") {
    const monthOff = S.smo || 0;
    const first = NOW();
    first.setDate(1);
    first.setMonth(first.getMonth() + monthOff);
    const year = first.getFullYear();
    const month = first.getMonth();
    const nDays = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const cells = [];
    for (let index = 0; index < lead; index++) {
      cells.push('<span class="cal-e"></span>');
    }
    const occs = [];
    for (let dayN = 1; dayN <= nDays; dayN++) {
      const date = year + "-" + pad(month + 1) + "-" + pad(dayN);
      const future = date > TODAY();
      const occ = future ? null : dayOcc(date);
      if (occ != null) {
        occs.push(occ);
      }
      cells.push(
        `<span class="cal-d ${future ? "fut" : occCls(occ)} ${date === TODAY() ? "today" : ""}" title="${dayN}: ${future ? "todavía no pasó" : occ == null ? "no trabajás" : occ + "% ocupado"}"><b>${dayN}</b><i>${future || occ == null ? "" : occ + "%"}</i></span>`,
      );
    }
    body = `<div class="wnav"><button class="pk-nav" data-smo="-1" aria-label="Mes anterior">‹</button><div><b style="text-transform:capitalize">${MESES[month]} ${year}</b><span>Promedio: ${occs.length ? Math.round(occs.reduce((sum, occ) => sum + occ, 0) / occs.length) + "% ocupado" : "sin datos"}</span></div><button class="pk-nav" data-smo="1" ${monthOff >= SMAX() ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>
    <div class="cal">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((label) => `<span class="cal-h">${label}</span>`).join("")}${cells.join("")}</div>`;
  } else {
    const year = S.syr || NOW().getFullYear();
    const nowYear = NOW().getFullYear();
    const nowMonth = NOW().getMonth();
    const months = Array.from(
      {
        length: 12,
      },
      (slot, month) => {
        if (year > nowYear || (year === nowYear && month > nowMonth)) {
          return null;
        }
        const nDays = new Date(year, month + 1, 0).getDate();
        const occs = [];
        for (let dayN = 1; dayN <= nDays; dayN += 2) {
          const date = year + "-" + pad(month + 1) + "-" + pad(dayN);
          if (date > TODAY()) {
            break;
          }
          const occ = dayOcc(date);
          if (occ != null) {
            occs.push(occ);
          }
        }
        if (occs.length) {
          return Math.round(occs.reduce((sum, occ) => sum + occ, 0) / occs.length);
        } else {
          return null;
        }
      },
    );
    body = `<div class="yearsel">${YEARS()
      .map((option) => `<button data-syr="${option}" aria-pressed="${year === option}">${option}</button>`)
      .join("")}</div>
    <div class="bars ybars occb">${months.map((occ, month) => `<div class="bar-c" title="${MESES[month]}: ${occ == null ? "sin datos" : occ + "% ocupado"}"><em>${occ == null ? "" : occ + "%"}</em><i class="${occCls(occ)}" style="height:${occ || 0}%"></i><span>${MESES[month].slice(0, 3)}</span></div>`).join("")}</div>
    <p class="note" style="margin-top:6px">Ocupación promedio de cada mes, en tus horas de trabajo.</p>`;
  }
  const quiet = quietWindows()
    .filter((win) => win.sug)
    .sort((one, other) => one.v - other.v);
  return `${tabs}<div class="panel"><p class="lbl">¿Cuándo tenés más gente?</p>${body}${legend}</div>
  ${
    quiet.length
      ? `<div class="panel"><p class="lbl">Tus horarios más flojos</p><p style="margin:0 0 10px;font-size:14px;text-align:left">Según las últimas 4 semanas. Llenalos con un happy hour o avisando a tus seguidores.</p>
   <ul class="ag">${quiet.map((win) => `<li><span class="ag-t">${win.h}–${win.e} h</span><div><b>${DNAME[win.dow]}</b><span>${win.v}% ocupado</span></div><span class="chip ${win.v < 35 ? "ok" : "gray"}">${win.v < 35 ? "Libre" : "Medio"}</span></li>`).join("")}</ul>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><button class="btn btn-ghost" data-btab="horarios">Armar happy hour</button><button class="btn btn-ghost" data-btab="comunidad">Avisar a seguidores</button></div></div>`
      : ""
  }`;
}
// las 6 franjas más tranquilas (para sugerir el happy hour)
export function lowWindows() {
  return quietWindows()
    .sort((one, other) => one.v - other.v)
    .slice(0, 6);
}

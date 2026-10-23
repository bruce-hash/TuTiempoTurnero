import { LIVE } from "../../config.js";
import { DOW, MESES, NOW, TODAY, addDays, dayLabel, dkey, pad, toMin } from "../../lib/fechas.js";
import { ME } from "../../lib/prestadores.js";
import { busy, cfg, ranges } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { YEARS } from "./finanzas.js";
import { DNAME } from "./horarios.js";

store.OCCD = {};
store.MTOT = {};
function workHours() {
  const e = cfg(ME());
  const a = /* @__PURE__ */ new Set();
  for (let t = 0; t < 7; t++) {
    ranges(e, t).forEach(([s, n]) => {
      for (let o = Math.floor(s / 60); o * 60 < n; o++) {
        a.add(o);
      }
    });
  }
  return [...a].sort((t, s) => t - s);
}
function occAt(date, a) {
  const t = cfg(ME());
  const s = /* @__PURE__ */ new Date(date + "T12:00:00").getDay();
  if (!ranges(t, s).some(([d, p]) => a * 60 >= d && a * 60 < p)) {
    return null;
  }
  const n = busy(ME(), date)
    .filter((d) => d.type !== "block")
    .reduce((d, p) => {
      const w = toMin(p.time);
      const y = w + p.dur;
      return d + Math.max(0, Math.min(y, a * 60 + 60) - Math.max(w, a * 60));
    }, 0);
  const o = Math.min(100, Math.round((n / 60) * 100));
  if (date > TODAY()) {
    return o;
  }
  if (LIVE) {
    if (date === TODAY()) {
      return o;
    } else {
      return Math.min(100, Math.round(((store.OCCD[date + "|" + a] || 0) / 60) * 100));
    }
  }
  const i = {
    0: 0.5,
    1: 0.85,
    2: 0.8,
    3: 0.9,
    4: 1,
    5: 1.2,
    6: 1.1,
  }[s];
  const l = a < 12 ? 22 + (a - 9) * 10 : a < 15 ? 30 : a < 17 ? 32 + (a - 15) * 14 : 68 + (a - 17) * 7;
  const c = ((+date.replace(/-/g, "") + a * 7) % 17) - 8;
  return Math.max(0, Math.min(100, Math.max(o, Math.round(l * i + c))));
}
const dayOcc = (e) => {
  const a = workHours()
    .map((t) => occAt(e, t))
    .filter((t) => t != null);
  if (a.length) {
    return Math.round(a.reduce((t, s) => t + s, 0) / a.length);
  } else {
    return null;
  }
};
const occCls = (e) => (e == null ? "cl" : e < 35 ? "lo" : e < 60 ? "md" : e < 80 ? "hi" : "fu");
function weekStart(off) {
  const a = addDays(0);
  const t = a.getDay();
  a.setDate(a.getDate() - ((t + 6) % 7) + off * 7);
  return a;
}
function patt(dow, a) {
  let t = 0;
  let s = 0;
  const n = weekStart(0);
  for (let o = 1; o <= 4; o++) {
    const i = new Date(n);
    i.setDate(i.getDate() - o * 7 + ((dow + 6) % 7));
    const l = occAt(dkey(i), a);
    if (l != null) {
      t += l;
      s++;
    }
  }
  if (s) {
    return Math.round(t / s);
  } else {
    return null;
  }
}
function quietWindows() {
  const e = cfg(ME());
  const a = [];
  [1, 2, 3, 4, 5, 6, 0].forEach((s) =>
    ranges(e, s).forEach(([n, o]) => {
      for (let i = Math.ceil(n / 60); i * 60 + 60 <= o; i += 2) {
        const l = Math.min(i + 2, Math.floor(o / 60));
        const c = [];
        for (let d = i; d < l; d++) {
          const p = patt(s, d);
          if (p != null) {
            c.push(p);
          }
        }
        if (c.length) {
          a.push({
            key: s + "|" + pad(i),
            dow: s,
            h: i,
            e: l,
            v: Math.round(c.reduce((d, p) => d + p, 0) / c.length),
          });
        }
      }
    }),
  );
  const t = [...a]
    .sort((s, n) => s.v - n.v)
    .slice(0, 4)
    .map((s) => s.key);
  a.forEach((s) => (s.sug = t.includes(s.key)));
  return a;
}
export const SMAX = () => (2028 - NOW().getFullYear()) * 12 + (11 - NOW().getMonth());
export function vBStats() {
  const e = S.sv || "semana";
  const a = workHours();
  const t = `<div class="seg3" role="group" aria-label="Vista"><button data-sv="semana" aria-pressed="${e === "semana"}">Semana</button><button data-sv="mes" aria-pressed="${e === "mes"}">Mes</button><button data-sv="anio" aria-pressed="${e === "anio"}">Año</button></div>`;
  const s =
    '<div class="oleg"><span><i class="oc lo"></i>Libre</span><span><i class="oc md"></i>Medio</span><span><i class="oc hi"></i>Casi lleno</span><span><i class="oc fu"></i>Lleno</span><span><i class="oc cl"></i>No trabajás</span></div>';
  let n = "";
  if (e === "semana") {
    const i = S.swk || 0;
    const l = weekStart(i);
    const c = Array.from(
      {
        length: 7,
      },
      (g, M) => {
        const _ = new Date(l);
        _.setDate(_.getDate() + M);
        return dkey(_);
      },
    );
    const d = (g) => {
      const M = /* @__PURE__ */ new Date(g + "T12:00:00");
      return M.getDate() + " " + MESES[M.getMonth()].slice(0, 3);
    };
    const p = (g) => g > TODAY();
    const y = c
      .map((g) => (p(g) ? null : dayOcc(g)))
      .map((g, M) => [g, M])
      .filter((g) => g[0] != null);
    const k = y.length ? y.reduce((g, M) => (M[0] < g[0] ? M : g)) : null;
    const h = y.length ? y.reduce((g, M) => (M[0] > g[0] ? M : g)) : null;
    const j = a
      .map((g) => {
        const M = c
          .filter((_) => !p(_))
          .map((_) => occAt(_, g))
          .filter((_) => _ != null);
        return [g, M.length ? M.reduce((_, D) => _ + D, 0) / M.length : null];
      })
      .filter((g) => g[1] != null);
    const b = j.length ? j.reduce((g, M) => (M[1] < g[1] ? M : g)) : null;
    n = `<div class="wnav"><button class="pk-nav" data-swk="-1" aria-label="Semana anterior">‹</button><div><b>${i === 0 ? "Esta semana" : i === -1 ? "Semana pasada" : "Hace " + -i + " semanas"}</b><span>Lunes ${d(c[0])} al domingo ${d(c[6])}</span></div><button class="pk-nav" data-swk="1" ${i >= 0 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div>
    ${k ? `<p class="insight">Tu día más tranquilo: <b>${DNAME[/* @__PURE__ */ new Date(c[k[1]] + "T12:00:00").getDay()].toLowerCase()}</b> (${k[0]}%). El más lleno: <b>${DNAME[/* @__PURE__ */ new Date(c[h[1]] + "T12:00:00").getDay()].toLowerCase()}</b> (${h[0]}%). La hora más floja: <b>${b[0]} h</b>.</p>` : ""}
    <div class="hm2wrap"><table class="hm2"><thead><tr><th></th>${c
      .map((g) => {
        const M = /* @__PURE__ */ new Date(g + "T12:00:00");
        return `<th class="${g === TODAY() ? "today" : ""}">${DOW[M.getDay()]}<span>${M.getDate()}</span></th>`;
      })
      .join("")}</tr></thead>
     <tbody>${a
       .map(
         (g) =>
           `<tr><th>${g} h</th>${c
             .map((M) => {
               const _ = occAt(M, g);
               const D = p(M) && _ != null;
               return `<td><span class="oc ${D ? "fut" : occCls(_)}" title="${dayLabel(M)} ${g} h: ${_ == null ? "no trabajás" : D ? "todavía no pasó" : _ + "% ocupado"}"></span></td>`;
             })
             .join("")}</tr>`,
       )
       .join("")}
     </tbody></table></div>
    <p class="note" style="margin-top:6px">El color muestra qué tan ocupada estuvo cada hora: cuanto más oscuro, más gente. Los días que todavía no pasaron quedan en blanco.</p>`;
  } else if (e === "mes") {
    const i = S.smo || 0;
    const l = NOW();
    l.setDate(1);
    l.setMonth(l.getMonth() + i);
    const c = l.getFullYear();
    const d = l.getMonth();
    const p = new Date(c, d + 1, 0).getDate();
    const w = (new Date(c, d, 1).getDay() + 6) % 7;
    const y = [];
    for (let h = 0; h < w; h++) {
      y.push('<span class="cal-e"></span>');
    }
    const k = [];
    for (let h = 1; h <= p; h++) {
      const j = c + "-" + pad(d + 1) + "-" + pad(h);
      const b = j > TODAY();
      const g = b ? null : dayOcc(j);
      if (g != null) {
        k.push(g);
      }
      y.push(
        `<span class="cal-d ${b ? "fut" : occCls(g)} ${j === TODAY() ? "today" : ""}" title="${h}: ${b ? "todavía no pasó" : g == null ? "no trabajás" : g + "% ocupado"}"><b>${h}</b><i>${b || g == null ? "" : g + "%"}</i></span>`,
      );
    }
    n = `<div class="wnav"><button class="pk-nav" data-smo="-1" aria-label="Mes anterior">‹</button><div><b style="text-transform:capitalize">${MESES[d]} ${c}</b><span>Promedio: ${k.length ? Math.round(k.reduce((h, j) => h + j, 0) / k.length) + "% ocupado" : "sin datos"}</span></div><button class="pk-nav" data-smo="1" ${i >= SMAX() ? "disabled" : ""} aria-label="Mes siguiente">›</button></div>
    <div class="cal">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((h) => `<span class="cal-h">${h}</span>`).join("")}${y.join("")}</div>`;
  } else {
    const i = S.syr || NOW().getFullYear();
    const l = NOW().getFullYear();
    const c = NOW().getMonth();
    const d = Array.from(
      {
        length: 12,
      },
      (p, w) => {
        if (i > l || (i === l && w > c)) {
          return null;
        }
        const y = new Date(i, w + 1, 0).getDate();
        const k = [];
        for (let h = 1; h <= y; h += 2) {
          const j = i + "-" + pad(w + 1) + "-" + pad(h);
          if (j > TODAY()) {
            break;
          }
          const b = dayOcc(j);
          if (b != null) {
            k.push(b);
          }
        }
        if (k.length) {
          return Math.round(k.reduce((h, j) => h + j, 0) / k.length);
        } else {
          return null;
        }
      },
    );
    n = `<div class="yearsel">${YEARS()
      .map((p) => `<button data-syr="${p}" aria-pressed="${i === p}">${p}</button>`)
      .join("")}</div>
    <div class="bars ybars occb">${d.map((p, w) => `<div class="bar-c" title="${MESES[w]}: ${p == null ? "sin datos" : p + "% ocupado"}"><em>${p == null ? "" : p + "%"}</em><i class="${occCls(p)}" style="height:${p || 0}%"></i><span>${MESES[w].slice(0, 3)}</span></div>`).join("")}</div>
    <p class="note" style="margin-top:6px">Ocupación promedio de cada mes, en tus horas de trabajo.</p>`;
  }
  const o = quietWindows()
    .filter((i) => i.sug)
    .sort((i, l) => i.v - l.v);
  return `${t}<div class="panel"><p class="lbl">¿Cuándo tenés más gente?</p>${n}${s}</div>
  ${
    o.length
      ? `<div class="panel"><p class="lbl">Tus horarios más flojos</p><p style="margin:0 0 10px;font-size:14px;text-align:left">Según las últimas 4 semanas. Llenalos con un happy hour o avisando a tus seguidores.</p>
   <ul class="ag">${o.map((i) => `<li><span class="ag-t">${i.h}–${i.e} h</span><div><b>${DNAME[i.dow]}</b><span>${i.v}% ocupado</span></div><span class="chip ${i.v < 35 ? "ok" : "gray"}">${i.v < 35 ? "Libre" : "Medio"}</span></li>`).join("")}</ul>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px"><button class="btn btn-ghost" data-btab="horarios">Armar happy hour</button><button class="btn btn-ghost" data-btab="comunidad">Avisar a seguidores</button></div></div>`
      : ""
  }`;
}
export function lowWindows() {
  return quietWindows()
    .sort((a, t) => a.v - t.v)
    .slice(0, 6);
}

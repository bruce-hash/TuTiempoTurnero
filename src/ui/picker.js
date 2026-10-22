import { pctTxt } from "../lib/dinero.js";
import { esc } from "../lib/dom.js";
import { DOW, MESES, TODAY, addDays, dayLabel, dkey, longLabel, toMin } from "../lib/fechas.js";
import { selDur } from "../lib/servicios.js";
import { cfg, cli, freeCount, nextFree, slotsFor } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";

export function relBadge(name) {
  const a = cli(name);
  if (a.n >= 2) {
    return `<span class="rb bad">⚠ ${a.n} faltas</span>`;
  } else if (a.n === 1) {
    return '<span class="rb warn">1 falta</span>';
  } else if (a.v >= 5) {
    return `<span class="rb ok">★ Fiel · ${a.v}</span>`;
  } else if (a.v === 0) {
    return '<span class="rb new">Nuevo</span>';
  } else {
    return "";
  }
}
export function vPicker(e) {
  const a = cfg(e.id);
  const t = selDur(e);
  if (!a.on) {
    return '<div class="panel" style="text-align:center"><b>Este profesional todavía no tiene turnos online.</b><p class="note">Podés seguirlo para enterarte cuando los active.</p></div>';
  }
  const s = [];
  for (let b = 0; b < a.ahead; b++) {
    s.push(dkey(addDays(b)));
  }
  if (!S.day || !s.includes(S.day)) {
    S.day = s.find((b) => freeCount(e.id, b, t, S.reprog) > 0) || s[0];
    S.wk = Math.floor(s.indexOf(S.day) / 7);
  }
  const n = Math.ceil(s.length / 7);
  if (S.wk == null || S.wk >= n) {
    S.wk = Math.floor(s.indexOf(S.day) / 7);
  }
  const o = s.slice(S.wk * 7, S.wk * 7 + 7);
  const i = /* @__PURE__ */ new Date(o[0] + "T12:00:00");
  const l = /* @__PURE__ */ new Date(o[o.length - 1] + "T12:00:00");
  const c =
    i.getMonth() === l.getMonth()
      ? MESES[i.getMonth()] + " " + i.getFullYear()
      : MESES[i.getMonth()].slice(0, 3) + " – " + MESES[l.getMonth()].slice(0, 3) + " " + l.getFullYear();
  const d = slotsFor(e.id, S.day, t, S.reprog);
  const p = d.list.filter((b) => b.free);
  const w = d.list.length - p.length;
  if (S.slot && (S.slot.date !== S.day || !p.some((b) => b.time === S.slot.time))) {
    S.slot = null;
  }
  const y = nextFree(e.id, t, S.reprog);
  const k = store.WAIT.some((b) => {
    var g;
    return b.pid == e.id && b.date === S.day && b.user === ((g = S.user) == null ? void 0 : g.email);
  });
  const h = [
    ["Mañana", "☀️", 0, 720],
    ["Tarde", "🌤️", 720, 1080],
    ["Noche", "🌙", 1080, 1440],
  ]
    .map(([b, g, M, _]) => [
      b,
      g,
      p.filter((D) => {
        const q = toMin(D.time);
        return q >= M && q < _;
      }),
    ])
    .filter((b) => b[2].length);
  const j = p.some((b) => b.disc);
  return `<section class="picker">
   <div class="pk-head"><p class="lbl" style="margin:0">2 · Elegí día y horario <span class="hint">· próximos ${a.ahead} días</span></p>
    ${y ? `<button class="quick" data-quick="${y.date}|${y.time}">⚡ Primer turno: <b>${esc(dayLabel(y.date))} ${y.time}</b>${y.disc ? ` <i>-${y.disc}%</i>` : ""}</button>` : ""}</div>
   <div class="pk-month"><button class="pk-nav" data-wk="-1" ${S.wk === 0 ? "disabled" : ""} aria-label="Semana anterior">‹</button><b>${c}</b><button class="pk-nav" data-wk="1" ${S.wk >= n - 1 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div>
   <div class="wk" role="listbox" aria-label="Días">${o
     .map((b) => {
       const g = slotsFor(e.id, b, t, S.reprog);
       const M = g.list.filter((T) => T.free).length;
       const _ = g.list.length || 1;
       const D = /* @__PURE__ */ new Date(b + "T12:00:00");
       const q = g.list.some((T) => T.free && T.disc);
       return `<button class="wd ${g.closed ? "closed" : M === 0 ? "full" : M / _ < 0.25 ? "low" : ""} ${b === TODAY() ? "today" : ""}" data-day="${b}" aria-selected="${S.day === b}" ${g.closed ? "disabled" : ""}><span>${DOW[D.getDay()]}</span><b>${D.getDate()}</b><i class="av-bar"><i style="width:${g.closed ? 0 : Math.round((M / _) * 100)}%"></i></i><small>${g.closed ? "Cerrado" : M ? M + '<span class="sm-l"> libres</span>' : "Lleno"}</small>${q ? "<em>%</em>" : ""}</button>`;
     })
     .join("")}</div>
   <div class="pk-body">
    <div class="pk-day"><b>${esc(longLabel(S.day))}</b>${!d.closed && p.length ? `<span>${p.length} libres${w ? " · " + w + " ocupados" : ""}</span>` : ""}</div>
    ${
      d.closed
        ? `<p class="note">${esc(d.reason)}</p>`
        : p.length
          ? h
              .map(
                ([b, g, M]) =>
                  `<div class="pk-grp"><p class="pk-gl">${g} ${b} <span>${M.length}</span></p><div class="slots">${M.map((_) => `<button class="slot ${_.disc ? "hh" : ""}" data-slot="${_.time}" aria-pressed="${S.slot && S.slot.time === _.time}"><b>${_.time}</b>${_.disc ? `<i>-${_.disc}%</i>` : ""}</button>`).join("")}</div></div>`,
              )
              .join("") +
            (j
              ? `<p class="hh-leg"><span class="slot hh mini"><i>-${a.happy.pct}%</i></span> Happy hour: ${a.happy.pct}% menos en horarios tranquilos</p>`
              : "")
          : `<div class="pk-full"><div style="font-size:30px">😕</div><b>No quedan turnos este día</b><p class="note">Te avisamos al instante si alguien cancela.</p>
       <button class="btn ${k ? "btn-ghost" : "btn-pri"} btn-block" data-act="waitlist" ${k ? "disabled" : ""}>${k ? "✓ Estás en la lista de espera" : "🔔 Avisame si se libera un turno"}</button>
       ${y ? `<button class="btn btn-ghost btn-block" style="margin-top:8px" data-quick="${y.date}|${y.time}">Ver el primer turno libre: ${esc(dayLabel(y.date))} ${y.time}</button>` : ""}</div>`
    }
   </div>
   <p class="note pk-pol">⏱ ${t} min · ${a.pay === "total" ? "Pagás el total al reservar" : "Seña del " + a.pct + "% al reservar"} + comisión TuTiempo (${pctTxt()}%) con Mercado Pago${a.cash !== false && a.pay !== "total" ? " · el resto en efectivo o Mercado Pago" : ""}</p>
  </section>`;
}

import { pctTxt } from "../lib/dinero.js";
import { esc } from "../lib/dom.js";
import { DOW, MESES, TODAY, addDays, dayLabel, dkey, longLabel, toMin } from "../lib/fechas.js";
import { selDur } from "../lib/servicios.js";
import { cfg, cli, freeCount, nextFree, slotsFor } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";

// etiqueta del cliente para el prestador según sus faltas (n) y visitas (v)
export function relBadge(name) {
  const stats = cli(name);
  if (stats.n >= 2) {
    return `<span class="rb bad">⚠ ${stats.n} faltas</span>`;
  } else if (stats.n === 1) {
    return '<span class="rb warn">1 falta</span>';
  } else if (stats.v >= 5) {
    return `<span class="rb ok">★ Fiel · ${stats.v}</span>`;
  } else if (stats.v === 0) {
    return '<span class="rb new">Nuevo</span>';
  } else {
    return "";
  }
}
// selector de día y horario: semanas de 7 días hasta conf.ahead, horarios libres por franja,
// primer turno libre, happy hour y lista de espera si el día está lleno
export function vPicker(prov) {
  const conf = cfg(prov.id);
  const dur = selDur(prov);
  if (!conf.on) {
    return '<div class="panel" style="text-align:center"><b>Este profesional todavía no tiene turnos online.</b><p class="note">Podés seguirlo para enterarte cuando los active.</p></div>';
  }
  const days = [];
  for (let offset = 0; offset < conf.ahead; offset++) {
    days.push(dkey(addDays(offset)));
  }
  if (!S.day || !days.includes(S.day)) {
    S.day = days.find((day) => freeCount(prov.id, day, dur, S.reprog) > 0) || days[0];
    S.wk = Math.floor(days.indexOf(S.day) / 7);
  }
  const weeks = Math.ceil(days.length / 7);
  if (S.wk == null || S.wk >= weeks) {
    S.wk = Math.floor(days.indexOf(S.day) / 7);
  }
  const weekDays = days.slice(S.wk * 7, S.wk * 7 + 7);
  const first = /* @__PURE__ */ new Date(weekDays[0] + "T12:00:00");
  const last = /* @__PURE__ */ new Date(weekDays[weekDays.length - 1] + "T12:00:00");
  const monthLabel =
    first.getMonth() === last.getMonth()
      ? MESES[first.getMonth()] + " " + first.getFullYear()
      : MESES[first.getMonth()].slice(0, 3) + " – " + MESES[last.getMonth()].slice(0, 3) + " " + last.getFullYear();
  const daySlots = slotsFor(prov.id, S.day, dur, S.reprog);
  const free = daySlots.list.filter((slot) => slot.free);
  const taken = daySlots.list.length - free.length;
  if (S.slot && (S.slot.date !== S.day || !free.some((slot) => slot.time === S.slot.time))) {
    S.slot = null;
  }
  const firstFree = nextFree(prov.id, dur, S.reprog);
  const onWaitlist = store.WAIT.some((wait) => {
    var user;
    return wait.pid == prov.id && wait.date === S.day && wait.user === ((user = S.user) == null ? void 0 : user.email);
  });
  const groups = [
    ["Mañana", "☀️", 0, 720],
    ["Tarde", "🌤️", 720, 1080],
    ["Noche", "🌙", 1080, 1440],
  ]
    .map(([label, icon, from, to]) => [
      label,
      icon,
      free.filter((slot) => {
        const min = toMin(slot.time);
        return min >= from && min < to;
      }),
    ])
    .filter((group) => group[2].length);
  const anyHappy = free.some((slot) => slot.disc);
  return `<section class="picker">
   <div class="pk-head"><p class="lbl" style="margin:0">2 · Elegí día y horario <span class="hint">· próximos ${conf.ahead} días</span></p>
    ${firstFree ? `<button class="quick" data-quick="${firstFree.date}|${firstFree.time}">⚡ Primer turno: <b>${esc(dayLabel(firstFree.date))} ${firstFree.time}</b>${firstFree.disc ? ` <i>-${firstFree.disc}%</i>` : ""}</button>` : ""}</div>
   <div class="pk-month"><button class="pk-nav" data-wk="-1" ${S.wk === 0 ? "disabled" : ""} aria-label="Semana anterior">‹</button><b>${monthLabel}</b><button class="pk-nav" data-wk="1" ${S.wk >= weeks - 1 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div>
   <div class="wk" role="listbox" aria-label="Días">${weekDays
     .map((day) => {
       const slots = slotsFor(prov.id, day, dur, S.reprog);
       const freeN = slots.list.filter((slot) => slot.free).length;
       const total = slots.list.length || 1;
       const date = /* @__PURE__ */ new Date(day + "T12:00:00");
       const hasHappy = slots.list.some((slot) => slot.free && slot.disc);
       return `<button class="wd ${slots.closed ? "closed" : freeN === 0 ? "full" : freeN / total < 0.25 ? "low" : ""} ${day === TODAY() ? "today" : ""}" data-day="${day}" aria-selected="${S.day === day}" ${slots.closed ? "disabled" : ""}><span>${DOW[date.getDay()]}</span><b>${date.getDate()}</b><i class="av-bar"><i style="width:${slots.closed ? 0 : Math.round((freeN / total) * 100)}%"></i></i><small>${slots.closed ? "Cerrado" : freeN ? freeN + '<span class="sm-l"> libres</span>' : "Lleno"}</small>${hasHappy ? "<em>%</em>" : ""}</button>`;
     })
     .join("")}</div>
   <div class="pk-body">
    <div class="pk-day"><b>${esc(longLabel(S.day))}</b>${!daySlots.closed && free.length ? `<span>${free.length} libres${taken ? " · " + taken + " ocupados" : ""}</span>` : ""}</div>
    ${
      daySlots.closed
        ? `<p class="note">${esc(daySlots.reason)}</p>`
        : free.length
          ? groups
              .map(
                ([label, icon, slots]) =>
                  `<div class="pk-grp"><p class="pk-gl">${icon} ${label} <span>${slots.length}</span></p><div class="slots">${slots.map((slot) => `<button class="slot ${slot.disc ? "hh" : ""}" data-slot="${slot.time}" aria-pressed="${S.slot && S.slot.time === slot.time}"><b>${slot.time}</b>${slot.disc ? `<i>-${slot.disc}%</i>` : ""}</button>`).join("")}</div></div>`,
              )
              .join("") +
            (anyHappy
              ? `<p class="hh-leg"><span class="slot hh mini"><i>-${conf.happy.pct}%</i></span> Happy hour: ${conf.happy.pct}% menos en horarios tranquilos</p>`
              : "")
          : `<div class="pk-full"><div style="font-size:30px">😕</div><b>No quedan turnos este día</b><p class="note">Te avisamos al instante si alguien cancela.</p>
       <button class="btn ${onWaitlist ? "btn-ghost" : "btn-pri"} btn-block" data-act="waitlist" ${onWaitlist ? "disabled" : ""}>${onWaitlist ? "✓ Estás en la lista de espera" : "🔔 Avisame si se libera un turno"}</button>
       ${firstFree ? `<button class="btn btn-ghost btn-block" style="margin-top:8px" data-quick="${firstFree.date}|${firstFree.time}">Ver el primer turno libre: ${esc(dayLabel(firstFree.date))} ${firstFree.time}</button>` : ""}</div>`
    }
   </div>
   <p class="note pk-pol">⏱ ${dur} min · ${conf.pay === "total" ? "Pagás el total al reservar" : "Seña del " + conf.pct + "% al reservar"} + comisión TuTiempo (${pctTxt()}%) con Mercado Pago${conf.cash !== false && conf.pay !== "total" ? " · el resto en efectivo o Mercado Pago" : ""}</p>
  </section>`;
}

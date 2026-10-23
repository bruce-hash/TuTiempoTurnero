import { H } from "../../lib/compat.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { DOW, MESES, NOW, TODAY, addDays, dayLabel, dkey, fromMin, longLabel, nowHM, pad, toMin } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { busy, cfg, cli, ranges, rangesTxt, slotsFor } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { relBadge } from "../../ui/picker.js";
import { feeOf } from "./finanzas.js";

// agenda del prestador: semanas de un período de 31 días y la línea de tiempo del día elegido, con turnos,
// servicios sin turno de hoy, descansos, huecos libres para ofrecer y la hora actual
export function vBAgendaT() {
  const days = [];
  for (let offset = 0; offset < 31; offset++) {
    days.push(dkey(addDays(offset)));
  }
  if (!S.aday || !days.includes(S.aday)) {
    S.aday = days[0];
  }
  if (S.awk == null || !days.slice(S.awk * 7, S.awk * 7 + 7).includes(S.aday)) {
    S.awk = Math.floor(days.indexOf(S.aday) / 7);
  }
  const weeks = Math.ceil(days.length / 7);
  const weekDays = days.slice(S.awk * 7, S.awk * 7 + 7);
  const shortDate = (date) => {
    const jsDate = /* @__PURE__ */ new Date(date + "T12:00:00");
    return jsDate.getDate() + " " + MESES[jsDate.getMonth()].slice(0, 3);
  };
  const day = S.aday;
  const conf = cfg(ME());
  const dow = /* @__PURE__ */ new Date(day + "T12:00:00").getDay();
  const dayConf = conf.days[dow];
  const items = busy(ME(), day).map((item) => H({}, item));
  if (day === TODAY()) {
    S.walk.forEach(
      (walk, index) =>
        walk.kind !== "prod" &&
        items.push({
          id: "w" + index,
          time: walk.hora,
          cliente: walk.cliente || "Cliente sin turno",
          svc: walk.svc + " · " + money(walk.precio),
          type: "walk",
          dur: 30,
          status: "done",
        }),
    );
  }
  items.sort((one, other) => one.time.localeCompare(other.time));
  // porcentaje del horario del día ocupado por turnos (null si está cerrado)
  const occupancy = (date) => {
    const dayRngs = ranges(conf, /* @__PURE__ */ new Date(date + "T12:00:00").getDay());
    if (!dayRngs.length) {
      return null;
    }
    const open = dayRngs.reduce((sum, [from, to]) => sum + to - from, 0);
    const used = busy(ME(), date)
      .filter((item) => item.type !== "block")
      .reduce((sum, item) => sum + item.dur, 0);
    return Math.min(100, Math.round((used / open) * 100));
  };
  const weekNav = `<div class="pk-month agnav"><button class="pk-nav" data-awk="-1" ${S.awk === 0 ? "disabled" : ""} aria-label="Semana anterior">‹</button><b>${shortDate(weekDays[0])} – ${shortDate(weekDays[weekDays.length - 1])}<span class="hint"> · agenda de 31 días</span></b><button class="pk-nav" data-awk="1" ${S.awk >= weeks - 1 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div><div class="wk agwk">${weekDays
    .map((date) => {
      const jsDate = /* @__PURE__ */ new Date(date + "T12:00:00");
      const occ = occupancy(date);
      const count = busy(ME(), date).filter((item) => item.type !== "block").length;
      return `<button class="wd ${occ == null ? "closed" : ""} ${date === TODAY() ? "today" : ""}" data-aday="${date}" aria-selected="${day === date}"><span>${DOW[jsDate.getDay()]}</span><b>${jsDate.getDate()}</b><i class="av-bar occ"><i style="width:${occ || 0}%"></i></i><small>${occ == null ? "Cerrado" : count + '<span class="sm-l"> turno' + (count === 1 ? "" : "s") + "</span>"}</small></button>`;
    })
    .join("")}</div>`;
  const bookings = items.filter((item) => item.type !== "block");
  // ingreso estimado del día: precio de los turnos menos la comisión de los reservados por la app, más lo cobrado sin turno
  const income =
    bookings
      .filter((item) => item.status !== "cancelled" && item.type !== "walk")
      .reduce((sum, item) => sum + ((item.price || 0) - (item.src === "app" ? feeOf(item) : 0)), 0) +
    S.walk.reduce((sum, walk) => (day === TODAY() ? sum + walk.precio : sum), 0);
  const selected = items.find((item) => String(item.id) === String(S.sel));
  const rngs = ranges(conf, dow);
  if (!rngs.length) {
    return `${weekNav}<div class="panel" style="text-align:center"><b>${esc(longLabel(day))}</b><p class="note">Cerrado. Podés abrir este día desde Horarios.</p></div>`;
  }
  const starts = items.map((item) => toMin(item.time));
  const ends = items.map((item) => toMin(item.time) + item.dur);
  const top = Math.floor(Math.min(rngs[0][0], ...starts) / 60) * 60;
  const bottom = Math.ceil(Math.max(rngs[rngs.length - 1][1], ...ends) / 60) * 60;
  // alto en píxeles de un minuto en la línea de tiempo
  const pxPerMin = 1.6;
  const height = (bottom - top) * pxPerMin;
  const breaks = [];
  for (let index = 1; index < rngs.length; index++) {
    if (rngs[index][0] > rngs[index - 1][1]) {
      breaks.push([rngs[index - 1][1], rngs[index][0]]);
    }
  }
  // huecos libres de 30 minutos o más (desde ahora, si es hoy), entre lo ocupado, los descansos y los bordes
  const gaps = [];
  let cursor = top;
  const taken = [...items.filter((item) => item.type !== "walk").map((item) => [toMin(item.time), toMin(item.time) + item.dur])];
  breaks.forEach((brk) => taken.push(brk));
  if (top < rngs[0][0]) {
    taken.push([top, rngs[0][0]]);
  }
  if (bottom > rngs[rngs.length - 1][1]) {
    taken.push([rngs[rngs.length - 1][1], bottom]);
  }
  taken.sort((one, other) => one[0] - other[0]);
  const nowMin = day === TODAY() ? NOW().getHours() * 60 + NOW().getMinutes() : 0;
  for (const [from, to] of taken) {
    if (from - cursor >= 30) {
      const start = Math.max(cursor, nowMin && day === TODAY() ? Math.ceil(nowMin / 30) * 30 : cursor);
      if (from - start >= 30) {
        gaps.push([start, from]);
      }
    }
    cursor = Math.max(cursor, to);
  }
  if (bottom - cursor >= 30) {
    const start = Math.max(cursor, day === TODAY() ? Math.ceil(nowMin / 30) * 30 : cursor);
    if (bottom - start >= 30) {
      gaps.push([start, bottom]);
    }
  }
  const kindClass = (item) =>
    item.type === "block" ? "blk" : item.type === "walk" ? "walk" : item.src === "manual" ? "man" : "app";
  // dos turnos que se pisan se dibujan en columnas alternadas
  let lastEnd = -1;
  let col = 0;
  const events = items
    .map((item) => {
      const start = toMin(item.time);
      col = start < lastEnd ? 1 - col : 0;
      lastEnd = Math.max(lastEnd, start + item.dur);
      const topPx = (start - top) * pxPerMin;
      const heightPx = Math.max(item.dur * pxPerMin, 30);
      return `<button class="ev ${kindClass(item)} ${item.status === "done" ? "done" : ""} ${item.status === "noshow" ? "ns" : ""} ${String(S.sel) === String(item.id) ? "sel" : ""} ${col ? "c2" : ""}" style="top:${topPx}px;height:${heightPx}px" data-sel="${item.id}">
      <span class="ev-t">${item.time}</span><span class="ev-n">${esc(item.cliente || "Bloqueado")}</span>${item.type === "block" ? "" : `<span class="ev-s">${esc(item.svc)}</span>`}
      <span class="ev-ic">${item.att ? "✓" : ""}${item.late ? "⏱" : ""}${item.status === "done" ? "✔" : ""}${item.status === "noshow" ? "✕" : ""}${item.disc ? "%" : ""}</span></button>`;
    })
    .join("");
  const hourLines = [];
  for (let minute = Math.ceil(top / 60) * 60; minute <= bottom; minute += 60) {
    hourLines.push(
      `<i class="tl-line" style="top:${(minute - top) * pxPerMin}px"></i><span class="tl-h" style="top:${(minute - top) * pxPerMin}px">${pad(minute / 60)}</span>`,
    );
  }
  const breakHtml = breaks
    .map(
      ([from, to]) =>
        `<div class="tl-brk" style="top:${(from - top) * pxPerMin}px;height:${(to - from) * pxPerMin}px">No trabajás · volvés a las ${fromMin(to)}</div>`,
    )
    .join("");
  const gapHtml = gaps.map(([from, to]) => {
    const key = day + "|" + fromMin(from);
    const offered = S.offered && S.offered[key];
    return `<div class="tl-gap" style="top:${(from - top) * pxPerMin}px;height:${(to - from) * pxPerMin}px"><span>Libre ${fromMin(from)}–${fromMin(to)}</span><button class="btn ${offered ? "btn-ghost" : "btn-pri"}" data-act="offerGap" data-g="${key}" data-z="${fromMin(to)}" ${offered ? "disabled" : ""}>${offered ? "✓ Ofrecido" : "📣 Ofrecer"}</button></div>`;
  }).join("");
  const nowLine =
    day === TODAY() && nowMin > top && nowMin < bottom
      ? `<div class="tl-now" style="top:${(nowMin - top) * pxPerMin}px"><span>${nowHM()}</span></div>`
      : "";
  return `${weekNav}
  <div class="stats2"><div><b>${bookings.length}</b><span>Turnos</span></div><div><b>${occupancy(day)}%</b><span>Ocupación</span></div><div><b>${money(income)}</b><span>Ingreso estimado</span></div></div>
  <div class="panel tl-panel"><div class="tl-top"><b>${esc(longLabel(day))}</b><span class="hint">${rangesTxt(rngs)}</span></div>
   <div class="tl-leg"><span><i class="lg app"></i>TuTiempo</span><span><i class="lg man"></i>Agendado</span><span><i class="lg walk"></i>Sin turno</span><span><i class="lg gap"></i>Libre</span></div>
   <div class="tl" style="height:${height}px">${hourLines.join("")}${breakHtml}${gapHtml}${events}${nowLine}</div>
   <p class="note">Tocá un turno para ver el detalle. En los huecos libres, “Ofrecer” avisa a tus ${store.COMM.followers} seguidores.</p></div>
  ${selected ? detailCard(selected) : ""}
  ${S.manOpen ? vManualForm(day) : S.blockOpen ? vBlockForm(day) : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-pri" data-act="manOpen">+ Agendar turno</button><button class="btn btn-ghost" data-act="blockOpen">⛔ Bloquear horario</button></div>'}
  <button class="btn btn-ghost btn-block" data-act="walkFromAgenda">+ Cargar servicio sin turno</button>`;
}
// detalle de lo elegido en la agenda: cliente, historial, ficha, montos y acciones
function detailCard(item) {
  const isBooking = typeof item.id == "number";
  const stats = item.cliente ? cli(item.cliente) : null;
  const origin =
    item.type === "block"
      ? "⛔ Bloqueado"
      : item.type === "walk"
        ? "🚶 Sin turno"
        : item.src === "manual"
          ? "✍ Agendado por vos"
          : "📱 Reservó por TuTiempo";
  return `<div class="panel detail"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><div><b style="font-size:17px">${esc(item.time)} · ${esc(item.cliente || "Horario bloqueado")}</b><div class="hint">${esc(item.svc || "")}${(item.addons || []).length ? " + " + (item.addons || []).map((addon) => esc(addon[0])).join(" + ") : ""}</div></div><button class="xbtn" data-act="selClose" aria-label="Cerrar">✕</button></div>
   <div class="chips" style="justify-content:flex-start;margin-top:8px"><span class="chip gray">${origin}</span>${item.cliente && item.type !== "block" && item.type !== "walk" ? relBadge(item.cliente) : ""}${item.type === "local" && item.status === "confirmed" ? '<span class="chip ok">✓ Confirmado</span>' : ""}${item.pay === "cash" ? '<span class="chip">💵 Resto en efectivo</span>' : item.pay === "reward" ? '<span class="chip ok">🎁 Premio de sellos (gratis)</span>' : ""}${item.late ? `<span class="chip">⏱ Llega ${item.late} min tarde</span>` : ""}${item.disc ? `<span class="chip ok">Happy hour −${item.disc}%</span>` : ""}</div>
   ${stats && item.type !== "block" && item.type !== "walk" ? `<p class="note" style="text-align:left;margin:8px 0 0">Historial: ${stats.v} turno${stats.v === 1 ? "" : "s"} · ${stats.n} falta${stats.n === 1 ? "" : "s"}</p>` : ""}
   ${
     item.cliente &&
     store.CLIENTS[item.cliente] &&
     (store.CLIENTS[item.cliente].notes || Object.values(store.CLIENTS[item.cliente].profile || {}).some(Boolean))
       ? `<div class="notebox">📝 ${[store.CLIENTS[item.cliente].notes]
           .concat(Object.values(store.CLIENTS[item.cliente].profile || {}))
           .filter(Boolean)
           .map(esc)
           .join(" · ")}</div>`
       : ""
   }
   ${item.cliente && store.CLIENTS[item.cliente] && item.type !== "block" && item.type !== "walk" ? `<button class="lnk" style="font-size:13px;margin-top:6px" data-cli="${esc(item.cliente)}">Ver ficha del cliente →</button>` : ""}
   ${item.price ? `<div class="sum" style="margin-top:10px"><div><span>Precio</span><span>${money(item.price)}</span></div><div><span>Seña pagada (Mercado Pago)</span><span>${money(item.paid || 0)}</span></div>${item.price > (item.paid || 0) ? `<div class="tot"><span>A cobrar en el local${item.pay === "cash" ? " (efectivo)" : item.src === "app" ? " (Mercado Pago)" : ""}</span><span>${money(item.price - (item.paid || 0))}</span></div>` : ""}</div>` : ""}
   ${isBooking && item.status === "confirmed" && item.type !== "block" ? (S.bAsk === item.id ? `<div class="bacts"><span class="hint">¿Cancelar? Se le devuelve todo al cliente.</span><button class="btn btn-ghost" data-act="bCancelNo">No</button><button class="btn btn-bad" data-act="bCancelYes" data-id="${item.id}">Sí, cancelar</button></div>` : `<div class="bacts" style="margin-top:12px"><button class="btn btn-ok" data-act="bDone" data-id="${item.id}">✓ Asistió</button><button class="btn btn-ghost" data-act="bNoShow" data-id="${item.id}">No vino</button><button class="btn btn-ghost" data-act="bCancel" data-id="${item.id}">Cancelar</button></div>`) : isBooking && item.type === "block" ? `<div class="bacts" style="margin-top:12px"><button class="btn btn-ghost" data-act="bUnblock" data-id="${item.id}">Desbloquear</button></div>` : item.status === "done" ? '<p class="note" style="text-align:left;margin-top:10px">✔ Atendido</p>' : item.status === "noshow" ? '<p class="note" style="text-align:left;margin-top:10px">✕ No vino</p>' : ""}
  </div>`;
}
// agendar a mano un turno para un cliente que escribió o llamó (sin comisión)
function vManualForm(day) {
  const prov = pr(ME());
  if (!prov.svcs.length) {
    return '<div class="panel"><p class="note">Cargá tus servicios en Perfil para poder agendar.</p></div>';
  }
  const svcIndex = Math.min(S.manSvc || 0, prov.svcs.length - 1);
  const dur = prov.svcs[svcIndex][1];
  const free = slotsFor(ME(), day, dur).list.filter((slot) => slot.free);
  return `<form class="panel" id="fManual" novalidate><p class="lbl">Agendar turno · ${esc(dayLabel(day))}</p>
   <p class="note" style="text-align:left;margin:-4px 0 10px">Para clientes que te escriben o te llaman. No paga comisión. Si el cliente tiene la app, le llegan los avisos ahí.</p>
   <div class="f"><label for="msv">Servicio</label><select id="msv">${prov.svcs.map((svc, index) => `<option value="${index}" ${index === svcIndex ? "selected" : ""}>${esc(svc[0])} · ${svc[1]} min</option>`).join("")}</select></div>
   <div class="f"><label for="mhr">Horario libre</label>${free.length ? `<select id="mhr">${free.map((slot) => `<option>${slot.time}</option>`).join("")}</select>` : '<p class="note" style="text-align:left;margin:0">No quedan horarios libres este día.</p>'}</div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="mcl">Cliente *</label><input id="mcl" autocomplete="off" placeholder="Nombre" value="${esc(S.manName || "")}"></div><div class="f"><label for="mtel">Celular</label><input id="mtel" inputmode="tel" autocomplete="off" placeholder="Opcional"></div></div>
   <div class="err" id="merr"></div>
   <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="manClose">Cancelar</button><button class="btn btn-pri" type="submit" ${free.length ? "" : "disabled"}>Agendar</button></div></form>`;
}
function vBlockForm(day) {
  return `<form class="panel" id="fBlock" novalidate><p class="lbl">Bloquear horario · ${esc(dayLabel(day))}</p>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="bkf">Desde</label><input id="bkf" type="time" value="13:00"></div><div class="f"><label for="bkt">Hasta</label><input id="bkt" type="time" value="14:00"></div></div>
   <div class="err" id="bkerr"></div>
   <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="blockClose">Cancelar</button><button class="btn btn-pri" type="submit">Bloquear</button></div></form>`;
}

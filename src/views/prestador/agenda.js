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

export function vBAgendaT() {
  const e = [];
  for (let u = 0; u < 31; u++) {
    e.push(dkey(addDays(u)));
  }
  if (!S.aday || !e.includes(S.aday)) {
    S.aday = e[0];
  }
  if (S.awk == null || !e.slice(S.awk * 7, S.awk * 7 + 7).includes(S.aday)) {
    S.awk = Math.floor(e.indexOf(S.aday) / 7);
  }
  const a = Math.ceil(e.length / 7);
  const t = e.slice(S.awk * 7, S.awk * 7 + 7);
  const s = (u) => {
    const E = /* @__PURE__ */ new Date(u + "T12:00:00");
    return E.getDate() + " " + MESES[E.getMonth()].slice(0, 3);
  };
  const n = S.aday;
  const o = cfg(ME());
  const i = /* @__PURE__ */ new Date(n + "T12:00:00").getDay();
  const l = o.days[i];
  const c = busy(ME(), n).map((u) => H({}, u));
  if (n === TODAY()) {
    S.walk.forEach(
      (u, E) =>
        u.kind !== "prod" &&
        c.push({
          id: "w" + E,
          time: u.hora,
          cliente: u.cliente || "Cliente sin turno",
          svc: u.svc + " · " + money(u.precio),
          type: "walk",
          dur: 30,
          status: "done",
        }),
    );
  }
  c.sort((u, E) => u.time.localeCompare(E.time));
  const d = (u) => {
    const E = ranges(o, /* @__PURE__ */ new Date(u + "T12:00:00").getDay());
    if (!E.length) {
      return null;
    }
    const O = E.reduce((B, [F, V]) => B + V - F, 0);
    const N = busy(ME(), u)
      .filter((B) => B.type !== "block")
      .reduce((B, F) => B + F.dur, 0);
    return Math.min(100, Math.round((N / O) * 100));
  };
  const p = `<div class="pk-month agnav"><button class="pk-nav" data-awk="-1" ${S.awk === 0 ? "disabled" : ""} aria-label="Semana anterior">‹</button><b>${s(t[0])} – ${s(t[t.length - 1])}<span class="hint"> · agenda de 31 días</span></b><button class="pk-nav" data-awk="1" ${S.awk >= a - 1 ? "disabled" : ""} aria-label="Semana siguiente">›</button></div><div class="wk agwk">${t
    .map((u) => {
      const E = /* @__PURE__ */ new Date(u + "T12:00:00");
      const O = d(u);
      const N = busy(ME(), u).filter((B) => B.type !== "block").length;
      return `<button class="wd ${O == null ? "closed" : ""} ${u === TODAY() ? "today" : ""}" data-aday="${u}" aria-selected="${n === u}"><span>${DOW[E.getDay()]}</span><b>${E.getDate()}</b><i class="av-bar occ"><i style="width:${O || 0}%"></i></i><small>${O == null ? "Cerrado" : N + '<span class="sm-l"> turno' + (N === 1 ? "" : "s") + "</span>"}</small></button>`;
    })
    .join("")}</div>`;
  const w = c.filter((u) => u.type !== "block");
  const y =
    w
      .filter((u) => u.status !== "cancelled" && u.type !== "walk")
      .reduce((u, E) => u + ((E.price || 0) - (E.src === "app" ? feeOf(E) : 0)), 0) +
    S.walk.reduce((u, E) => (n === TODAY() ? u + E.precio : u), 0);
  const k = c.find((u) => String(u.id) === String(S.sel));
  const h = ranges(o, i);
  if (!h.length) {
    return `${p}<div class="panel" style="text-align:center"><b>${esc(longLabel(n))}</b><p class="note">Cerrado. Podés abrir este día desde Horarios.</p></div>`;
  }
  const j = c.map((u) => toMin(u.time));
  const b = c.map((u) => toMin(u.time) + u.dur);
  const g = Math.floor(Math.min(h[0][0], ...j) / 60) * 60;
  const M = Math.ceil(Math.max(h[h.length - 1][1], ...b) / 60) * 60;
  const _ = 1.6;
  const D = (M - g) * _;
  const q = [];
  for (let u = 1; u < h.length; u++) {
    if (h[u][0] > h[u - 1][1]) {
      q.push([h[u - 1][1], h[u][0]]);
    }
  }
  const C = [];
  let T = g;
  const A = [...c.filter((u) => u.type !== "walk").map((u) => [toMin(u.time), toMin(u.time) + u.dur])];
  q.forEach((u) => A.push(u));
  if (g < h[0][0]) {
    A.push([g, h[0][0]]);
  }
  if (M > h[h.length - 1][1]) {
    A.push([h[h.length - 1][1], M]);
  }
  A.sort((u, E) => u[0] - E[0]);
  const L = n === TODAY() ? NOW().getHours() * 60 + NOW().getMinutes() : 0;
  for (const [u, E] of A) {
    if (u - T >= 30) {
      const O = Math.max(T, L && n === TODAY() ? Math.ceil(L / 30) * 30 : T);
      if (u - O >= 30) {
        C.push([O, u]);
      }
    }
    T = Math.max(T, E);
  }
  if (M - T >= 30) {
    const u = Math.max(T, n === TODAY() ? Math.ceil(L / 30) * 30 : T);
    if (M - u >= 30) {
      C.push([u, M]);
    }
  }
  const I = (u) =>
    u.type === "block" ? "blk" : u.type === "walk" ? "walk" : u.src === "manual" ? "man" : "app";
  let z = -1;
  let G = 0;
  const x = c
    .map((u) => {
      const E = toMin(u.time);
      G = E < z ? 1 - G : 0;
      z = Math.max(z, E + u.dur);
      const O = (E - g) * _;
      const N = Math.max(u.dur * _, 30);
      return `<button class="ev ${I(u)} ${u.status === "done" ? "done" : ""} ${u.status === "noshow" ? "ns" : ""} ${String(S.sel) === String(u.id) ? "sel" : ""} ${G ? "c2" : ""}" style="top:${O}px;height:${N}px" data-sel="${u.id}">
      <span class="ev-t">${u.time}</span><span class="ev-n">${esc(u.cliente || "Bloqueado")}</span>${u.type === "block" ? "" : `<span class="ev-s">${esc(u.svc)}</span>`}
      <span class="ev-ic">${u.att ? "✓" : ""}${u.late ? "⏱" : ""}${u.status === "done" ? "✔" : ""}${u.status === "noshow" ? "✕" : ""}${u.disc ? "%" : ""}</span></button>`;
    })
    .join("");
  const v = [];
  for (let u = Math.ceil(g / 60) * 60; u <= M; u += 60) {
    v.push(
      `<i class="tl-line" style="top:${(u - g) * _}px"></i><span class="tl-h" style="top:${(u - g) * _}px">${pad(u / 60)}</span>`,
    );
  }
  const r = q
    .map(
      ([u, E]) =>
        `<div class="tl-brk" style="top:${(u - g) * _}px;height:${(E - u) * _}px">No trabajás · volvés a las ${fromMin(E)}</div>`,
    )
    .join("");
  const m = C.map(([u, E]) => {
    const O = n + "|" + fromMin(u);
    const N = S.offered && S.offered[O];
    return `<div class="tl-gap" style="top:${(u - g) * _}px;height:${(E - u) * _}px"><span>Libre ${fromMin(u)}–${fromMin(E)}</span><button class="btn ${N ? "btn-ghost" : "btn-pri"}" data-act="offerGap" data-g="${O}" data-z="${fromMin(E)}" ${N ? "disabled" : ""}>${N ? "✓ Ofrecido" : "📣 Ofrecer"}</button></div>`;
  }).join("");
  const f =
    n === TODAY() && L > g && L < M
      ? `<div class="tl-now" style="top:${(L - g) * _}px"><span>${nowHM()}</span></div>`
      : "";
  return `${p}
  <div class="stats2"><div><b>${w.length}</b><span>Turnos</span></div><div><b>${d(n)}%</b><span>Ocupación</span></div><div><b>${money(y)}</b><span>Ingreso estimado</span></div></div>
  <div class="panel tl-panel"><div class="tl-top"><b>${esc(longLabel(n))}</b><span class="hint">${rangesTxt(h)}</span></div>
   <div class="tl-leg"><span><i class="lg app"></i>TuTiempo</span><span><i class="lg man"></i>Agendado</span><span><i class="lg walk"></i>Sin turno</span><span><i class="lg gap"></i>Libre</span></div>
   <div class="tl" style="height:${D}px">${v.join("")}${r}${m}${x}${f}</div>
   <p class="note">Tocá un turno para ver el detalle. En los huecos libres, “Ofrecer” avisa a tus ${store.COMM.followers} seguidores.</p></div>
  ${k ? detailCard(k) : ""}
  ${S.manOpen ? vManualForm(n) : S.blockOpen ? vBlockForm(n) : '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-pri" data-act="manOpen">+ Agendar turno</button><button class="btn btn-ghost" data-act="blockOpen">⛔ Bloquear horario</button></div>'}
  <button class="btn btn-ghost btn-block" data-act="walkFromAgenda">+ Cargar servicio sin turno</button>`;
}
function detailCard(e) {
  const a = typeof e.id == "number";
  const t = e.cliente ? cli(e.cliente) : null;
  const s =
    e.type === "block"
      ? "⛔ Bloqueado"
      : e.type === "walk"
        ? "🚶 Sin turno"
        : e.src === "manual"
          ? "✍ Agendado por vos"
          : "📱 Reservó por TuTiempo";
  return `<div class="panel detail"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><div><b style="font-size:17px">${esc(e.time)} · ${esc(e.cliente || "Horario bloqueado")}</b><div class="hint">${esc(e.svc || "")}${(e.addons || []).length ? " + " + (e.addons || []).map((n) => esc(n[0])).join(" + ") : ""}</div></div><button class="xbtn" data-act="selClose" aria-label="Cerrar">✕</button></div>
   <div class="chips" style="justify-content:flex-start;margin-top:8px"><span class="chip gray">${s}</span>${e.cliente && e.type !== "block" && e.type !== "walk" ? relBadge(e.cliente) : ""}${e.type === "local" && e.status === "confirmed" ? '<span class="chip ok">✓ Confirmado</span>' : ""}${e.pay === "cash" ? '<span class="chip">💵 Resto en efectivo</span>' : e.pay === "reward" ? '<span class="chip ok">🎁 Premio de sellos (gratis)</span>' : ""}${e.late ? `<span class="chip">⏱ Llega ${e.late} min tarde</span>` : ""}${e.disc ? `<span class="chip ok">Happy hour −${e.disc}%</span>` : ""}</div>
   ${t && e.type !== "block" && e.type !== "walk" ? `<p class="note" style="text-align:left;margin:8px 0 0">Historial: ${t.v} turno${t.v === 1 ? "" : "s"} · ${t.n} falta${t.n === 1 ? "" : "s"}</p>` : ""}
   ${
     e.cliente &&
     store.CLIENTS[e.cliente] &&
     (store.CLIENTS[e.cliente].notes || Object.values(store.CLIENTS[e.cliente].profile || {}).some(Boolean))
       ? `<div class="notebox">📝 ${[store.CLIENTS[e.cliente].notes]
           .concat(Object.values(store.CLIENTS[e.cliente].profile || {}))
           .filter(Boolean)
           .map(esc)
           .join(" · ")}</div>`
       : ""
   }
   ${e.cliente && store.CLIENTS[e.cliente] && e.type !== "block" && e.type !== "walk" ? `<button class="lnk" style="font-size:13px;margin-top:6px" data-cli="${esc(e.cliente)}">Ver ficha del cliente →</button>` : ""}
   ${e.price ? `<div class="sum" style="margin-top:10px"><div><span>Precio</span><span>${money(e.price)}</span></div><div><span>Seña pagada (Mercado Pago)</span><span>${money(e.paid || 0)}</span></div>${e.price > (e.paid || 0) ? `<div class="tot"><span>A cobrar en el local${e.pay === "cash" ? " (efectivo)" : e.src === "app" ? " (Mercado Pago)" : ""}</span><span>${money(e.price - (e.paid || 0))}</span></div>` : ""}</div>` : ""}
   ${a && e.status === "confirmed" && e.type !== "block" ? (S.bAsk === e.id ? `<div class="bacts"><span class="hint">¿Cancelar? Se le devuelve todo al cliente.</span><button class="btn btn-ghost" data-act="bCancelNo">No</button><button class="btn btn-bad" data-act="bCancelYes" data-id="${e.id}">Sí, cancelar</button></div>` : `<div class="bacts" style="margin-top:12px"><button class="btn btn-ok" data-act="bDone" data-id="${e.id}">✓ Asistió</button><button class="btn btn-ghost" data-act="bNoShow" data-id="${e.id}">No vino</button><button class="btn btn-ghost" data-act="bCancel" data-id="${e.id}">Cancelar</button></div>`) : a && e.type === "block" ? `<div class="bacts" style="margin-top:12px"><button class="btn btn-ghost" data-act="bUnblock" data-id="${e.id}">Desbloquear</button></div>` : e.status === "done" ? '<p class="note" style="text-align:left;margin-top:10px">✔ Atendido</p>' : e.status === "noshow" ? '<p class="note" style="text-align:left;margin-top:10px">✕ No vino</p>' : ""}
  </div>`;
}
function vManualForm(e) {
  const a = pr(ME());
  if (!a.svcs.length) {
    return '<div class="panel"><p class="note">Cargá tus servicios en Perfil para poder agendar.</p></div>';
  }
  const t = Math.min(S.manSvc || 0, a.svcs.length - 1);
  const s = a.svcs[t][1];
  const n = slotsFor(ME(), e, s).list.filter((o) => o.free);
  return `<form class="panel" id="fManual" novalidate><p class="lbl">Agendar turno · ${esc(dayLabel(e))}</p>
   <p class="note" style="text-align:left;margin:-4px 0 10px">Para clientes que te escriben o te llaman. No paga comisión. Si el cliente tiene la app, le llegan los avisos ahí.</p>
   <div class="f"><label for="msv">Servicio</label><select id="msv">${a.svcs.map((o, i) => `<option value="${i}" ${i === t ? "selected" : ""}>${esc(o[0])} · ${o[1]} min</option>`).join("")}</select></div>
   <div class="f"><label for="mhr">Horario libre</label>${n.length ? `<select id="mhr">${n.map((o) => `<option>${o.time}</option>`).join("")}</select>` : '<p class="note" style="text-align:left;margin:0">No quedan horarios libres este día.</p>'}</div>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="mcl">Cliente *</label><input id="mcl" autocomplete="off" placeholder="Nombre" value="${esc(S.manName || "")}"></div><div class="f"><label for="mtel">Celular</label><input id="mtel" inputmode="tel" autocomplete="off" placeholder="Opcional"></div></div>
   <div class="err" id="merr"></div>
   <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="manClose">Cancelar</button><button class="btn btn-pri" type="submit" ${n.length ? "" : "disabled"}>Agendar</button></div></form>`;
}
function vBlockForm(e) {
  return `<form class="panel" id="fBlock" novalidate><p class="lbl">Bloquear horario · ${esc(dayLabel(e))}</p>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="bkf">Desde</label><input id="bkf" type="time" value="13:00"></div><div class="f"><label for="bkt">Hasta</label><input id="bkt" type="time" value="14:00"></div></div>
   <div class="err" id="bkerr"></div>
   <div style="display:grid;grid-template-columns:1fr 2fr;gap:8px"><button type="button" class="btn btn-ghost" data-act="blockClose">Cancelar</button><button class="btn btn-pri" type="submit">Bloquear</button></div></form>`;
}

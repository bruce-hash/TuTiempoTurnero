import { feeFor, money, mustPayTotal, payNow, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dayLabel, toMin } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { RUBRO } from "../../lib/rubros.js";
import { PREP, selAdds, selDur, selPrice } from "../../lib/servicios.js";
import { cfg, happyAt, priceAt, seriesDates, slotsFor, uname } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { myStamps, stampGoal } from "../../ui/sellos.js";

export function vCheckoutTurno() {
  const e = pr(S.pid);
  const a = e && e.svcs[S.svc];
  if (!e || !a) {
    return '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Ese servicio ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Volver</button></div></div>';
  }
  const t = cfg(e.id);
  const s = a ? stampGoal(e.id, a) : 0;
  const n = !!s && !S.reprog && !!(myStamps(e.id, a) >= s);
  if (S.payM === "reward" && !n) {
    S.payM = "mp";
  }
  if (S.payM === "reward") {
    S.rep = 0;
  }
  if (!S.slot) {
    return `<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Elegí un horario primero.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="perfil" data-id="${e.id}">Elegir horario</button></div></div>`;
  }
  const o = selPrice(e);
  const i = selDur(e);
  const l = selAdds(e);
  const c = a[3];
  const d = RUBRO[c] || RUBRO.b;
  const p = uname();
  const w = priceAt(e.id, o, S.slot.date, S.slot.time);
  const y = happyAt(e.id, S.slot.date, toMin(S.slot.time));
  const k = mustPayTotal(e.id, p);
  const h = payNow(e.id, w, p);
  const j = S.rep || 0;
  const g = (j ? seriesDates(S.slot.date, j, 3) : []).map((T) => {
    const A = slotsFor(e.id, T, i, null, true).list.some((I) => I.free && I.time === S.slot.time);
    const L = priceAt(e.id, o, T, S.slot.time);
    return {
      k: T,
      ok: A,
      price: L,
      now: payNow(e.id, L, p),
      fee: feeFor(L),
    };
  });
  const M = g.filter((T) => T.ok);
  const _ = h + M.reduce((T, A) => T + A.now, 0);
  const D = w + M.reduce((T, A) => T + A.price, 0);
  const q = 1 + M.length;
  const C = feeFor(w) + M.reduce((T, A) => T + A.fee, 0);
  return `<button class="back" data-go="perfil" data-id="${e.id}">← Cambiar horario</button>
  <form class="narrow stack" id="fTurno" novalidate>
   <h1 class="h1">Confirmá tu turno</h1>
   <div class="panel turnocard"><div class="tdate"><span>${esc(dayLabel(S.slot.date, true))}</span><b>${S.slot.time}</b></div>
    <div><b>${esc(a[0])}</b>${l.length ? `<div class="hint">+ ${l.map((T) => esc(T[0])).join(" · ")}</div>` : ""}<div class="hint">${i} min · ${esc(e.name)}</div><div class="hint">📍 ${esc(e.addr)}</div></div></div>
   ${PREP(e, a) ? `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(PREP(e, a))}</p></div>` : ""}
   ${
     S.payM === "reward"
       ? ""
       : `<div class="panel"><p class="lbl">¿Lo hacés seguido?</p>
     <div class="seg3" role="group" aria-label="Repetir turno">${d.reps
       .map((T) => [T, T === 0 ? "Una vez" : T === 1 ? "Cada semana" : `Cada ${T} sem.`])
       .map(([T, A]) => `<button type="button" data-rep="${T}" aria-pressed="${j === T}">${A}</button>`)
       .join("")}</div>
     ${
       j
         ? `<p class="note" style="text-align:left;margin:10px 0 8px">Reservamos también los próximos 3 turnos, mismo día y hora.</p>
       <ul class="ag">${g.map((T) => `<li><span class="ag-t">${esc(dayLabel(T.k))}</span><div><b>${S.slot.time} h</b><span>${T.ok ? money(T.price) : "Ocupado, se saltea"}</span></div>${T.ok ? '<span class="chip ok">✓ Libre</span>' : '<span class="chip bad">✕ Ocupado</span>'}</li>`).join("")}</ul>`
         : ""
     }</div>`
   }
   ${(() => {
     const T = t.cash !== false && !k;
     const A = S.payM === "reward" && n ? "reward" : T && S.payM === "cash" ? "cash" : "mp";
     const L = A === "reward" ? 0 : _ + C;
     const I = D - _;
     if (A === "reward") {
       return `<div class="panel"><p class="lbl">¿Cómo pagás?</p><div class="paypick" role="radiogroup">
      <button type="button" role="radio" class="payopt" data-paym="reward" aria-checked="true"><span class="mp reward">🎁</span><span><b>Usar mi premio</b><small class="hint">Canjeás ${s} sellos de tu tarjeta de ${esc(a[0])}: este turno es gratis.</small></span></button>
      <button type="button" role="radio" class="payopt" data-paym="mp" aria-checked="false"><span class="mp">MP</span><span><b>Mercado Pago</b><small class="hint">Pagar y guardar los sellos para después.</small></span></button></div></div>
     <div class="panel"><div class="sum"><div><span>${esc(a[0])}</span><span><s>${money(a[2])}</s></span></div><div style="color:var(--ok)"><span>🎁 Premio de la tarjeta de sellos</span><span>−${money(a[2])}</span></div>
      <div class="tot"><span>Pagás</span><span>${money(0)}</span></div></div></div>
     <p class="note" style="text-align:left;margin:0">Si cancelás, los sellos vuelven a tu tarjeta.</p>
     <div class="err" id="terr"></div><button class="btn btn-pri btn-block" type="submit">Canjear premio y reservar</button>`;
     } else {
       return `<div class="panel"><p class="lbl">Seña para reservar</p>
      <div class="paym"><span class="mp">MP</span><span><b>${I > 0 ? `Seña de ${money(_)}` : money(_)}${C ? ` + comisión ${money(C)}` : ""} con Mercado Pago</b><small class="hint">${I > 0 ? "Es obligatoria: con la seña pagada tu turno queda confirmado." : "Este profesional cobra el total al reservar."}</small></span></div>
      ${n ? `<div class="paypick" style="margin-top:10px"><button type="button" role="radio" class="payopt" data-paym="reward" aria-checked="false"><span class="mp reward">🎁</span><span><b>Usar mi premio</b><small class="hint">Tu tarjeta de ${esc(a[0])} está llena: este turno gratis, sin seña.</small></span></button></div>` : ""}
      ${k ? '<p class="alert" style="margin-top:10px">Este profesional pide pagar el total por faltas anteriores sin aviso.</p>' : ""}</div>
    ${
      I > 0
        ? `<div class="panel"><p class="lbl">¿Cómo pagás el resto (${money(I)})?</p><div class="paypick" role="radiogroup">
      ${T ? `<button type="button" role="radio" class="payopt" data-paym="cash" aria-checked="${A === "cash"}"><span class="mp cash">$</span><span><b>Efectivo</b><small class="hint">En el local, el día del turno.</small></span></button>` : ""}
      <button type="button" role="radio" class="payopt" data-paym="mp" aria-checked="${A === "mp"}"><span class="mp">MP</span><span><b>Mercado Pago</b><small class="hint">En el local, con QR o transferencia.</small></span></button></div></div>`
        : ""
    }
    <div class="panel"><div class="sum">
     <div><span>${esc(a[0])}</span><span>${money(a[2])}</span></div>
     ${y ? `<div style="color:var(--ok)"><span>Happy hour −${y}%</span><span>−${money(o - w)}</span></div>` : ""}
     ${M.length ? `<div><span>${M.length} turno${M.length > 1 ? "s" : ""} más</span><span>${money(D - w)}</span></div>` : ""}
     <div class="sumsep"><span>${I > 0 ? "Seña" : "Pago"} para ${esc(e.name)}${
       q > 1
         ? ` (${(() => {
             const z = [h].concat(M.map((G) => G.now));
             if (z.every((G) => G === z[0])) {
               return money(z[0]) + " × " + q;
             } else {
               return z.map(money).join(" + ");
             }
           })()})`
         : ""
     }</span><span>${money(_)}</span></div>
     <div class="feerow"><span>Comisión TuTiempo (${pctTxt()}% del precio)</span><span>${money(C)}</span></div>
     <div class="tot"><span>Pagás ahora</span><span>${money(L)}</span></div>
     ${I > 0 ? `<div class="feeline"><span>Después, en el local${q > 1 ? ` (los ${q} turnos)` : ""} · ${A === "cash" ? "efectivo" : "Mercado Pago"}</span><span>${money(I)}</span></div>` : ""}</div>
     <p class="note" style="text-align:left;margin:6px 0 0">${I > 0 ? `La seña es para ${esc(e.name)} y se descuenta del precio. ` : ""}La comisión de TuTiempo se paga aparte, al reservar${q > 1 ? `: una por cada uno de los ${q} turnos` : ""}.</p></div>
    <p class="note" style="text-align:left;margin:0">Si no vas, no se devuelve lo pagado. Si cancela el profesional, te devolvemos todo (seña y comisión).</p>
    <div class="err" id="terr"></div>
    <button class="btn btn-pri btn-block" type="submit">Pagar ${money(L)} y reservar${q > 1 ? ` ${q} turnos` : ""}</button>`;
     }
   })()}
  </form>`;
}

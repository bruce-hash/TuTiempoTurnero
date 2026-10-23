import { feeFor, money, mustPayTotal, payNow, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { dayLabel, toMin } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { RUBRO } from "../../lib/rubros.js";
import { PREP, selAdds, selDur, selPrice } from "../../lib/servicios.js";
import { cfg, happyAt, priceAt, seriesDates, slotsFor, uname } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { myStamps, stampGoal } from "../../ui/sellos.js";

// confirmación y pago de la reserva: repetición (serie de 3 turnos más), forma de pago (Mercado Pago, efectivo
// en el local para el resto, o premio de sellos) y el resumen. Los montos acá son para mostrar: el cobro real lo
// calcula la base al crear la reserva.
export function vCheckoutTurno() {
  const prov = pr(S.pid);
  const svc = prov && prov.svcs[S.svc];
  if (!prov || !svc) {
    return '<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Ese servicio ya no está disponible.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="home">Volver</button></div></div>';
  }
  const conf = cfg(prov.id);
  const goal = svc ? stampGoal(prov.id, svc) : 0;
  const canRedeem = !!goal && !S.reprog && !!(myStamps(prov.id, svc) >= goal);
  if (S.payM === "reward" && !canRedeem) {
    S.payM = "mp";
  }
  if (S.payM === "reward") {
    S.rep = 0;
  }
  if (!S.slot) {
    return `<div class="narrow" style="margin-top:24px"><div class="panel" style="text-align:center"><b>Elegí un horario primero.</b><button class="btn btn-pri btn-block" style="margin-top:12px" data-go="perfil" data-id="${prov.id}">Elegir horario</button></div></div>`;
  }
  const base = selPrice(prov);
  const dur = selDur(prov);
  const adds = selAdds(prov);
  const cat = svc[3];
  const rubro = RUBRO[cat] || RUBRO.b;
  const user = uname();
  const price = priceAt(prov.id, base, S.slot.date, S.slot.time);
  const happy = happyAt(prov.id, S.slot.date, toMin(S.slot.time));
  const mustTotal = mustPayTotal(prov.id, user);
  const deposit = payNow(prov.id, price, user);
  const rep = S.rep || 0;
  // los próximos 3 turnos de la serie: los ocupados se saltean
  const series = (rep ? seriesDates(S.slot.date, rep, 3) : []).map((date) => {
    const free = slotsFor(prov.id, date, dur, null, true).list.some((slot) => slot.free && slot.time === S.slot.time);
    const seriesPrice = priceAt(prov.id, base, date, S.slot.time);
    return {
      k: date,
      ok: free,
      price: seriesPrice,
      now: payNow(prov.id, seriesPrice, user),
      fee: feeFor(seriesPrice),
    };
  });
  const seriesOk = series.filter((item) => item.ok);
  const depositTotal = deposit + seriesOk.reduce((sum, item) => sum + item.now, 0);
  const priceTotal = price + seriesOk.reduce((sum, item) => sum + item.price, 0);
  const count = 1 + seriesOk.length;
  const feeTotal = feeFor(price) + seriesOk.reduce((sum, item) => sum + item.fee, 0);
  return `<button class="back" data-go="perfil" data-id="${prov.id}">← Cambiar horario</button>
  <form class="narrow stack" id="fTurno" novalidate>
   <h1 class="h1">Confirmá tu turno</h1>
   <div class="panel turnocard"><div class="tdate"><span>${esc(dayLabel(S.slot.date, true))}</span><b>${S.slot.time}</b></div>
    <div><b>${esc(svc[0])}</b>${adds.length ? `<div class="hint">+ ${adds.map((addon) => esc(addon[0])).join(" · ")}</div>` : ""}<div class="hint">${dur} min · ${esc(prov.name)}</div><div class="hint">📍 ${esc(prov.addr)}</div></div></div>
   ${PREP(prov, svc) ? `<div class="panel prepbox"><b>Antes de venir</b><p>${esc(PREP(prov, svc))}</p></div>` : ""}
   ${
     S.payM === "reward"
       ? ""
       : `<div class="panel"><p class="lbl">¿Lo hacés seguido?</p>
     <div class="seg3" role="group" aria-label="Repetir turno">${rubro.reps
       .map((weeks) => [weeks, weeks === 0 ? "Una vez" : weeks === 1 ? "Cada semana" : `Cada ${weeks} sem.`])
       .map(([weeks, label]) => `<button type="button" data-rep="${weeks}" aria-pressed="${rep === weeks}">${label}</button>`)
       .join("")}</div>
     ${
       rep
         ? `<p class="note" style="text-align:left;margin:10px 0 8px">Reservamos también los próximos 3 turnos, mismo día y hora.</p>
       <ul class="ag">${series.map((item) => `<li><span class="ag-t">${esc(dayLabel(item.k))}</span><div><b>${S.slot.time} h</b><span>${item.ok ? money(item.price) : "Ocupado, se saltea"}</span></div>${item.ok ? '<span class="chip ok">✓ Libre</span>' : '<span class="chip bad">✕ Ocupado</span>'}</li>`).join("")}</ul>`
         : ""
     }</div>`
   }
   ${(() => {
     const cashOk = conf.cash !== false && !mustTotal;
     const method = S.payM === "reward" && canRedeem ? "reward" : cashOk && S.payM === "cash" ? "cash" : "mp";
     const payNowTotal = method === "reward" ? 0 : depositTotal + feeTotal;
     const rest = priceTotal - depositTotal;
     if (method === "reward") {
       return `<div class="panel"><p class="lbl">¿Cómo pagás?</p><div class="paypick" role="radiogroup">
      <button type="button" role="radio" class="payopt" data-paym="reward" aria-checked="true"><span class="mp reward">🎁</span><span><b>Usar mi premio</b><small class="hint">Canjeás ${goal} sellos de tu tarjeta de ${esc(svc[0])}: este turno es gratis.</small></span></button>
      <button type="button" role="radio" class="payopt" data-paym="mp" aria-checked="false"><span class="mp">MP</span><span><b>Mercado Pago</b><small class="hint">Pagar y guardar los sellos para después.</small></span></button></div></div>
     <div class="panel"><div class="sum"><div><span>${esc(svc[0])}</span><span><s>${money(svc[2])}</s></span></div><div style="color:var(--ok)"><span>🎁 Premio de la tarjeta de sellos</span><span>−${money(svc[2])}</span></div>
      <div class="tot"><span>Pagás</span><span>${money(0)}</span></div></div></div>
     <p class="note" style="text-align:left;margin:0">Si cancelás, los sellos vuelven a tu tarjeta.</p>
     <div class="err" id="terr"></div><button class="btn btn-pri btn-block" type="submit">Canjear premio y reservar</button>`;
     } else {
       return `<div class="panel"><p class="lbl">Seña para reservar</p>
      <div class="paym"><span class="mp">MP</span><span><b>${rest > 0 ? `Seña de ${money(depositTotal)}` : money(depositTotal)}${feeTotal ? ` + comisión ${money(feeTotal)}` : ""} con Mercado Pago</b><small class="hint">${rest > 0 ? "Es obligatoria: con la seña pagada tu turno queda confirmado." : "Este profesional cobra el total al reservar."}</small></span></div>
      ${canRedeem ? `<div class="paypick" style="margin-top:10px"><button type="button" role="radio" class="payopt" data-paym="reward" aria-checked="false"><span class="mp reward">🎁</span><span><b>Usar mi premio</b><small class="hint">Tu tarjeta de ${esc(svc[0])} está llena: este turno gratis, sin seña.</small></span></button></div>` : ""}
      ${mustTotal ? '<p class="alert" style="margin-top:10px">Este profesional pide pagar el total por faltas anteriores sin aviso.</p>' : ""}</div>
    ${
      rest > 0
        ? `<div class="panel"><p class="lbl">¿Cómo pagás el resto (${money(rest)})?</p><div class="paypick" role="radiogroup">
      ${cashOk ? `<button type="button" role="radio" class="payopt" data-paym="cash" aria-checked="${method === "cash"}"><span class="mp cash">$</span><span><b>Efectivo</b><small class="hint">En el local, el día del turno.</small></span></button>` : ""}
      <button type="button" role="radio" class="payopt" data-paym="mp" aria-checked="${method === "mp"}"><span class="mp">MP</span><span><b>Mercado Pago</b><small class="hint">En el local, con QR o transferencia.</small></span></button></div></div>`
        : ""
    }
    <div class="panel"><div class="sum">
     <div><span>${esc(svc[0])}</span><span>${money(svc[2])}</span></div>
     ${happy ? `<div style="color:var(--ok)"><span>Happy hour −${happy}%</span><span>−${money(base - price)}</span></div>` : ""}
     ${seriesOk.length ? `<div><span>${seriesOk.length} turno${seriesOk.length > 1 ? "s" : ""} más</span><span>${money(priceTotal - price)}</span></div>` : ""}
     <div class="sumsep"><span>${rest > 0 ? "Seña" : "Pago"} para ${esc(prov.name)}${
       count > 1
         ? ` (${(() => {
             const amounts = [deposit].concat(seriesOk.map((item) => item.now));
             if (amounts.every((amount) => amount === amounts[0])) {
               return money(amounts[0]) + " × " + count;
             } else {
               return amounts.map(money).join(" + ");
             }
           })()})`
         : ""
     }</span><span>${money(depositTotal)}</span></div>
     <div class="feerow"><span>Comisión TuTiempo (${pctTxt()}% del precio)</span><span>${money(feeTotal)}</span></div>
     <div class="tot"><span>Pagás ahora</span><span>${money(payNowTotal)}</span></div>
     ${rest > 0 ? `<div class="feeline"><span>Después, en el local${count > 1 ? ` (los ${count} turnos)` : ""} · ${method === "cash" ? "efectivo" : "Mercado Pago"}</span><span>${money(rest)}</span></div>` : ""}</div>
     <p class="note" style="text-align:left;margin:6px 0 0">${rest > 0 ? `La seña es para ${esc(prov.name)} y se descuenta del precio. ` : ""}La comisión de TuTiempo se paga aparte, al reservar${count > 1 ? `: una por cada uno de los ${count} turnos` : ""}.</p></div>
    <p class="note" style="text-align:left;margin:0">Si no vas, no se devuelve lo pagado. Si cancela el profesional, te devolvemos todo (seña y comisión).</p>
    <div class="err" id="terr"></div>
    <button class="btn btn-pri btn-block" type="submit">Pagar ${money(payNowTotal)} y reservar${count > 1 ? ` ${count} turnos` : ""}</button>`;
     }
   })()}
  </form>`;
}

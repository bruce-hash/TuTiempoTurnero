import { esc } from "../../lib/dom.js";
import { DOW, addDays, dkey } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { R, cfg, freeCount } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { vDayBlocks } from "./bloqueo-dias.js";

export const PRESETS = [
  ["doble", "Doble jornada", "9–12 y 15–21", R(true, "09:00", "12:00"), R(true, "15:00", "21:00")],
  ["corrido", "Corrido", "9 a 21", R(true, "09:00", "21:00"), R(false, "15:00", "21:00")],
  ["manana", "Solo mañana", "9 a 13", R(true, "09:00", "13:00"), R(false, "15:00", "21:00")],
  ["tarde", "Solo tarde", "15 a 21", R(false, "09:00", "12:00"), R(true, "15:00", "21:00")],
];
export const DNAME = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export function vBHorarios() {
  const e = cfg(ME());
  const a = [1, 2, 3, 4, 5, 6, 0];
  const t = S.hErr || {};
  const s = e.happy;
  const n = (l, c, d) =>
    `<select id="${l}">${c.map(([p, w]) => `<option value="${p}" ${String(d) === String(p) ? "selected" : ""}>${w}</option>`).join("")}</select>`;
  const o = (l, c, d) => {
    const p = e.days[l][c];
    const w = !e.days[l].on || !p.on;
    return `<div class="rng ${w ? "off" : ""}"><label class="mini"><input type="checkbox" id="h${c}${l}" ${p.on ? "checked" : ""} ${e.days[l].on ? "" : "disabled"}> ${d}</label><input type="time" id="h${c}f${l}" value="${p.from}" aria-label="${d} desde" ${w ? "disabled" : ""}><span class="hint">a</span><input type="time" id="h${c}t${l}" value="${p.to}" aria-label="${d} hasta" ${w ? "disabled" : ""}></div>`;
  };
  const i = freeCount(ME(), dkey(addDays(1)), 30);
  return `<form class="stack" id="fHorarios" novalidate>
   <div class="panel"><p class="lbl">Días y horarios</p>
    <div class="hdays">${a
      .map((l) => {
        const c = e.days[l];
        return `<div class="hday ${c.on ? "" : "off"}"><div class="hday-h"><label class="chk dname"><input type="checkbox" id="hd${l}" ${c.on ? "checked" : ""}> ${DNAME[l]}</label><span class="dclosed">Cerrado</span></div>
      <div class="rngs">${o(l, "m", "Mañana")}${o(l, "t", "Tarde")}</div><span class="ferr" id="herr-d${l}">${t["d" + l] || ""}</span></div>`;
      })
      .join("")}</div>
    <span class="ferr" id="herr-days">${t.days || ""}</span>
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" data-act="copyMon">Copiar el horario del lunes a todos los días abiertos</button></div>
   <div class="panel hhpanel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><p class="lbl" style="margin:0">Happy hour</p><div class="hint">Descuento automático en tus horarios flojos.</div></div><label class="chk" style="margin:0;white-space:nowrap;flex:none"><input type="checkbox" id="hhon" ${s.on ? "checked" : ""}> Activo</label></div>
    <p class="lbl" style="margin:12px 0 6px">Descuento</p>
    <div class="hhpct"><div class="seg3">${[5, 10, 15, 20, 30].map((l) => `<button type="button" data-hhp="${l}" aria-pressed="${s.pct === l}">${l}%</button>`).join("")}</div>
     <label class="hhother" for="hhp">Otro <input id="hhp" inputmode="numeric" value="${s.pct}" aria-label="Porcentaje de descuento"> %</label></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:10px"><div class="f"><label for="hhf">Desde</label><input type="time" id="hhf" value="${s.from}"></div><div class="f"><label for="hht">Hasta</label><input type="time" id="hht" value="${s.to}"></div></div>
    <div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map((l) => `<label><input type="checkbox" id="hhd${l}" ${s.days.includes(l) ? "checked" : ""}><span>${DOW[l]}</span></label>`).join("")}</div>
    <span class="ferr" id="herr-hh">${t.hh || ""}</span>
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" data-act="hhSuggest">✨ Usar mis horarios más flojos</button></div>
   <div class="panel"><p class="lbl">Reglas de reserva</p>
    <div class="f"><label for="hbuf">Descanso entre turnos</label>${n(
      "hbuf",
      [
        [0, "Sin descanso"],
        [5, "5 min"],
        [10, "10 min"],
        [15, "15 min"],
        [20, "20 min"],
        [30, "30 min"],
      ],
      e.buffer || 0,
    )}<span class="hint">Tiempo para limpiar o preparar entre un cliente y el siguiente. No se puede reservar.</span></div>
    <div class="f"><label for="hst">Cada cuánto empieza un turno</label>${n(
      "hst",
      [
        [15, "Cada 15 min"],
        [20, "Cada 20 min"],
        [30, "Cada 30 min"],
        [45, "Cada 45 min"],
        [60, "Cada 1 hora"],
      ],
      e.step,
    )}</div>
    <p class="hint" style="text-align:left;margin:-4px 0 12px">📅 Tus clientes pueden reservar desde hoy hasta 31 días adelante.</p>
    <div class="f"><label for="hno">Aviso mínimo</label>${n(
      "hno",
      [
        [0, "Sin mínimo"],
        [30, "30 min antes"],
        [60, "1 hora antes"],
        [120, "2 horas antes"],
        [720, "12 horas antes"],
      ],
      e.notice,
    )}<span class="hint">No te pueden reservar con menos anticipación que esto.</span></div>
    <div class="f"><label for="hpay">Al reservar el cliente paga</label>${n(
      "hpay",
      [
        ["sena30", "Seña del 30%"],
        ["sena50", "Seña del 50%"],
        ["total", "El total"],
      ],
      e.pay === "total" ? "total" : "sena" + e.pct,
    )}<span class="hint">Lo pagado no se devuelve. Si el cliente no viene, te queda a vos.</span></div>
   </div>
   <div class="panel" style="text-align:center"><p class="lbl">Tu link de turnos</p><p style="margin:0 0 8px;font-weight:700">tutiempo.com.ar/${esc(pr(ME()).slug || "p/" + ME())}</p><p class="note">Ponelo en tu bio de Instagram y compartilo con tus clientes.</p>
    <button type="button" class="btn btn-ghost btn-block" data-act="copiarLink">Copiar link</button></div>
   <p class="note">Con lo guardado, mañana te quedan <b>${i}</b> turnos libres de 30 min.</p>
   <button class="btn btn-pri btn-block" type="submit">Guardar horarios</button>
   <button type="button" class="btn btn-ghost btn-block" data-act="preview">👁 Ver cómo lo ve un cliente</button>
  </form>${vDayBlocks()}`;
}

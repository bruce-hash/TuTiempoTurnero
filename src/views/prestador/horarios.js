import { esc } from "../../lib/dom.js";
import { DOW, addDays, dkey } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { R, cfg, freeCount } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { vDayBlocks } from "./bloqueo-dias.js";

// jornadas predefinidas: [id, nombre, detalle, mañana, tarde]
export const PRESETS = [
  ["doble", "Doble jornada", "9–12 y 15–21", R(true, "09:00", "12:00"), R(true, "15:00", "21:00")],
  ["corrido", "Corrido", "9 a 21", R(true, "09:00", "21:00"), R(false, "15:00", "21:00")],
  ["manana", "Solo mañana", "9 a 13", R(true, "09:00", "13:00"), R(false, "15:00", "21:00")],
  ["tarde", "Solo tarde", "15 a 21", R(false, "09:00", "12:00"), R(true, "15:00", "21:00")],
];
export const DNAME = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
// horarios del prestador: días con mañana y tarde, happy hour, reglas de reserva, link y días bloqueados
export function vBHorarios() {
  const conf = cfg(ME());
  const order = [1, 2, 3, 4, 5, 6, 0];
  const errs = S.hErr || {};
  const happy = conf.happy;
  const select = (id, options, current) =>
    `<select id="${id}">${options.map(([value, label]) => `<option value="${value}" ${String(current) === String(value) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
  // una franja (part "m" mañana / "t" tarde) de un día: casilla, desde y hasta
  const range = (dow, part, label) => {
    const rng = conf.days[dow][part];
    const off = !conf.days[dow].on || !rng.on;
    return `<div class="rng ${off ? "off" : ""}"><label class="mini"><input type="checkbox" id="h${part}${dow}" ${rng.on ? "checked" : ""} ${conf.days[dow].on ? "" : "disabled"}> ${label}</label><input type="time" id="h${part}f${dow}" value="${rng.from}" aria-label="${label} desde" ${off ? "disabled" : ""}><span class="hint">a</span><input type="time" id="h${part}t${dow}" value="${rng.to}" aria-label="${label} hasta" ${off ? "disabled" : ""}></div>`;
  };
  const freeTomorrow = freeCount(ME(), dkey(addDays(1)), 30);
  return `<form class="stack" id="fHorarios" novalidate>
   <div class="panel"><p class="lbl">Días y horarios</p>
    <div class="hdays">${order
      .map((dow) => {
        const day = conf.days[dow];
        return `<div class="hday ${day.on ? "" : "off"}"><div class="hday-h"><label class="chk dname"><input type="checkbox" id="hd${dow}" ${day.on ? "checked" : ""}> ${DNAME[dow]}</label><span class="dclosed">Cerrado</span></div>
      <div class="rngs">${range(dow, "m", "Mañana")}${range(dow, "t", "Tarde")}</div><span class="ferr" id="herr-d${dow}">${errs["d" + dow] || ""}</span></div>`;
      })
      .join("")}</div>
    <span class="ferr" id="herr-days">${errs.days || ""}</span>
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" data-act="copyMon">Copiar el horario del lunes a todos los días abiertos</button></div>
   <div class="panel hhpanel"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><p class="lbl" style="margin:0">Happy hour</p><div class="hint">Descuento automático en tus horarios flojos.</div></div><label class="chk" style="margin:0;white-space:nowrap;flex:none"><input type="checkbox" id="hhon" ${happy.on ? "checked" : ""}> Activo</label></div>
    <p class="lbl" style="margin:12px 0 6px">Descuento</p>
    <div class="hhpct"><div class="seg3">${[5, 10, 15, 20, 30].map((pct) => `<button type="button" data-hhp="${pct}" aria-pressed="${happy.pct === pct}">${pct}%</button>`).join("")}</div>
     <label class="hhother" for="hhp">Otro <input id="hhp" inputmode="numeric" value="${happy.pct}" aria-label="Porcentaje de descuento"> %</label></div>
    <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-top:10px"><div class="f"><label for="hhf">Desde</label><input type="time" id="hhf" value="${happy.from}"></div><div class="f"><label for="hht">Hasta</label><input type="time" id="hht" value="${happy.to}"></div></div>
    <div class="daypick">${[1, 2, 3, 4, 5, 6, 0].map((dow) => `<label><input type="checkbox" id="hhd${dow}" ${happy.days.includes(dow) ? "checked" : ""}><span>${DOW[dow]}</span></label>`).join("")}</div>
    <span class="ferr" id="herr-hh">${errs.hh || ""}</span>
    <button type="button" class="btn btn-ghost btn-block" style="margin-top:10px" data-act="hhSuggest">✨ Usar mis horarios más flojos</button></div>
   <div class="panel"><p class="lbl">Reglas de reserva</p>
    <div class="f"><label for="hbuf">Descanso entre turnos</label>${select(
      "hbuf",
      [
        [0, "Sin descanso"],
        [5, "5 min"],
        [10, "10 min"],
        [15, "15 min"],
        [20, "20 min"],
        [30, "30 min"],
      ],
      conf.buffer || 0,
    )}<span class="hint">Tiempo para limpiar o preparar entre un cliente y el siguiente. No se puede reservar.</span></div>
    <div class="f"><label for="hst">Cada cuánto empieza un turno</label>${select(
      "hst",
      [
        [15, "Cada 15 min"],
        [20, "Cada 20 min"],
        [30, "Cada 30 min"],
        [45, "Cada 45 min"],
        [60, "Cada 1 hora"],
      ],
      conf.step,
    )}</div>
    <p class="hint" style="text-align:left;margin:-4px 0 12px">📅 Tus clientes pueden reservar desde hoy hasta 31 días adelante.</p>
    <div class="f"><label for="hno">Aviso mínimo</label>${select(
      "hno",
      [
        [0, "Sin mínimo"],
        [30, "30 min antes"],
        [60, "1 hora antes"],
        [120, "2 horas antes"],
        [720, "12 horas antes"],
      ],
      conf.notice,
    )}<span class="hint">No te pueden reservar con menos anticipación que esto.</span></div>
    <div class="f"><label for="hpay">Al reservar el cliente paga</label>${select(
      "hpay",
      [
        ["sena30", "Seña del 30%"],
        ["sena50", "Seña del 50%"],
        ["total", "El total"],
      ],
      conf.pay === "total" ? "total" : "sena" + conf.pct,
    )}<span class="hint">Lo pagado no se devuelve. Si el cliente no viene, te queda a vos.</span></div>
   </div>
   <div class="panel" style="text-align:center"><p class="lbl">Tu link de turnos</p><p style="margin:0 0 8px;font-weight:700">tutiempo.com.ar/${esc(pr(ME()).slug || "p/" + ME())}</p><p class="note">Ponelo en tu bio de Instagram y compartilo con tus clientes.</p>
    <button type="button" class="btn btn-ghost btn-block" data-act="copiarLink">Copiar link</button></div>
   <p class="note">Con lo guardado, mañana te quedan <b>${freeTomorrow}</b> turnos libres de 30 min.</p>
   <button class="btn btn-pri btn-block" type="submit">Guardar horarios</button>
   <button type="button" class="btn btn-ghost btn-block" data-act="preview">👁 Ver cómo lo ve un cliente</button>
  </form>${vDayBlocks()}`;
}

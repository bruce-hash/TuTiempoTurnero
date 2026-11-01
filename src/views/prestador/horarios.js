import { MP_TERMS } from "../../lib/cobro.js";
import { mpPctOf, pctTxt } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { DOW, addDays, dkey } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { R, cfg, freeCount } from "../../lib/turnero.js";
import { profileLinkText } from "../../router.js";
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
  // C38 (V3b): en qué días y horas rige el happy hour, en la misma lista de días
  const hhChip = (dow) =>
    happy.on && happy.days.includes(dow) && conf.days[dow].on ? `<span class="hhchip">⚡ Happy hour ${esc(happy.from)}–${esc(happy.to)} · −${happy.pct}%</span>` : "";
  return `<form class="stack" id="fHorarios" novalidate>
   <p class="hsaved" id="hSaved" role="status" aria-live="polite">${S.hSavedAt ? "✓ Guardado" : "Los cambios se guardan solos."}</p>
   <div class="panel"><p class="lbl">Días y horarios</p>
    <div class="hdays">${order
      .map((dow) => {
        const day = conf.days[dow];
        return `<div class="hday ${day.on ? "" : "off"}"><div class="hday-h"><label class="chk dname"><input type="checkbox" id="hd${dow}" ${day.on ? "checked" : ""}> ${DNAME[dow]}</label><span class="dclosed">Cerrado</span>${hhChip(dow)}</div>
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
    <p class="hint" style="text-align:left;margin:0 0 12px">⏱ Los horarios de cada servicio empiezan cuando abrís y se suceden según lo que dura el servicio (un corte de 45 min: 9:00, 9:45, 10:30…). Si hay un turno tomado, siguen desde que termina, sin dejar huecos. Sin descanso entre turnos.</p>
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
      // D30: 30, 40, 50% o el total (si tenía otro %, se sigue mostrando hasta que lo cambie)
      [["sena30", "Seña del 30%"], ["sena40", "Seña del 40%"], ["sena50", "Seña del 50%"]]
        .concat(conf.pay !== "total" && ![30, 40, 50].includes(+conf.pct) ? [["sena" + conf.pct, `Seña del ${conf.pct}% (la que tenés hoy)`]] : [])
        .concat([["total", "El total"]]),
      conf.pay === "total" ? "total" : "sena" + conf.pct,
    )}<span class="hint">Lo pagado no se devuelve. Si el cliente no viene, te queda a vos.</span></div>
    <div class="f"><label for="hterm">Plazo de acreditación de Mercado Pago</label>${select("hterm", MP_TERMS, conf.term || "instant")}<span class="hint">Tiene que ser el mismo plazo que elegiste en tu cuenta de Mercado Pago (Tu negocio → Costos y plazos). Si no coincide, vas a recibir un poco más o un poco menos que la seña.${mpPctOf(ME()) ? ` Al cliente se le suma ${pctTxt(mpPctOf(ME()))}% por la acreditación.` : ""}</span></div>
   </div>
   <div class="panel" style="text-align:center"><p class="lbl">Tu link de turnos</p><p style="margin:0 0 8px;font-weight:700">${esc(profileLinkText(pr(ME())))}</p><p class="note">Ponelo en tu bio de Instagram y compartilo con tus clientes.</p>
    <button type="button" class="btn btn-ghost btn-block" data-act="copiarLink">Copiar link</button></div>
   <p class="note">Con lo guardado, mañana te quedan <b>${freeTomorrow}</b> turnos libres de 30 min.</p>
   <button type="button" class="btn btn-ghost btn-block" data-act="preview">👁 Ver cómo lo ve un cliente</button>
  </form>${vDayBlocks()}`;
}

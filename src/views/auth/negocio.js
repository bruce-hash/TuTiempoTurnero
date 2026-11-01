import { esc } from "../../lib/dom.js";
import { STEPS, dniDone, setupTodo, stepDone } from "../../lib/alta.js";
import { MP_TERMS } from "../../lib/cobro.js";
import { DOW } from "../../lib/fechas.js";
import { ME, avatar, pr } from "../../lib/prestadores.js";
import { CATS, catName } from "../../lib/rubros.js";
import { cfg } from "../../lib/turnero.js";
import { dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";
import { dniForm } from "../prestador/verificacion.js";
import { vLogin } from "./login.js";

// Registrá tu negocio (ingreso y registro, aprobado el 1/11): página completa en 5 pasos, después de la cuenta (paso 0,
// la misma ventana de ingreso). Se guarda en cada paso ("Guardar y seguir"): si sale y vuelve, sigue donde quedó.
// "Volver" no pierde nada. No recibe reservas hasta estar aprobado y con Mercado Pago conectado.

// Paso 2: ejemplos por rubro (nombre y duración, sin precio; los puede ajustar el cliente de TuTiempo después)
export const SVC_EXAMPLES = {
  b: [["Corte", 30], ["Corte y barba", 45], ["Barba", 20], ["Corte infantil", 30]],
  p: [["Corte", 45], ["Brushing", 30], ["Color", 90], ["Mechas", 120]],
  m: [["Descontracturante", 60], ["Relajante", 60], ["Piedras calientes", 75]],
  l: [["Lifting", 60], ["Extensiones clásicas", 120], ["Service", 60]],
  u: [["Esmaltado semipermanente", 60], ["Kapping", 75], ["Esculpidas", 120]],
  d: [["Cera piernas completas", 45], ["Cavado", 20], ["Cejas", 15]],
};
// Paso 3: plantillas de horarios. days: [dow, [desde, hasta], [desde, hasta] | null]
export const HOUR_TEMPLATES = [
  ["lv", "Lunes a viernes, 9 a 18", "Sábado y domingo cerrado", [1, 2, 3, 4, 5].map((dow) => [dow, ["09:00", "18:00"], null])],
  ["ls", "Lunes a sábado, 9 a 13 y 16 a 20", "Con corte al mediodía", [1, 2, 3, 4, 5, 6].map((dow) => [dow, ["09:00", "13:00"], ["16:00", "20:00"]])],
  ["ms", "Martes a sábado, 10 a 20", "Domingo y lunes cerrado", [2, 3, 4, 5, 6].map((dow) => [dow, ["10:00", "20:00"], null])],
  ["dd", "Armarlo día por día", "Elegí qué días abrís y en qué horario", null],
];
export const DURATIONS = [15, 20, 30, 40, 45, 60, 75, 90, 120, 150, 180, 240];

const errOf = (key) => (S.biz.errs && S.biz.errs[key] ? `<span class="ferr" id="berr-${key}">⚠ ${esc(S.biz.errs[key])}</span>` : "");
const field = (id, label, value, attrs = "", hint = "") =>
  `<div class="f"><label for="${id}">${label}</label><input id="${id}" value="${esc(value || "")}" ${attrs}>${hint ? `<span class="hint">${hint}</span>` : ""}${errOf(id)}</div>`;

function stepsAside(n) {
  const item = (label, i) => {
    const num = i + 1;
    const cls = num === n ? "now" : stepDone(num) ? "done" : "";
    // los pasos ya guardados se pueden volver a abrir
    const go = cls === "done" ? `data-act="bizGo" data-n="${num}"` : "";
    return `<li class="${cls}"><button type="button" ${go} ${go ? "" : "disabled"} ${num === n ? 'aria-current="step"' : ""}><span class="d">${cls === "done" ? "✓" : num}</span>${label}</button></li>`;
  };
  return `<aside class="biz-steps" aria-label="Pasos del alta"><p>Registrá tu negocio</p><ol>${STEPS.map(item).join("")}</ol>
   <p class="note">Se guarda en cada paso: si salís, seguís donde quedaste.</p></aside>`;
}
// form: la etiqueta del formulario con "%" donde va el contenido (los pasos 4 y 5 no tienen: botones con data-act)
function shell(n, body, { title, sub, next = "Guardar y seguir", form, finish }) {
  const prog = `<div class="biz-prog">Paso ${n} de 5 · ${STEPS[n - 1]}<div class="segs">${STEPS.map((label, i) => `<i class="${i + 1 < n || stepDone(i + 1) ? "done" : i + 1 === n ? "now" : ""}"></i>`).join("")}</div></div>`;
  const acts = `<div class="biz-acts">${n > 1 ? '<button type="button" class="btn btn-ghost" data-act="bizBack">Volver</button>' : '<span class="biz-saved">Podés cambiar todo después desde tu Perfil.</span>'}<button class="btn btn-pri" ${form ? 'type="submit"' : finish ? 'type="button" data-act="bizFinish"' : 'type="button" data-act="bizNext"'}>${next}</button></div>`;
  const inner = `${prog}<h1 class="biz-h">${title}</h1><p class="am-sub">${sub}</p>${body}<div class="err" id="bizErr">${esc(S.biz.err || "")}</div>${acts}`;
  return `<div class="biz">${stepsAside(n)}<section class="biz-card">${form ? form.replace("%", () => inner) : inner}</section></div>`;
}

function step1() {
  const prov = S.barberAuth ? pr(ME()) : null;
  const d = Object.assign({ name: prov ? prov.name : "", cats: prov ? prov.cats : [], addr: prov ? prov.addr : "", tel: prov ? prov.tel : "", ig: prov ? prov.ig : "" }, S.biz.data || {});
  const photo = prov && prov.photo ? avatar(prov) : S.biz.photoPreview ? `<img src="${esc(S.biz.photoPreview)}" alt="">` : "📷";
  return shell(
    1,
    `${field("bn", "Nombre del negocio", d.name, 'maxlength="80" autocomplete="organization"')}
   <div class="f"><label>Rubro <span class="hint">(uno o más)</span></label><div class="catpick" style="margin:0">${CATS.map(([key, , name, icon]) => `<label><input type="checkbox" id="bc-${key}" ${(d.cats || []).includes(key) ? "checked" : ""}><span>${icon} ${name}</span></label>`).join("")}</div>${errOf("cats")}</div>
   <div class="biz-row">${field("ba", "Dirección", d.addr, 'maxlength="160" autocomplete="street-address"')}<div class="f"><label for="bcity">Ciudad</label><select id="bcity" disabled><option>Olavarría</option></select></div></div>
   <div class="biz-row">${field("bt", "Celular del negocio", d.tel, 'type="tel" inputmode="tel" maxlength="40" autocomplete="tel"', "Lo ve TuTiempo y el cliente que tiene un turno pago con vos.")}${field("bi", 'Instagram <span class="hint">(opcional)</span>', d.ig, 'maxlength="60" placeholder="@tunegocio"')}</div>
   <div class="f"><label for="bphoto">Foto o logo <span class="hint">(opcional)</span></label><div class="biz-photo"><i>${photo}</i><div><input type="file" id="bphoto" accept="image/*"><div class="hint" style="margin-top:4px">Cuadrada, se ve en tu perfil y en el listado. Si no subís una, van tus iniciales.</div></div></div></div>`,
    { title: "Tu negocio", sub: "Lo que ven tus clientes cuando te buscan.", form: '<form id="fBiz1" novalidate>%</form>' },
  );
}
function step2() {
  const prov = pr(ME());
  const rows = S.biz.svcs || [];
  const cats = prov.cats || [];
  const durSel = (i, value) =>
    `<select id="bsd${i}" aria-label="Duración del servicio ${i + 1}">${DURATIONS.concat(DURATIONS.includes(+value) ? [] : [+value])
      .filter((min) => min > 0)
      .sort((a, b) => a - b)
      .map((min) => `<option value="${min}" ${+value === min ? "selected" : ""}>${min < 60 ? min + " min" : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : min / 60 + " h"}</option>`)
      .join("")}</select>`;
  const catSel = (i, value) =>
    cats.length > 1
      ? `<div class="f"><label for="bsc${i}">Rubro</label><select id="bsc${i}">${cats.map((cat) => `<option value="${cat}" ${value === cat ? "selected" : ""}>${esc(catName(cat))}</option>`).join("")}</select></div>`
      : "";
  const examples = cats
    .map(
      (cat) =>
        `<p class="lbl" style="margin:0 0 6px">Ejemplos para ${esc(catName(cat).toLowerCase())} (tocá para agregar)</p><div class="biz-chips">${(SVC_EXAMPLES[cat] || [])
          .map(([name, min]) => `<button type="button" class="chip" data-act="bizEx" data-c="${cat}" data-n="${esc(name)}" data-d="${min}">＋ ${esc(name)} · ${min} min</button>`)
          .join("")}</div>`,
    )
    .join("");
  return shell(
    2,
    `${examples}
   <div class="biz-svcs">${rows
     .map(
       (row, i) =>
         `<div class="biz-svc ${cats.length > 1 ? "with-cat" : ""}"><div class="f"><label for="bsn${i}">Servicio</label><input id="bsn${i}" value="${esc(row[0])}" maxlength="80"></div><div class="f"><label for="bsd${i}">Duración</label>${durSel(i, row[1])}</div><div class="f"><label for="bsp${i}">Precio ($)</label><input id="bsp${i}" value="${row[2] || ""}" inputmode="numeric" placeholder="10000"></div>${catSel(i, row[3])}<button type="button" class="btn btn-ghost biz-x" data-act="bizSvcDel" data-i="${i}" aria-label="Quitar el servicio ${i + 1}">✕</button></div>`,
     )
     .join("")}</div>
   <button type="button" class="lnk" data-act="bizSvcAdd">＋ Agregar otro servicio</button>
   <p class="note" style="text-align:left;margin-top:12px">Necesitás al menos uno por rubro. El precio que cargues es el que ve el cliente; la seña se calcula sola.</p>`,
    { title: "Servicios", sub: "Lo que reservan tus clientes. Podés sumar más después.", form: '<form id="fBiz2" novalidate>%</form>' },
  );
}
function step3() {
  const days = S.biz.days || {};
  const tpl = S.biz.tpl || "";
  const order = [1, 2, 3, 4, 5, 6, 0];
  const row = (dow) => {
    const day = days[dow] || { on: false, m: ["09:00", "18:00"], t: null };
    return `<div class="biz-day ${day.on ? "" : "off"}"><label class="chk"><input type="checkbox" id="wd${dow}" ${day.on ? "checked" : ""}> <b>${DOW[dow]}</b></label>
     <span class="biz-rng"><input type="time" id="wm${dow}f" value="${day.m[0]}" aria-label="${DOW[dow]} desde" ${day.on ? "" : "disabled"}> a <input type="time" id="wm${dow}t" value="${day.m[1]}" aria-label="${DOW[dow]} hasta" ${day.on ? "" : "disabled"}></span>
     <span class="biz-rng"><label class="chk mini"><input type="checkbox" id="wt${dow}" ${day.t ? "checked" : ""} ${day.on ? "" : "disabled"}> y de</label><input type="time" id="wt${dow}f" value="${day.t ? day.t[0] : "16:00"}" aria-label="${DOW[dow]} tarde desde" ${day.on && day.t ? "" : "disabled"}> a <input type="time" id="wt${dow}t" value="${day.t ? day.t[1] : "20:00"}" aria-label="${DOW[dow]} tarde hasta" ${day.on && day.t ? "" : "disabled"}></span>${errOf("d" + dow)}</div>`;
  };
  return shell(
    3,
    `<div class="biz-opt" role="radiogroup" aria-label="Plantilla de horarios">${HOUR_TEMPLATES.map(([key, label, hint]) => `<label class="${tpl === key ? "on" : ""}"><input type="radio" name="btpl" data-act="bizTpl" data-k="${key}" ${tpl === key ? "checked" : ""}><span><b>${label}</b><small>${hint}</small></span></label>`).join("")}</div>
   <div class="biz-days">${order.map(row).join("")}</div>${errOf("days")}`,
    { title: "Horarios", sub: "Elegí una plantilla y ajustala. Los feriados y vacaciones los bloqueás desde la Agenda.", form: '<form id="fBiz3" novalidate>%</form>' },
  );
}
function step4() {
  const conf = cfg(ME());
  const pay = S.biz.pay || (conf.pay === "total" ? "total" : String(conf.pct || 50));
  const term = S.biz.term || conf.term || "instant";
  const seg = (act, value, label, on) => `<button type="button" class="${on ? "on" : ""}" aria-pressed="${on}" data-act="${act}" data-v="${value}">${label}</button>`;
  const mpOk = S.mp === "ok";
  return shell(
    4,
    `<div class="f"><label>Seña que paga el cliente al reservar</label><div class="biz-seg">${[["30", "30%"], ["40", "40%"], ["50", "50%"], ["total", "Total"]].map(([value, label]) => seg("bizPay", value, label, pay === value)).join("")}</div><span class="hint">El resto lo cobrás en el local, como prefieras.</span></div>
   <div class="f"><label>Plazo de acreditación de Mercado Pago</label><div class="biz-seg">${MP_TERMS.map(([value, label]) => seg("bizTerm", value, label, term === value)).join("")}</div><span class="hint">Tiene que ser el mismo plazo que elegiste en tu cuenta de Mercado Pago (Tu negocio → Costos y plazos).</span></div>
   <div class="biz-mp"><div><b>Mercado Pago</b><div class="hint">${mpOk ? "✓ Conectado: las señas entran directo a tu cuenta." : "Las señas entran directo a tu cuenta."}</div></div>${mpOk ? "" : '<button type="button" class="btn btn-pri btn-sm" data-act="bizMp">Conectar Mercado Pago</button>'}</div>
   ${mpOk ? "" : '<p class="note" style="text-align:left;margin-top:12px">Sin Mercado Pago conectado tu perfil no recibe reservas. Si preferís, conectalo después desde Perfil → Cobros.</p>'}`,
    { title: "Seña y cobro", sub: "Cómo cobrás la seña de cada turno." },
  );
}
function step5() {
  const body = dniRequired()
    ? dniDone()
      ? '<div class="am-ok">Ya tenemos tu DNI: lo revisa el equipo de TuTiempo.</div>'
      : dniForm(S.dniSt || {})
    : '<div class="am-ok"><b>Aprobación de TuTiempo</b><br>El equipo de TuTiempo revisa tu perfil antes de que aparezca en el listado. No tenés que cargar nada más.</div>';
  return shell(5, body, {
    title: "Verificación",
    sub: dniRequired() ? "Para que tus clientes sepan quién sos." : "Último paso.",
    next: "Enviar para aprobar",
    finish: true,
  });
}
function done() {
  const prov = pr(ME());
  const first = ((S.user && S.user.name) || (prov && prov.name) || "").split(" ")[0];
  const todo = setupTodo().slice(2);
  return `<div class="biz biz-one"><section class="biz-card" style="text-align:center"><div style="font-size:40px" aria-hidden="true">🎉</div><h1 class="biz-h">¡Listo${first ? ", " + esc(first) : ""}!</h1>
   <p class="am-sub">Tu negocio quedó cargado. Esto es lo que falta para recibir reservas:</p>
   <ol class="steps" style="text-align:left"><li class="done"><span class="dot">✓</span><div><b>Datos, servicios, horarios y seña</b></div></li>${todo
     .map(([label, ok], i) => `<li class="${ok ? "done" : i === 0 ? "now" : ""}"><span class="dot">${ok ? "✓" : i + 2}</span><div><b>${esc(label)}</b>${ok ? "" : label.startsWith("Conectar") ? "<span>Falta: sin esto no recibís reservas</span>" : ""}</div></li>`)
     .join("")}</ol>
   <button class="btn btn-pri btn-block" style="margin-top:8px" data-act="toPanel">Ir a mi Agenda</button></section></div>`;
}

// días del formulario: { dow: { on, m: [desde, hasta], t: [desde, hasta] | null } }
export function daysFromCfg(conf) {
  const days = {};
  for (let dow = 0; dow < 7; dow++) {
    const day = conf.days[dow] || {};
    const m = day.m && day.m.on ? day.m : day.t && day.t.on ? day.t : null;
    const t = day.m && day.m.on && day.t && day.t.on ? day.t : null;
    days[dow] = { on: !!day.on && !!m, m: m ? [m.from, m.to] : ["09:00", "18:00"], t: t ? [t.from, t.to] : null };
  }
  return days;
}
export function daysFromTemplate(key) {
  const tpl = HOUR_TEMPLATES.find((row) => row[0] === key);
  const days = {};
  for (let dow = 0; dow < 7; dow++) {
    days[dow] = { on: false, m: ["09:00", "18:00"], t: null };
  }
  (tpl && tpl[3] ? tpl[3] : []).forEach(([dow, m, t]) => {
    days[dow] = { on: true, m: m.slice(), t: t ? t.slice() : null };
  });
  return days;
}
// al entrar a un paso: lo que ya estaba guardado (o la plantilla sugerida)
function prepareStep(step) {
  const prov = pr(ME());
  if (step === 2 && !S.biz.svcs && prov) {
    S.biz.svcs = (prov.svcs || []).map((svc) => svc.slice());
  }
  if (step === 3 && !S.biz.days && prov) {
    if (stepDone(3)) {
      S.biz.days = daysFromCfg(cfg(ME()));
      S.biz.tpl = "dd";
    } else {
      S.biz.days = daysFromTemplate("lv");
      S.biz.tpl = "lv";
    }
  }
}

export function vNegocio() {
  const step = S.bizStep;
  if (!step) {
    return vLogin();
  }
  if (step === "listo") {
    return done();
  }
  prepareStep(step);
  return [null, step1, step2, step3, step4, step5][step]();
}

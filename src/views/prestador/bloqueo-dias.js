import { api } from "../../api/index.js";
import { LIVE } from "../../config.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { TODAY, addDays, dayLabel, dayWord, dkey, fromMin } from "../../lib/fechas.js";
import { ME, pr } from "../../lib/prestadores.js";
import { busy, cfg, isDayBlock, ranges } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { render } from "../../ui/render.js";
import { cliStamps, setCliStamps, stampGoal } from "../../ui/sellos.js";
import { toast } from "../../ui/toast.js";

export function vDayBlocks() {
  const e = ME();
  const a = TODAY();
  const t = S.db || {};
  const s = store.BOOK.filter((d) => d.pid == e && isDayBlock(d) && d.date >= a && d.status !== "cancelled").sort(
    (d, p) => d.date.localeCompare(p.date),
  );
  const n = cfg(e);
  const o = (d) => {
    let p = dkey(addDays(1, d));
    for (let w = 0; w < 7 && !ranges(n, /* @__PURE__ */ new Date(p + "T12:00:00").getDay()).length; w++) {
      p = dkey(addDays(1, p));
    }
    return p;
  };
  const i = [];
  s.forEach((d) => {
    const p = i[i.length - 1];
    if (p && p.why === d.svc && o(p.to) === d.date) {
      p.to = d.date;
      p.ids.push(d.id);
    } else {
      i.push({
        from: d.date,
        to: d.date,
        why: d.svc,
        ids: [d.id],
      });
    }
  });
  const l = t.from || dkey(addDays(1));
  const c = t.to || l;
  return `<form class="panel" id="fDayBlock" novalidate><p class="lbl">🏖️ Bloquear días o semanas</p>
   ${
     S.dbCancelled && S.dbCancelled.length
       ? `<div class="panel warnbox dbdone"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Cancelamos ${S.dbCancelled.length} turno${S.dbCancelled.length > 1 ? "s" : ""} y avisamos a tus clientes</b><button type="button" class="xbtn" data-act="dbCancelClose" aria-label="Cerrar">✕</button></div>
     <p class="note" style="text-align:left;margin:4px 0 8px">A los que reservaron por la app les llegó el aviso. <b>TuTiempo no devuelve la seña:</b> llamá a cada cliente y devolvele la seña o pasale el turno a otro día. Eso lo arreglás vos.</p>
     <ul class="ag">${S.dbCancelled.map((d) => `<li><span class="ag-t">${esc(d.time)}</span><div><b>${esc(d.name || "Cliente")}</b><span>${esc(dayLabel(d.date))} · ${esc(d.svc || "")}${d.paid ? " · seña " + money(d.paid) : ""}${d.app ? " · 📱 avisado en la app" : " · ✍ agendado a mano"}${d.tel ? ` · <a class="lnk" href="tel:${esc(String(d.tel).replace(/[^\d+]/g, ""))}">📞 ${esc(d.tel)}</a>` : ""}</span></div></li>`).join("")}</ul></div>`
       : ""
   }
   <p class="note" style="text-align:left;margin:0 0 10px">Vacaciones, feriados, un curso… Esos días nadie puede reservarte. Si ya tenés turnos esos días, se cancelan y les avisamos por la app. La seña no la devuelve TuTiempo: vos los llamás para devolverla o darles otro turno. Antes te mostramos la lista.</p>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="dbf">Desde</label><input id="dbf" type="date" min="${a}" value="${l}"></div><div class="f"><label for="dbt">Hasta</label><input id="dbt" type="date" min="${a}" value="${c}"></div></div>
   <div class="fchips">${[
     [0, "Solo ese día"],
     [6, "1 semana"],
     [13, "2 semanas"],
     [29, "1 mes"],
   ]
     .map(([d, p]) => `<button type="button" data-act="dbQuick" data-d="${d}">${p}</button>`)
     .join("")}</div>
   <div class="f" style="margin-top:10px"><label for="dbr">Motivo (lo ves solo vos)</label><input id="dbr" maxlength="40" value="${esc(t.why || "Vacaciones")}" autocomplete="off"></div>
   <div class="err" id="dberr"></div>
   ${
     S.dbAsk
       ? `<div class="panel delpanel"><b>Esos días tenés ${S.dbAsk.list.length} turno${S.dbAsk.list.length > 1 ? "s" : ""}</b><p style="margin:4px 0 8px;font-size:14px">Si bloqueás, se cancelan y les avisamos por la app. TuTiempo no devuelve la seña: después llamá a cada uno para devolvérsela o reprogramarle el turno. Eso lo arreglás vos.</p>
     <ul class="ag">${S.dbAsk.list.map((d) => `<li><span class="ag-t">${esc(d.time)}</span><div><b>${esc(d.cliente || "Cliente")}</b><span>${esc(dayLabel(d.date))} · ${esc(d.svc)}${d.paid ? " · seña " + money(d.paid) : ""}</span></div></li>`).join("")}</ul>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button type="button" class="btn btn-ghost" data-act="dbAskNo">Volver</button><button type="button" class="btn btn-bad" data-act="dbConfirm">Bloquear y cancelar</button></div></div>`
       : '<button class="btn btn-pri btn-block" type="submit">Bloquear días</button>'
   }
   ${i.length ? `<p class="lbl" style="margin-top:14px">Próximos días bloqueados</p><ul class="ag">${i.map((d) => `<li><span class="ag-t">🏖️</span><div><b>${esc(dayLabel(d.from))}${d.to !== d.from ? ` al ${esc(dayLabel(d.to))}` : ""}</b><span>${esc(d.why.replace(/^🏖️\s*/, ""))} · ${d.ids.length} día${d.ids.length > 1 ? "s" : ""} de atención</span></div><button type="button" class="btn btn-ghost btn-sm" data-act="dbDel" data-ids="${d.ids.join(",")}">Desbloquear</button></li>`).join("")}</ul>` : ""}
  </form>`;
}
export function blockDays(e, a, t) {
  const s = ME();
  const n = cfg(s);
  S.dbAsk = null;
  if (LIVE) {
    api.m
      .blockDays(e, a, t)
      .then((c) => {
        S.dbCancelled = ((c && c.cancelled) || []).map((p) => ({
          name: p.name,
          date: p.day,
          time: p.time,
          svc: p.service,
          app: p.app,
          tel: p.tel,
          paid: +p.paid || 0,
        }));
        S.db = null;
        const d = (c && c.blocked) || 0;
        toast(
          `Bloqueaste ${d} día${d === 1 ? "" : "s"}.${S.dbCancelled.length ? ` Cancelamos ${S.dbCancelled.length} turno${S.dbCancelled.length > 1 ? "s" : ""} y les avisamos. Llamalos para la seña.` : ""}`,
        );
        return api.loadMine();
      })
      .then(render)
      .catch(() => {});
    return;
  }
  const o =
    Math.round(
      /* @__PURE__ */ (new Date(a + "T12:00:00") - /* @__PURE__ */ new Date(e + "T12:00:00")) / 864e5,
    ) + 1;
  let i = 0;
  const l = [];
  for (let c = 0; c < o; c++) {
    const d = dkey(addDays(c, e));
    const p = ranges(n, /* @__PURE__ */ new Date(d + "T12:00:00").getDay());
    if (!p.length) {
      continue;
    }
    const w = busy(s, d);
    if (w.some((h) => isDayBlock(h))) {
      continue;
    }
    w.filter((h) => h.type !== "block" && h.type !== "walk" && h.status === "confirmed").forEach((h) => {
      h.status = "cancelled";
      h.byProv = true;
      h.refund = 0;
      h.self = true;
      if (h.pay === "reward" && !h.stampBack) {
        h.stampBack = true;
        const j = pr(s).svcs.find((b) => b[0] === h.svc);
        if (j) {
          setCliStamps(h.cliente, j, cliStamps(h.cliente, j) + (h.rwGoal || stampGoal(s, j)));
        }
      }
      if (h.mine) {
        pushCancel(h);
      }
      l.push({
        name: h.cliente,
        date: h.date,
        time: h.time,
        svc: h.svc,
        app: h.src === "app",
        tel: h.tel || (store.CLIENTS[h.cliente] || {}).tel || (h.mine && S.form && S.form.tel) || "",
        paid: h.paid || 0,
      });
    });
    w.filter((h) => h.type === "block").forEach((h) => {
      store.BOOK = store.BOOK.filter((j) => j !== h);
    });
    const y = p[0][0];
    const k = p[p.length - 1][1];
    store.BOOK.push({
      id: store.BID++,
      pid: s,
      date: d,
      time: fromMin(y),
      dur: k - y,
      svc: "🏖️ " + t,
      cliente: "Día bloqueado",
      type: "block",
      status: "confirmed",
      paid: 0,
      price: 0,
    });
    i++;
  }
  S.dbCancelled = l.sort((c, d) => (c.date + c.time).localeCompare(d.date + d.time));
  S.db = null;
  toast(
    `Bloqueaste ${i} día${i === 1 ? "" : "s"}.${l.length ? ` Cancelamos ${l.length} turno${l.length > 1 ? "s" : ""} y les avisamos. Llamalos para la seña.` : ""}`,
  );
  render();
}
export function pushCancel(e) {
  if (LIVE || !S.inbox) {
    return;
  }
  const a = pr(e.pid);
  S.inbox.unshift({
    id: Date.now() + Math.random(),
    pid: e.pid,
    name: a.name,
    photo: a.photo,
    hue: a.hue,
    body: e.self
      ? `${a.name} tuvo que cancelar tu turno del ${dayWord(e.date)} a las ${e.time} (${e.svc}).${e.paid ? ` ${a.name} se va a comunicar con vos para devolverte la seña (${money(e.paid)}) o pasarte el turno a otro día.` : ""}`
      : `${a.name} tuvo que cancelar tu turno del ${dayWord(e.date)} a las ${e.time} (${e.svc}).${e.paid ? ` Te devolvemos todo lo que pagaste (${money(e.paid + (e.fee || 0))}).` : ""} Reprogramalo cuando quieras desde Mis turnos.`,
    d: "recién",
    read: false,
    auto: true,
    kind: "cancel",
    bid: e.id,
  });
  S.inboxSeen = false;
}

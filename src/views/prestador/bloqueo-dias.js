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

// bloqueo de días (vacaciones, feriados): formulario, aviso de turnos a cancelar y próximos bloqueos
export function vDayBlocks() {
  const pid = ME();
  const today = TODAY();
  const form = S.db || {};
  const blocks = store.BOOK.filter((booking) => booking.pid == pid && isDayBlock(booking) && booking.date >= today && booking.status !== "cancelled").sort(
    (one, other) => one.date.localeCompare(other.date),
  );
  const conf = cfg(pid);
  // siguiente día con horario después de date (para unir días bloqueados seguidos aunque haya cerrados en el medio)
  const nextOpen = (date) => {
    let next = dkey(addDays(1, date));
    for (let tries = 0; tries < 7 && !ranges(conf, /* @__PURE__ */ new Date(next + "T12:00:00").getDay()).length; tries++) {
      next = dkey(addDays(1, next));
    }
    return next;
  };
  const runs = [];
  blocks.forEach((block) => {
    const last = runs[runs.length - 1];
    if (last && last.why === block.svc && nextOpen(last.to) === block.date) {
      last.to = block.date;
      last.ids.push(block.id);
    } else {
      runs.push({
        from: block.date,
        to: block.date,
        why: block.svc,
        ids: [block.id],
      });
    }
  });
  const from = form.from || dkey(addDays(1));
  const to = form.to || from;
  return `<form class="panel" id="fDayBlock" novalidate><p class="lbl">🏖️ Bloquear días o semanas</p>
   ${
     S.dbCancelled && S.dbCancelled.length
       ? `<div class="panel warnbox dbdone"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>Cancelamos ${S.dbCancelled.length} turno${S.dbCancelled.length > 1 ? "s" : ""} y avisamos a tus clientes</b><button type="button" class="xbtn" data-act="dbCancelClose" aria-label="Cerrar">✕</button></div>
     <p class="note" style="text-align:left;margin:4px 0 8px">A los que reservaron por la app les llegó el aviso. <b>TuTiempo no devuelve la seña:</b> llamá a cada cliente y devolvele la seña o pasale el turno a otro día. Eso lo arreglás vos.</p>
     <ul class="ag">${S.dbCancelled.map((item) => `<li><span class="ag-t">${esc(item.time)}</span><div><b>${esc(item.name || "Cliente")}</b><span>${esc(dayLabel(item.date))} · ${esc(item.svc || "")}${item.paid ? " · seña " + money(item.paid) : ""}${item.app ? " · 📱 avisado en la app" : " · ✍ agendado a mano"}${item.tel ? ` · <a class="lnk" href="tel:${esc(String(item.tel).replace(/[^\d+]/g, ""))}">📞 ${esc(item.tel)}</a>` : ""}</span></div></li>`).join("")}</ul></div>`
       : ""
   }
   <p class="note" style="text-align:left;margin:0 0 10px">Vacaciones, feriados, un curso… Esos días nadie puede reservarte. Si ya tenés turnos esos días, se cancelan y les avisamos por la app. La seña no la devuelve TuTiempo: vos los llamás para devolverla o darles otro turno. Antes te mostramos la lista.</p>
   <div class="opts" style="grid-template-columns:repeat(2,minmax(0,1fr))"><div class="f"><label for="dbf">Desde</label><input id="dbf" type="date" min="${today}" value="${from}"></div><div class="f"><label for="dbt">Hasta</label><input id="dbt" type="date" min="${today}" value="${to}"></div></div>
   <div class="fchips">${[
     [0, "Solo ese día"],
     [6, "1 semana"],
     [13, "2 semanas"],
     [29, "1 mes"],
   ]
     .map(([days, label]) => `<button type="button" data-act="dbQuick" data-d="${days}">${label}</button>`)
     .join("")}</div>
   <div class="f" style="margin-top:10px"><label for="dbr">Motivo (lo ves solo vos)</label><input id="dbr" maxlength="40" value="${esc(form.why || "Vacaciones")}" autocomplete="off"></div>
   <div class="err" id="dberr"></div>
   ${
     S.dbAsk
       ? `<div class="panel delpanel"><b>Esos días tenés ${S.dbAsk.list.length} turno${S.dbAsk.list.length > 1 ? "s" : ""}</b><p style="margin:4px 0 8px;font-size:14px">Si bloqueás, se cancelan y les avisamos por la app. TuTiempo no devuelve la seña: después llamá a cada uno para devolvérsela o reprogramarle el turno. Eso lo arreglás vos.</p>
     <ul class="ag">${S.dbAsk.list.map((item) => `<li><span class="ag-t">${esc(item.time)}</span><div><b>${esc(item.cliente || "Cliente")}</b><span>${esc(dayLabel(item.date))} · ${esc(item.svc)}${item.paid ? " · seña " + money(item.paid) : ""}</span></div></li>`).join("")}</ul>
     <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><button type="button" class="btn btn-ghost" data-act="dbAskNo">Volver</button><button type="button" class="btn btn-bad" data-act="dbConfirm">Bloquear y cancelar</button></div></div>`
       : '<button class="btn btn-pri btn-block" type="submit">Bloquear días</button>'
   }
   ${runs.length ? `<p class="lbl" style="margin-top:14px">Próximos días bloqueados</p><ul class="ag">${runs.map((run) => `<li><span class="ag-t">🏖️</span><div><b>${esc(dayLabel(run.from))}${run.to !== run.from ? ` al ${esc(dayLabel(run.to))}` : ""}</b><span>${esc(run.why.replace(/^🏖️\s*/, ""))} · ${run.ids.length} día${run.ids.length > 1 ? "s" : ""} de atención</span></div><button type="button" class="btn btn-ghost btn-sm" data-act="dbDel" data-ids="${run.ids.join(",")}">Desbloquear</button></li>`).join("")}</ul>` : ""}
  </form>`;
}
// bloquea los días con horario entre from y to. En vivo lo hace la base (block_days); en la demo se cancelan
// los turnos de esos días (sin devolver la seña: la devuelve el prestador) y se devuelven los sellos canjeados.
export function blockDays(from, to, reason) {
  const pid = ME();
  const conf = cfg(pid);
  S.dbAsk = null;
  if (LIVE) {
    api.m
      .blockDays(from, to, reason)
      .then((res) => {
        S.dbCancelled = ((res && res.cancelled) || []).map((row) => ({
          name: row.name,
          date: row.day,
          time: row.time,
          svc: row.service,
          app: row.app,
          tel: row.tel,
          paid: +row.paid || 0,
        }));
        S.db = null;
        const blocked = (res && res.blocked) || 0;
        toast(
          `Bloqueaste ${blocked} día${blocked === 1 ? "" : "s"}.${S.dbCancelled.length ? ` Cancelamos ${S.dbCancelled.length} turno${S.dbCancelled.length > 1 ? "s" : ""} y les avisamos. Llamalos para la seña.` : ""}`,
        );
        return api.loadMine();
      })
      .then(render)
      .catch(() => {});
    return;
  }
  const nDays =
    Math.round(
      /* @__PURE__ */ (new Date(to + "T12:00:00") - /* @__PURE__ */ new Date(from + "T12:00:00")) / 864e5,
    ) + 1;
  let blockedCount = 0;
  const cancelled = [];
  for (let offset = 0; offset < nDays; offset++) {
    const date = dkey(addDays(offset, from));
    const rngs = ranges(conf, /* @__PURE__ */ new Date(date + "T12:00:00").getDay());
    if (!rngs.length) {
      continue;
    }
    const dayBookings = busy(pid, date);
    if (dayBookings.some((item) => isDayBlock(item))) {
      continue;
    }
    dayBookings.filter((item) => item.type !== "block" && item.type !== "walk" && item.status === "confirmed").forEach((booking) => {
      booking.status = "cancelled";
      booking.byProv = true;
      booking.refund = 0;
      booking.self = true;
      if (booking.pay === "reward" && !booking.stampBack) {
        booking.stampBack = true;
        const svc = pr(pid).svcs.find((row) => row[0] === booking.svc);
        if (svc) {
          setCliStamps(booking.cliente, svc, cliStamps(booking.cliente, svc) + (booking.rwGoal || stampGoal(pid, svc)));
        }
      }
      if (booking.mine) {
        pushCancel(booking);
      }
      cancelled.push({
        name: booking.cliente,
        date: booking.date,
        time: booking.time,
        svc: booking.svc,
        app: booking.src === "app",
        tel: booking.tel || (store.CLIENTS[booking.cliente] || {}).tel || (booking.mine && S.form && S.form.tel) || "",
        paid: booking.paid || 0,
      });
    });
    dayBookings.filter((item) => item.type === "block").forEach((blockItem) => {
      store.BOOK = store.BOOK.filter((item) => item !== blockItem);
    });
    const start = rngs[0][0];
    const end = rngs[rngs.length - 1][1];
    store.BOOK.push({
      id: store.BID++,
      pid: pid,
      date: date,
      time: fromMin(start),
      dur: end - start,
      svc: "🏖️ " + reason,
      cliente: "Día bloqueado",
      type: "block",
      status: "confirmed",
      paid: 0,
      price: 0,
    });
    blockedCount++;
  }
  S.dbCancelled = cancelled.sort((one, other) => (one.date + one.time).localeCompare(other.date + other.time));
  S.db = null;
  toast(
    `Bloqueaste ${blockedCount} día${blockedCount === 1 ? "" : "s"}.${cancelled.length ? ` Cancelamos ${cancelled.length} turno${cancelled.length > 1 ? "s" : ""} y les avisamos. Llamalos para la seña.` : ""}`,
  );
  render();
}
// demo: aviso al cliente de que el prestador canceló su turno
export function pushCancel(booking) {
  if (LIVE || !S.inbox) {
    return;
  }
  const prov = pr(booking.pid);
  S.inbox.unshift({
    id: Date.now() + Math.random(),
    pid: booking.pid,
    name: prov.name,
    photo: prov.photo,
    hue: prov.hue,
    body: booking.self
      ? `${prov.name} tuvo que cancelar tu turno del ${dayWord(booking.date)} a las ${booking.time} (${booking.svc}).${booking.paid ? ` ${prov.name} se va a comunicar con vos para devolverte la seña (${money(booking.paid)}) o pasarte el turno a otro día.` : ""}`
      : `${prov.name} tuvo que cancelar tu turno del ${dayWord(booking.date)} a las ${booking.time} (${booking.svc}).${booking.paid ? ` Te devolvemos todo lo que pagaste (${money(booking.paid + (booking.fee || 0))}).` : ""} Reprogramalo cuando quieras desde Mis turnos.`,
    d: "recién",
    read: false,
    auto: true,
    kind: "cancel",
    bid: booking.id,
  });
  S.inboxSeen = false;
}

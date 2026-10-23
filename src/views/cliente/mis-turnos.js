import { api } from "../../api/index.js";
import { money } from "../../lib/dinero.js";
import { esc } from "../../lib/dom.js";
import { TODAY, dayLabel, nowHM } from "../../lib/fechas.js";
import { avatar, pr } from "../../lib/prestadores.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { myCards, stampCard } from "../../ui/sellos.js";
import { myUpcoming } from "./home.js";
import { rateForm } from "./perfil.js";

function vMisTurnosBase() {
  const e = myUpcoming();
  const a = store.BOOK.filter((i) => i.mine && !e.includes(i)).sort((i, l) =>
    (l.date + l.time).localeCompare(i.date + i.time),
  );
  const t = (i) => {
    const l = pr(i.pid);
    return `<button class="tcard seg-${i.cat || l.cats[0]}" data-act="verTurno" data-id="${i.id}"><div class="tdate"><span>${esc(dayLabel(i.date, true))}</span><b>${i.time}</b></div><div class="tc-m"><b>${esc(l.name)}</b><span>${esc(i.svc)}</span><span>📍 ${esc(l.addr)}</span><span class="chip ok">✓ Confirmado</span>${i.pay === "cash" ? '<span class="chip">💵 Resto en efectivo</span>' : i.pay === "reward" ? '<span class="chip ok">🎁 Premio</span>' : ""}</div><span class="tc-go">›</span></button>`;
  };
  const s = (i) =>
    i.status === "done"
      ? '<span class="chip ok">✔ Fuiste</span>'
      : i.status === "noshow"
        ? '<span class="chip bad">No fuiste</span>'
        : i.status === "cancelled"
          ? i.byProv
            ? '<span class="chip bad">Lo canceló el profesional</span>'
            : '<span class="chip gray">Avisaste que no ibas</span>'
          : '<span class="chip gray">Pasado</span>';
  const n = S.inbox || [];
  const o = n.filter((i) => !i.read).length;
  if (o && !S.inboxSeen) {
    S.inboxSeen = true;
    setTimeout(() => {
      n.forEach((i) => (i.read = true));
      api.m.readMessages();
    }, 1500);
  }
  return `<div class="narrow stack" style="margin-top:20px"><h1 class="h1">Mis turnos</h1>
   ${(() => {
     const i = store.BOOK.filter(
       (l) =>
         l.mine &&
         l.status === "cancelled" &&
         l.byProv &&
         l.date >= TODAY() &&
         !l.rebooked &&
         !store.BOOK.some(
           (c) =>
             c.mine &&
             c.pid == l.pid &&
             c.status === "confirmed" &&
             c.svc === l.svc &&
             c.id > l.id &&
             (!l.series || c.series !== l.series) &&
             c.date + c.time >= TODAY() + nowHM(),
         ),
     );
     if (i.length) {
       return `<div class="panel delpanel"><p class="lbl" style="margin:0 0 6px">⚠ Turnos que canceló el profesional</p><ul class="ag">${i.map((l) => `<li><span class="ag-t">${l.time}</span><div><b>${esc(pr(l.pid).name)}</b><span>${esc(l.svc)} · ${esc(dayLabel(l.date))}${l.self ? " · te va a llamar para devolverte la seña o darte otro turno" : l.paid ? ` · te devolvemos ${money(l.paid + (l.fee || 0))}` : ""}</span></div>${l.self ? "<span></span>" : `<button class="btn btn-pri btn-sm" data-act="rebook" data-id="${l.id}">Reprogramar</button>`}</li>`).join("")}</ul></div>`;
     } else {
       return "";
     }
   })()}
   <p class="lbl" style="margin:4px 0 0">Próximos</p>
   ${e.length ? e.map(t).join("") : '<div class="panel" style="text-align:center"><p class="note" style="margin:0 0 10px">No tenés turnos reservados.</p><button class="btn btn-pri btn-block" data-act="goLocal">Reservar un turno</button></div>'}
   ${
     n.length
       ? `<div class="panel inbox"><p class="lbl">🔔 Avisos y mensajes de tus profesionales${o ? ` <span class="cnt">${o}</span>` : ""}</p><ul class="ag">${n
           .slice(0, S.inboxAll ? 50 : 3)
           .map(
             (i) =>
               `<li class="${i.read ? "" : "unread"}">${avatar({
                 photo: i.photo,
                 name: i.name,
                 hue: i.hue,
               })}<div><b>${esc(i.name)}</b><span class="msgb">${esc(i.body)}</span><span class="hint">${esc(i.d)}</span></div><button class="btn btn-ghost btn-sm" data-go="perfil" data-id="${i.pid}">Reservar</button></li>`,
           )
           .join(
             "",
           )}</ul>${n.length > 3 && !S.inboxAll ? `<button class="lnk" data-act="inboxAll">Ver todos (${n.length})</button>` : ""}</div>`
       : ""
   }
   <!--SELLOS-->
   ${a.length ? `<p class="lbl" style="margin:8px 0 0">Anteriores</p><div class="panel"><ul class="ag">${a.map((i) => `<li><span class="ag-t">${esc(dayLabel(i.date))}</span><div><b>${esc(pr(i.pid).name)} · ${i.time}</b><span>${esc(i.svc)} · ${money(i.price)}</span>${i.stamped ? '<span class="hint">🎟️ +1 sello</span>' : ""}${i.status === "done" && !i.reviewed ? (S.rateFor === i.id ? rateForm(i) : `<button class="lnk" data-act="rateOpen" data-id="${i.id}">★ Calificar</button>`) : i.reviewed ? '<span class="hint">✓ Calificaste</span>' : ""}</div>${s(i)}</li>`).join("")}</ul></div>` : ""}
  </div>`;
}
function vMisTurnosCards() {
  const e = myCards();
  if (e.length) {
    return `<p class="lbl" style="margin:4px 0 0">🎟️ Mis sellos</p><div class="stampgrid">${e
      .sort((a, t) => t.n / t.goal - a.n / a.goal)
      .map(stampCard)
      .join("")}</div>`;
  } else {
    return "";
  }
}
export function vMisTurnos() {
  return vMisTurnosBase().replace("<!--SELLOS-->", vMisTurnosCards());
}

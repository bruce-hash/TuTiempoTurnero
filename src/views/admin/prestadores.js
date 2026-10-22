import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { relDate } from "../../lib/fechas.js";
import { avatar } from "../../lib/prestadores.js";
import { CAT, CATS, catName } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { admIc } from "./admin.js";
import { admFile } from "./ficha.js";

const ACT_LEVELS = [
  ["🔥 Muy activos", "30 o más servicios en 30 días", (e) => e >= 30],
  ["✅ Activos", "10 a 29 servicios", (e) => e >= 10 && e < 30],
  ["🌱 Poca actividad", "1 a 9 servicios", (e) => e >= 1 && e < 10],
  ["💤 Sin actividad", "ningún servicio en 30 días", (e) => e < 1],
];
export function admProv(e) {
  const a = (S.admQ || "").toLowerCase();
  const t = S.admF || "todos";
  const s = S.admG === "act" ? "act" : "rubro";
  const n = e.pv.filter((d) => d.status === "pending");
  const o = e.pv
    .filter((d) => d.status !== "pending" && (t === "todos" || d.status === t))
    .sort(
      (d, p) =>
        (+p.activity || 0) - (+d.activity || 0) || p.month - d.month || String(d.name).localeCompare(p.name),
    );
  const i =
    s === "rubro"
      ? CATS.map(([d, p, w, y]) => ({
          h: `${y} ${p}`,
          items: o.filter((k) => (k.cats || [])[0] === d),
        })).concat([
          {
            h: "Sin rubro",
            items: o.filter((d) => !CAT[(d.cats || [])[0]]),
          },
        ])
      : ACT_LEVELS.map(([d, p, w]) => ({
          h: d,
          sub: p,
          items: o.filter((y) => w(+y.activity || 0)),
        }));
  const l = (d) =>
    d.status === "active"
      ? '<span class="chip ok">Activo</span>'
      : d.status === "suspended"
        ? '<span class="chip bad">Suspendido</span>'
        : '<span class="chip warnc">En revisión</span>';
  const c = (d) => {
    const p = S.admOpen === d.id;
    const w = (d.notes || []).length;
    return `<li class="${p ? "open" : ""}">${avatar(d)}<div><b>${esc(d.name)}</b><span>${admIc(d.cats)} ${+d.activity || 0} servicios en 30 días · ${d.month} turno${d.month === 1 ? "" : "s"} este mes · ★ ${(+d.rating || 0).toFixed(1)}${d.mp ? "" : " · sin Mercado Pago"}</span>${l(d)}${w ? ` <span class="chip">📝 ${w}</span>` : ""}</div>
      <span class="admact"><button class="btn btn-ghost btn-sm" data-act="admOpen" data-id="${d.id}" aria-expanded="${p}">${p ? "Cerrar" : "Ficha"}</button></span>${p ? admFile(d) : ""}</li>`;
  };
  return `${
    n.length
      ? `<div class="panel"><p class="lbl">Para verificar · ${n.length}</p><ul class="ag">${n
          .map(
            (
              d,
            ) => `<li>${avatar(d)}<div><b>${esc(d.name)}</b><span>${(d.cats || []).map(catName).join(" · ")}${d.created ? " · " + esc(typeof d.created == "string" && d.created.length > 12 ? relDate(d.created) : d.created) : ""}</span>
     ${S.admDni && S.admDni.id === d.id ? `<span>${S.admDni.urls.length ? S.admDni.urls.map((p, w) => `<a class="lnk" href="${esc(p)}" target="_blank" rel="noopener">DNI ${w + 1}</a>`).join(" · ") : "Sin archivos de DNI"}</span>` : ""}</div>
     <span class="admact">${LIVE ? `<button class="btn btn-ghost btn-sm" data-act="admDni" data-id="${d.id}">Ver DNI</button>` : ""}<button class="btn btn-ok btn-sm" data-act="admSet" data-id="${d.id}" data-s="active">Aprobar</button></span></li>`,
          )
          .join("")}</ul></div>`
      : ""
  }
   <div class="panel"><p class="lbl">Prestadores · ${o.length}</p>
    <div class="seg3 admg" role="group" aria-label="Dividir">${[
      ["rubro", "Por rubro"],
      ["act", "Por actividad"],
    ]
      .map(
        ([d, p]) =>
          `<button type="button" data-act="admG" data-g="${d}" aria-pressed="${s === d}">${p}</button>`,
      )
      .join("")}</div>
    <input id="admQ" class="search" placeholder="🔍 Buscar prestador" value="${esc(S.admQ || "")}" autocomplete="off">
    <div class="fchips">${[
      ["todos", "Todos"],
      ["active", "Activos"],
      ["suspended", "Suspendidos"],
    ]
      .map(([d, p]) => `<button data-act="admF" data-f="${d}" aria-pressed="${t === d}">${p}</button>`)
      .join("")}</div>
    ${
      i
        .filter((d) => d.items.length)
        .map(
          (d) =>
            `<div class="admgrp"><p class="admgh"><b>${d.h}</b><span>${d.items.length}${d.sub ? " · " + d.sub : ""}</span></p><ul class="ag admlist">${d.items
              .filter((p) => !a || String(p.name).toLowerCase().includes(a))
              .map(c)
              .join("")}</ul></div>`,
        )
        .join("") || '<p class="note">No hay prestadores con ese filtro.</p>'
    }
    <p class="note" style="text-align:left;margin:10px 0 0">${s === "rubro" ? "Cada prestador va en su rubro principal. Dentro de cada rubro, primero los más activos." : "Actividad = servicios hechos por la app en los últimos 30 días."}</p></div>`;
}

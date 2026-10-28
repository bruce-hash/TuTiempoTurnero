import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { relDate } from "../../lib/fechas.js";
import { avatar } from "../../lib/prestadores.js";
import { CAT, CATS, catName } from "../../lib/rubros.js";
import { dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";
import { admIc } from "./admin.js";
import { admFile } from "./ficha.js";

// H10: lo que cargó el prestador para verificarlo (para aprobar hacen falta el número y las dos fotos, si TuTiempo exige
// el DNI: D26; si no, la línea y "Ver DNI" aparecen solo si cargó algo)
const asksDni = (prov) => dniRequired() || !!prov.dni || prov.dniPhotos.front || prov.dniPhotos.back;
const dniLine = (prov) => {
  const photo = (side, label) => `${label} ${prov.dniPhotos[side] ? "✓" : "falta"}`;
  return `DNI ${prov.dni ? esc(prov.dni) : "sin cargar"} · ${photo("front", "Frente")} · ${photo("back", "Dorso")}`;
};

// niveles de actividad: [nombre, detalle, condición sobre los servicios de los últimos 30 días]
const ACT_LEVELS = [
  ["🔥 Muy activos", "30 o más servicios en 30 días", (count) => count >= 30],
  ["✅ Activos", "10 a 29 servicios", (count) => count >= 10 && count < 30],
  ["🌱 Poca actividad", "1 a 9 servicios", (count) => count >= 1 && count < 10],
  ["💤 Sin actividad", "ningún servicio en 30 días", (count) => count < 1],
];
// prestadores para el admin: pendientes de verificar arriba; el resto agrupado por rubro o por actividad,
// con búsqueda, filtro por estado y la ficha de cada uno
export function admProv(data) {
  const query = (S.admQ || "").toLowerCase();
  const filter = S.admF || "todos";
  const groupBy = S.admG === "act" ? "act" : "rubro";
  const pending = data.pv.filter((prov) => prov.status === "pending");
  const list = data.pv
    .filter((prov) => prov.status !== "pending" && (filter === "todos" || prov.status === filter))
    .sort(
      (one, other) =>
        (+other.activity || 0) - (+one.activity || 0) || other.month - one.month || String(one.name).localeCompare(other.name),
    );
  const groups =
    groupBy === "rubro"
      ? CATS.map(([key, plural, one, icon]) => ({
          h: `${icon} ${plural}`,
          items: list.filter((prov) => (prov.cats || [])[0] === key),
        })).concat([
          {
            h: "Sin rubro",
            items: list.filter((prov) => !CAT[(prov.cats || [])[0]]),
          },
        ])
      : ACT_LEVELS.map(([label, sub, test]) => ({
          h: label,
          sub: sub,
          items: list.filter((prov) => test(+prov.activity || 0)),
        }));
  const statusChip = (prov) =>
    prov.status === "active"
      ? '<span class="chip ok">Activo</span>'
      : prov.status === "suspended"
        ? '<span class="chip bad">Suspendido</span>'
        : '<span class="chip warnc">En revisión</span>';
  const row = (prov) => {
    const open = S.admOpen === prov.id;
    const nNotes = (prov.notes || []).length;
    return `<li class="${open ? "open" : ""}">${avatar(prov)}<div><b>${esc(prov.name)}</b><span>${admIc(prov.cats)} ${+prov.activity || 0} servicios en 30 días · ${prov.month} turno${prov.month === 1 ? "" : "s"} este mes · ★ ${(+prov.rating || 0).toFixed(1)}${prov.mp ? "" : " · sin Mercado Pago"}</span>${statusChip(prov)}${nNotes ? ` <span class="chip">📝 ${nNotes}</span>` : ""}</div>
      <span class="admact"><button class="btn btn-ghost btn-sm" data-act="admOpen" data-id="${prov.id}" aria-expanded="${open}">${open ? "Cerrar" : "Ficha"}</button></span>${open ? admFile(prov) : ""}</li>`;
  };
  return `${
    pending.length
      ? `<div class="panel"><p class="lbl">${dniRequired() ? "Para verificar" : "Para aprobar"} · ${pending.length}</p><ul class="ag">${pending
          .map(
            (
              prov,
            ) => `<li>${avatar(prov)}<div><b>${esc(prov.name)}</b><span>${(prov.cats || []).map(catName).join(" · ")}${prov.created ? " · " + esc(typeof prov.created == "string" && prov.created.length > 12 ? relDate(prov.created) : prov.created) : ""}</span>
     ${LIVE && asksDni(prov) ? `<span>${dniLine(prov)}</span>` : ""}
     ${S.admDni && S.admDni.id === prov.id ? `<span>${S.admDni.urls.length ? S.admDni.urls.map((file) => `<a class="lnk" href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.side)}</a>`).join(" · ") : "Sin archivos de DNI"}</span>` : ""}</div>
     <span class="admact">${LIVE && asksDni(prov) ? `<button class="btn btn-ghost btn-sm" data-act="admDni" data-id="${prov.id}">Ver DNI</button>` : ""}<button class="btn btn-ok btn-sm" data-act="admSet" data-id="${prov.id}" data-s="active">Aprobar</button></span></li>`,
          )
          .join("")}</ul></div>`
      : ""
  }
   <div class="panel"><p class="lbl">Prestadores · ${list.length}</p>
    <div class="seg3 admg" role="group" aria-label="Dividir">${[
      ["rubro", "Por rubro"],
      ["act", "Por actividad"],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" data-act="admG" data-g="${key}" aria-pressed="${groupBy === key}">${label}</button>`,
      )
      .join("")}</div>
    <input id="admQ" class="search" placeholder="🔍 Buscar prestador" value="${esc(S.admQ || "")}" autocomplete="off">
    <div class="fchips">${[
      ["todos", "Todos"],
      ["active", "Activos"],
      ["suspended", "Suspendidos"],
    ]
      .map(([key, label]) => `<button data-act="admF" data-f="${key}" aria-pressed="${filter === key}">${label}</button>`)
      .join("")}</div>
    ${
      groups
        .filter((group) => group.items.length)
        .map(
          (group) =>
            `<div class="admgrp"><p class="admgh"><b>${group.h}</b><span>${group.items.length}${group.sub ? " · " + group.sub : ""}</span></p><ul class="ag admlist">${group.items
              .filter((prov) => !query || String(prov.name).toLowerCase().includes(query))
              .map(row)
              .join("")}</ul></div>`,
        )
        .join("") || '<p class="note">No hay prestadores con ese filtro.</p>'
    }
    <p class="note" style="text-align:left;margin:10px 0 0">${groupBy === "rubro" ? "Cada prestador va en su rubro principal. Dentro de cada rubro, primero los más activos." : "Actividad = servicios hechos por la app en los últimos 30 días."}</p></div>`;
}

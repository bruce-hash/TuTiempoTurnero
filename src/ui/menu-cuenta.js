import { esc } from "../lib/dom.js";
import { avatar } from "../lib/prestadores.js";

// Menú de cuenta de la cabecera (Bloque D): un botón con el avatar (y el nombre, desde 700 px) que abre las opciones de
// la cuenta. Cada opción usa la acción de siempre (data-go / data-act): al elegirla, la app redibuja y el menú se cierra.
// Teclado: Enter, Espacio o ↓ abren y llevan a la primera opción; ↑ ↓ Inicio Fin recorren; Esc cierra y vuelve al botón;
// Tab cierra y sigue. Se cierra también al tocar afuera.

// items: [ícono, texto, atributos de la acción (data-go="…" o data-act="…"), extra opcional (un contador)]
export function accountMenu({ who, email, items, dot }) {
  const name = (who && who.name) || "Tu cuenta";
  return `<div class="acct"><button type="button" class="avbtn acct-btn" data-act="acctMenu" aria-haspopup="menu" aria-expanded="false" aria-controls="acctMenu" aria-label="Tu cuenta: ${esc(name)}">${avatar(who)}<span class="acct-name">${esc(name.split(" ")[0])}</span><span class="acct-car" aria-hidden="true">▾</span>${dot ? '<i class="dotn" title="Tenés avisos nuevos"></i>' : ""}</button>
  <div class="acct-menu" id="acctMenu" role="menu" aria-label="Tu cuenta" hidden>
   <div class="acct-who" role="none"><b>${esc(name)}</b>${email ? `<span>${esc(email)}</span>` : ""}</div>
   ${items.map(([icon, label, attrs, extra]) => `<button type="button" role="menuitem" tabindex="-1" ${attrs}><span aria-hidden="true">${icon}</span> ${esc(label)}${extra || ""}</button>`).join("")}
  </div></div>`;
}

const button = () => document.querySelector("#nav .acct-btn");
const menu = () => document.getElementById("acctMenu");
const options = () => [...(menu() ? menu().querySelectorAll("[role=menuitem]") : [])];
const isOpen = () => !!(menu() && !menu().hidden);

export function openAccountMenu(focusFirst) {
  if (!menu()) {
    return;
  }
  menu().hidden = false;
  button().setAttribute("aria-expanded", "true");
  if (focusFirst && options()[0]) {
    options()[0].focus();
  }
}
export function closeAccountMenu(focusButton) {
  if (!isOpen()) {
    return;
  }
  menu().hidden = true;
  button().setAttribute("aria-expanded", "false");
  if (focusButton) {
    button().focus();
  }
}
// el botón: con el mouse o el dedo abre y cierra; con el teclado (Enter o Espacio, ev.detail 0) abre en la primera opción
export function toggleAccountMenu(ev) {
  if (isOpen()) {
    closeAccountMenu(false);
  } else {
    openAccountMenu(!ev || ev.detail === 0);
  }
}

document.addEventListener("click", (ev) => {
  if (isOpen() && !ev.target.closest(".acct")) {
    closeAccountMenu(false);
  }
});
document.addEventListener("keydown", (ev) => {
  const btn = button();
  if (!btn) {
    return;
  }
  if (!isOpen()) {
    if (ev.target === btn && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
      ev.preventDefault();
      openAccountMenu(true);
      if (ev.key === "ArrowUp") {
        options().at(-1).focus();
      }
    }
    return;
  }
  const list = options();
  const at = list.indexOf(document.activeElement);
  const move = (index) => {
    ev.preventDefault();
    list[(index + list.length) % list.length].focus();
  };
  if (ev.key === "Escape") {
    ev.preventDefault();
    closeAccountMenu(true);
  } else if (ev.key === "ArrowDown") {
    move(at + 1);
  } else if (ev.key === "ArrowUp") {
    move(at < 0 ? -1 : at - 1);
  } else if (ev.key === "Home") {
    move(0);
  } else if (ev.key === "End") {
    move(-1);
  } else if (ev.key === "Tab") {
    closeAccountMenu(false);
  }
});

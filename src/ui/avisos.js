import { dismissed, inAppBrowser, isIOS, needsIosInstall } from "../lib/pwa.js";
import { S } from "../state.js";

// Bloque C: lo que ve la persona de la app instalable y las notificaciones push. Solo arma HTML; las acciones están en
// actions/avisos.js. Sin vapidPublicKey en config.js (o en la demo) no aparece nada de notificaciones.

const card = (icon, title, text, actions) =>
  `<div class="panel pwa-card"><div class="pwa-row"><span class="pwa-ic" aria-hidden="true">${icon}</span><div><b>${title}</b>${text}</div></div>${actions}</div>`;
const two = (later, ok) => `<div class="pwa-acts">${later}${ok}</div>`;

// la guía de iPhone (Apple no deja ofrecer la instalación desde la página: hay que agregarla a inicio a mano)
export function iosSteps(forPush) {
  return `<ol class="pwa-steps"><li>Tocá <span class="pwa-share" aria-label="Compartir"></span> <b>Compartir</b>, abajo en Safari.</li><li>Elegí <b>Agregar a inicio</b> y tocá <b>Agregar</b>.</li><li>Abrí TuTiempo desde el ícono${forPush ? " y tocá <b>Activar avisos</b>" : ""}.</li></ol>`;
}

const PUSH_TEXT = {
  cliente: ["¿Te avisamos antes del turno?", "Te mandamos una notificación 24 h y 2 h antes, y si el turno cambia. Lo podés apagar cuando quieras en Mi perfil."],
  prestador: ["Enterate al toque de cada reserva", "Te avisamos cuando alguien reserva o cancela, y si hay novedades de tus cobros. De tus clientes, solo el nombre de pila."],
};

// tarjeta para activar las notificaciones: después de reservar (cliente) y arriba de la Agenda (prestador).
// "Ahora no" la esconde 30 días en este dispositivo.
export function pushCard(kind) {
  const push = S.push || {};
  if (!S.user) {
    return "";
  }
  if (push.avail === "ios-install" && !inAppBrowser() && !dismissed("ios_" + kind, 30)) {
    return card(
      "📲",
      "Para recibir avisos en el iPhone, agregá TuTiempo a tu pantalla de inicio",
      `${iosSteps(true)}<p class="note pwa-note">Apple solo permite notificaciones a las apps agregadas a inicio (iOS 16.4 o más nuevo). Igual te mandamos todo por email.</p>`,
      `<div class="pwa-acts one"><button class="btn btn-ghost" data-act="pushLater" data-k="ios_${kind}">Entendido</button></div>`,
    );
  }
  if (push.avail !== "ok" || push.on || dismissed("push_" + kind, 30)) {
    return "";
  }
  const [title, text] = PUSH_TEXT[kind];
  return card(
    "🔔",
    title,
    `<p class="note pwa-note">${text}</p>`,
    two(`<button class="btn btn-ghost" data-act="pushLater" data-k="push_${kind}">Ahora no</button>`, '<button class="btn btn-pri" data-act="pushOn">Activar avisos</button>'),
  );
}

// tarjeta para instalar la app, después de reservar (Android y compu). Una sola vez: si la cierra, no vuelve (queda en
// el menú de cuenta).
export function installCard() {
  if (!S.canInstall || dismissed("install_card")) {
    return "";
  }
  return card(
    "📲",
    "Instalá TuTiempo para tener tus turnos a mano",
    '<p class="note pwa-note">Se abre como una app, desde su ícono, y ocupa muy poco.</p>',
    two('<button class="btn btn-ghost" data-act="installLater">Ahora no</button>', '<button class="btn btn-pri" data-act="pwaInstall">Instalar</button>'),
  );
}

// ¿va "Instalar la app" en el menú de cuenta? (Android y compu con el aviso del navegador; iPhone: abre la guía)
export const installMenuItem = () => (S.canInstall || needsIosInstall()) && !inAppBrowser() ? ["📲", isIOS() ? "Agregar a inicio" : "Instalar la app", 'data-act="pwaInstall"'] : null;

// Mi perfil (cliente) y Perfil del panel (prestador): este dispositivo y la opción de cada uno
export function pushPanel(scope) {
  const push = S.push || {};
  if (push.avail === "none" || !S.user) {
    return "";
  }
  const here = /Android|iPhone|iPad/.test(navigator.userAgent) ? "este celular" : "esta compu";
  let device;
  if (push.avail === "ios-install") {
    device = `<p class="note pwa-note">En el iPhone, las notificaciones funcionan con TuTiempo agregada a la pantalla de inicio:</p>${iosSteps(true)}`;
  } else if (push.avail === "ios-old") {
    device = '<p class="note pwa-note">Tu iPhone necesita iOS 16.4 o más nuevo para recibir notificaciones. Igual te avisamos todo por email.</p>';
  } else if (push.avail === "unsupported") {
    device = '<p class="note pwa-note">Este navegador no permite notificaciones. Igual te avisamos todo por email.</p>';
  } else if (push.avail === "denied") {
    device = `<p class="note pwa-note">Bloqueaste las notificaciones de TuTiempo en este navegador. Para recibirlas, habilitalas en la configuración del sitio (el candado al lado de la dirección → Notificaciones → Permitir) y volvé acá.</p>`;
  } else if (push.on) {
    device = `<div class="pwa-dev"><div><b>En ${here}</b><div class="hint">Recibís los avisos acá</div></div><span class="pill-ok">Activadas</span></div>
     <button class="btn btn-ghost btn-block" data-act="pushOff">Desactivar en ${here}</button>`;
  } else {
    device = `<div class="pwa-dev"><div><b>En ${here}</b><div class="hint">Todavía no recibís avisos acá</div></div></div>
     <button class="btn btn-pri btn-block" data-act="pushOn">Activar avisos</button>`;
  }
  const option =
    scope === "prestador"
      ? `<label class="chk pwa-opt"><input type="checkbox" id="bPushBk"${S.user.pushBookings === false ? "" : " checked"}> Nuevas reservas y cancelaciones de clientes</label>
     <p class="note pwa-note">Los avisos de cobros (pagos devueltos, contracargos, reconectar Mercado Pago) te llegan siempre.</p>`
      : `<label class="chk pwa-opt"><input type="checkbox" id="uPush"${S.user.pushNotices === false ? "" : " checked"}> Recordatorios y novedades por notificación</label>
     <p class="note pwa-note">Igual que en email: la confirmación y las cancelaciones llegan siempre. En la notificación no va nada privado: el detalle lo ves al abrir la app.</p>`;
  return `<div class="panel push-panel"><p class="lbl">Notificaciones</p>${device}${option}</div>`;
}

// la guía de instalación en el iPhone (o de abrir el link en el navegador, desde Instagram o WhatsApp)
export function installGuide() {
  if (!S.pwaGuide) {
    return "";
  }
  const body = inAppBrowser()
    ? '<p class="note pwa-note">Desde el navegador de Instagram, Facebook o WhatsApp no se puede instalar. Abrí este link en Safari (iPhone) o Chrome (Android) y probá de nuevo.</p>'
    : `${iosSteps(false)}<p class="note pwa-note">Queda en tu pantalla de inicio y se abre como una app. Desde iOS 16.4, también te puede mandar notificaciones.</p>`;
  return `<div class="pwa-guide" role="dialog" aria-modal="true" aria-label="Agregar TuTiempo a inicio"><div class="panel">
   <b class="pwa-gt">📲 Agregá TuTiempo a tu pantalla de inicio</b>${body}
   <button class="btn btn-pri btn-block" data-act="pwaGuideClose">Entendido</button></div></div>`;
}

// una versión nueva lista: se aplica sola al volver al frente o al cambiar de pantalla; mientras tanto, esta barra
export function updateBar() {
  return S.updateReady
    ? '<div class="pwa-update" role="status"><span>Hay una versión nueva de TuTiempo</span><button class="btn btn-pri btn-sm" data-act="pwaReload">Actualizar</button></div>'
    : "";
}

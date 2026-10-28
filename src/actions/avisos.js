import { registerChange, registerClick } from "./registro.js";
import { api } from "../api/index.js";
import { disablePush, enablePush } from "../lib/push.js";
import { dismiss, needsIosInstall, promptInstall, reloadNow } from "../lib/pwa.js";
import { S } from "../state.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// Bloque C: activar y desactivar las notificaciones de este dispositivo, las opciones de cada uno, instalar la app y
// aplicar una versión nueva.

// "Activar avisos": el permiso se pide acá, con el toque (enablePush llama a requestPermission enseguida)
registerClick("pushOn", (ev, el, act) => {
  el.disabled = true;
  enablePush().then((result) => {
    toast(
      result === "on"
        ? "Listo: te vamos a avisar en este dispositivo."
        : result === "denied"
          ? "No diste permiso para las notificaciones. Si cambiás de idea, habilitalas en la configuración del navegador."
          : "No pudimos activar los avisos. Probá de nuevo en un momento.",
    );
    render();
  });
});
registerClick("pushOff", (ev, el, act) => {
  el.disabled = true;
  disablePush().then(() => {
    toast("Listo: ya no te llegan notificaciones en este dispositivo. Los emails siguen igual.");
    render();
  });
});
// "Ahora no" / "Entendido": esa tarjeta no vuelve por 30 días en este dispositivo
registerClick("pushLater", (ev, el, act) => {
  dismiss(el.dataset.k);
  render();
});
// "Instalar la app" (menú o tarjeta): el aviso del navegador; en el iPhone, la guía
registerClick("pwaInstall", (ev, el, act) => {
  if (needsIosInstall() || !S.canInstall) {
    S.pwaGuide = true;
    render();
    return;
  }
  dismiss("install_card");
  promptInstall();
});
// la tarjeta de instalar se muestra una sola vez: cerrada, no vuelve (queda en el menú)
registerClick("installLater", (ev, el, act) => {
  dismiss("install_card");
  render();
});
registerClick("pwaGuideClose", (ev, el, act) => {
  S.pwaGuide = false;
  render();
});
registerClick("pwaReload", () => reloadNow());

// las opciones: recordatorios y novedades (cliente), nuevas reservas y cancelaciones (prestador)
registerChange("uPush", (ev) => {
  const on = ev.target.checked;
  S.user.pushNotices = on;
  api.m.setPushPrefs({ push_notices: on });
  toast(on ? "Listo: te avisamos los recordatorios y novedades por notificación." : "Listo: ya no te mandamos recordatorios ni novedades por notificación. La confirmación y las cancelaciones te siguen llegando.");
});
registerChange("bPushBk", (ev) => {
  const on = ev.target.checked;
  S.user.pushBookings = on;
  api.m.setPushPrefs({ push_bookings: on });
  toast(on ? "Listo: te avisamos cada reserva nueva y cada cancelación." : "Listo: ya no te avisamos las reservas ni las cancelaciones. Los avisos de cobros te siguen llegando.");
});

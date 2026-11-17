// 17/11: dónde vuelve a permitir las notificaciones quien las rechazó, según el dispositivo. Lo usan la tarjeta de
// Mi perfil (ui/avisos.js) y el aviso al tocar «Activar avisos» (actions/avisos.js). Cuentas puras (pruebas/unidad.mjs).
// En el iPhone no es «la configuración del navegador»: es Configuración → Notificaciones → TuTiempo (la app agregada a
// inicio). Si TuTiempo no aparece en esa lista, hay que borrar el ícono y volver a agregarla a inicio desde Safari.
const nav = () => (typeof navigator == "undefined" ? {} : navigator);
const onIphone = (ua, platform, touch) => /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && touch > 1);

export function pushAllowWhere(ua = nav().userAgent || "", platform = nav().platform, touch = nav().maxTouchPoints) {
  return onIphone(ua, platform, touch)
    ? "en el iPhone: Configuración → Notificaciones → TuTiempo → Permitir notificaciones"
    : /Android/.test(ua)
      ? "en el celular: tocá el candado al lado de la dirección (o, con la app instalada, mantené apretado el ícono → Información de la app) → Notificaciones → Permitir"
      : "en la compu: tocá el candado al lado de la dirección → Notificaciones → Permitir";
}
export function pushIosReinstall(ua = nav().userAgent || "", platform = nav().platform, touch = nav().maxTouchPoints) {
  return onIphone(ua, platform, touch)
    ? " Si TuTiempo no aparece en esa lista, borrá el ícono de TuTiempo de la pantalla de inicio, abrí tutiempo.com.ar en Safari, tocá Compartir → Agregar a inicio, entrá desde el ícono nuevo y tocá «Activar avisos»."
    : "";
}

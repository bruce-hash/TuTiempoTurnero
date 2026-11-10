// Mensajes para la gente: la clave es un código de error de la base (raise exception) o un pedazo del mensaje en
// inglés de Supabase Auth; errMsg busca la primera que aparezca en el error.
const ERRS = {
  login_required: "Ingresá para continuar.",
  slot_taken: "Ese horario se acaba de ocupar. Elegí otro.",
  slot_not_available: "Ese horario ya no está disponible.",
  online_booking_off: "Este profesional pausó los turnos online.",
  too_many_holds: "Tenés reservas sin pagar. Terminá de pagar o esperá 10 minutos.",
  service_not_found: "Ese servicio ya no existe.",
  provider_not_available: "Este perfil ya no está disponible.",
  cannot_cancel: "Ese turno ya no se puede cancelar.",
  already_registered: "Ya tenés un perfil de profesional.",
  bad_dni: "El DNI tiene que tener 7 u 8 números, sin puntos.",
  dni_taken: "Ese DNI ya está registrado en otro negocio de TuTiempo. Si es tuyo, escribinos.",
  dni_locked: "Tu DNI ya está verificado: para cambiarlo, escribinos.",
  dni_missing: "Falta el número de DNI: el profesional lo carga en su panel, en Perfil.",
  dni_photos_missing: "Faltan las fotos del DNI (frente y dorso): el profesional las sube en su panel, en Perfil.",
  bad_dni_file: "Subí una foto (JPG, PNG o WEBP) o un PDF.",
  category_required: "Elegí al menos un rubro.",
  delete_provider_first: "Primero eliminá tu perfil de profesional.",
  "Invalid login credentials": "Email o contraseña incorrectos.",
  "Email not confirmed": "Confirmá tu email: te mandamos un link.",
  "Token has expired or is invalid": "Código incorrecto o vencido. Pedí uno nuevo.",
  // 4/11: el código de reautenticación (cambiar contraseña)
  reauthentication_not_valid: "El código no es correcto o venció. Revisalo o pedí uno nuevo.",
  "invalid nonce": "El código no es correcto o venció. Revisalo o pedí uno nuevo.",
  reauthentication_needed: "Confirmá el cambio con el código que te mandamos por email.",
  "User already registered": "Ese email ya tiene cuenta. Ingresá o recuperá tu contraseña.",
  "Password should be at least": "La contraseña tiene que tener al menos 8 caracteres, con letras y números.",
  "Password should contain": "La contraseña tiene que tener letras y números.",
  weak: "Esa contraseña es muy común o apareció en filtraciones. Elegí otra.",
  "New password should be different": "La contraseña nueva tiene que ser distinta de la anterior.",
  // H30: CAPTCHA (Turnstile) sin resolver, o rechazado por Supabase Auth
  captcha_missing: "Completá la verificación de seguridad y probá de nuevo.",
  "captcha protection": "No pudimos comprobar la verificación de seguridad. Probá de nuevo.",
  "For security purposes": "Por seguridad, esperá un minuto antes de pedirlo de nuevo.",
  "rate limit": "Demasiados intentos. Esperá un rato y probá de nuevo.",
  "Auth session missing": "El link venció o ya se usó. Pedí uno nuevo.",
  "Signups not allowed": "Por ahora no se pueden crear cuentas nuevas.",
  "Unable to validate email address": "Ese email no es válido.",
  "Email link is invalid or has expired": "El link venció o ya se usó. Pedí uno nuevo.",
  cash_not_allowed: "Para este turno hay que pagar con Mercado Pago.",
  // D33: cuentas separadas
  business_account: "Las cuentas de negocio no pueden reservar. Para reservar, ingresá con tu cuenta personal.",
  client_history: "Esta cuenta ya se usó como cliente: el negocio va en una cuenta aparte.",
  provider_mp_not_connected: "Este profesional todavía no toma turnos online.",
  mp_not_connected: "Tu cuenta de Mercado Pago ya estaba desconectada.",
  note_required: "Escribí una nota que explique cómo se resolvió.",
  cannot_reprocess: "Ese pago ya no se puede reprocesar: sus turnos cambiaron o ya tiene una devolución.",
  cannot_retry: "Esa devolución ya no se puede reintentar.",
  too_many_cash: "Ya tenés 4 turnos para pagar en efectivo. Pagá este con Mercado Pago.",
  bad_photo_path: "No pudimos guardar la foto.",
  too_many_messages: "Llegaste al límite de mensajes por hoy. Probá mañana.",
  bad_message: "Escribí un mensaje (hasta 500 letras).",
  not_enough_stamps: "Todavía no tenés todos los sellos.",
  reward_not_available: "Este servicio no es el premio de la tarjeta.",
  stamp_today: "Ya le sumaste un sello a mano hoy.",
  client_without_app: "Este contacto no tiene la app: los sellos se guardan en su cuenta.",
  stamps_off: "Las tarjetas de sellos están apagadas.",
  bad_reward: "Elegí servicios tuyos para la tarjeta de sellos.",
  no_stamp_card: "Ese servicio no tiene tarjeta de sellos.",
  bad_stamp_goal: "Cada tarjeta lleva de 15 a 20 sellos.",
  forbidden: "No tenés permiso para hacer eso.",
  // 4/11 · Bloque 3: ofrecer un hueco a los seguidores (offer_slot)
  offer_repeated: "Ese horario ya lo ofreciste.",
  offer_taken: "Ese horario ya no está libre.",
  offer_past: "Ese horario ya pasó.",
  offer_limit: "Llegaste al límite de hoy: 5 ofertas a todos tus seguidores y 10 a seguidores puntuales. Mañana podés seguir.",
  not_follower: "Esa persona ya no te sigue.",
  // S19 / S01 (8/11): un negocio suspendido o pendiente no escribe a sus seguidores ni a sus clientes
  not_active: "Con tu negocio sin aprobar o suspendido no podés mandar avisos ni ofrecer turnos.",
  bad_offer: "Elegí un horario libre de los próximos días.",
  bad_commission: "La comisión tiene que estar entre 0% y 30%.",
  bad_site_url: "Escribí solo https:// y el dominio, sin barra al final ni nada después.",
  empty_note: "Escribí la nota.",
  too_many_notes: "Ese profesional ya tiene demasiadas notas.",
  month_closed: "El mes está cerrado: reabrilo para cambiarlo.",
  // 10/11 · punto 7: marcar «Asistió» o «No vino»
  too_early: "Todavía falta para ese turno: «Asistió» y «No vino» se marcan desde 12 horas antes.",
  bad_state: "Ese turno ya cambió (se canceló, se marcó o sigue esperando el pago). Mirá la Agenda de nuevo.",
  not_done: "Primero marcá «Asistió»: el resto se anota en un turno atendido.",
  period_not_over: "Todavía no terminó: se cierra cuando termina.",
  already_closed: "Ya estaba cerrado.",
  year_closed: "El año está cerrado: reabrí el año primero.",
  bad_amount: "Escribí un monto válido.",
  empty_concept: "Escribí el concepto.",
  bad_day: "Fecha inválida.",
  // 10/11 · punto 9: el stock lo lleva la base (compra, venta, ajuste)
  no_stock: "No alcanza el stock de ese producto. Revisalo en Productos.",
  stock_locked: "El stock cambia solo con una compra, una venta o un ajuste.",
  product_not_found: "Ese producto ya no está en tu lista.",
  bad_qty: "Escribí la cantidad con números enteros (1 o más).",
  bad_reason: "Elegí el motivo: roto, vencido o uso en el local.",
  // gastos fijos (C31, D44): se cambian solo desde el mes actual y desde «Gastos fijos»
  bad_month: "Los gastos fijos se cambian desde el mes actual en adelante.",
  fixed_expense: "Ese gasto es fijo: cambialo desde «Gastos fijos».",
};
export function errMsg(err) {
  const text = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  for (const key in ERRS) {
    if (text.includes(key)) {
      return ERRS[key];
    }
  }
  if (/Failed to fetch|NetworkError|network/i.test(text)) {
    return "Sin conexión. Revisá internet y probá de nuevo.";
  } else {
    return "Algo salió mal. Probá de nuevo en un momento.";
  }
}

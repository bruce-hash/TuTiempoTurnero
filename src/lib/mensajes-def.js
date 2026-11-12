// 11/11 (división del código): los avisos automáticos por defecto, aparte de la pestaña Mensajes (src/views/prestador/mensajes.js)
// para que el arranque (api, panel vacío) no cargue todo el panel.
// avisos automáticos por defecto (el parámetro no se usa). 7/11 · Bloque 5: salen el recordatorio de 2 h y el saludo
// de cumpleaños (ya no se mandan a nadie: send_scheduled_notices en la base)
export const MSG_DEF = (cat) => [
  {
    k: "conf",
    t: "Confirmación al reservar",
    cuando: "Apenas reserva",
    on: true,
    txt: "¡Hola {nombre}! Tu turno en {barberia} quedó para el {dia} a las {hora}. Te esperamos en {direccion}.",
  },
  {
    k: "r24",
    t: "Recordatorio 24 h antes",
    cuando: "Un día antes",
    on: true,
    txt: "{nombre}, te recordamos tu turno mañana a las {hora} en {barberia}. ¡Te esperamos!",
  },
  {
    k: "rev",
    t: "Pedido de reseña",
    cuando: "2 horas después del turno",
    on: true,
    txt: "¡Gracias por venir, {nombre}! ¿Nos dejás tu opinión? Nos ayuda muchísimo: {link}",
  },
];

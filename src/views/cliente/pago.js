import { api } from "../../api/index.js";
import { esc } from "../../lib/dom.js";
import { longLabel } from "../../lib/fechas.js";
import { S } from "../../state.js";
import { render } from "../../ui/render.js";

// Paso 1 (v4): pantalla de regreso de Mercado Pago SIN sesión (/turno/<id>?pago=<token>). Pasa, por ejemplo, cuando se
// paga desde la app instalada: Mercado Pago vuelve al navegador, que no tiene la sesión. Con el token de la vuelta muestra
// el estado del pago y del turno (solo servicio, prestador, día y hora) y ofrece ingresar para verlo. Mientras el pago se
// confirma, vuelve a preguntar solo (y le pide a mp-reconcile que consulte a Mercado Pago, por si el aviso no llega).
const WAIT_MS = 4000;
const MAX_TRIES = 45; // unos 3 minutos

function loadPay(first) {
  const token = S.payToken;
  if (!token || S.payLoading) {
    return;
  }
  S.payLoading = true;
  if (first) {
    api.checkoutPoke(token);
  }
  api
    .checkoutStatus(token)
    .then((st) => {
      S.payStatus = st || { state: "unknown" };
    })
    .catch(() => {
      S.payStatus = S.payStatus || { state: "error" };
    })
    .finally(() => {
      S.payLoading = false;
      if (S.view !== "pagoVuelta" || S.payToken !== token) {
        return;
      }
      render();
      const state = S.payStatus && S.payStatus.state;
      if ((state === "waiting" || state === "checking" || state === "error") && (S.payTries || 0) < MAX_TRIES) {
        S.payTries = (S.payTries || 0) + 1;
        clearTimeout(loadPay.timer);
        loadPay.timer = setTimeout(() => {
          if (S.view === "pagoVuelta" && S.payToken === token) {
            // cada tanto, que mp-reconcile vuelva a consultar (la base lo limita a una vez cada 15 s)
            if (S.payTries % 4 === 0) {
              api.checkoutPoke(token);
            }
            loadPay(false);
          }
        }, WAIT_MS);
      }
    });
}

export function vPagoVuelta() {
  const st = S.payStatus;
  if (!st) {
    loadPay(true);
    return '<div class="narrow" style="margin-top:24px"><div class="skel" style="min-height:240px"></div></div>';
  }
  const what = st.service
    ? `<p class="lead">${esc(st.service)} · ${esc(longLabel(st.date))} a las ${esc(st.time)}${st.provider ? ` en ${esc(st.provider)}` : ""}.</p>`
    : "";
  const login = (label) =>
    `<button class="btn btn-pri btn-block" data-act="payLogin">${label}</button><p class="note" style="margin-top:8px">Si pagaste desde la app instalada, Mercado Pago te trajo al navegador: ingresá con la misma cuenta.</p>`;
  const card = (icon, title, body, actions) =>
    `<div class="narrow stack pay-back" style="margin-top:24px;text-align:center"><div class="panel"><div style="font-size:40px" aria-hidden="true">${icon}</div><h1 class="h1">${title}</h1>${body}${actions}</div></div>`;
  switch (st.state) {
    case "confirmed":
      return card("✅", "¡Listo! Tenés turno", `${what}<p class="note">Te llega la confirmación por email.</p>`, login("Ingresá para ver tu turno"));
    case "partial":
      return card(
        "✅",
        `Se confirmaron ${st.confirmed} de ${st.n} turnos`,
        `${what}<p class="note">Lo que pagaste por los demás se devuelve solo a tu Mercado Pago.</p>`,
        login("Ingresá para ver tus turnos"),
      );
    case "refunded":
      return card(
        "💳",
        "No pudimos confirmar tu turno",
        `${what}<p class="note">El horario ya no estaba libre cuando llegó el pago: te devolvemos lo que pagaste a tu Mercado Pago, sin que hagas nada.</p>`,
        login("Ingresá para elegir otro horario"),
      );
    case "waiting":
      return card(
        "⏳",
        S.payBack === "failure" ? "El pago no se completó" : "Estamos confirmando tu pago",
        `${what}<p class="note">${S.payBack === "failure" ? "Tu horario sigue reservado unos minutos: ingresá para volver a intentarlo." : "Mercado Pago nos avisa en segundos. Tu horario queda reservado mientras tanto: esta pantalla se actualiza sola."}</p>`,
        login("Ingresá a tu cuenta"),
      );
    case "checking":
      return card(
        "⏳",
        "Estamos revisando tu pago con Mercado Pago",
        `${what}<p class="note">El horario se liberó mientras pagabas. Si el pago se aprobó, en unos minutos te confirmamos el turno o te devolvemos la plata, sin que hagas nada. Te avisamos por email.</p>`,
        login("Ingresá a tu cuenta"),
      );
    case "not_paid":
      return card(
        "✕",
        "El pago no se completó",
        `${what}<p class="note">El horario se liberó. Si llegaste a pagar y no ves la devolución, escribinos a contacto@tutiempo.com.ar.</p>`,
        login("Ingresá para elegir otro horario"),
      );
    case "error":
      return card("⚠", "No pudimos ver el estado de tu pago", '<p class="note">Revisá tu conexión: esta pantalla vuelve a intentarlo sola.</p>', login("Ingresá a tu cuenta"));
    default:
      return card("🔎", "No encontramos este pago", '<p class="note">Ingresá para ver tus turnos.</p>', login("Ingresá a tu cuenta"));
  }
}

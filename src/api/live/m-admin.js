import { LM } from "./index.js";
import { saved } from "../saved.js";
import { sb } from "../../config.js";

// Escrituras del administrador (todas por funciones de la base que verifican el rol) y, al final, sellos y
// mensajes del prestador a sus clientes.
Object.assign(LM, {
  adminSetCommission: (pct) =>
    saved(
      sb.rpc("admin_set_commission", {
        p_pct: pct,
      }),
    ),
  adminSetProvider: (providerId, status, verified) =>
    saved(
      sb.rpc("admin_set_provider", {
        pid: providerId,
        p_status: status,
        p_verified: verified,
      }),
    ),
  adminAddNote: (providerId, body) =>
    saved(
      sb.rpc("admin_add_note", {
        pid: providerId,
        p_body: body,
      }),
    ),
  adminDelNote: (noteId) =>
    saved(
      sb.rpc("admin_delete_note", {
        p_id: noteId,
      }),
    ),
  adminRefundRetry: (refundId) => saved(sb.rpc("admin_refund_retry", { p_refund: refundId })),
  adminRefundCreate: (paymentId, amount, note) =>
    saved(sb.rpc("admin_refund_create", { p_payment: paymentId, p_booking: null, p_amount: amount, p_note: note })),
  adminResolve: (kind, id, note) => saved(sb.rpc("admin_resolve", { p_kind: kind, p_id: id, p_note: note })),
  adminDeleteProvider: (providerId) =>
    saved(
      sb.rpc("admin_delete_provider", {
        pid: providerId,
      }),
    ),
  adminClose: (kind, period) =>
    saved(
      sb.rpc("admin_close", {
        p_kind: kind,
        p_period: period,
      }),
    ),
  adminReopen: (kind, period) =>
    saved(
      sb.rpc("admin_reopen", {
        p_kind: kind,
        p_period: period,
      }),
    ),
  adminAddExp: (day, concept, amount) =>
    saved(
      sb.rpc("admin_add_expense", {
        p_day: day,
        p_concept: concept,
        p_amount: amount,
      }),
    ),
  adminDelExp: (expenseId) =>
    saved(
      sb.rpc("admin_delete_expense", {
        p_id: expenseId,
      }),
    ),
  // fotos del DNI de un prestador: enlaces firmados que vencen a los 5 minutos
  adminDni: async (userId) => {
    const res = await sb.storage.from("dni").list(userId, {
      limit: 10,
    });
    if (res.error) {
      throw res.error;
    }
    // URL firmada de 2 minutos por archivo: se piden al tocar "Ver DNI" y no se guardan
    const urls = [];
    for (const file of res.data || []) {
      const signed = await sb.storage.from("dni").createSignedUrl(userId + "/" + file.name, 120);
      if (signed.data) {
        urls.push({
          side: file.name.startsWith("frente-") ? "Frente" : file.name.startsWith("dorso-") ? "Dorso" : "Archivo",
          url: signed.data.signedUrl,
        });
      }
    }
    return urls;
  },
  giveStamp: (client, svcId) =>
    saved(
      sb.rpc("give_stamp", {
        p_client: client.id,
        p_service: svcId,
      }),
    ),
  redeemStamps: (client, svcId) =>
    saved(
      sb.rpc("redeem_stamps", {
        p_client: client.id,
        p_service: svcId,
      }),
    ),
  // goals: { idServicio: sellos para el premio }; sin valor, el servicio no da sellos
  saveStampGoals: (prov, goals) =>
    Promise.all(
      prov.svcs
        .filter((svc) => svc[4])
        .map((svc) =>
          saved(
            sb
              .from("services")
              .update({
                stamp_goal: goals[svc[4]] || null,
              })
              .eq("id", svc[4]),
          ),
        ),
    ),
  sendMessages: (clientIds, body) =>
    saved(
      sb.rpc("send_client_messages", {
        p_client_ids: clientIds,
        p_body: body,
      }),
    ),
  // marcar como leídos no es importante: si falla no se avisa
  readMessages: () =>
    sb.rpc("mark_messages_read").then(
      () => {},
      () => {},
    ),
});

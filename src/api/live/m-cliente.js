import { LM } from "./index.js";
import { call, saved } from "../saved.js";
import { sb } from "../../config.js";
import { S } from "../../state.js";
import { avatarUrl } from "../../ui/fotos.js";

// Escrituras de la cuenta del cliente (reseñas, cancelaciones, favoritos, lista de espera, perfil, foto) y del
// cierre de caja y los días bloqueados del prestador.
Object.assign(LM, {
  review: (booking, stars, body) =>
    saved(
      sb.from("reviews").insert({
        provider_id: booking.pid,
        booking_id: booking.id,
        author: "-",
        stars: stars,
        body: body || null,
      }),
    ),
  // la devolución de la seña la decide cancel_by_client en la base
  cancelClient: (booking) =>
    saved(
      sb.rpc("cancel_by_client", {
        p_booking: booking.id,
      }),
    ),
  follow: (providerId, on) =>
    saved(
      on
        ? sb.from("follows").insert({
            user_id: S.user.id,
            provider_id: providerId,
          })
        : sb.from("follows").delete().eq("provider_id", providerId).eq("user_id", S.user.id),
    ),
  waitlist: (providerId, day) =>
    saved(
      sb.from("waitlist").insert({
        user_id: S.user.id,
        provider_id: providerId,
        day: day,
      }),
    ),
  saveMe: (fullName, phone) =>
    saved(
      sb
        .from("profiles")
        .update({
          full_name: fullName,
          phone: phone || null,
        })
        .eq("id", S.user.id),
    ),
  // Bloque 3: recordatorios y novedades por email (Mi perfil); la base no encola esos emails de quien los apaga
  setEmailNotices: (on) =>
    saved(
      sb
        .from("profiles")
        .update({
          email_notices: !!on,
        })
        .eq("id", S.user.id),
    ),
  // Bloque C: opciones de las notificaciones ({ push_notices } o { push_bookings }) y la suscripción de este dispositivo
  setPushPrefs: (prefs) => saved(sb.from("profiles").update(prefs).eq("id", S.user.id)),
  pushSubscribe: (endpoint, p256dh, auth, label) =>
    saved(sb.rpc("push_subscribe", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_label: label })),
  pushUnsubscribe: (endpoint) => call(sb.rpc("push_unsubscribe", { p_endpoint: endpoint })),
  deleteAccount: () => saved(sb.rpc("delete_my_account")),
  setAvatar: async (blob) => {
    const path = `${S.user.id}/a-${Date.now()}.jpg`;
    await saved(
      sb.storage.from("avatars").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      }),
    );
    await saved(
      sb
        .from("profiles")
        .update({
          avatar_path: path,
        })
        .eq("id", S.user.id),
    );
    return avatarUrl(path);
  },
  setProviderPhoto: async (blob) => {
    const path = `${S.user.id}/p-${Date.now()}.jpg`;
    await saved(
      sb.storage.from("avatars").upload(path, blob, {
        contentType: "image/jpeg",
        upsert: false,
      }),
    );
    await saved(
      sb
        .from("providers")
        .update({
          photo_path: path,
        })
        .eq("id", S.me),
    );
    return avatarUrl(path);
  },
  // si falla el borrado del archivo queda huérfano en el bucket, pero la foto ya no se muestra
  delMedia: async (media) => {
    if (!media.id) {
      return;
    }
    const rows = await saved(sb.from("media").delete().eq("id", media.id).select("storage_path"));
    const path = rows && rows[0] && rows[0].storage_path;
    if (path) {
      sb.storage
        .from("media")
        .remove([path])
        .catch(() => {});
    }
  },
  // kind "day" o "month"; el período de un mes se guarda como su día 1
  closeCash: (kind, period, totals) =>
    saved(
      sb.from("cash_closings").upsert({
        provider_id: S.me,
        kind: kind,
        period: kind === "month" ? period + "-01" : period,
        income: Math.round(totals.income || 0),
        expenses: Math.round(totals.expenses || 0),
        cash: Math.round(totals.cash || 0),
        mp: Math.round(totals.mp || 0),
        counted: totals.counted == null ? null : Math.round(totals.counted),
        closed_at: /* @__PURE__ */ new Date().toISOString(),
      }),
    ),
  reopenCash: (kind, period) =>
    saved(
      sb
        .from("cash_closings")
        .delete()
        .eq("provider_id", S.me)
        .eq("kind", kind)
        .eq("period", kind === "month" ? period + "-01" : period),
    ),
  blockDays: (from, to, reason) =>
    saved(
      sb.rpc("block_days", {
        p_from: from,
        p_to: to,
        p_reason: reason,
      }),
    ),
});

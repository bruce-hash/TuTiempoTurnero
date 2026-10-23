import { LM } from "./index.js";
import { saved } from "../saved.js";
import { sb } from "../../config.js";
import { S } from "../../state.js";
import { avatarUrl } from "../../ui/fotos.js";

Object.assign(LM, {
  review: (e, a, t) =>
    saved(
      sb.from("reviews").insert({
        provider_id: e.pid,
        booking_id: e.id,
        author: "-",
        stars: a,
        body: t || null,
      }),
    ),
  cancelClient: (e) =>
    saved(
      sb.rpc("cancel_by_client", {
        p_booking: e.id,
      }),
    ),
  follow: (e, a) =>
    saved(
      a
        ? sb.from("follows").insert({
            user_id: S.user.id,
            provider_id: e,
          })
        : sb.from("follows").delete().eq("provider_id", e).eq("user_id", S.user.id),
    ),
  waitlist: (e, a) =>
    saved(
      sb.from("waitlist").insert({
        user_id: S.user.id,
        provider_id: e,
        day: a,
      }),
    ),
  saveMe: (e, a) =>
    saved(
      sb
        .from("profiles")
        .update({
          full_name: e,
          phone: a || null,
        })
        .eq("id", S.user.id),
    ),
  deleteAccount: () => saved(sb.rpc("delete_my_account")),
  setAvatar: async (e) => {
    const a = `${S.user.id}/a-${Date.now()}.jpg`;
    await saved(
      sb.storage.from("avatars").upload(a, e, {
        contentType: "image/jpeg",
        upsert: false,
      }),
    );
    await saved(
      sb
        .from("profiles")
        .update({
          avatar_path: a,
        })
        .eq("id", S.user.id),
    );
    return avatarUrl(a);
  },
  setProviderPhoto: async (e) => {
    const a = `${S.user.id}/p-${Date.now()}.jpg`;
    await saved(
      sb.storage.from("avatars").upload(a, e, {
        contentType: "image/jpeg",
        upsert: false,
      }),
    );
    await saved(
      sb
        .from("providers")
        .update({
          photo_path: a,
        })
        .eq("id", S.me),
    );
    return avatarUrl(a);
  },
  delMedia: async (e) => {
    if (!e.id) {
      return;
    }
    const a = await saved(sb.from("media").delete().eq("id", e.id).select("storage_path"));
    const t = a && a[0] && a[0].storage_path;
    if (t) {
      sb.storage
        .from("media")
        .remove([t])
        .catch(() => {});
    }
  },
  closeCash: (e, a, t) =>
    saved(
      sb.from("cash_closings").upsert({
        provider_id: S.me,
        kind: e,
        period: e === "month" ? a + "-01" : a,
        income: Math.round(t.income || 0),
        expenses: Math.round(t.expenses || 0),
        cash: Math.round(t.cash || 0),
        mp: Math.round(t.mp || 0),
        counted: t.counted == null ? null : Math.round(t.counted),
        closed_at: /* @__PURE__ */ new Date().toISOString(),
      }),
    ),
  reopenCash: (e, a) =>
    saved(
      sb
        .from("cash_closings")
        .delete()
        .eq("provider_id", S.me)
        .eq("kind", e)
        .eq("period", e === "month" ? a + "-01" : a),
    ),
  blockDays: (e, a, t) =>
    saved(
      sb.rpc("block_days", {
        p_from: e,
        p_to: a,
        p_reason: t,
      }),
    ),
});

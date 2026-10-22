import { LM } from "./index.js";
import { saved } from "../saved.js";
import { sb } from "../../config.js";

Object.assign(LM, {
  adminSetCommission: (e) =>
    saved(
      sb.rpc("admin_set_commission", {
        p_pct: e,
      }),
    ),
  adminSetProvider: (e, a, t) =>
    saved(
      sb.rpc("admin_set_provider", {
        pid: e,
        p_status: a,
        p_verified: t,
      }),
    ),
  adminAddNote: (e, a) =>
    saved(
      sb.rpc("admin_add_note", {
        pid: e,
        p_body: a,
      }),
    ),
  adminDelNote: (e) =>
    saved(
      sb.rpc("admin_delete_note", {
        p_id: e,
      }),
    ),
  adminDeleteProvider: (e) =>
    saved(
      sb.rpc("admin_delete_provider", {
        pid: e,
      }),
    ),
  adminClose: (e, a) =>
    saved(
      sb.rpc("admin_close", {
        p_kind: e,
        p_period: a,
      }),
    ),
  adminReopen: (e, a) =>
    saved(
      sb.rpc("admin_reopen", {
        p_kind: e,
        p_period: a,
      }),
    ),
  adminAddExp: (e, a, t) =>
    saved(
      sb.rpc("admin_add_expense", {
        p_day: e,
        p_concept: a,
        p_amount: t,
      }),
    ),
  adminDelExp: (e) =>
    saved(
      sb.rpc("admin_delete_expense", {
        p_id: e,
      }),
    ),
  adminDni: async (e) => {
    const a = await sb.storage.from("dni").list(e, {
      limit: 10,
    });
    if (a.error) {
      throw a.error;
    }
    const t = [];
    for (const s of a.data || []) {
      const n = await sb.storage.from("dni").createSignedUrl(e + "/" + s.name, 300);
      if (n.data) {
        t.push(n.data.signedUrl);
      }
    }
    return t;
  },
  giveStamp: (e, a) =>
    saved(
      sb.rpc("give_stamp", {
        p_client: e.id,
        p_service: a,
      }),
    ),
  redeemStamps: (e, a) =>
    saved(
      sb.rpc("redeem_stamps", {
        p_client: e.id,
        p_service: a,
      }),
    ),
  saveStampGoals: (e, a) =>
    Promise.all(
      e.svcs
        .filter((t) => t[4])
        .map((t) =>
          saved(
            sb
              .from("services")
              .update({
                stamp_goal: a[t[4]] || null,
              })
              .eq("id", t[4]),
          ),
        ),
    ),
  sendMessages: (e, a) =>
    saved(
      sb.rpc("send_client_messages", {
        p_client_ids: e,
        p_body: a,
      }),
    ),
  readMessages: () =>
    sb.rpc("mark_messages_read").then(
      () => {},
      () => {},
    ),
});

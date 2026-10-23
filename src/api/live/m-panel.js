import { LM } from "./index.js";
import { cfgToDb } from "../mapeo.js";
import { saved } from "../saved.js";
import { sb } from "../../config.js";
import { TODAY, fromMin, localToIso, toMin } from "../../lib/fechas.js";
import { S } from "../../state.js";

Object.assign(LM, {
  markBooking: (e, a) =>
    saved(
      sb.rpc("mark_booking", {
        p_booking: e.id,
        p_status: a === "noshow" ? "no_show" : "done",
      }),
    ),
  cancelProvider: (e) =>
    saved(
      sb.rpc("cancel_by_provider", {
        p_booking: e.id,
      }),
    ),
  addBooking: (e) =>
    saved(
      sb
        .from("bookings")
        .insert({
          provider_id: S.me,
          client_name: e.cliente,
          client_phone: e.tel || null,
          service_name: e.svc,
          source: e.type === "block" ? "block" : "manual",
          status: "confirmed",
          starts_at: localToIso(e.date, e.time),
          ends_at: localToIso(e.date, fromMin(toMin(e.time) + e.dur)),
          price: e.price || 0,
        })
        .select("id")
        .single(),
    ).then((a) => {
      e.id = a.id;
    }),
  delBooking: (e) => saved(sb.from("bookings").delete().eq("id", e.id)),
  upsertClient: (e, a) =>
    a.id
      ? saved(
          sb
            .from("provider_clients")
            .update({
              phone: a.tel || null,
              notes: a.notes || null,
              birthday: a.bday || null,
              profile: a.profile || {},
            })
            .eq("id", a.id),
        )
      : saved(
          sb
            .from("provider_clients")
            .insert({
              provider_id: S.me,
              name: e,
              phone: a.tel || null,
              notes: a.notes || null,
              birthday: a.bday || null,
              profile: a.profile || {},
            })
            .select("id")
            .single(),
        ).then((t) => {
          a.id = t.id;
        }),
  contacted: (e) =>
    saved(
      sb
        .from("provider_clients")
        .update({
          contacted_at: /* @__PURE__ */ new Date().toISOString(),
        })
        .eq("provider_id", S.me)
        .in("name", e),
    ),
  addWalk: (e) =>
    saved(
      sb
        .from("walkins")
        .insert({
          provider_id: S.me,
          at: localToIso(TODAY(), e.hora),
          kind: e.kind === "prod" ? "product" : "service",
          description: e.svc,
          amount: e.precio,
          tip: e.propina || 0,
          method: e.medio === "Mercado Pago" ? "mp" : "cash",
          client_name: e.cliente || null,
          product_id: e.pid || null,
        })
        .select("id")
        .single(),
    ).then((a) => {
      e.id = a.id;
    }),
  delWalk: (e) => (e.id ? saved(sb.from("walkins").delete().eq("id", e.id)) : Promise.resolve()),
  setStock: (e) =>
    saved(
      sb
        .from("products")
        .update({
          stock: e.stock,
        })
        .eq("id", e.id),
    ),
  addProduct: (e) =>
    saved(
      sb
        .from("products")
        .insert({
          provider_id: S.me,
          name: e.n,
          price: e.p,
          stock: e.stock,
          min_stock: e.min,
        })
        .select("id")
        .single(),
    ).then((a) => {
      e.id = a.id;
    }),
  addExpense: (e) =>
    saved(
      sb
        .from("expenses")
        .insert({
          provider_id: S.me,
          concept: e.c,
          amount: e.m,
          category: e.cat,
          spent_on: e.d,
          product_id: e.prodId || null,
          qty: e.qty || null,
        })
        .select("id")
        .single(),
    ).then((a) => {
      e.id = a.id;
    }),
  delExpense: (e) => saved(sb.from("expenses").delete().eq("id", e.id)),
  saveTemplate: (e) =>
    saved(
      sb.from("message_templates").upsert({
        provider_id: S.me,
        key: e.k,
        enabled: e.on,
        body: e.txt,
      }),
    ),
  saveSettings: (e) => {
    const a = cfgToDb(S.me, e);
    return saved(sb.from("provider_settings").upsert(a.st))
      .then(() => saved(sb.from("provider_hours").delete().eq("provider_id", S.me)))
      .then(() => (a.hours.length ? saved(sb.from("provider_hours").insert(a.hours)) : null));
  },
  setGoal: (e) =>
    saved(
      sb
        .from("provider_private")
        .update({
          monthly_goal: e,
        })
        .eq("provider_id", S.me),
    ),
});

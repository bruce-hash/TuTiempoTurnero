import { LM } from "./index.js";
import { cfgToDb } from "../mapeo.js";
import { saved } from "../saved.js";
import { sb } from "../../config.js";
import { TODAY, fromMin, localToIso, toMin } from "../../lib/fechas.js";
import { S } from "../../state.js";

// Escrituras del panel del prestador (agenda, clientes, caja, productos, gastos, avisos y horarios), todas por saved().
// Lo que crea una fila guarda su id en el objeto de la app.
Object.assign(LM, {
  markBooking: (booking, status) =>
    saved(
      sb.rpc("mark_booking", {
        p_booking: booking.id,
        p_status: status === "noshow" ? "no_show" : "done",
      }),
    ),
  cancelProvider: (booking) =>
    saved(
      sb.rpc("cancel_by_provider", {
        p_booking: booking.id,
      }),
    ),
  // turno agendado a mano o bloqueo de horario (sin dinero: la política de la base no lo permite)
  addBooking: (booking) =>
    saved(
      sb
        .from("bookings")
        .insert({
          provider_id: S.me,
          client_name: booking.cliente,
          client_phone: booking.tel || null,
          service_name: booking.svc,
          source: booking.type === "block" ? "block" : "manual",
          status: "confirmed",
          starts_at: localToIso(booking.date, booking.time),
          ends_at: localToIso(booking.date, fromMin(toMin(booking.time) + booking.dur)),
          price: booking.price || 0,
        })
        .select("id")
        .single(),
    ).then((row) => {
      booking.id = row.id;
    }),
  delBooking: (booking) => saved(sb.from("bookings").delete().eq("id", booking.id)),
  upsertClient: (name, client) =>
    client.id
      ? saved(
          sb
            .from("provider_clients")
            .update({
              phone: client.tel || null,
              notes: client.notes || null,
              birthday: client.bday || null,
              profile: client.profile || {},
            })
            .eq("id", client.id),
        )
      : saved(
          sb
            .from("provider_clients")
            .insert({
              provider_id: S.me,
              name: name,
              phone: client.tel || null,
              notes: client.notes || null,
              birthday: client.bday || null,
              profile: client.profile || {},
            })
            .select("id")
            .single(),
        ).then((row) => {
          client.id = row.id;
        }),
  contacted: (names) =>
    saved(
      sb
        .from("provider_clients")
        .update({
          contacted_at: /* @__PURE__ */ new Date().toISOString(),
        })
        .eq("provider_id", S.me)
        .in("name", names),
    ),
  addWalk: (walk) =>
    saved(
      sb
        .from("walkins")
        .insert({
          provider_id: S.me,
          at: localToIso(TODAY(), walk.hora),
          kind: walk.kind === "prod" ? "product" : "service",
          description: walk.svc,
          amount: walk.precio,
          tip: walk.propina || 0,
          method: walk.medio === "Mercado Pago" ? "mp" : "cash",
          client_name: walk.cliente || null,
          product_id: walk.pid || null,
        })
        .select("id")
        .single(),
    ).then((row) => {
      walk.id = row.id;
    }),
  delWalk: (walk) => (walk.id ? saved(sb.from("walkins").delete().eq("id", walk.id)) : Promise.resolve()),
  setStock: (prod) =>
    saved(
      sb
        .from("products")
        .update({
          stock: prod.stock,
        })
        .eq("id", prod.id),
    ),
  addProduct: (prod) =>
    saved(
      sb
        .from("products")
        .insert({
          provider_id: S.me,
          name: prod.n,
          price: prod.p,
          stock: prod.stock,
          min_stock: prod.min,
        })
        .select("id")
        .single(),
    ).then((row) => {
      prod.id = row.id;
    }),
  addExpense: (expense) =>
    saved(
      sb
        .from("expenses")
        .insert({
          provider_id: S.me,
          concept: expense.c,
          amount: expense.m,
          category: expense.cat,
          spent_on: expense.d,
          product_id: expense.prodId || null,
          qty: expense.qty || null,
        })
        .select("id")
        .single(),
    ).then((row) => {
      expense.id = row.id;
    }),
  delExpense: (expense) => saved(sb.from("expenses").delete().eq("id", expense.id)),
  saveTemplate: (tpl) =>
    saved(
      sb.from("message_templates").upsert({
        provider_id: S.me,
        key: tpl.k,
        enabled: tpl.on,
        body: tpl.txt,
      }),
    ),
  // los horarios se reemplazan enteros: se borran los del prestador y se insertan los nuevos
  saveSettings: (conf) => {
    const rows = cfgToDb(S.me, conf);
    return saved(sb.from("provider_settings").upsert(rows.st))
      .then(() => saved(sb.from("provider_hours").delete().eq("provider_id", S.me)))
      .then(() => (rows.hours.length ? saved(sb.from("provider_hours").insert(rows.hours)) : null));
  },
  setGoal: (goal) =>
    saved(
      sb
        .from("provider_private")
        .update({
          monthly_goal: goal,
        })
        .eq("provider_id", S.me),
    ),
});

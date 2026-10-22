// Crea el cobro en Mercado Pago, a nombre del prestador: la seña (para el prestador) + la comisión de TuTiempo
// que paga el cliente aparte (marketplace_fee: va directo a la cuenta de TuTiempo).
// El monto SIEMPRE sale de la base (turnos en estado 'hold' del usuario), nunca del navegador.
import { admin, caller, cors, env, json, sellerToken, MP_API } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, h);
  try {
    const user = await caller(req);
    if (!user) return json({ error: "login_required" }, 401, h);
    const body = await req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.booking_ids) ? body.booking_ids.map(Number).filter(Number.isInteger).slice(0, 4) : [];
    if (!ids.length) return json({ error: "bad_request" }, 400, h);

    const db = admin();
    const { data: rows, error } = await db.from("bookings")
      .select("id, provider_id, client_id, status, deposit, client_fee, paid_wallet, price, service_name, hold_expires_at")
      .in("id", ids);
    if (error) throw error;
    const ok = (rows ?? []).filter((b) => b.client_id === user.id && b.status === "hold" && new Date(b.hold_expires_at) > new Date());
    if (ok.length !== ids.length) return json({ error: "hold_expired" }, 409, h);
    const pid = ok[0].provider_id;
    if (ok.some((b) => b.provider_id !== pid)) return json({ error: "bad_request" }, 400, h);

    // Todo sale de la base: seña de cada turno + comisión de cada turno (calculada por book_slot con la comisión vigente).
    const fee = ok.reduce((a, b) => a + (b.client_fee ?? 0), 0);
    const amount = ok.reduce((a, b) => a + b.deposit - b.paid_wallet, 0) + fee;
    if (amount <= 0) return json({ error: "nothing_to_pay" }, 409, h);

    // Se cobra con la llave del PRESTADOR: la seña entra directo a su cuenta de Mercado Pago.
    const [token, { data: prov }] = await Promise.all([sellerToken(db, pid), db.from("providers").select("name").eq("id", pid).single()]);
    if (!token) return json({ error: "provider_mp_not_connected" }, 409, h);

    const site = env("SITE_URL");
    const expires = ok.map((b) => b.hold_expires_at).sort()[0];
    const pref = {
      items: [{ id: String(ids[0]), title: `Seña + comisión · ${ok[0].service_name ?? "Turno"} · ${prov?.name ?? ""}`.slice(0, 250), quantity: 1, unit_price: amount, currency_id: "ARS" }],
      external_reference: ids.join(","),
      marketplace_fee: fee,                 // comisión de TuTiempo: va a la cuenta de TuTiempo (dueña de MP_CLIENT_ID)
      binary_mode: true,                    // aprobado o rechazado al instante (nada de pagos "pendientes" que vencen el horario)
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },   // sin efectivo en Rapipago/Pago Fácil
      notification_url: `${env("SUPABASE_URL")}/functions/v1/mp-webhook?provider=${pid}`,
      back_urls: {
        success: `${site}/?mp=success&b=${ids[0]}`,
        pending: `${site}/?mp=pending&b=${ids[0]}`,
        failure: `${site}/?mp=failure&b=${ids[0]}`,
      },
      auto_return: "approved",
      expires: true,
      expiration_date_to: expires,
      payer: { email: user.email },
      statement_descriptor: "TUTIEMPO",
      metadata: { booking_ids: ids, user_id: user.id },
    };
    const r = await fetch(`${MP_API}/checkout/preferences`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Idempotency-Key": `pref-${ids.join("-")}` },
      body: JSON.stringify(pref),
    });
    const mp = await r.json();
    if (!r.ok) { console.error("MP preference error", r.status, mp); return json({ error: "mp_error" }, 502, h); }
    await db.from("bookings").update({ mp_preference_id: mp.id }).in("id", ids);
    return json({ init_point: mp.init_point }, 200, h);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500, h);
  }
});

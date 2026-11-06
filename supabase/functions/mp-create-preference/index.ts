// Crea el cobro en Mercado Pago, a nombre del prestador: la seña (para el prestador) + la comisión de TuTiempo
// que paga el cliente aparte (marketplace_fee: va directo a la cuenta de TuTiempo).
// El monto SIEMPRE sale de la base (turnos en estado 'hold' del usuario), nunca del navegador.
import { accountToken, activeAccount, admin, caller, cors, env, json, MP_API, must } from "../_shared/util.ts";

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
    const rows = must("leer las reservas", await db.from("bookings")
      .select("id, provider_id, client_id, status, deposit, client_fee, mp_fee, paid_wallet, price, service_name, hold_expires_at")
      .in("id", ids));
    const ok = (rows ?? []).filter((b) => b.client_id === user.id && b.status === "hold" && new Date(b.hold_expires_at) > new Date());
    if (ok.length !== ids.length) return json({ error: "hold_expired" }, 409, h);
    const pid = ok[0].provider_id;
    if (ok.some((b) => b.provider_id !== pid)) return json({ error: "bad_request" }, 400, h);

    // Todo sale de la base (book_slot): seña de cada turno + comisión de TuTiempo + lo que se suma por Mercado Pago (D30).
    // marketplace_fee es solo la comisión de TuTiempo: lo de Mercado Pago lo descuenta Mercado Pago del lado del prestador.
    const fee = ok.reduce((a, b) => a + (b.client_fee ?? 0), 0);
    const mpFee = ok.reduce((a, b) => a + (b.mp_fee ?? 0), 0);
    const amount = ok.reduce((a, b) => a + b.deposit - b.paid_wallet, 0) + fee + mpFee;
    if (amount <= 0) return json({ error: "nothing_to_pay" }, 409, h);

    // Se cobra con la llave de la cuenta ACTIVA del prestador: la seña entra directo a su cuenta de Mercado Pago.
    // Una cuenta desconectada (solo devoluciones y consultas) nunca crea cobros.
    const [acc, provRes] = await Promise.all([activeAccount(db, pid), db.from("providers").select("name").eq("id", pid).single()]);
    const prov = must("leer el nombre del prestador", provRes);
    const token = await accountToken(db, acc, { charge: true });
    if (!acc || !token) return json({ error: "provider_mp_not_connected" }, 409, h);

    const site = env("SITE_URL");
    const expires = ok.map((b) => b.hold_expires_at).sort()[0];
    // Paso 1 (v4): el cobro queda anotado con un token de regreso. La vuelta lleva a la pantalla del turno con ese token:
    // muestra el estado del pago aunque el navegador no tenga la sesión (por ejemplo, desde la app instalada) y, si el
    // aviso de Mercado Pago no llega, mp-reconcile le pregunta a Mercado Pago por este cobro.
    const back = must("anotar el cobro", await db.rpc("checkout_open", { p_booking_ids: ids, p_account: acc.id })) as string;
    // 4/11: desde la app instalada la vuelta lleva app=1. En iOS, Mercado Pago la abre en Safari, que no tiene la sesión de
    // la app: la pantalla de regreso muestra el estado y pide volver a la app, que confirma sola con el cobro que guardó.
    const app = body.app === true ? "&app=1" : "";
    const ret = (st: string) => `${site}/turno/${ids[0]}?pago=${back}&mp=${st}${app}`;
    const pref = {
      items: [{ id: String(ids[0]), title: `Seña + comisión · ${ok[0].service_name ?? "Turno"} · ${prov?.name ?? ""}`.slice(0, 250), quantity: 1, unit_price: amount, currency_id: "ARS" }],
      external_reference: ids.join(","),
      marketplace_fee: fee,                 // comisión de TuTiempo: va a la cuenta de TuTiempo (dueña de MP_CLIENT_ID)
      binary_mode: true,                    // aprobado o rechazado al instante (nada de pagos "pendientes" que vencen el horario)
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },   // sin efectivo en Rapipago/Pago Fácil
      // el aviso dice qué cuenta cobró: así se consulta (y se devuelve) con su llave aunque el prestador reconecte otra
      notification_url: `${env("SUPABASE_URL")}/functions/v1/mp-webhook?provider=${pid}&account=${acc.id}`,
      back_urls: { success: ret("success"), pending: ret("pending"), failure: ret("failure") },
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
    // solo referencia: si no se guarda, el pago igual se confirma por external_reference (se loguea y sigue)
    const up = await db.from("bookings").update({ mp_preference_id: mp.id }).in("id", ids);
    if (up.error) console.error("db: falló guardar mp_preference_id", JSON.stringify({ code: up.error.code, message: up.error.message }));
    // el token de regreso también vuelve a la app (es el cobro del mismo usuario): la app instalada lo guarda para
    // confirmar el pago al volver a primer plano, aunque la vuelta de Mercado Pago se abra en otro navegador
    return json({ init_point: mp.init_point, token: back, booking: ids[0] }, 200, h);
  } catch (e) {
    console.error("mp-create-preference", e instanceof Error ? e.message : e);
    return json({ error: "server_error" }, 500, h);
  }
});

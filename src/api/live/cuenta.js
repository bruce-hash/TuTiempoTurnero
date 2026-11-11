import { liveApi } from "./index.js";
import { feesFromDb, upsertP } from "../mapeo.js";
import { call } from "../saved.js";
import { CITY, sb } from "../../config.js";
import { errMsg } from "../../lib/errores.js";
import { isoToLocal, minsBetween } from "../../lib/fechas.js";
import { pr } from "../../lib/prestadores.js";
import { uname } from "../../lib/turnero.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { avatarUrl } from "../../ui/fotos.js";
import { toast } from "../../ui/toast.js";
import { cleanPending } from "../../lib/pendiente.js";

export const liveCuenta = {
  // Sesión de Supabase → S.user. Si es prestador, carga su panel; después, sus turnos, avisos, sellos y si es admin.
  async session() {
    const { data: data } = await sb.auth.getSession();
    const session = data && data.session;
    if (!session) {
      return null;
    }
    const user = session.user;
    const profile = await call(
      sb.from("profiles").select("full_name,phone,avatar_path,email_notices,email_bookings,push_notices,push_bookings,push_followers").eq("id", user.id).maybeSingle(),
    ).catch(() => null);
    S.user = {
      // D32: cuándo se creó la cuenta (la vuelta de Google con la casilla de negocio va directo al paso 1 si es nueva)
      createdAt: user.created_at || null,
      id: user.id,
      email: user.email,
      name: (profile && profile.full_name) || (user.user_metadata && user.user_metadata.full_name) || user.email.split("@")[0],
      photo: avatarUrl(profile && profile.avatar_path) || (user.user_metadata && user.user_metadata.avatar_url) || null,
      // Bloque 3: avisos de sus turnos por email (por defecto, sí)
      emailNotices: !profile || profile.email_notices !== false,
      // Bloque C: notificaciones (cliente: recordatorios y novedades; prestador: nuevas reservas y cancelaciones)
      pushNotices: !profile || profile.push_notices !== false,
      pushBookings: !profile || profile.push_bookings !== false,
      // C06: seguidores nuevos (prestador)
      pushFollowers: !profile || profile.push_followers !== false,
      // 11/11 (D25): emails de reservas nuevas y cancelaciones de clientes (prestador; por defecto, sí)
      emailBookings: !profile || profile.email_bookings !== false,
    };
    S.form.tel = (profile && profile.phone) || "";
    let pid = await call(sb.rpc("my_provider"));
    // Ingreso y registro: la acción pendiente que viajó en la cuenta nueva (el link del email se pudo abrir en otro
    // navegador o en otro celular). Se usa una vez y se borra.
    const meta = user.user_metadata || {};
    if (meta.tt_pending) {
      if (!S.pending) {
        S.pending = cleanPending(meta.tt_pending);
      }
      // la cuenta se creó desde "Registrá tu negocio" (paso 0): es la del negocio
      S.bizNew = !!S.pending && S.pending.a === "negocio";
      sb.auth.updateUser({ data: { tt_pending: null } }).catch(() => {});
    }
    // Alta de antes del rediseño (los datos del negocio viajaban en los metadatos de la cuenta y el perfil se creaba al
    // confirmar el email): se sigue respetando para las cuentas que quedaron a medio camino. Queda en el paso 2.
    const reg = meta.provider_reg;
    if (!pid && reg) {
      try {
        pid = await call(
          sb.rpc("register_provider", {
            p_name: reg.name,
            p_address: reg.address || "",
            p_categories: reg.categories,
            p_phone: reg.phone || "",
            p_dni: null,
            p_instagram: reg.instagram || null,
            p_city: CITY,
          }),
        );
        await call(sb.rpc("setup_step", { p_step: 1 })).catch(() => null);
        await sb.auth.updateUser({
          data: {
            provider_reg: null,
          },
        });
      } catch (err) {
        toast(errMsg(err));
      }
    }
    if (pid) {
      S.me = pid;
      S.barberAuth = true;
      await liveApi.loadMine();
      await liveApi.mySetup();
    }
    await Promise.all([liveApi.myBookings(), liveApi.myMessages(), liveApi.myStamps(), liveApi.adminCheck()]);
    return S.user;
  },
  // D33: ¿la cuenta ya se usó como cliente? (turnos, seguidos, reseñas)
  async clientHistory() {
    return await call(sb.rpc("my_client_history"));
  },
  // Registrá tu negocio: qué pasos guardó y qué le falta para recibir reservas (lib/alta.js)
  async mySetup() {
    if (!S.me) {
      return null;
    }
    const setup = await call(sb.rpc("my_setup")).catch(() => null);
    S.setupBy = Object.assign({}, S.setupBy, setup ? { [S.me]: setup } : {});
    return setup;
  },
  async myBookings() {
    if (!S.user) {
      return;
    }
    const rows = await call(sb.rpc("my_bookings"));
    // Estados de la base → los de la app.
    const statusMap = {
      confirmed: "confirmed",
      done: "done",
      no_show: "noshow",
      cancelled_client: "cancelled",
      cancelled_provider: "cancelled",
      cancelled_refunded: "cancelled",
      hold: "hold",
      expired: "expired",
    };
    store.BOOK = store.BOOK.filter((booking) => !booking.mine).concat(
      (rows || []).map((row) => {
        const prov =
          pr(row.provider_id) ||
          upsertP({
            id: row.provider_id,
            name: row.provider_name,
            addr: row.address || "",
            hue: row.hue,
            cats: [row.category || "n"],
            svcs: [],
          });
        if (row.photo_path && !prov.photo) {
          prov.photo = avatarUrl(row.photo_path);
        }
        return Object.assign(
          {
            id: row.id,
            pid: row.provider_id,
            dur: minsBetween(row.starts_at, row.ends_at),
            svc: row.service_name,
            price: row.price,
            paid: row.paid_mp + row.paid_wallet,
            fee: +row.client_fee || 0,
            // D30: lo que pagó por Mercado Pago (se le devuelve si cancela el profesional)
            mpFee: +row.paid_mp_fee || 0,
            disc: row.discount_pct,
            status: statusMap[row.status] || row.status,
            byProv: row.status === "cancelled_provider",
            // Bloque 1: el pago se devolvió (o hubo contracargo) desde Mercado Pago; y la devolución de la app, si hay
            byRefund: row.status === "cancelled_refunded",
            refund: row.refund_amount
              ? {
                  amount: row.refund_amount,
                  status: row.refund_status,
                  done: row.refund_done_at ? isoToLocal(row.refund_done_at).date : null,
                  reason: row.refund_reason,
                }
              : null,
            self: !!row.settle_by_provider,
            mine: true,
            pay: row.pay_method || "mp",
            series: row.series_id,
            cat: row.category,
            type: "local",
            src: "app",
            cliente: uname(),
            addons: (row.addons || []).map((addon) => [addon.name, addon.price, addon.min]),
            intake: row.intake || {},
            every: row.repeat_days || 0,
            note: row.prep_note || "",
            reviewed: !!row.reviewed,
            stamped: !!row.stamped,
            // D45: ese profesional no le muestra horarios (sin «Reprogramar» ni «Reservar de nuevo»)
            noSlots: !!row.no_slots,
          },
          isoToLocal(row.starts_at),
        );
      }),
    );
  },
  async myStamps() {
    if (!S.user) {
      return;
    }
    const rows = await call(sb.rpc("my_stamps")).catch(() => []);
    S.myStampsBy = S.myStampsBy || {};
    S.cards = (rows || []).map((row) => {
      (S.myStampsBy[row.provider_id] ||= {})[row.service_id] = row.stamps;
      return {
        pid: row.provider_id,
        sid: row.service_id,
        svc: row.service_name,
        name: row.provider_name,
        photo: avatarUrl(row.photo_path),
        hue: row.hue,
        cat: row.category || "n",
        n: row.stamps,
        goal: row.stamp_goal || 0,
        on: row.stamps_on,
        done: row.done,
      };
    });
  },
  // Bloque C: ¿este dispositivo (su endpoint de push) está suscripto a esta cuenta?
  async pushRegistered(endpoint) {
    return !!(await call(sb.rpc("push_registered", { p_endpoint: endpoint })));
  },
  // Paso 1 (v4): estado del pago y del turno para la pantalla de regreso de Mercado Pago, con el token de la vuelta (anda
  // sin sesión: solo servicio, prestador, día y hora). null si el token no existe.
  async checkoutStatus(token) {
    return await call(sb.rpc("checkout_status", { p_token: token }));
  },
  // …y le pide a mp-reconcile que consulte ya a Mercado Pago (por si el aviso no llegó); a lo sumo cada 15 s por cobro
  async checkoutPoke(token) {
    await sb.functions.invoke("mp-reconcile", { body: { token } }).catch(() => {});
  },
  // Bloque D (D26): "Exigir DNI para aprobar prestadores" (si no se puede leer, se exige, como hasta ahora)
  // C29: y si las tarjetas de sellos están encendidas en TuTiempo (si no se puede leer, encendidas, como hasta ahora)
  async requireDni() {
    const row = await call(sb.from("app_settings").select("require_dni,stamps_on").maybeSingle()).catch(() => null);
    S.requireDni = !row || row.require_dni !== false;
    S.stampsOn = !row || row.stamps_on !== false;
    return S.requireDni;
  },
  // D34: comisión de TuTiempo (% del precio del turno) y % de Mercado Pago por plazo (app_settings, lo puede leer cualquiera)
  async fees() {
    const row = await call(
      sb.from("app_settings").select("deposit_commission_pct,mp_pct_instant,mp_pct_d10,mp_pct_d18,mp_pct_d35").maybeSingle(),
    ).catch(() => null);
    if (row) {
      store.FEES = feesFromDb(row);
    }
  },
};

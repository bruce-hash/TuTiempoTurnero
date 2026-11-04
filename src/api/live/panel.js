import { liveApi } from "./index.js";
import { call } from "../saved.js";
import { sb } from "../../config.js";
import { TODAY, addDays, daysAgo, dkey, isoToLocal, localToIso, minsBetween } from "../../lib/fechas.js";
import { p0cat, pr } from "../../lib/prestadores.js";
import { dniRequired } from "../../lib/verificacion.js";
import { S } from "../../state.js";
import { store } from "../../store.js";
import { feeOf } from "../../views/prestador/finanzas.js";
import { MSG_DEF } from "../../views/prestador/mensajes.js";
import { medioFromDb } from "../../lib/medios.js";
import { avatarUrl } from "../../ui/fotos.js";
import { restMissing } from "../../lib/resto.js";

// C22 (V3b): la consulta de los turnos del panel y cómo se pasan a la agenda. Los usan la carga completa (loadMine) y la
// que vuelve a pedir solo los turnos cada 30 segundos y al volver a la pestaña (refreshAgenda).
const bookingsQuery = (pid, from, to) =>
  sb
    .from("bookings")
    .select(
      "id,service_id,client_id,client_name,client_phone,service_name,source,status,starts_at,ends_at,price,discount_pct,paid_mp,paid_wallet,app_fee,client_fee,paid_mp_fee,series_id,addons,buffer_min,pay_method,rest_method,rest_parts",
    )
    .eq("provider_id", pid)
    .gte("starts_at", localToIso(from, "00:00"))
    .lt("starts_at", localToIso(to, "23:59"))
    .in("status", ["confirmed", "done", "no_show", "hold"])
    .order("starts_at")
    .limit(5e3);
const statusMap = {
  confirmed: "confirmed",
  done: "done",
  no_show: "noshow",
  hold: "confirmed",
};
const bookingFromDb = (pid) => (row) =>
  Object.assign(
    {
      id: row.id,
      pid: pid,
      dur: minsBetween(row.starts_at, row.ends_at),
      svc: row.service_name || "",
      price: row.price,
      paid: row.paid_mp + row.paid_wallet,
      // comisión que salió de la seña (turnos anteriores a la versión 30, cuando no se cobraba aparte)
      feeIn: Math.max(0, (row.app_fee || 0) - (row.client_fee || 0)),
      fee: row.client_fee || 0,
      mpFee: row.paid_mp_fee || 0,
      disc: row.discount_pct,
      cliente: row.client_name || "",
      tel: row.client_phone || "",
      src: row.source === "app" ? "app" : "manual",
      type: row.source === "block" ? "block" : "local",
      // un turno en espera de pago se muestra como confirmado: el horario ya está tomado
      status: statusMap[row.status],
      pay: row.pay_method || "mp",
      // C25 (V4): cómo se cobró el resto en el local (lo anota el prestador en la Caja del día)
      restMethod: row.rest_method || null,
      // V4b: el resto en uno o dos medios, si el prestador lo cargó así
      restParts: row.rest_parts ? row.rest_parts.map((part) => [medioFromDb(part.method), part.amount]) : null,
      series: row.series_id,
      hold: row.status === "hold",
      buf: row.buffer_min || 0,
      addons: (row.addons || []).map((addon) => [addon.name, addon.price, addon.min]),
      intake: row.intake || {},
      cat: ((pr(pid).svcs || []).find((svc) => svc[4] === row.service_id) || [])[3],
    },
    isoToLocal(row.starts_at),
  );

const expenseFromDb = (row) => ({
  id: row.id,
  c: row.concept,
  m: row.amount,
  cat: row.category,
  d: row.spent_on,
  // C31: viene de un gasto fijo (se cambia desde Gastos fijos, no se borra suelto)
  fixed: row.fixed_id || null,
});
const ym = (date) => (date ? String(date).slice(0, 7) : null);

export const livePanel = {
  // C31: los gastos fijos del prestador y, después de un cambio, los gastos otra vez (las filas de cada mes)
  async loadFixed(pid) {
    const rows = await call(sb.from("fixed_expenses").select("*").eq("provider_id", pid || S.me).order("id")).catch(() => []);
    store.FIXED = (rows || []).map((row) => ({ id: row.id, c: row.concept, cat: row.category, m: row.amount, since: ym(row.since), until: ym(row.until_month) }));
  },
  async reloadExpenses() {
    const rows = await call(sb.from("expenses").select("*").eq("provider_id", S.me).gte("spent_on", dkey(addDays(-400))).order("spent_on"));
    store.GASTOS = (rows || []).map(expenseFromDb);
    await livePanel.loadFixed(S.me);
  },
  // C22 (V3b): vuelve a pedir solo los turnos del panel (60 días atrás, 120 adelante). true si cambió algo.
  async refreshAgenda() {
    const pid = S.me;
    if (!pid) {
      return false;
    }
    const rows = await call(bookingsQuery(pid, dkey(addDays(-60)), dkey(addDays(120))));
    const sig = () => JSON.stringify(store.BOOK.filter((booking) => booking.pid == pid && !booking.mine));
    const before = sig();
    store.BOOK = store.BOOK.filter((booking) => booking.pid != pid || booking.mine).concat((rows || []).map(bookingFromDb(pid)));
    return sig() !== before;
  },
  // Todo el panel del prestador logueado en una tanda: turnos de 60 días atrás a 120 adelante, clientes, productos,
  // gastos, ventas sin turno de hoy, plantillas de avisos, finanzas de 30 días, ocupación, sellos y cierres de caja.
  async loadMine() {
    const pid = S.me;
    await liveApi.loadProvider(pid, true);
    const from = dkey(addDays(-60));
    const to = dkey(addDays(120));
    // C31: los gastos fijos que falten hasta este mes (y los precargados la primera vez), antes de leer los gastos
    await call(sb.rpc("fixed_expenses_sync")).catch(() => null);
    await liveApi.loadFixed(pid);
    const [bookings, clients, products, expenses, walkins, templates, finance, priv, occupancy, cards, closings, mpSt, notices] = await Promise.all([
      call(bookingsQuery(pid, from, to)),
      call(sb.from("provider_clients").select("*").eq("provider_id", pid).limit(5e3)),
      call(sb.from("products").select("*").eq("provider_id", pid).order("name")),
      call(
        sb
          .from("expenses")
          .select("*")
          .eq("provider_id", pid)
          .gte("spent_on", dkey(addDays(-400)))
          .order("spent_on"),
      ),
      call(
        sb
          .from("walkins")
          .select("*")
          .eq("provider_id", pid)
          .gte("at", localToIso(TODAY(), "00:00"))
          .order("at"),
      ),
      call(sb.from("message_templates").select("*").eq("provider_id", pid)),
      call(
        sb.rpc("provider_finance", {
          p_from: dkey(addDays(-29)),
          p_to: dkey(addDays(-1)),
        }),
      ),
      call(
        sb.from("provider_private").select("mp_connected,monthly_goal,phone").eq("provider_id", pid).maybeSingle(),
      ),
      call(
        sb.rpc("provider_occupancy", {
          p_from: dkey(addDays(-400)),
          p_to: TODAY(),
        }),
      ),
      call(sb.from("loyalty_cards").select("user_id,service_id,stamps").eq("provider_id", pid).limit(5e3)),
      call(
        sb
          .from("cash_closings")
          .select("kind,period,income,expenses,cash,mp,counted,closed_at")
          .eq("provider_id", pid)
          .gte("period", dkey(addDays(-800))),
      ),
      // Bloque 1: si hoy puede cobrar y qué depende de cuentas anteriores; avisos de pagos devueltos o contracargos
      call(sb.rpc("my_mp_status")),
      call(sb.rpc("my_provider_notices")),
    ]);
    // H10: mientras no está verificado, qué le falta cargar (número, frente, dorso); el número no viaja al navegador
    S.dniSt = pr(pid).verified === false ? await call(sb.rpc("my_dni_status")).catch(() => null) : null;
    // Bloque D (D26): si TuTiempo exige el DNI para aprobar y, si no lo exige, si el perfil ya está aprobado (los pasos)
    await liveApi.requireDni();
    S.provStatus = pr(pid).verified === false && !dniRequired() ? await call(sb.rpc("my_provider_status")).catch(() => null) : null;
    store.BOOK = store.BOOK.filter((booking) => booking.pid != pid || booking.mine).concat((bookings || []).map(bookingFromDb(pid)));
    store.CLIENTS = {};
    (clients || []).forEach((row) => {
      store.CLIENTS[row.name] = {
        id: row.id,
        v: row.visits,
        n: row.no_shows,
        last: daysAgo(row.last_visit),
        spend: row.visits ? Math.round(row.total_spent / row.visits) : 0,
        tel: row.phone || "",
        notes: row.notes || "",
        bday: row.birthday || "",
        contacted: !!row.contacted_at,
        user: row.user_id,
        profile: row.profile || {},
        stamps: Object.fromEntries(
          (cards || []).filter((card) => row.user_id && card.user_id === row.user_id).map((card) => [card.service_id, card.stamps]),
        ),
      };
    });
    store.PRODS = (products || []).map((row) => ({
      id: row.id,
      n: row.name,
      p: row.price,
      stock: row.stock,
      min: row.min_stock,
      // C36: precio de compra (opcional)
      cost: row.cost == null ? null : row.cost,
    }));
    store.GASTOS = (expenses || []).map(expenseFromDb);
    store.CLOSINGS = {};
    (closings || []).forEach((row) => {
      store.CLOSINGS[row.kind + "|" + (row.kind === "month" ? String(row.period).slice(0, 7) : row.period)] = {
        income: row.income,
        expenses: row.expenses,
        cash: row.cash,
        mp: row.mp,
        counted: row.counted,
        at: isoToLocal(row.closed_at).time,
      };
    });
    S.walk = (walkins || []).map((row) => ({
      id: row.id,
      svc: row.description,
      precio: row.amount,
      propina: row.tip,
      hora: isoToLocal(row.at).time,
      medio: medioFromDb(row.method) || "Efectivo",
      pid: row.product_id || null,
      cliente: row.client_name || "",
      kind: row.kind === "product" ? "prod" : "svc",
    }));
    store.MSGS = MSG_DEF(p0cat(pid)).map((tpl) => {
      const saved = (templates || []).find((row) => row.key === tpl.k);
      if (saved) {
        return Object.assign(tpl, {
          on: saved.enabled,
          txt: saved.body,
        });
      } else {
        return tpl;
      }
    });
    store.FIN = (finance || []).map((row) => ({
      date: row.day,
      app: row.app,
      man: row.man,
      walk: row.walk,
      prod: row.prod,
    }));
    store.OCCD = {};
    (occupancy || []).forEach((row) => {
      store.OCCD[row.day + "|" + row.hour] = row.busy_min;
    });
    store.MTOT = {};
    store.MBRK = {};
    S.mpSt = mpSt || {};
    S.mp = S.mpSt.can_charge ? "ok" : "none";
    S.notices = notices || [];
    // 4/11: los huecos ya ofrecidos (la Agenda los marca "✓ Ofrecido")
    await livePanel.myOffers().catch(() => {});
    const prov = pr(pid);
    // reseñas y trabajos de su perfil (los cargó loadProvider)
    store.COMM = store.COMMBY[pid];
    S.goal = (priv && priv.monthly_goal) || S.goal;
    // celular del negocio (privado: lo ve TuTiempo y el cliente con un turno pago). Antes no se cargaba y guardar Perfil
    // lo borraba.
    if (pr(pid) && priv) {
      pr(pid).tel = priv.phone || "";
    }
    S.jobsToday = store.BOOK.filter((booking) => booking.pid == pid && booking.date === TODAY() && booking.status === "done").length;
    S.earnToday = store.BOOK.filter((booking) => booking.pid == pid && booking.date === TODAY() && booking.status === "done").reduce(
      (sum, booking) => sum + (booking.price - (booking.src === "app" ? feeOf(booking) : 0) - restMissing(booking)),
      0,
    );
  },
  async monthTotals(year) {
    const rows = await call(
      sb.rpc("provider_month_totals", {
        p_year: year,
      }),
    );
    store.MTOT[year] = (rows || []).map((row) => ({
      ing: row.income,
      gas: row.expenses,
    }));
    return store.MTOT[year];
  },
  // C33 (V4): el año mes por mes, separado por origen y tipo de gasto (provider_month_breakdown)
  async monthBreakdown(year) {
    const rows = await call(sb.rpc("provider_month_breakdown", { p_year: year }));
    store.MBRK[year] = (rows || []).map((row) => ({ app: row.app, man: row.man, walk: row.walk, prod: row.prod, fixed: row.exp_fixed, buys: row.exp_products }));
    return store.MBRK[year];
  },
  // 4/11 · Bloque 3: quienes siguen al prestador (Clientes → Seguidores): "Ana G.", foto, desde cuándo y su ficha si ya
  // es cliente. El número que se muestra en el panel sale de acá (al día).
  async followers() {
    const data = await call(sb.rpc("provider_followers"));
    store.FOLLOWERS = ((data && data.items) || []).map((row) => ({
      id: row.id,
      name: row.name,
      photo: avatarUrl(row.photo),
      since: row.since,
      client: row.client,
    }));
    store.COMM.followers = (data && data.count) || 0;
    return store.FOLLOWERS;
  },
  // los huecos que ya ofreció (a todos o a un seguidor), para marcarlos "✓ Ofrecido" aunque recargue
  async myOffers() {
    const rows = await call(
      sb.from("slot_offers").select("starts_at,target_user").eq("provider_id", S.me).gte("starts_at", new Date().toISOString()).limit(1e3),
    );
    S.offered = {};
    S.offeredTo = {};
    (rows || []).forEach((row) => {
      const { date, time } = isoToLocal(row.starts_at);
      if (row.target_user) {
        S.offeredTo[row.target_user + "|" + date + "|" + time] = true;
      } else {
        S.offered[date + "|" + time] = true;
      }
    });
  },
  // 4/11: el número de seguidores y los avisos del panel ("Nuevo seguidor") se vuelven a pedir con la Agenda (cada 30 s
  // y al volver a la pestaña); antes se cargaban una sola vez al entrar. true si cambió algo.
  async refreshCommunity() {
    const pid = S.me;
    if (!pid) {
      return false;
    }
    const [row, notices] = await Promise.all([
      call(sb.from("providers").select("followers").eq("id", pid).maybeSingle()),
      call(sb.rpc("my_provider_notices")),
    ]);
    const before = JSON.stringify([store.COMM.followers, S.notices]);
    if (row) {
      store.COMM.followers = row.followers;
    }
    S.notices = notices || [];
    return JSON.stringify([store.COMM.followers, S.notices]) !== before;
  },
  m: {},
};

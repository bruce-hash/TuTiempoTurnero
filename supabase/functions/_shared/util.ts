// Utilidades compartidas de las Edge Functions de TuTiempo (Deno).
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const env = (k: string, required = true): string => {
  const v = Deno.env.get(k) ?? "";
  if (required && !v) throw new Error(`Falta la variable ${k}`);
  return v;
};

// Solo se aceptan llamadas desde el sitio (SITE_URL). Nada de "*".
export function cors(req: Request): Record<string, string> {
  const site = env("SITE_URL");
  const origin = req.headers.get("Origin") ?? "";
  const allowed = origin === site ? origin : site;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

// Cliente con permisos totales: NUNCA se expone al navegador.
export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

// Usuario que llama (verifica el JWT de Supabase Auth).
export async function caller(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data, error } = await c.auth.getUser();
  return error ? null : data.user;
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparación en tiempo constante.
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// API de Mercado Pago. Solo para pruebas se cambia con el secreto MP_API_URL de la función (un Mercado Pago falso);
// sin ese secreto, siempre la real.
export const MP_API = (Deno.env.get("MP_API_URL") ?? "").replace(/\/+$/, "") || "https://api.mercadopago.com";

// Cuenta de Mercado Pago de un prestador (tabla mp_accounts, Bloque 1). Una sola "active" por prestador: la única que
// crea cobros. Las "refunds_only" (desconectadas o reemplazadas) sirven solo para devoluciones y consultas.
export type MpAccount = {
  id: number; provider_id: number; mp_user_id: string | null; status: "active" | "refunds_only" | "purged";
  access_token: string | null; refresh_token: string | null; expires_at: string | null;
};
const ACCOUNT_COLS = "id, provider_id, mp_user_id, status, access_token, refresh_token, expires_at";

export async function activeAccount(db: SupabaseClient, pid: number): Promise<MpAccount | null> {
  const { data } = await db.from("mp_accounts").select(ACCOUNT_COLS).eq("provider_id", pid).eq("status", "active").maybeSingle();
  return (data as MpAccount) ?? null;
}
export async function accountById(db: SupabaseClient, id: number): Promise<MpAccount | null> {
  const { data } = await db.from("mp_accounts").select(ACCOUNT_COLS).eq("id", id).maybeSingle();
  return (data as MpAccount) ?? null;
}
// Cuentas de un prestador que todavía tienen llave (la activa primero): para avisos viejos que no dicen la cuenta.
export async function providerAccounts(db: SupabaseClient, pid: number): Promise<MpAccount[]> {
  const { data } = await db.from("mp_accounts").select(ACCOUNT_COLS).eq("provider_id", pid).neq("status", "purged")
    .order("status", { ascending: true }).order("connected_at", { ascending: false });
  return (data as MpAccount[]) ?? [];
}

// Llave de una cuenta. Las llaves duran 180 días: si faltan menos de `days` días, se renueva con el refresh_token y se
// guarda la nueva (MP entrega un refresh_token nuevo cada vez y el viejo deja de servir). `charge`: solo sirve la cuenta
// activa (crear cobros). Una sola renovación a la vez por cuenta (mp_account_refresh_claim): los demás siguen con la
// llave actual mientras no venza.
const msLeft = (acc: MpAccount) => (acc.expires_at ? new Date(acc.expires_at).getTime() - Date.now() : Infinity);
function usable(acc: MpAccount | null, charge?: boolean): string | null {
  if (!acc?.access_token || acc.status === "purged" || (charge && acc.status !== "active")) return null;
  return msLeft(acc) > 0 ? acc.access_token : null;
}
export async function accountToken(db: SupabaseClient, acc: MpAccount | null, opts: { days?: number; charge?: boolean } = {}): Promise<string | null> {
  const days = opts.days ?? 15;
  if (!acc || acc.status === "purged" || (opts.charge && acc.status !== "active")) return null;
  if (msLeft(acc) > days * 864e5 || !acc.refresh_token) return usable(acc, opts.charge);
  const { data: claimed } = await db.rpc("mp_account_refresh_claim", { p_account: acc.id });
  // otro proceso la está renovando: la llave que haya guardada (la actual o la nueva), si sirve
  if (!claimed) return usable(await accountById(db, acc.id), opts.charge);
  const release = () => db.rpc("mp_account_refresh_release", { p_account: acc.id });
  // se relee: puede que otro la haya renovado entre la lectura y la reserva
  const cur = await accountById(db, acc.id);
  if (!cur?.refresh_token || cur.status === "purged" || msLeft(cur) > days * 864e5) {
    await release();
    return usable(cur, opts.charge);
  }
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: cur.refresh_token }),
  }).catch(() => null);
  const tok = r ? await r.json().catch(() => ({})) : {};
  if (r?.ok && tok.access_token) {
    await db.rpc("mp_account_refreshed", { p_account: cur.id, p_access: tok.access_token, p_refresh: tok.refresh_token ?? null, p_expires_in: Number(tok.expires_in) || 0 });
    return opts.charge && cur.status !== "active" ? null : tok.access_token;
  }
  // falló: si mientras tanto otro proceso ya la renovó (cambió el refresh_token), se usa esa y no hay error
  const again = await accountById(db, cur.id);
  if (again?.refresh_token && again.refresh_token !== cur.refresh_token) {
    await release();
    return usable(again, opts.charge);
  }
  console.error("MP refresh", cur.id, r?.status);
  // venció y no se pudo renovar: si era la activa, deja de cobrar (tiene que reconectar)
  await db.rpc("mp_account_error", { p_account: cur.id, p_error: `No se pudo renovar la llave (${r?.status ?? "sin respuesta"})`, p_expired: msLeft(cur) <= 0 });
  return usable(cur, opts.charge);
}

// Respuesta de Mercado Pago: solo los campos permitidos (nada del comprador ni de la tarjeta). La base vuelve a filtrar
// con la misma lista (mp_clean), que es la que guarda.
const MP_FIELDS = ["id", "status", "status_detail", "transaction_amount", "currency_id", "date_created", "date_approved",
  "date_last_updated", "collector_id", "external_reference", "metadata", "fee_details", "marketplace_fee"];
export function mpClean(pay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of MP_FIELDS) if (pay && k in pay) out[k] = pay[k];
  if (Array.isArray(pay?.refunds)) {
    out.refunds = (pay.refunds as Record<string, unknown>[]).filter((x) => x && typeof x === "object")
      .map((x) => ({ id: x.id, amount: x.amount, status: x.status, date_created: x.date_created }));
  }
  return out;
}

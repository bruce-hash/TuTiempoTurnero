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

export const COMMISSION = 0.10; // solo si no se puede leer la comisión de la base
export const MP_API = "https://api.mercadopago.com";

// Llave de Mercado Pago del PRESTADOR (OAuth). Con ella se crea el cobro: la plata entra a SU cuenta y la comisión
// (marketplace_fee) va a la cuenta de TuTiempo, dueña de la aplicación (MP_CLIENT_ID). Las llaves duran 180 días:
// si faltan menos de `days` días, se renueva con el refresh_token y se guarda la nueva (MP entrega un refresh_token nuevo cada vez).
export async function sellerToken(db: SupabaseClient, pid: number, days = 15): Promise<string | null> {
  const { data: sec } = await db.from("provider_secrets").select("mp_access_token, mp_refresh_token, mp_expires_at").eq("provider_id", pid).maybeSingle();
  if (!sec?.mp_access_token) return null;
  const left = sec.mp_expires_at ? new Date(sec.mp_expires_at).getTime() - Date.now() : Infinity;
  if (left > days * 864e5 || !sec.mp_refresh_token) return left > 0 ? sec.mp_access_token : null;
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: sec.mp_refresh_token }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) {
    console.error("MP refresh", pid, r.status);
    if (left <= 0) await db.from("provider_private").update({ mp_connected: false }).eq("provider_id", pid);   // venció: tiene que reconectar
    return left > 0 ? sec.mp_access_token : null;
  }
  await db.from("provider_secrets").update({
    mp_access_token: tok.access_token, mp_refresh_token: tok.refresh_token ?? sec.mp_refresh_token,
    mp_expires_at: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null,
  }).eq("provider_id", pid);
  return tok.access_token;
}

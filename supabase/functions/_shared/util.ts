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

// ---------- Claves del proyecto ----------
// Proyectos nuevos: claves publishable/secret (sb_publishable_…, sb_secret_…), que Supabase inyecta en las funciones como
// JSON por nombre en SUPABASE_PUBLISHABLE_KEYS y SUPABASE_SECRET_KEYS ({"default":"sb_…"}); las viejas (SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY) pueden estar desactivadas. Proyectos viejos: solo las viejas. Se usa la nueva si está.
function namedKey(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (!v.startsWith("{") && !v.startsWith("[")) return v;
  try {
    const o = JSON.parse(v);
    if (Array.isArray(o)) return typeof o[0] === "string" ? o[0] : "";
    if (o && typeof o === "object") {
      const k = typeof o.default === "string" ? o.default : Object.values(o).find((x) => typeof x === "string");
      return (k as string) ?? "";
    }
  } catch { /* no es JSON */ }
  return "";
}
export function projectKey(kind: "publishable" | "secret"): string {
  const fresh = namedKey(Deno.env.get(kind === "secret" ? "SUPABASE_SECRET_KEYS" : "SUPABASE_PUBLISHABLE_KEYS") ?? "");
  const legacy = (Deno.env.get(kind === "secret" ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY") ?? "").trim();
  const key = fresh || legacy;
  if (!key) throw new Error(kind === "secret" ? "Falta SUPABASE_SECRET_KEYS o SUPABASE_SERVICE_ROLE_KEY" : "Falta SUPABASE_PUBLISHABLE_KEYS o SUPABASE_ANON_KEY");
  return key;
}

// Cliente con permisos totales: NUNCA se expone al navegador.
export const admin = (): SupabaseClient =>
  createClient(env("SUPABASE_URL"), projectKey("secret"), { auth: { persistSession: false } });

// ---------- Usuario que llama ----------
// Verifica el JWT de Supabase Auth que manda el navegador (supabase-js: Authorization: Bearer <access_token>).
//  - Firmado con las claves asimétricas (ES256/RS256, proyectos nuevos): se verifica acá con las claves públicas del
//    proyecto (SUPABASE_JWKS si Supabase la inyecta, si no /auth/v1/.well-known/jwks.json), sin depender de una apikey.
//  - HS256 (proyectos viejos, secreto compartido): se lo pregunta a Auth (/auth/v1/user) con la clave publishable o anon.
// Si rechaza, deja en el log el motivo exacto, nunca el token.
export type Caller = { id: string; email: string | null };
const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Jwk = { kty?: string; kid?: string; alg?: string; crv?: string; x?: string; y?: string; n?: string; e?: string };
let jwksCache: { at: number; keys: Jwk[] } | null = null;
async function jwks(force = false): Promise<Jwk[]> {
  const injected = Deno.env.get("SUPABASE_JWKS") ?? "";
  if (injected.trim()) {
    try {
      const o = JSON.parse(injected);
      const keys = Array.isArray(o) ? o : o?.keys;
      if (Array.isArray(keys) && keys.length) return keys;
    } catch { /* formato desconocido: se pide al proyecto */ }
  }
  if (!force && jwksCache && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/.well-known/jwks.json`);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const keys = ((await r.json())?.keys ?? []) as Jwk[];
  jwksCache = { at: Date.now(), keys };
  return keys;
}
async function verifyAsymmetric(alg: string, kid: string | undefined, signed: string, sig: Uint8Array): Promise<"ok" | "bad_signature" | "unknown_kid"> {
  for (const force of [false, true]) {   // una clave nueva (rotación): se vuelve a pedir la lista una vez
    const keys = (await jwks(force)).filter((k) => (!kid || k.kid === kid) && (alg === "ES256" ? k.kty === "EC" : k.kty === "RSA"));
    if (!keys.length) continue;
    for (const k of keys) {
      const jwk = alg === "ES256" ? { kty: "EC", crv: k.crv ?? "P-256", x: k.x, y: k.y } : { kty: "RSA", n: k.n, e: k.e };
      const params = alg === "ES256" ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      const key = await crypto.subtle.importKey("jwk", jwk, params, false, ["verify"]);
      const good = await crypto.subtle.verify(alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5", key, sig, new TextEncoder().encode(signed));
      if (good) return "ok";
    }
    return "bad_signature";
  }
  return "unknown_kid";
}

export async function caller(req: Request): Promise<Caller | null> {
  const reject = (reason: string, info: Record<string, unknown> = {}) => {
    console.warn(`caller: rechazado (${reason})`, JSON.stringify(info));
    return null;
  };
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return reject("sin_authorization");
  if (!/^Bearer /i.test(auth)) return reject("authorization_sin_bearer");
  const token = auth.slice(7).trim();
  const parts = token.split(".");
  // sin sesión, supabase-js manda la clave publishable (no es un JWT) o la anon (un JWT con role anon)
  if (parts.length !== 3) return reject("no_es_jwt", { prefijo: token.startsWith("sb_") ? token.split("_").slice(0, 2).join("_") : "otro" });
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return reject("jwt_ilegible");
  }
  const alg = String(header.alg ?? ""), kid = typeof header.kid === "string" ? header.kid : undefined;
  const now = Math.floor(Date.now() / 1000), exp = Number(claims.exp);
  const info = { alg, kid, role: claims.role ?? null, iss: claims.iss ?? null, exp_en_s: Number.isFinite(exp) ? exp - now : null };
  if (claims.role !== "authenticated") return reject("rol_no_authenticated (¿sin sesión?)", info);
  if (!Number.isFinite(exp) || exp <= now) return reject("vencido", info);
  if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) return reject("sin_sub", info);

  if (alg === "ES256" || alg === "RS256") {
    // el emisor es el Auth del proyecto (con dominio propio puede no ser SUPABASE_URL: la firma es la que manda)
    if (typeof claims.iss !== "string" || !/\/auth\/v1$/.test(claims.iss)) return reject("emisor_desconocido", info);
    let res: string;
    try {
      res = await verifyAsymmetric(alg, kid, `${parts[0]}.${parts[1]}`, b64urlBytes(parts[2]));
    } catch (e) {
      res = "jwks_no_disponible";
      console.warn("caller: no se pudieron leer las claves públicas del proyecto; se le pregunta a Auth", String((e as Error)?.message ?? e));
    }
    if (res === "ok") return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
    if (res !== "jwks_no_disponible") return reject(res === "unknown_kid" ? "kid_desconocido" : "firma_invalida", info);
  } else if (alg !== "HS256") {
    return reject("alg_no_soportado", info);
  }

  // HS256 (o sin las claves públicas): Auth dice si el token es válido
  let apikey: string;
  try {
    apikey = projectKey("publishable");
  } catch (e) {
    return reject("sin_clave_publishable_ni_anon", { ...info, detalle: String((e as Error).message) });
  }
  const r = await fetch(`${env("SUPABASE_URL")}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    return reject(`auth_${r.status}`, { ...info, apikey: apikey.startsWith("sb_") ? "publishable" : "anon", error_code: b?.error_code ?? b?.code ?? null, msg: String(b?.msg ?? b?.message ?? "").slice(0, 120) });
  }
  const u = await r.json().catch(() => null);
  if (!u?.id) return reject("auth_sin_usuario", info);
  return { id: String(u.id), email: u.email ?? null };
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

// Funciones que llama solo pg_cron (o la base) con CRON_SECRET, que lee de Vault: mp-refunds y dni-cleanup. Devuelve la
// respuesta de rechazo, o null si la llamada trae la clave (ni la service_role sirve: la clave del cron solo dispara esto).
export function cronOnly(req: Request): Response | null {
  const secret = env("CRON_SECRET");
  if (secret.length < 32) { console.error("CRON_SECRET demasiado corta (mínimo 32 caracteres)"); return json({ error: "config" }, 500); }
  if (!safeEqual(req.headers.get("Authorization") ?? "", `Bearer ${secret}`)) return json({ error: "forbidden" }, 403);
  return null;
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

// ---------- Llaves cifradas (Bloque 2a, H13) ----------
// AES-256-GCM con Web Crypto. Cada valor: "v<n>:<iv>:<cifrado>" en base64, con un IV aleatorio de 12 bytes. La clave es
// MP_TOKENS_KEY (v1) o MP_TOKENS_KEY_V2, _V3… (32 bytes en base64, secretos de las funciones): se lee con cualquier
// versión y se escribe siempre con la última. Datos asociados (AAD): prestador + cuenta de MP + campo, así un valor
// copiado a otra fila u otro campo no se puede descifrar.
export class TokenError extends Error {
  constructor(public kind: "plaintext" | "undecryptable", message: string) { super(message); }
}
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function tokenKeys(): Map<number, string> {
  const keys = new Map<number, string>();
  const v1 = Deno.env.get("MP_TOKENS_KEY");
  if (v1) keys.set(1, v1);
  for (let v = 2; v <= 9; v++) {
    const k = Deno.env.get(`MP_TOKENS_KEY_V${v}`);
    if (k) keys.set(v, k);
  }
  return keys;
}
async function aesKey(version: number): Promise<CryptoKey> {
  const raw = tokenKeys().get(version);
  if (!raw) throw new TokenError("undecryptable", `Falta la clave MP_TOKENS_KEY${version === 1 ? "" : "_V" + version}`);
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error(`MP_TOKENS_KEY${version === 1 ? "" : "_V" + version} tiene que ser de 32 bytes (base64)`);
  return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
const aad = (providerId: number, mpUserId: string | null, field: string) =>
  new TextEncoder().encode(`tutiempo:${providerId}:${mpUserId ?? ""}:${field}`);
export async function encryptToken(plain: string, providerId: number, mpUserId: string | null, field: "access_token" | "refresh_token"): Promise<string> {
  const versions = [...tokenKeys().keys()];
  if (!versions.length) throw new Error("Falta la variable MP_TOKENS_KEY");
  const version = Math.max(...versions);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(providerId, mpUserId, field) }, await aesKey(version), new TextEncoder().encode(plain));
  return `v${version}:${b64(iv)}:${b64(new Uint8Array(ct))}`;
}
export async function decryptToken(value: string, providerId: number, mpUserId: string | null, field: "access_token" | "refresh_token"): Promise<string> {
  const m = /^v(\d+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) throw new TokenError("plaintext", "Llave sin cifrar");
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(m[2]), additionalData: aad(providerId, mpUserId, field) },
      await aesKey(Number(m[1])), unb64(m[3]));
    return new TextDecoder().decode(pt);
  } catch (e) {
    if (e instanceof TokenError) throw e;
    throw new TokenError("undecryptable", "No se pudo descifrar la llave (clave o datos asociados distintos)");
  }
}
// Llaves en claro de una cuenta. Una llave sin cifrar (de antes del Bloque 2a) deja la cuenta para reconectar; una que no
// se puede descifrar (clave mal cargada) solo deja el error, sin desconectar a nadie.
async function plainTokens(db: SupabaseClient, acc: MpAccount): Promise<{ access: string | null; refresh: string | null } | null> {
  try {
    return {
      access: acc.access_token ? await decryptToken(acc.access_token, acc.provider_id, acc.mp_user_id, "access_token") : null,
      refresh: acc.refresh_token ? await decryptToken(acc.refresh_token, acc.provider_id, acc.mp_user_id, "refresh_token") : null,
    };
  } catch (e) {
    const plaintext = e instanceof TokenError && e.kind === "plaintext";
    console.error("mp_accounts", acc.id, plaintext ? "llave sin cifrar: hay que reconectar la cuenta" : String(e));
    await db.rpc("mp_account_error", {
      p_account: acc.id, p_error: plaintext ? "Llave sin cifrar: hay que volver a conectar la cuenta" : String((e as Error).message).slice(0, 200),
      p_expired: plaintext,
    });
    return null;
  }
}

// Llave de una cuenta. Las llaves duran 180 días: si faltan menos de `days` días, se renueva con el refresh_token y se
// guarda la nueva (MP entrega un refresh_token nuevo cada vez y el viejo deja de servir). `charge`: solo sirve la cuenta
// activa (crear cobros). Una sola renovación a la vez por cuenta (mp_account_refresh_claim): los demás siguen con la
// llave actual mientras no venza.
const msLeft = (acc: MpAccount) => (acc.expires_at ? new Date(acc.expires_at).getTime() - Date.now() : Infinity);
async function usable(db: SupabaseClient, acc: MpAccount | null, charge?: boolean): Promise<string | null> {
  if (!acc?.access_token || acc.status === "purged" || (charge && acc.status !== "active") || msLeft(acc) <= 0) return null;
  return (await plainTokens(db, acc))?.access ?? null;
}
export async function accountToken(db: SupabaseClient, acc: MpAccount | null, opts: { days?: number; charge?: boolean } = {}): Promise<string | null> {
  const days = opts.days ?? 15;
  if (!acc || acc.status === "purged" || (opts.charge && acc.status !== "active")) return null;
  if (msLeft(acc) > days * 864e5 || !acc.refresh_token) return await usable(db, acc, opts.charge);
  const { data: claimed } = await db.rpc("mp_account_refresh_claim", { p_account: acc.id });
  // otro proceso la está renovando: la llave que haya guardada (la actual o la nueva), si sirve
  if (!claimed) return await usable(db, await accountById(db, acc.id), opts.charge);
  const release = () => db.rpc("mp_account_refresh_release", { p_account: acc.id });
  // se relee: puede que otro la haya renovado entre la lectura y la reserva
  const cur = await accountById(db, acc.id);
  if (!cur?.refresh_token || cur.status === "purged" || msLeft(cur) > days * 864e5) {
    await release();
    return await usable(db, cur, opts.charge);
  }
  const plain = await plainTokens(db, cur);
  if (!plain?.refresh) return null;   // sin cifrar o sin descifrar: ya quedó el error (y la reserva se liberó)
  const r = await fetch(`${MP_API}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), grant_type: "refresh_token", refresh_token: plain.refresh }),
  }).catch(() => null);
  const tok = r ? await r.json().catch(() => ({})) : {};
  if (r?.ok && tok.access_token) {
    await db.rpc("mp_account_refreshed", {
      p_account: cur.id,
      p_access: await encryptToken(tok.access_token, cur.provider_id, cur.mp_user_id, "access_token"),
      p_refresh: tok.refresh_token ? await encryptToken(tok.refresh_token, cur.provider_id, cur.mp_user_id, "refresh_token") : null,
      p_expires_in: Number(tok.expires_in) || 0,
    });
    return opts.charge && cur.status !== "active" ? null : tok.access_token;
  }
  // falló: si mientras tanto otro proceso ya la renovó (cambió el refresh_token), se usa esa y no hay error
  const again = await accountById(db, cur.id);
  if (again?.refresh_token && again.refresh_token !== cur.refresh_token) {
    await release();
    return await usable(db, again, opts.charge);
  }
  console.error("MP refresh", cur.id, r?.status);
  // venció y no se pudo renovar: si era la activa, deja de cobrar (tiene que reconectar)
  await db.rpc("mp_account_error", { p_account: cur.id, p_error: `No se pudo renovar la llave (${r?.status ?? "sin respuesta"})`, p_expired: msLeft(cur) <= 0 });
  return await usable(db, cur, opts.charge);
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

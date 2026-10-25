// Conexión del prestador con su cuenta de Mercado Pago (OAuth de marketplace).
//  POST /mp-oauth            → (usuario logueado) devuelve la URL de autorización.
//  GET  /mp-oauth?code&state → (vuelve de MP) guarda los tokens y redirige al sitio.
// Desplegar con verify_jwt = false: el GET lo abre el navegador al volver de MP; el POST valida el usuario adentro.
import { admin, caller, cors, env, json, MP_API } from "../_shared/util.ts";

const b64url = (a: Uint8Array) => btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.serve(async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const db = admin();
  const redirectUri = `${env("SUPABASE_URL")}/functions/v1/mp-oauth`;
  try {
    if (req.method === "POST") {
      const user = await caller(req);
      if (!user) return json({ error: "login_required" }, 401, h);
      const { data: p } = await db.from("providers").select("id").eq("owner_id", user.id).neq("status", "deleted").maybeSingle();
      if (!p) return json({ error: "not_a_provider" }, 403, h);
      const state = crypto.randomUUID();
      // PKCE: verificador secreto que se guarda acá y desafío (SHA-256) que viaja a Mercado Pago
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
      const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      await db.from("mp_oauth_states").insert({ state, provider_id: p.id, code_verifier: verifier });
      const u = new URL("https://auth.mercadopago.com/authorization");
      u.searchParams.set("client_id", env("MP_CLIENT_ID"));
      u.searchParams.set("response_type", "code");
      u.searchParams.set("platform_id", "mp");
      u.searchParams.set("state", state);
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("code_challenge", challenge);
      u.searchParams.set("code_challenge_method", "S256");
      return json({ url: u.toString() }, 200, h);
    }
    // GET: vuelta desde Mercado Pago
    const url = new URL(req.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const site = env("SITE_URL");
    const { data: st } = await db.from("mp_oauth_states").select("provider_id, created_at, code_verifier").eq("state", state).maybeSingle();
    await db.from("mp_oauth_states").delete().eq("state", state);
    if (!st || !code || Date.now() - new Date(st.created_at).getTime() > 15 * 60 * 1000) {
      return Response.redirect(`${site}/?mp_connected=0`, 302);
    }
    const r = await fetch(`${MP_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env("MP_CLIENT_ID"), client_secret: env("MP_CLIENT_SECRET"), grant_type: "authorization_code", code, redirect_uri: redirectUri,
                             ...(st.code_verifier ? { code_verifier: st.code_verifier } : {}) }),
    });
    const tok = await r.json();
    if (!r.ok || !tok.access_token) { console.error("MP oauth", r.status, tok); return Response.redirect(`${site}/?mp_connected=0`, 302); }
    // Llaves por cuenta (Bloque 1): la misma cuenta actualiza su llave; otra cuenta crea una fila nueva y la anterior queda
    // para devoluciones y consultas (mp_connect). provider_private.mp_connected lo actualiza la base.
    const { error } = await db.rpc("mp_connect", {
      p_provider: st.provider_id, p_mp_user_id: String(tok.user_id ?? ""), p_access: tok.access_token,
      p_refresh: tok.refresh_token ?? null, p_expires_in: Number(tok.expires_in) || 0,
    });
    if (error) { console.error("mp_connect", error); return Response.redirect(`${site}/?mp_connected=0`, 302); }
    return Response.redirect(`${site}/?mp_connected=1`, 302);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500, h);
  }
});

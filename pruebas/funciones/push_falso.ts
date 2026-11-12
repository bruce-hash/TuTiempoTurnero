// Servicio de push falso para probar push-send (Bloque C): hace de Google/Mozilla/Apple y del navegador a la vez.
// Cada "dispositivo" tiene sus claves (p256dh y auth, como las que da el navegador) y un endpoint propio. Al recibir un
// mensaje comprueba lo mismo que un servicio de verdad: Authorization VAPID (RFC 8292: JWT ES256 firmado con la clave k,
// para su origen, vigente y por menos de 24 h), Content-Encoding aes128gcm y TTL; después lo descifra con la clave
// privada del dispositivo (RFC 8291), como el navegador. Se le puede pedir que responda con otro código (410, 500, 403…).
import { b64u, decrypt, unb64u, vapidVerify } from "../../supabase/functions/_shared/webpush.ts";

export type Recibido = { device: string; status: number; vapidOk: boolean; vapidWhy: string; ttl: number; urgency: string | null; topic: string | null; encoding: string | null; size: number; payload: any };

export function pushFalso(vapidPublic: string) {
  const devices = new Map<string, { publicRaw: Uint8Array; d: Uint8Array; auth: Uint8Array; respond: number[] }>();
  const recibidos: Recibido[] = [];
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    const id = url.pathname.replace(/^\/push\//, "");
    const dev = devices.get(id);
    if (req.method !== "POST" || !dev) return new Response("no existe", { status: 404 });
    const raw = new Uint8Array(await req.arrayBuffer());
    const auth = req.headers.get("Authorization") ?? "";
    const m = auth.match(/^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/);
    let vapidOk = false, vapidWhy = "sin Authorization vapid";
    if (m) {
      const v = await vapidVerify(m[1], m[2]);
      const now = Date.now() / 1000;
      vapidWhy = !v ? "firma inválida" : m[2] !== vapidPublic ? "otra clave" : v.claims.aud !== url.origin ? "aud" : !(Number(v.claims.exp) > now && Number(v.claims.exp) <= now + 86400) ? "exp"
        : !/^mailto:|^https:\/\//.test(String(v.claims.sub)) ? "sub" : v.header.alg !== "ES256" ? "alg" : "";
      vapidOk = vapidWhy === "";
    }
    const status = dev.respond.shift() ?? (vapidOk ? 201 : 403);
    let payload: any = null;
    try { payload = JSON.parse(new TextDecoder().decode(await decrypt(raw, dev.publicRaw, dev.d, dev.auth))); } catch (e) { payload = { error: String(e) }; }
    recibidos.push({
      device: id, status, vapidOk, vapidWhy, ttl: Number(req.headers.get("TTL") ?? "-1"), urgency: req.headers.get("Urgency"),
      topic: req.headers.get("Topic"), encoding: req.headers.get("Content-Encoding"), size: raw.length, payload,
    });
    return new Response(status === 201 ? "" : "error", { status });
  });
  const origin = `http://localhost:${(server.addr as Deno.NetAddr).port}`;
  return {
    origin,
    recibidos,
    // un dispositivo nuevo: lo que el navegador le daría a la app (endpoint, p256dh, auth)
    async dispositivo(nombre: string) {
      const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
      const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
      const d = unb64u((await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
      const auth = crypto.getRandomValues(new Uint8Array(16));
      devices.set(nombre, { publicRaw, d, auth, respond: [] });
      return { endpoint: `${origin}/push/${nombre}`, p256dh: b64u(publicRaw), auth: b64u(auth) };
    },
    // los próximos mensajes a ese dispositivo responden con estos códigos
    responder(nombre: string, ...codes: number[]) { devices.get(nombre)!.respond.push(...codes); },
    cerrar: () => server.shutdown(),
  };
}

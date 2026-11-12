// Web Push (Bloque C) con WebCrypto, sin dependencias:
//  - cifrado del mensaje "aes128gcm" (RFC 8291 sobre RFC 8188): un solo registro, con las claves del dispositivo
//    (p256dh y auth de la suscripción) y un par ECDH nuevo por mensaje;
//  - VAPID (RFC 8292): un JWT ES256 firmado con la clave privada del servidor, en "Authorization: vapid t=…, k=…".
// Validado con los valores intermedios oficiales de RFC 8291 (apéndice A) y con el ejemplo de RFC 8292
// (pruebas/funciones/webpush_rfc.ts, npm run test:webpush).

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(text: string): Uint8Array {
  const s = text.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
// HKDF (RFC 5869) en dos pasos, como lo escribe RFC 8291: extract = HMAC(salt, ikm); expand de un bloque (≤ 32 octetos)
const extract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);
const expand = async (prk: Uint8Array, info: Uint8Array, length: number) => (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, length);

// clave P-256 desde su forma sin comprimir (65 octetos: 0x04 || x || y), con la privada (d) si se da
function p256Jwk(publicRaw: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("clave pública P-256 inválida");
  return { kty: "EC", crv: "P-256", x: b64u(publicRaw.slice(1, 33)), y: b64u(publicRaw.slice(33, 65)), ...(d ? { d: b64u(d) } : {}), ext: true };
}

export type Keys = { ecdhSecret: Uint8Array; prkKey: Uint8Array; keyInfo: Uint8Array; ikm: Uint8Array; prk: Uint8Array; cekInfo: Uint8Array; cek: Uint8Array; nonceInfo: Uint8Array; nonce: Uint8Array };

// las claves del mensaje (RFC 8291 §3.3 y §3.4); se exporta para comparar cada valor intermedio con el RFC
export async function deriveKeys(ecdhSecret: Uint8Array, authSecret: Uint8Array, uaPublic: Uint8Array, asPublic: Uint8Array, salt: Uint8Array): Promise<Keys> {
  const prkKey = await extract(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await expand(prkKey, keyInfo, 32);
  const prk = await extract(salt, ikm);
  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = enc.encode("Content-Encoding: nonce\0");
  return { ecdhSecret, prkKey, keyInfo, ikm, prk, cekInfo, cek: await expand(prk, cekInfo, 16), nonceInfo, nonce: await expand(prk, nonceInfo, 12) };
}

const RS = 4096; // tamaño de registro del encabezado (RFC 8291 §4: un solo registro)

export type Sender = { publicRaw: Uint8Array; privateKey: CryptoKey };
// par ECDH del servidor para un mensaje (uno nuevo cada vez, RFC 8291 §5)
export async function newSender(): Promise<Sender> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  return { publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey: pair.privateKey };
}
// par ECDH conocido (solo para comparar con los valores del RFC)
export async function senderFrom(publicRaw: Uint8Array, privateD: Uint8Array): Promise<Sender> {
  const privateKey = await crypto.subtle.importKey("jwk", p256Jwk(publicRaw, privateD), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { publicRaw, privateKey };
}

// cifra el mensaje para un dispositivo: encabezado (salt, rs, idlen, clave pública del servidor) y el registro cifrado
export async function encrypt(plaintext: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, opts: { sender?: Sender; salt?: Uint8Array } = {}): Promise<Uint8Array> {
  if (authSecret.length !== 16) throw new Error("auth inválido");
  // RFC 8291 §4: hasta 3993 octetos de texto, así el mensaje (86 de encabezado + texto + 0x02 + 16 de etiqueta) entra en 4096
  if (plaintext.length > 3993) throw new Error("mensaje demasiado largo");
  const sender = opts.sender ?? await newSender();
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const uaKey = await crypto.subtle.importKey("jwk", p256Jwk(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256));
  const k = await deriveKeys(ecdhSecret, authSecret, uaPublic, sender.publicRaw, salt);
  const cek = await crypto.subtle.importKey("raw", k.cek, "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: k.nonce }, cek, concat(plaintext, new Uint8Array([2]))));
  const header = concat(salt, new Uint8Array([(RS >>> 24) & 255, (RS >>> 16) & 255, (RS >>> 8) & 255, RS & 255, 65]), sender.publicRaw);
  return concat(header, record);
}

// descifra (lo hace el navegador; acá lo usan las pruebas y el servicio de push falso)
export async function decrypt(body: Uint8Array, uaPublic: Uint8Array, uaPrivateD: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16), idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen), record = body.slice(21 + idlen);
  const uaKey = await crypto.subtle.importKey("jwk", p256Jwk(uaPublic, uaPrivateD), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const asKey = await crypto.subtle.importKey("jwk", p256Jwk(asPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaKey, 256));
  const k = await deriveKeys(ecdhSecret, authSecret, uaPublic, asPublic, salt);
  const cek = await crypto.subtle.importKey("raw", k.cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: k.nonce }, cek, record));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  if (end < 0 || padded[end] !== 2) throw new Error("delimitador inválido");
  return padded.slice(0, end);
}

// ---------- VAPID (RFC 8292) ----------
export type Vapid = { publicKey: string; privateKey: CryptoKey; subject: string };

// claves del servidor: la pública sin comprimir y la privada (d), las dos en base64url (las que da npm run vapid)
export async function vapidKeys(publicB64: string, privateB64: string, subject: string): Promise<Vapid> {
  const pub = unb64u(publicB64), d = unb64u(privateB64);
  if (d.length !== 32) throw new Error("VAPID_PRIVATE_KEY inválida");
  if (!/^(mailto:|https:\/\/)/.test(subject)) throw new Error("VAPID_SUBJECT tiene que ser mailto: o https://");
  const privateKey = await crypto.subtle.importKey("jwk", p256Jwk(pub, d), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { publicKey: b64u(pub), privateKey, subject };
}

// Authorization para un servicio de push: el JWT vale para el origen del endpoint y hasta 12 horas (el máximo es 24)
export async function vapidAuthorization(endpoint: string, v: Vapid, now = Date.now()): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject })));
  // WebCrypto firma ECDSA en el formato de JWS (r || s, 64 octetos), sin DER
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.privateKey, enc.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

// comprueba un JWT VAPID con la clave k (lo hacen los servicios de push; acá, las pruebas y el servicio falso)
export async function vapidVerify(token: string, publicB64: string): Promise<{ header: Record<string, unknown>; claims: Record<string, unknown> } | null> {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const key = await crypto.subtle.importKey("jwk", p256Jwk(unb64u(publicB64)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, unb64u(s), enc.encode(`${h}.${b}`));
  if (!ok) return null;
  const dec = new TextDecoder();
  return { header: JSON.parse(dec.decode(unb64u(h))), claims: JSON.parse(dec.decode(unb64u(b))) };
}

// ---------- Servicios de push conocidos ----------
// La base solo guarda endpoints de estos servicios (push_endpoint_ok) y la función lo vuelve a mirar antes de mandar:
// así no se la puede usar para hacer pedidos a cualquier dirección.
const HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function knownEndpoint(endpoint: string, extra: string[] = []): boolean {
  try {
    const u = new URL(endpoint);
    if (extra.some((origin) => endpoint.startsWith(origin + "/"))) return true;
    return u.protocol === "https:" && !u.port && !u.username && HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

// Bloque C · el cifrado de Web Push y VAPID de supabase/functions/_shared/webpush.ts contra los vectores oficiales:
//  - RFC 8291, apéndice A ("Intermediate Values for Encryption"): con las claves y la sal del ejemplo, cada valor
//    intermedio (ecdh_secret, PRK_key, key_info, IKM, PRK, cek_info, CEK, nonce_info, NONCE), el encabezado y el
//    mensaje cifrado completo tienen que dar exactamente lo mismo; y el mensaje del RFC se descifra al texto original.
//  - RFC 8292, §2.4 (ejemplo): el JWT del RFC se verifica con su clave k, su encabezado y su cuerpo son los del RFC y la
//    clave k corresponde al JWK del ejemplo. Los JWT que firma webpush.ts se verifican igual (ES256 da firmas distintas
//    cada vez: por eso se verifica, no se compara).
// Uso: deno run --config pruebas/funciones/deno.json pruebas/funciones/webpush_rfc.ts          (npm run test:webpush)
//      … webpush_rfc.ts --rfc rfc8291.txt rfc8292.txt   además, que cada valor de acá esté tal cual en el texto del RFC
//      (el CI baja los RFC de rfc-editor.org: así los valores no pueden estar copiados mal)
import { b64u, decrypt, deriveKeys, encrypt, knownEndpoint, senderFrom, unb64u, vapidAuthorization, vapidKeys, vapidVerify } from "../../supabase/functions/_shared/webpush.ts";

let F = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};
const same = (name: string, got: Uint8Array, want: string) => ok(name, b64u(got) === want.replace(/\s+/g, ""), b64u(got));

// ---------- RFC 8291, apéndice A ----------
const V = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  as_public: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  as_private: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  ua_public: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  ua_private: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth_secret: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdh_secret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  PRK_key: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  key_info: "V2ViUHVzaDogaW5mbwAEJXGyvs3942BVGq8e0PTNNmwRzr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0EwbZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAvMBKiiujwa7t45ewP",
  IKM: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  PRK: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek_info: "Q29udGVudC1FbmNvZGluZzogYWVzMTI4Z2NtAA",
  CEK: "oIhVW04MRdy2XN9CiKLxTg",
  nonce_info: "Q29udGVudC1FbmNvZGluZzogbm9uY2UA",
  NONCE: "4h_95klXJ5E_qnoN",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  padded: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24C",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};
const pt = unb64u(V.plaintext), uaPub = unb64u(V.ua_public), asPub = unb64u(V.as_public), salt = unb64u(V.salt), auth = unb64u(V.auth_secret);
ok("RFC 8291: el texto del ejemplo es \"When I grow up, I want to be a watermelon\"", new TextDecoder().decode(pt) === "When I grow up, I want to be a watermelon");
// ECDH: con la privada del servidor y la pública del dispositivo (y al revés, el mismo secreto)
const sender = await senderFrom(asPub, unb64u(V.as_private));
const uaKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u(uaPub.slice(1, 33)), y: b64u(uaPub.slice(33)) }, { name: "ECDH", namedCurve: "P-256" }, false, []);
const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256));
same("RFC 8291: ecdh_secret", ecdh, V.ecdh_secret);
const k = await deriveKeys(ecdh, auth, uaPub, asPub, salt);
same("RFC 8291: PRK_key", k.prkKey, V.PRK_key);
same("RFC 8291: key_info", k.keyInfo, V.key_info);
same("RFC 8291: IKM", k.ikm, V.IKM);
same("RFC 8291: PRK", k.prk, V.PRK);
same("RFC 8291: cek_info", k.cekInfo, V.cek_info);
same("RFC 8291: CEK", k.cek, V.CEK);
same("RFC 8291: nonce_info", k.nonceInfo, V.nonce_info);
same("RFC 8291: NONCE", k.nonce, V.NONCE);
const body = await encrypt(pt, uaPub, auth, { sender, salt });
same("RFC 8291: encabezado de 86 octetos (sal, rs 4096, idlen 65, clave del servidor)", body.slice(0, 86), V.header);
same("RFC 8291: registro cifrado (texto + 0x02 con AES-GCM)", body.slice(86), V.ciphertext);
same("RFC 8291: mensaje completo, igual al del ejemplo", body, V.body);
ok("RFC 8291: el encabezado mide 86 octetos y el mensaje 144", body.length === 144 && unb64u(V.header).length === 86);
const back = await decrypt(unb64u(V.body), uaPub, unb64u(V.ua_private), auth);
ok("RFC 8291: el mensaje del RFC se descifra al texto original", b64u(back) === V.plaintext);
same("RFC 8291: texto con el delimitador 0x02", new Uint8Array([...pt, 2]), V.padded);
// con claves y sal nuevas (como en producción): se descifra y nunca sale dos veces igual
const random1 = await encrypt(pt, uaPub, auth), random2 = await encrypt(pt, uaPub, auth);
ok("cifrado con claves nuevas: se descifra con la clave del dispositivo", b64u(await decrypt(random1, uaPub, unb64u(V.ua_private), auth)) === V.plaintext);
ok("cifrado con claves nuevas: cada mensaje es distinto (sal y par ECDH nuevos)", b64u(random1) !== b64u(random2) && b64u(random1.slice(0, 16)) !== b64u(random2.slice(0, 16)));
let tampered = false;
try { const bad = random1.slice(); bad[bad.length - 1] ^= 1; await decrypt(bad, uaPub, unb64u(V.ua_private), auth); } catch { tampered = true; }
ok("cifrado: un mensaje alterado no se descifra (etiqueta de AES-GCM)", tampered);
let wrongAuth = false;
try { await decrypt(random1, uaPub, unb64u(V.ua_private), crypto.getRandomValues(new Uint8Array(16))); } catch { wrongAuth = true; }
ok("cifrado: con otro auth no se descifra", wrongAuth);
let tooLong = false;
try { await encrypt(new Uint8Array(3994), uaPub, auth); } catch { tooLong = true; }
ok("cifrado: hasta 3993 octetos el mensaje mide 4096; más, se rechaza (RFC 8291 §4)", tooLong && (await encrypt(new Uint8Array(3993), uaPub, auth)).length === 4096);

// ---------- RFC 8292, §2.4 ----------
const R = {
  t: "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.eyJhdWQiOiJodHRwczovL3B1c2guZXhhbXBsZS5uZXQiLCJleHAiOjE0NTM1MjM3NjgsInN1YiI6Im1haWx0bzpwdXNoQGV4YW1wbGUuY29tIn0.i3CYb7t4xfxCDquptFOepC9GAu_HLGkMlMuCGSK2rpiUfnK9ojFwDXb1JrErtmysazNjjvW2L9OkSSHzvoD1oA",
  k: "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
  x: "DUfHPKLVFQzVvnCPGyfucbECzPDa7rWbXriLcysAjEc",
  y: "F6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs",
};
const verified = await vapidVerify(R.t, R.k);
ok("RFC 8292: el JWT del ejemplo se verifica con su clave k (ES256, firma r||s de 64 octetos)", !!verified && unb64u(R.t.split(".")[2]).length === 64);
ok("RFC 8292: encabezado { typ: JWT, alg: ES256 }", !!verified && verified.header.typ === "JWT" && verified.header.alg === "ES256");
ok("RFC 8292: cuerpo { aud, exp: 1453523768, sub }", !!verified && verified.claims.aud === "https://push.example.net" && verified.claims.exp === 1453523768 && verified.claims.sub === "mailto:push@example.com");
const kRaw = unb64u(R.k);
ok("RFC 8292: la clave k es el JWK del ejemplo (x, y)", kRaw.length === 65 && kRaw[0] === 4 && b64u(kRaw.slice(1, 33)) === R.x && b64u(kRaw.slice(33)) === R.y);
const sigBytes = unb64u(R.t.split(".")[2]); sigBytes[10] ^= 1;
const forged = R.t.split(".").slice(0, 2).join(".") + "." + b64u(sigBytes);
ok("RFC 8292: con la firma alterada no se verifica", (await vapidVerify(forged, R.k)) === null);
// los nuestros: el mismo formato, verificables con la pública, para el origen del endpoint y por 12 horas
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const d = unb64u((await crypto.subtle.exportKey("jwk", pair.privateKey)).d!);
const v = await vapidKeys(b64u(pubRaw), b64u(d), "mailto:contacto@tutiempo.com.ar");
const now = Date.UTC(2026, 9, 28, 15, 0, 0);
const authz = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc123", v, now);
const m = authz.match(/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/);
ok("VAPID propio: Authorization con el formato de RFC 8292 (vapid t=…, k=…)", !!m && m[2] === b64u(pubRaw));
const mine = m ? await vapidVerify(m[1], m[2]) : null;
ok("VAPID propio: se verifica con la clave pública", !!mine);
ok("VAPID propio: aud = origen del endpoint, sub = el contacto, exp = 12 horas", !!mine && mine.claims.aud === "https://fcm.googleapis.com" && mine.claims.sub === "mailto:contacto@tutiempo.com.ar" && mine.claims.exp === now / 1000 + 12 * 3600 && mine.header.alg === "ES256");
let badSub = false;
try { await vapidKeys(b64u(pubRaw), b64u(d), "contacto@tutiempo.com.ar"); } catch { badSub = true; }
ok("VAPID: el contacto tiene que ser mailto: o https:// (RFC 8292 §2.1)", badSub);

// ---------- Servicios de push conocidos ----------
for (const [url, want] of [
  ["https://fcm.googleapis.com/fcm/send/abc", true], ["https://updates.push.services.mozilla.com/wpush/v2/abc", true],
  ["https://web.push.apple.com/QGx", true], ["https://wns2-bn3p.notify.windows.com/w/?token=x", true],
  ["http://fcm.googleapis.com/fcm/send/abc", false], ["https://fcm.googleapis.com:8443/x", false], ["https://evil.com/fcm.googleapis.com", false],
  ["https://fcm.googleapis.com.evil.com/x", false], ["https://user@fcm.googleapis.com/x", false], ["https://169.254.169.254/latest", false], ["no es una url", false],
] as [string, boolean][]) {
  ok(`endpoint ${want ? "aceptado" : "rechazado"}: ${url}`, knownEndpoint(url) === want);
}

// ---------- Contra el texto de los RFC (CI) ----------
const rfcAt = Deno.args.indexOf("--rfc");
if (rfcAt >= 0) {
  const flat = (file: string) => Deno.readTextFileSync(file).replace(/\s+/g, "");
  const r8291 = flat(Deno.args[rfcAt + 1]), r8292 = flat(Deno.args[rfcAt + 2]);
  ok("RFC 8291 bajado de rfc-editor.org", r8291.includes("MessageEncryptionforWebPush") && r8291.includes("RFC8291"));
  for (const [name, value] of Object.entries(V)) {
    // el RFC parte algunos valores en varias líneas; el texto con el 0x02 y el cifrado aparecen dentro de una frase
    ok(`RFC 8291: ${name} está tal cual en el RFC`, r8291.includes(value));
  }
  ok("RFC 8292 bajado de rfc-editor.org", r8292.includes("VoluntaryApplicationServerIdentification") && r8292.includes("RFC8292"));
  for (const [name, value] of Object.entries(R)) ok(`RFC 8292: ${name} está tal cual en el RFC`, r8292.includes(value));
}

console.log(F ? `${F} FALLAS` : "TODO OK");
Deno.exit(F ? 1 : 0);

// Bloque C · genera un par de claves VAPID (P-256) para las notificaciones push. Una vez por entorno (prueba y producción).
// Uso: npm run vapid   → muestra la pública (va en config.js como vapidPublicKey y en el secreto VAPID_PUBLIC_KEY) y la
// privada (solo en el secreto VAPID_PRIVATE_KEY de Supabase: nunca en config.js ni en el repo). No guarda nada en disco.
import { webcrypto as crypto } from "node:crypto";

const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
console.log(`Clave pública  (config.js → vapidPublicKey, y secreto VAPID_PUBLIC_KEY):\n  ${publicKey}\n`);
console.log(`Clave privada  (solo el secreto VAPID_PRIVATE_KEY de Supabase; no la compartas ni la guardes en el repo):\n  ${privateKey}\n`);
console.log("Comando para Supabase (en la carpeta del proyecto, con el proyecto vinculado):");
console.log(`  supabase secrets set VAPID_PUBLIC_KEY=${publicKey} VAPID_PRIVATE_KEY=${privateKey} VAPID_SUBJECT=mailto:contacto@tutiempo.com.ar`);

// Manda las notificaciones push (Bloque C, D27): lo que la base dejó en push_outbox (avisos del cliente, nuevas reservas,
// cancelaciones del cliente y avisos de cobros del prestador). Pide los pendientes (push_due, con el texto mínimo ya
// armado), cifra cada uno para su dispositivo (aes128gcm, RFC 8291), lo firma con VAPID (RFC 8292) y avisa cada resultado
// (push_result): 404/410 borra la suscripción, 429 y 5xx reintentan, el resto falla.
// La llaman la base en el momento (pg_net, al encolar) y pg_cron cada minuto (public.run_push_send), con CRON_SECRET;
// cualquier otra llamada se rechaza.
// Secretos: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (npm run vapid) y VAPID_SUBJECT (mailto:contacto@…). PUSH_TEST_ORIGINS existe
// solo para las pruebas (un servicio de push falso): sin ese secreto, solo los servicios de push conocidos.
// En los logs, el resultado y el servicio; nunca el contenido ni el endpoint completo.
import { admin, cronOnly, json } from "../_shared/util.ts";
import { encrypt, knownEndpoint, unb64u, vapidAuthorization, vapidKeys, type Vapid } from "../_shared/webpush.ts";

const TEST_ORIGINS = (Deno.env.get("PUSH_TEST_ORIGINS") ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
const PARALLEL = 6, TIMEOUT_MS = 10_000;

type Due = { id: number; endpoint: string; p256dh: string; auth: string; title: string; body: string; url: string; tag: string; ttl: number; urgency: string };

const host = (endpoint: string) => { try { return new URL(endpoint).host; } catch { return "?"; } };

async function deliver(e: Due, vapid: Vapid): Promise<{ status: number; error?: string }> {
  if (!knownEndpoint(e.endpoint, TEST_ORIGINS)) return { status: 400, error: "endpoint de un servicio de push desconocido" };
  let message: Uint8Array;
  try {
    // lo único que viaja: título, texto, adónde lleva y la etiqueta (el detalle se ve al abrir la app)
    message = await encrypt(new TextEncoder().encode(JSON.stringify({ title: e.title, body: e.body, url: e.url, tag: e.tag })), unb64u(e.p256dh), unb64u(e.auth));
  } catch (err) {
    return { status: 400, error: `claves del dispositivo inválidas: ${String(err).slice(0, 100)}` };
  }
  try {
    const r = await fetch(e.endpoint, {
      method: "POST",
      headers: {
        Authorization: await vapidAuthorization(e.endpoint, vapid),
        TTL: String(e.ttl),
        Urgency: e.urgency === "high" ? "high" : "normal",
        // el servicio reemplaza un aviso pendiente del mismo turno por el nuevo (RFC 8030 §5.4)
        ...(/^[A-Za-z0-9_-]{1,32}$/.test(e.tag) ? { Topic: e.tag } : {}),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
      },
      body: message,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
    return { status: r.status, error: r.ok ? undefined : `${r.status} ${text}`.trim() };
  } catch (err) {
    return { status: 0, error: `Sin respuesta del servicio de push: ${String(err).slice(0, 200)}` };
  }
}

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  let vapid: Vapid;
  try {
    vapid = await vapidKeys(Deno.env.get("VAPID_PUBLIC_KEY") ?? "", Deno.env.get("VAPID_PRIVATE_KEY") ?? "", Deno.env.get("VAPID_SUBJECT") ?? "");
  } catch (err) {
    console.error("push-send: faltan o están mal VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT:", String(err));
    return json({ error: "config" }, 500);
  }
  const db = admin();
  const { data: rows, error } = await db.rpc("push_due", { p_limit: 100 });
  if (error) { console.error("db: falló push_due", error.code, error.message); return json({ error: "db" }, 500); }
  const queue = [...((rows as Due[]) ?? [])];
  let sent = 0, failed = 0, gone = 0;
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const res = await deliver(e, vapid);
      const { error: e2 } = await db.rpc("push_result", { p_id: e.id, p_status: res.status, p_error: res.error ?? null });
      if (e2) console.error("db: falló push_result", e.id, e2.code, e2.message);
      if (res.status >= 200 && res.status < 300) sent++;
      else if (res.status === 404 || res.status === 410) gone++;
      else failed++;
      if (res.status === 401 || res.status === 403) {
        console.error(`push ${e.id}: ${host(e.endpoint)} rechazó la firma VAPID (${res.status}): revisá que VAPID_PUBLIC_KEY coincida con vapidPublicKey de config.js`);
      } else if (!(res.status >= 200 && res.status < 300)) {
        console.error(`push ${e.id}: ${host(e.endpoint)} → ${res.error ?? res.status}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return json({ sent, gone, failed });
});

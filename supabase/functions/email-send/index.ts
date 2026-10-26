// Manda por email los avisos de la app (Bloque 3, H07): confirmación, recordatorios de 24 h y de 2 h, reseña, cumpleaños y
// cancelaciones, con el mismo texto que el cliente ve en Mis turnos. La cola la llena la base (email_outbox, desde
// client_messages); esta función pide los pendientes (emails_due), los manda con Resend y avisa cada resultado
// (email_result), que decide los reintentos. Cada email lleva su clave de idempotencia: si un reintento llega a Resend
// después de un envío que sí salió, no sale dos veces.
// La llama pg_cron cada 5 minutos (public.run_email_send) con CRON_SECRET; cualquier otra llamada se rechaza.
// Secretos: RESEND_API_KEY, EMAIL_FROM ("TuTiempo <avisos@tutiempo.com.ar>") y EMAIL_REPLY_TO (soporte). EMAIL_API_URL
// existe solo para las pruebas (un Resend falso): sin ese secreto, la API real.
import { admin, cronOnly, json } from "../_shared/util.ts";
import { renderNotice } from "../_shared/email.ts";

const API = (Deno.env.get("EMAIL_API_URL") ?? "").replace(/\/+$/, "") || "https://api.resend.com";
// Resend acepta 2 pedidos por segundo
const GAP_MS = Number(Deno.env.get("EMAIL_GAP_MS") ?? "550");

type Due = { id: number; to_email: string; subject: string; body: string; provider_name: string; site_url: string };

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  const key = Deno.env.get("RESEND_API_KEY") ?? "", from = Deno.env.get("EMAIL_FROM") ?? "";
  const replyTo = Deno.env.get("EMAIL_REPLY_TO") ?? "";
  if (!key || !from) { console.error("email-send: faltan RESEND_API_KEY o EMAIL_FROM"); return json({ error: "config" }, 500); }
  const db = admin();
  const { data: rows, error } = await db.rpc("emails_due", { p_limit: 50 });
  if (error) return json({ error: error.message }, 500);
  let sent = 0, failed = 0;
  for (const [i, e] of ((rows as Due[]) ?? []).entries()) {
    if (i > 0 && GAP_MS > 0) await new Promise((ok) => setTimeout(ok, GAP_MS));
    const { html, text } = renderNotice(e);
    let result: { ok: boolean; id?: string; error?: string; permanent?: boolean };
    try {
      const r = await fetch(`${API}/emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `tt-email-${e.id}` },
        // el asunto lleva el nombre del negocio: sin saltos de línea (es un encabezado del email)
        body: JSON.stringify({ from, to: [e.to_email], subject: e.subject.replace(/[\r\n]+/g, " "), html, text, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      result = r.ok && body.id
        ? { ok: true, id: String(body.id) }
        // 400 y 422: el email está mal (dirección inválida, por ejemplo) y reintentar no lo arregla
        : { ok: false, error: `${r.status} ${body.message ?? body.name ?? ""}`.trim().slice(0, 300), permanent: r.status === 400 || r.status === 422 };
    } catch (err) {
      result = { ok: false, error: `Sin respuesta de Resend: ${String(err).slice(0, 200)}` };
    }
    const { error: e2 } = await db.rpc("email_result", {
      p_id: e.id, p_ok: result.ok, p_provider_message_id: result.id ?? null, p_error: result.error ?? null, p_permanent: result.permanent ?? false,
    });
    if (e2) console.error("email_result", e.id, e2);
    if (result.ok) sent++; else { failed++; console.error("email", e.id, result.error); }
  }
  return json({ sent, failed });
});

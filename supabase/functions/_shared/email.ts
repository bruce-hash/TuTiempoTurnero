// Email de un aviso de la app (Bloque 3): el mismo texto que el cliente ve en Mis turnos, con los links al sitio tocables,
// el único botón (Ver mis turnos, en el sitio) y un pie con el link a Mi perfil para dejar de recibir los recordatorios.
// Versión HTML (todo el texto escapado) y de texto plano.

export type EmailNotice = { subject: string; body: string; provider_name: string; site_url: string };

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const escRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Todo el texto del aviso (plantilla del prestador, nombre del negocio, dirección) llega escapado. Solo los links al
// sitio, los que arma la base con la dirección del sitio (/<slug>, /p/<id>), quedan tocables; cualquier otra dirección
// (por ejemplo, una que el prestador escribió en su plantilla) queda como texto.
const linkSite = (html: string, site: string) =>
  html.replace(new RegExp(escRe(esc(site)) + "(?:/[A-Za-z0-9_/-]*)?", "g"), (url) => `<a href="${url}" style="color:#4338ca">${url}</a>`);

export function renderNotice(n: EmailNotice): { html: string; text: string } {
  const site = n.site_url.replace(/\/+$/, "");
  const profile = `${site}/cuenta`;
  const footer = "Recibís este email por tus turnos en TuTiempo.";
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#71717a">${esc(n.provider_name)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(n.subject)}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;white-space:pre-line">${linkSite(esc(n.body), site)}</p>
<p style="margin:0"><a href="${esc(site)}/mis-turnos" style="display:inline-block;background:#4338ca;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:15px">Ver mis turnos</a></p>
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#71717a;text-align:center">${footer}<br><a href="${esc(profile)}" style="color:#71717a">Dejar de recibir estos emails</a></p>
</body></html>`;
  const text = `${n.body}\n\nVer mis turnos: ${site}/mis-turnos\n\n--\n${footer}\nDejar de recibir estos emails: ${profile}\n`;
  return { html, text };
}

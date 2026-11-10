// Email de un aviso de la app (Bloque 3; con la marca desde C04: logo arriba, que es un PNG del sitio porque los emails
// no muestran SVG, y la paleta del manual): el mismo texto que el cliente ve en Mis turnos, con los links al sitio tocables,
// el único botón (Ver mis turnos, en el sitio) y un pie con el link a Mi perfil. Versión HTML (todo el texto escapado) y
// de texto plano.
// optional: recordatorios, reseña y cumpleaños (el cliente los apaga en Mi perfil: "Dejar de recibir estos emails"). La
// confirmación y las cancelaciones llegan siempre: su pie dice dónde se apagan los recordatorios y novedades.
// for_provider (10/11, D43): un aviso al profesional sobre su cuenta (suspendida / activa de nuevo): el botón lleva a su
// panel, el pie dice que es por su negocio y trae cómo escribirle a TuTiempo (WhatsApp y email). Llega siempre.

export type EmailNotice = { subject: string; body: string; provider_name: string; site_url: string; optional: boolean; for_provider?: boolean };

// contacto de TuTiempo (el mismo del aviso fijo del panel: src/views/prestador/suspendida.js)
const WHATSAPP = "https://wa.me/5492284722825";
const CONTACT = "contacto@tutiempo.com.ar";

const esc = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const escRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Todo el texto del aviso (plantilla del prestador, nombre del negocio, dirección) llega escapado. Solo los links al
// sitio, los que arma la base con la dirección del sitio (/<slug>, /p/<id>), quedan tocables; cualquier otra dirección
// (por ejemplo, una que el prestador escribió en su plantilla) queda como texto.
const linkSite = (html: string, site: string) =>
  html.replace(new RegExp(escRe(esc(site)) + "(?:/[A-Za-z0-9_/-]*)?", "g"), (url) => `<a href="${url}" style="color:#0440F3">${url}</a>`);

export function renderNotice(n: EmailNotice): { html: string; text: string } {
  const site = n.site_url.replace(/\/+$/, "");
  const profile = `${site}/cuenta`;
  const pro = !!n.for_provider;
  const footer = pro ? "Recibís este email por tu negocio en TuTiempo." : "Recibís este email por tus turnos en TuTiempo.";
  const button = pro ? { url: `${site}/panel/agenda`, label: "Ir a mi panel" } : { url: `${site}/mis-turnos`, label: "Ver mis turnos" };
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(n.subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#F8F5F1;font-family:Arial,Helvetica,sans-serif;color:#04122E">
<div style="max-width:520px;margin:0 auto 14px;text-align:center"><img src="${esc(site)}/icons/logo-email.png" width="150" height="101" alt="TuTiempo" style="display:block;margin:0 auto;border:0;width:150px;height:auto"></div>
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;border:1px solid #e6e1d9">
<p style="margin:0 0 4px;font-size:13px;color:#4a5468">${esc(n.provider_name)}</p>
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${esc(n.subject)}</h1>
<p style="margin:0 0 20px;font-size:16px;line-height:1.5;white-space:pre-line">${linkSite(esc(n.body), site)}</p>
<p style="margin:0"><a href="${esc(button.url)}" style="display:inline-block;background:#0440F3;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:15px">${button.label}</a></p>${pro
    ? `\n<p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#4a5468">¿Dudas? Escribinos por <a href="${WHATSAPP}" style="color:#0440F3">WhatsApp</a> o a <a href="mailto:${CONTACT}" style="color:#0440F3">${CONTACT}</a>.</p>`
    : ""}
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#4a5468;text-align:center">${footer}<br><b style="color:#0440F3;letter-spacing:.04em">TU TIEMPO. SU SOLUCIÓN. AL INSTANTE.</b>${pro
    ? ""
    : `<br>${n.optional
      ? `<a href="${esc(profile)}" style="color:#4a5468">Dejar de recibir estos emails</a>`
      : `Recordatorios y novedades: <a href="${esc(profile)}" style="color:#4a5468">Mi perfil</a>`}`}</p>
</body></html>`;
  const text = pro
    ? `${n.body}\n\nIr a mi panel: ${button.url}\n¿Dudas? WhatsApp: ${WHATSAPP} · ${CONTACT}\n\n--\n${footer}\n`
    : `${n.body}\n\nVer mis turnos: ${site}/mis-turnos\n\n--\n${footer}\n` +
      (n.optional ? `Dejar de recibir estos emails: ${profile}\n` : `Recordatorios y novedades: Mi perfil (${profile})\n`);
  return { html, text };
}

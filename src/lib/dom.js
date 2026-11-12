export const $ = (selector) => document.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"]/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[ch],
  );
// Iniciales para los avatares sin foto (hasta dos letras; "?" si no hay nombre).
export const ini = (name) =>
  String(name || "")
    .replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "?";
// Solo redirige al propio sitio o a Mercado Pago / Mercado Libre, y solo por http(s).
export function safeRedirect(target) {
  let url;
  try {
    url = new URL(target, location.href);
  } catch (err) {
    throw new Error("Dirección inválida");
  }
  if (
    (url.origin !== location.origin &&
      !/(^|\.)mercadopago\.com(\.ar)?$/.test(url.hostname) &&
      !/(^|\.)mercadolibre\.com(\.ar)?$/.test(url.hostname)) ||
    !/^https?:$/.test(url.protocol)
  ) {
    throw new Error("Redirección no permitida");
  }
  location.assign(url.href);
}

export const $ = (e) => document.querySelector(e);
export const esc = (e) =>
  String(e ?? "").replace(
    /[&<>"]/g,
    (a) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      })[a],
  );
export const ini = (e) =>
  String(e || "")
    .replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((a) => a[0].toUpperCase())
    .join("") || "?";
export function safeRedirect(e) {
  let a;
  try {
    a = new URL(e, location.href);
  } catch (s) {
    throw new Error("Dirección inválida");
  }
  if (
    (a.origin !== location.origin &&
      !/(^|\.)mercadopago\.com(\.ar)?$/.test(a.hostname) &&
      !/(^|\.)mercadolibre\.com(\.ar)?$/.test(a.hostname)) ||
    !/^https?:$/.test(a.protocol)
  ) {
    throw new Error("Redirección no permitida");
  }
  location.assign(a.href);
}

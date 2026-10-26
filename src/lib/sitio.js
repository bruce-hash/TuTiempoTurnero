// H24: la dirección del sitio con la que la base arma los links de los avisos. Solo https:// y el dominio: sin puerto,
// carpeta, parámetros ni barra al final. La misma regla que public.site_url_ok() en la base. Sin dependencias: lo
// prueba pruebas/unidad.mjs.
export const SITE_URL_RE = /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// en minúsculas y sin espacios alrededor; null si no es una dirección válida
export function siteUrl(raw) {
  const url = String(raw == null ? "" : raw).trim().toLowerCase();
  return url.length <= 100 && SITE_URL_RE.test(url) ? url : null;
}
export const SITE_URL_ERR = "Escribí solo https:// y el dominio, sin barra al final ni nada después (por ejemplo https://prueba.tutiempo.com.ar).";

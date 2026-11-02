// C02 · Recargar vuelve a la misma pantalla. Las direcciones de la app (/panel/agenda, /mis-turnos, /<slug>…) las tiene
// que devolver el servidor con index.html (el .htaccess, Bloque B). Si en algún hosting eso falla y el servidor manda
// la recarga al inicio (una redirección a "/", un 404 que lleva a la portada, un .htaccess que no se subió), la app
// igual vuelve a donde estaba: antes de irse guarda su dirección en esta pestaña (sessionStorage) y, si la recarga
// cayó en "/", arranca en la guardada. Solo en una recarga (no al abrir "/" a propósito ni en otra pestaña) y si se
// guardó hace menos de un minuto. Además deja la marca para que el panel de TuTiempo avise (serverMissedRoute).
const KEY = "tt_here";
let missed = false;

// la dirección actual, al irse de la página (también la última que dibujó el enrutador)
export function rememberHere() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ path: location.pathname + location.search, at: Date.now() }));
  } catch (err) {}
}

const isReload = () => {
  try {
    const nav = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
    return !!nav && nav.type === "reload";
  } catch (err) {
    return false;
  }
};

// adónde volver después de una recarga que cayó en el inicio, o null
export function reloadTarget() {
  if (!isReload() || location.pathname !== "/" || location.search) {
    return null;
  }
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
  } catch (err) {
    saved = null;
  }
  if (!saved || typeof saved.path !== "string" || !/^\/(?!\/)/.test(saved.path) || /[\\\s]/.test(saved.path) || saved.path === "/") {
    return null;
  }
  if (!(Date.now() - saved.at >= 0 && Date.now() - saved.at < 60000)) {
    return null;
  }
  missed = true;
  return saved.path;
}
export const serverMissedRoute = () => missed;

// para el panel de TuTiempo: ¿el servidor devuelve la app en una dirección interna? Pide /panel/agenda sin seguir
// redirecciones y sin sesión: tiene que llegar index.html (200, HTML con #app). true, false o null si no se pudo ver.
export async function checkRoutes() {
  if (missed) {
    return false;
  }
  try {
    const res = await fetch("/panel/agenda?tt-revisar=1", { redirect: "manual", cache: "no-store", credentials: "omit" });
    if (res.type === "opaqueredirect" || res.status !== 200 || !/text\/html/.test(res.headers.get("content-type") || "")) {
      return false;
    }
    return /id="app"/.test(await res.text());
  } catch (err) {
    return null;
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", rememberHere);
}

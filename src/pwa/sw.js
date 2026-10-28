// TuTiempo · service worker (Bloque C). Lo escribe el build en /sw.js con la versión y la lista de archivos de esa
// versión (vite.config.mjs, tutiempo:pwa).
// Qué hace:
//  - Guarda solo archivos de la app de este mismo sitio: los JS y CSS con hash, las fuentes, los íconos, el manifest y
//    la pantalla "Sin conexión". NUNCA guarda nada de Supabase, Mercado Pago ni Cloudflare (otro origen: ni los mira),
//    ni config.js, ni pedidos con Authorization, ni nada que no sea GET: turnos, horarios y precios salen siempre de la red.
//  - Las pantallas (navegación) van primero a la red; sin red, "Sin conexión".
//  - Cada versión usa su propia caché y borra las anteriores al activarse; se instala sola (skipWaiting) y la app se
//    recarga en un momento seguro (src/lib/pwa.js).
//  - Notificaciones push: las muestra y, al tocarlas, abre la app en la dirección del aviso.
const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = "tt-" + VERSION;
const OFFLINE = "/offline.html";

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("tt-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// lo único que se puede guardar (siempre de este sitio)
const cacheable = (url) =>
  /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(js|css)$/.test(url.pathname) ||
  /^\/(fonts|icons)\/[^/]+\.(woff2|png)$/.test(url.pathname) ||
  ["/offline.html", "/offline.js", "/manifest.webmanifest"].includes(url.pathname);

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Supabase, Mercado Pago, Cloudflare y cualquier otro sitio: directo a la red, sin pasar por acá
  if (url.origin !== self.location.origin) return;
  if (req.headers.has("Authorization")) return;
  if (req.mode === "navigate") {
    ev.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }
  // config.js, vendor/, robots.txt y el resto: a la red, como sin service worker
  if (!cacheable(url)) return;
  ev.respondWith(
    caches.match(req).then((hit) =>
      hit ||
      fetch(req).then((res) => {
        if (res.ok && res.type === "basic") {
          // solo si la caché de esta versión sigue existiendo: si una versión nueva o el freno de emergencia la
          // borraron, no se vuelve a crear
          const copy = res.clone();
          caches.has(CACHE).then((has) => has && caches.open(CACHE).then((cache) => cache.put(req, copy)));
        }
        return res;
      }),
    ),
  );
});

// ---------- Notificaciones push ----------
// el mensaje trae título, texto, adónde lleva (una dirección de la app) y la etiqueta; nada más
self.addEventListener("push", (ev) => {
  let data = {};
  try {
    data = ev.data ? ev.data.json() : {};
  } catch (err) {}
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "TuTiempo";
  const url = typeof data.url === "string" && data.url.startsWith("/") && !data.url.startsWith("//") ? data.url : "/";
  const tag = typeof data.tag === "string" && data.tag ? data.tag.slice(0, 40) : undefined;
  ev.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body.slice(0, 160) : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      lang: "es-AR",
      tag,
      renotify: !!tag,
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (ev) => {
  ev.notification.close();
  const target = new URL((ev.notification.data && ev.notification.data.url) || "/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  ev.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((client) => new URL(client.url).origin === target.origin);
      if (open) {
        return open.focus().then((client) => (client || open).navigate(target.href)).catch(() => self.clients.openWindow(target.href));
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

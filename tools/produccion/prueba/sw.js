// public_html/prueba/sw.js · desde el 12/11 la app está en https://tutiempo.com.ar. Reemplaza al service worker de la
// app de prueba: al activarse borra lo guardado, se desinstala y recarga las pestañas abiertas, que ya van a la
// redirección (.htaccess de esta carpeta) y terminan en el dominio principal.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (ev) => {
  ev.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});

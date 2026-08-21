const CACHE_NAME = "overtime-app-v38";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=38",
  "./app.js?v=38",
  "./manifest.webmanifest",
  "./quick/",
  "./quick/index.html",
  "./quick/manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/clock-out-192.png",
  "./icons/clock-out-512.png",
];
const NETWORK_FIRST_DESTINATIONS = new Set(["document", "style", "script", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const sameOrigin = requestUrl.origin === self.location.origin;
  const networkFirst = sameOrigin && (
    event.request.mode === "navigate" ||
    NETWORK_FIRST_DESTINATIONS.has(event.request.destination)
  );

  if (networkFirst) {
    event.respondWith(
      fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, copy);
        });
        return response;
      }).catch(() => caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }
        return requestUrl.pathname.includes("/quick/")
          ? caches.match("./quick/index.html")
          : caches.match("./index.html");
      }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

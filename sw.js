/* Património Familiar — Service Worker v61 */
const CACHE_NAME = "pf-cache-v61";
const ASSETS = [
  "./", "./index.html", "./styles.css", "./app.js", "./manifest.webmanifest",
  "./icon192.png", "./icon512.png",
  "./icon192-maskable.png", "./icon512-maskable.png",
  "./apple-touch-icon.png", "./apple-touch-icon-167.png",
  "./apple-touch-icon-152.png", "./apple-touch-icon-120.png",
  "./splash-430x932.png", "./splash-393x852.png", "./splash-390x844.png",
  "./splash-375x812.png", "./splash-414x896.png", "./splash-375x667.png",
  "./splash-1024x1366.png", "./splash-834x1194.png", "./splash-768x1024.png"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => k !== CACHE_NAME ? caches.delete(k) : Promise.resolve()));
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    cache.put(request, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request).then(resp => {
    cache.put(request, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => cached || new Response("Offline", { status: 503 }));
  return cached || fetchPromise;
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(networkFirst(req));
    return;
  }

  if (["script", "style", "worker", "manifest"].includes(req.destination)) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

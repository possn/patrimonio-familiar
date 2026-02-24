// Património Familiar — Service Worker (network-first for app shell)
const CACHE_VERSION = "pf-2026-02-23b";
const CACHE_STATIC = `${CACHE_VERSION}-static`;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest"
];

// install: cache app shell (fresh)
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    await cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: "reload" })));
  })());
});

// activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith("pf-") && k !== CACHE_STATIC) ? caches.delete(k) : null));
    await self.clients.claim();
  })());
});

function isAppShell(url){
  const p = url.pathname;
  return p.endsWith("/") || p.endsWith("/index.html") || p.endsWith("/app.js") || p.endsWith("/styles.css") || p.endsWith("/manifest.webmanifest");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // only handle same-origin
  if(url.origin !== self.location.origin) return;

  // navigation: network-first (stability + updates)
  if(req.mode === "navigate" || req.destination === "document"){
    event.respondWith((async () => {
      try{
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_STATIC);
        cache.put("./index.html", fresh.clone());
        return fresh;
      }catch(e){
        const cache = await caches.open(CACHE_STATIC);
        return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  // app shell files: network-first (avoid stale JS/CSS causing dead buttons)
  if(isAppShell(url)){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_STATIC);
      try{
        const fresh = await fetch(req);
        cache.put(req, fresh.clone());
        return fresh;
      }catch(e){
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  // everything else: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_STATIC);
    const cached = await cache.match(req);
    if(cached) return cached;
    const fresh = await fetch(req);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});

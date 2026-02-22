// Simple offline cache (app shell)
const CACHE = "pf-cache-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./service-worker.js",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/favicon-32.png",
  "./assets/favicon-32-dark.png",
  "./assets/apple-touch-icon.png",
  "./assets/apple-touch-icon-dark.png",
  "./assets/logo-master-1024.png",
  "./assets/splash-iphone-se-light.png",
  "./assets/splash-iphone-se-dark.png",
  "./assets/splash-iphone-8-light.png",
  "./assets/splash-iphone-8-dark.png",
  "./assets/splash-iphone-x-xs-light.png",
  "./assets/splash-iphone-x-xs-dark.png",
  "./assets/splash-iphone-xr-11-light.png",
  "./assets/splash-iphone-xr-11-dark.png",
  "./assets/splash-iphone-11-pro-max-light.png",
  "./assets/splash-iphone-11-pro-max-dark.png",
  "./assets/splash-iphone-12-13-14-light.png",
  "./assets/splash-iphone-12-13-14-dark.png",
  "./assets/splash-iphone-12-13-14-pro-max-light.png",
  "./assets/splash-iphone-12-13-14-pro-max-dark.png",
  "./assets/splash-ipad-light.png",
  "./assets/splash-ipad-dark.png",
  "./assets/splash-ipad-pro-11-light.png",
  "./assets/splash-ipad-pro-11-dark.png",
  "./assets/splash-ipad-pro-12.9-light.png",
  "./assets/splash-ipad-pro-12.9-dark.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // cache-first for same-origin
  const url = new URL(req.url);
  if (url.origin === location.origin){
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(()=>{});
        return res;
      }).catch(()=>cached))
    );
  }
});

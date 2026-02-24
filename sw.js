const CACHE = "pf-cache-20260224082237";
const CORE = [
  "./",
  "./index.html?v=20260224082237",
  "./styles.css?v=20260224082237",
  "./app.js?v=20260224082237",
  "./manifest.webmanifest?v=20260224082237"
];

self.addEventListener("install", (event)=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>null));
});

self.addEventListener("activate", (event)=>{
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("pf-cache-") && k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  if(req.method!=="GET") return;
  const url = new URL(req.url);
  // network-first for HTML, cache-first for others
  if(url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")){
    event.respondWith(fetch(req).then(res=>{
      const copy = res.clone();
      caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>null);
      return res;
    }).catch(()=>caches.match(req).then(r=>r||caches.match("./"))));
    return;
  }
  event.respondWith(caches.match(req).then(r=>r||fetch(req).then(res=>{
    const copy = res.clone();
    caches.open(CACHE).then(c=>c.put(req, copy)).catch(()=>null);
    return res;
  }).catch(()=>r)));
});

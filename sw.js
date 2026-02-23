/* Património Familiar — Service Worker
   Objetivo: permitir PWA + funcionamento offline sem quebrar libs em CDN.
   Estratégia:
   - Pre-cache do “app shell” + libs CDN na instalação (quando online)
   - Cache-first para recursos estáticos
   - Network-first para navegação HTML (para updates), com fallback cache
*/

const CACHE_VERSION = 'pf-v1.0.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// URLs que queremos precachear.
// Nota: GitHub Pages pode servir /<repo>/...; por isso usamos caminhos relativos onde possível.
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  // libs externas (CDN) — essenciais p/ a app
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.2.67/build/pdf.worker.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // cache.addAll falha se 1 URL falhar; usamos carregamento resiliente.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const req = new Request(url, { mode: 'cors' });
            const res = await fetch(req);
            if (res && res.ok) await cache.put(req, res.clone());
          } catch (_) {
            // Ignora — ficará disponível quando online.
          }
        })
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

function isHTMLRequest(request) {
  return request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // HTML: network-first (para apanhar updates), fallback para cache.
  if (isHTMLRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, res.clone());
          return res;
        } catch (_) {
          const cached = await caches.match(request);
          return cached || caches.match('./index.html');
        }
      })()
    );
    return;
  }

  // Outros recursos: cache-first, fallback network.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const res = await fetch(request);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, res.clone());
        return res;
      } catch (_) {
        return cached; // pode ser undefined
      }
    })()
  );
});

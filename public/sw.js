// FitForge Service Worker
// Macht die App offline nutzbar und beschleunigt wiederholte Ladevorgänge:
// - App-Shell (index.html) wird network-first geladen, offline aus dem Cache
// - CDN-Skripte/Styles/Fonts/Bilder werden cache-first ausgeliefert
// Firestore-/Auth-Aufrufe werden NICHT angefasst (das SDK regelt offline selbst).

const VERSION = 'v1';
const PRECACHE = 'ff-precache-' + VERSION;
const RUNTIME = 'ff-runtime-' + VERSION;
// 'ff-compiled' gehört dem App-Loader (kompilierter App-Code) – nie löschen!

const PRECACHE_URLS = [
  '/',
  '/favicon.svg',
  '/manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-storage-compat.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  'https://unpkg.com/html5-qrcode',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap',
];

// Hosts, die niemals gecacht werden dürfen (Live-Daten-APIs)
const NEVER_CACHE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(PRECACHE);
    // Einzeln cachen – ein fehlgeschlagener Download darf die Installation nicht abbrechen
    await Promise.allSettled(PRECACHE_URLS.map(url => {
      const req = url.startsWith('http')
        ? new Request(url, { mode: 'no-cors' })
        : new Request(url);
      return cache.add(req);
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => (k.startsWith('ff-precache-') || k.startsWith('ff-runtime-')) && k !== PRECACHE && k !== RUNTIME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER_CACHE_HOSTS.includes(url.hostname)) return;

  // Navigation (Seitenaufruf): network-first, offline aus dem Cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(PRECACHE);
          // Vercel liefert für alle Pfade index.html – unter '/' cachen
          cache.put('/', fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match('/');
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Statische Ressourcen: cache-first, bei Miss aus dem Netz laden und cachen
  const isStatic = ['script', 'style', 'font', 'image'].includes(req.destination);
  if (!isStatic) return;

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreVary: true });
    if (cached) return cached;
    const resp = await fetch(req);
    // Auch opaque-Responses (no-cors CDN) cachen
    if (resp && (resp.ok || resp.type === 'opaque')) {
      try {
        const cache = await caches.open(RUNTIME);
        cache.put(req, resp.clone());
      } catch (e) {}
    }
    return resp;
  })());
});

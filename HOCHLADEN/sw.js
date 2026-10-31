// Service Worker: App startet auch offline. Eigene Dateien: erst Netz (immer aktuell), sonst Cache.
// Schriften & Supabase-Bibliothek vom CDN: aus dem Cache. Supabase-API selbst: nie cachen.
const VERSION = 'ausgaben-v5';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './manifest.webmanifest',
  './app.js', './store.js', './sync.js', './ui.js', './donut.js',
  './format.js', './categories.js', './haptics.js',
  './icon-192.png', './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Immer beim Server nachfragen (GitHub Pages cacht sonst bis zu 10 Min.) – unverändert = schnelle 304-Antwort
    const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
    e.respondWith(
      fetch(fresh).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))),
    );
    return;
  }

  if (/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      })),
    );
  }
});

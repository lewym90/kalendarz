// Service worker: działanie offline, powiadomienia, obsługa kliknięć i (opcjonalnie) push z serwera.
const VERSION = 'kalendarz-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/recur.js', 'js/nlp.js', 'js/notify.js', 'js/weather.js', 'js/ui.js', 'js/editors.js', 'js/screens.js', 'js/extras.js', 'js/data/imieniny.js', 'js/ics.js', 'js/planner.js', 'js/tools.js', 'js/lock.js',
  'fonts/bricolage-grotesque-latin-wght-normal.woff2', 'fonts/bricolage-grotesque-latin-ext-wght-normal.woff2',
  'fonts/instrument-sans-latin-wght-normal.woff2', 'fonts/instrument-sans-latin-ext-wght-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Najpierw cache (szybki start), w tle odświeżanie. Zewnętrzne API (pogoda) idzie prosto do sieci.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => hit || caches.match('index.html'));
      return hit || net;
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'alarm', url });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

// Push z serwera (opcjonalny etap 2): { title, body, badge, url }.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'Kalendarz', body: e.data && e.data.text() }; }
  e.waitUntil(
    Promise.all([
      self.registration.showNotification(d.title || 'Kalendarz', { body: d.body || '', icon: 'icons/icon-192.png', tag: d.tag, data: { url: d.url || './' } }),
      typeof d.badge === 'number' && self.navigator.setAppBadge ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()) : null,
    ])
  );
});

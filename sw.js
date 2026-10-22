// Service worker: działanie offline, powiadomienia, obsługa kliknięć i (opcjonalnie) push z serwera.
const VERSION = 'kalendarz-v26';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/recur.js', 'js/nlp.js', 'js/notify.js', 'js/weather.js', 'js/ui.js', 'js/editors.js', 'js/screens.js', 'js/extras.js', 'js/data/imieniny.js', 'js/ics.js', 'js/planner.js', 'js/tools.js', 'js/lock.js', 'js/push.js', 'js/peers.js', 'js/geo.js', 'js/voice.js',
  'fonts/bricolage-grotesque-latin-wght-normal.woff2', 'fonts/bricolage-grotesque-latin-ext-wght-normal.woff2',
  'fonts/instrument-sans-latin-wght-normal.woff2', 'fonts/instrument-sans-latin-ext-wght-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(u); return c.put(u, r); })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'kalendarz-dbg').map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Kod (HTML/JS/CSS): najpierw sieć (z obejściem pamięci podręcznej przeglądarki, max 3 s), przy braku sieci — kopia offline.
// Czcionki i ikony: najpierw kopia, odświeżanie w tle. Zewnętrzne API (pogoda) idzie prosto do sieci.
const isStatic = (u) => /\.(woff2?|png|jpg|svg|ico)$/i.test(u.pathname);
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const store = (res) => { if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; };
  if (isStatic(url)) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then(store)));
    return;
  }
  e.respondWith(
    new Promise((resolve) => {
      let done = false;
      const fallback = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'));
      const t = setTimeout(() => { if (!done) fallback().then((h) => { if (h && !done) { done = true; resolve(h); } }); }, 3000);
      fetch(req, { cache: 'no-cache' }).then((res) => { if (done) return store(res); done = true; clearTimeout(t); resolve(store(res)); }).catch(() => { if (!done) { done = true; clearTimeout(t); fallback().then(resolve); } });
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

// Push z serwera: { title, body, badge, url, tag }. Diagnostykę ostatniego pusha zapisujemy w pamięci podręcznej (widać ją w Centrum).
async function dbg(msg) {
  try { const c = await caches.open('kalendarz-dbg'); await c.put('/dbg.json', new Response(JSON.stringify({ t: Date.now(), msg }))); } catch (_) { /* nic */ }
}
self.addEventListener('push', (e) => {
  let raw = '';
  try { raw = e.data ? e.data.text() : '(brak danych)'; } catch (err) { raw = `(błąd odczytu: ${err})`; }
  let d = {};
  try { d = JSON.parse(raw); } catch (_) { d = { title: 'Kalendarz', body: raw }; }
  e.waitUntil((async () => {
    try {
      await self.registration.showNotification(d.title || 'Kalendarz', { body: d.body || '', icon: 'icons/icon-192.png', tag: d.tag, data: { url: d.url || './' } });
      if (typeof d.badge === 'number' && self.navigator.setAppBadge) { if (d.badge > 0) await self.navigator.setAppBadge(d.badge); else await self.navigator.clearAppBadge(); }
      await dbg(`OK: ${raw.slice(0, 200)}`);
    } catch (err) {
      await dbg(`BŁĄD: ${err} | ${raw.slice(0, 120)}`);
      try { await self.registration.showNotification(d.title || 'Kalendarz', { body: d.body || '' }); } catch (_) { /* nic */ }
    }
  })());
});

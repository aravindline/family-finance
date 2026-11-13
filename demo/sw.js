// Service worker: keeps the app shell on the device so it opens with no network.
// Only the app's own files are cached (the tracker template for an update is always fetched fresh); financial data is never cached here (it lives encrypted in IndexedDB).
const VERSION = 'ff-demo-0.14.0';
const PREFIX = VERSION.replace(/[\d.]+$/, ''); // the demo copy uses its own prefix, so neither deletes the other's files
const SHELL = ['./', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/ctx.js', './js/ui.js', './js/views-main.js', './js/views-more.js', './js/views-update.js', './js/views-insight.js', './js/views-extra.js', './js/views-c2.js', './js/views-income.js', './js/voice.js', './js/views-v12.js', './js/views-v13.js', './js/views-v14.js', './js/upgrade.js', './js/wealth.js', './js/views-forms.js', './js/forms.js', './js/views-kite.js', './js/kite.js', './js/views-cas.js', './js/cas.js', './js/views-handover.js', './js/views-year.js', './js/views-topics.js', './js/views-move.js', './js/migrate.js', './js/extract.js', './js/bio.js', './js/vault.js', './js/crypto.js', './js/db.js', './js/fmt.js', './js/auth.js', './js/config.js', './js/graph.js', './js/sync.js', './js/xlsx.js', './js/zip.js',
  './vendor/msal-browser-3.30.0.min.js', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-192.png', './icons/maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // never touch other sites
  // the PDF reader (2 MB) is kept only after the CAS page first uses it, so installing and updating the app stays light
  const lazy = /\/vendor\/pdfjs\//.test(url.pathname);
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => {
    if (lazy && r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});

const prefix = 'xuanos-mobile:' + self.registration.scope + ':';
const version = prefix + 'v2';
const assets = [
  'index.html', 'mobile.css', 'mobile.js', 'mark.svg', 'orbit.svg',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'touch-icon.png'
];
const urls = new Set(assets.map(path => new URL(path, self.registration.scope).href));
const entry = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(
    [...urls].map(url => new Request(url, { cache: 'reload' }))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(prefix) && key !== version).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && [self.registration.scope, entry].includes(url.origin + url.pathname)) {
    event.respondWith(caches.open(version).then(async cache => (await cache.match(entry)) || fetch(request)));
  } else if (urls.has(url.href)) {
    event.respondWith(caches.open(version).then(async cache => (await cache.match(request)) || fetch(request)));
  }
});

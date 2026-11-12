// Service worker: aplikácia sa dá nainštalovať a jej súbory sa načítajú aj
// pri slabom signáli. Samotné tlmočenie internet potrebuje vždy.
const CACHE = 'tlmocnik-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'vendor/anthropic-sdk.js', 'vendor/qrcode.js',
  'js/main.js', 'js/store.js', 'js/interpreter.js', 'js/stt-client.js', 'js/tts-client.js',
  'js/soniox-rest.js', 'js/refiner.js', 'js/audio.js', 'js/mic-worklet.js',
  'js/ui/dom.js', 'js/ui/languages.js', 'js/ui/settings.js',
  'js/core/config.js', 'js/core/emitter.js', 'js/core/errors.js', 'js/core/languages.js',
  'js/core/pcm.js', 'js/core/prompt.js', 'js/core/segmenter.js', 'js/core/tag-parser.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Najprv z vyrovnávacej pamäte, na pozadí sa stiahne čerstvá verzia.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});

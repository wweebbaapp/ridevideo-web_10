// Service worker: cache the app shell so RideVideo works fully offline.
const CACHE = "ridevideo-web10-11";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./js/app.js",
  "./js/physics.js",
  "./js/gpx.js",
  "./js/video-sync.js",
  "./js/hud.js",
  "./js/charts.js",
  "./js/elevation.js",
  "./js/slope-chart.js",
  "./js/map-view.js",
  "./js/geocode.js",
  "./js/storage.js",
  "./js/trainer.js",
  "./js/intervals.js",
  "./js/interval-view.js",
  "./js/interval-zoom-chart.js",
  "./js/ui-scale.js",
  "./vendor/maplibre/maplibre-gl.css",
  "./vendor/maplibre/maplibre-gl.mjs",
  "./vendor/maplibre/maplibre-gl-shared.mjs",
  "./vendor/maplibre/maplibre-gl-worker.mjs",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  // Never cache large user video files; only serve app shell from cache.
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).catch(() => cached))
  );
});

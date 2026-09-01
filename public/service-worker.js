const APP_CACHE_PREFIX = "lumen-ai-notes-v";
// main.jsx registers this worker with a build-specific query. That changes the
// worker script URL on every release and gives each release an isolated shell
// cache, while keeping the public file host-path portable.
const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "legacy-10";
const CACHE_NAME = `${APP_CACHE_PREFIX}${BUILD_ID.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80)}`;
const MAX_EXTERNAL_IMAGES = 40;
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    // Vite fingerprints production assets. Discover those hashed files from
    // the built HTML so the first successful visit is sufficient for offline use.
    const response = await fetch("./");
    const html = await response.clone().text();
    const htmlAssets = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g))
      .map((match) => new URL(match[1], self.location.href).href)
      .filter((url) => url.startsWith(self.location.origin));
    // Only cache the entry JS/CSS at install time. Lecture bodies, search data,
    // diagrams, and other large chunks are cached when the learner first uses
    // them, keeping iPhone installation fast and storage proportional to use.
    // The worker must not become installable if the HTML's entry JS or CSS is
    // missing. Keeping the previous worker active is safer than promoting a
    // partially uploaded release and then retiring its working shell cache.
    await cache.addAll([...new Set(htmlAssets)]);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      // Other app runtimes also own Cache API namespaces. In particular,
      // WebLLM stores the explicitly downloaded on-device model there. Only
      // retire old Lumen shell caches; never erase unrelated site data during
      // a service-worker update.
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(APP_CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const cacheResponse = async (request, response, { trimExternalImages = false } = {}) => {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  if (!trimExternalImages) return;
  const external = (await cache.keys()).filter((key) => new URL(key.url).origin !== self.location.origin);
  await Promise.all(external.slice(0, Math.max(0, external.length - MAX_EXTERNAL_IMAGES)).map((key) => cache.delete(key)));
};

self.addEventListener("fetch", (event) => {
  // AI configuration and answers are live, private responses. Never cache them
  // or turn an unavailable/error response into stale application state.
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    if (event.request.destination !== "image") return;
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then(async (response) => {
        if (response.ok || response.type === "opaque") {
          await cacheResponse(event.request, response.clone(), { trimExternalImages: true });
        }
        return response;
      })),
    );
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response.ok) await cacheResponse(event.request, response.clone());
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then(async (response) => {
          if (response.ok) {
            await cacheResponse(event.request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

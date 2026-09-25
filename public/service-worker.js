const APP_CACHE_PREFIX = "lumen-ai-notes-v";
// main.jsx registers this worker with a build-specific query. That changes the
// worker script URL on every release and gives each release an isolated shell
// cache, while keeping the public file host-path portable.
const buildOf = (scriptUrl) => new URL(scriptUrl).searchParams.get("build") || "legacy-10";
const VERSIONED = new URL(self.location.href).searchParams.has("build");
const BUILD_ID = buildOf(self.location.href);
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

// The build emits the lazy route screens (Reader and its TeX renderer,
// Whiteboard, the AI studio and both tutors, the review center, the readiness
// check, storage health, device evidence) with their static imports and CSS. They are application code, so every screen must open offline after
// one online visit. Fetch the list uncached: hosts may cache non-asset files.
const ROUTE_LIST_URL = new URL("./offline-routes.json", self.location.href).href;

const readRouteList = async () => {
  const response = await fetch(`${ROUTE_LIST_URL}?build=${encodeURIComponent(BUILD_ID)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`The offline route list is unavailable (${response.status}).`);
  const list = await response.clone().json();
  if (list?.build !== BUILD_ID || typeof list.entry !== "string" || !Array.isArray(list.files)) {
    throw new Error("The offline route list belongs to a different Lumen build.");
  }
  const files = list.files.map((file) => new URL(file, self.location.href).href);
  if (files.some((url) => !url.startsWith(self.location.origin))) throw new Error("The offline route list names another origin.");
  return { entry: new URL(list.entry, self.location.href).href, files, response };
};

// cache.addAll accepts any 2xx, so a host that answers a missing chunk with
// the SPA shell would cache HTML as a script. Reject that as a missing file.
const fetchScripts = (urls) => Promise.all(urls.map(async (url) => {
  const response = await fetch(url);
  if (!response.ok || (response.headers.get("content-type") || "").includes("text/html")) {
    throw new Error(`Offline route file is missing: ${url}`);
  }
  return [url, response];
}));

// A failed install must not leave a half-filled cache behind, but it must
// never delete the cache the active worker is still serving from.
const discardFailedInstall = async () => {
  const active = self.registration.active?.scriptURL;
  if (!active || buildOf(active) !== BUILD_ID) await caches.delete(CACHE_NAME);
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // Validate the release before writing anything: this worker's build must
    // match the route list, and the HTML must boot the same entry chunk the
    // route chunks import. Otherwise fail install and keep the working worker.
    // Only a build-specific registration can match a route list; an unversioned
    // worker (a legacy registration or the Vite dev server) installs entry-only.
    const routes = VERSIONED ? await readRouteList() : null;

    // Vite fingerprints production assets. Discover those hashed files from
    // the built HTML so the first successful visit is sufficient for offline use.
    const response = await fetch("./");
    const html = await response.clone().text();
    const htmlAssets = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g))
      .map((match) => new URL(match[1], self.location.href).href)
      .filter((url) => url.startsWith(self.location.origin));
    if (routes && !htmlAssets.includes(routes.entry)) throw new Error("The app shell and offline route list come from different builds.");
    const routeResponses = routes ? await fetchScripts(routes.files.filter((url) => !htmlAssets.includes(url))) : [];

    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(APP_SHELL);
      // Install caches the entry JS/CSS and the route screens only. Lecture
      // bodies, search data, diagrams, fonts, and the on-device model runtime
      // are cached when the learner first uses them, keeping iPhone
      // installation fast and storage proportional to use. The worker must not
      // become installable if any entry or route file is missing. Keeping the
      // previous worker active is safer than promoting a partially uploaded
      // release and then retiring its working shell cache.
      await cache.addAll([...new Set(htmlAssets)]);
      await Promise.all(routeResponses.map(([url, routeResponse]) => cache.put(url, routeResponse)));
      // StorageHealth reads this copy to keep route files out of optional cleanup.
      if (routes) await cache.put(ROUTE_LIST_URL, routes.response);
    } catch (error) {
      await discardFailedInstall();
      throw error;
    }
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
  // Each shell cache keeps the route list its own install wrote. Answering
  // from, or refreshing, that copy here could store another build's list in
  // it, and optional-cache cleanup would then drop this release's screens.
  if (`${url.origin}${url.pathname}` === ROUTE_LIST_URL) return;
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

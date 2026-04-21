const CACHE_NAME = "trpg-tool-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./data.js",
  "./scenarios.html",
  "./scenario_detail.html",
  "./sessions.html",
  "./session_detail.html",
  "./characters.html",
  "./character_detail.html",
  "./manifest.json"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

function isHtmlRequest(request) {
  const url = new URL(request.url);
  return (
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname.endsWith(".html") ||
    url.pathname === "/" ||
    url.pathname.endsWith("/")
  );
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image" ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".json") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".webp") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".ico")
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const fresh = await fetch(request, { cache: "no-store" });
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const fallback = await cache.match("./index.html");
      if (fallback) return fallback;
    }

    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => null);
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  return new Response("Offline", {
    status: 503,
    statusText: "Offline"
  });
}

self.addEventListener("fetch", event => {
  const { request } = event;

  if (request.method !== "GET") return;

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isStaticAsset(request)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
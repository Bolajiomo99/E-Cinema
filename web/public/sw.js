// E-Cinema offline shell, only for Downloads: the Downloads pages and the app's static files are
// kept so downloaded films can be opened without a connection. Nothing else is cached, and
// films themselves live encrypted in IndexedDB, never here.
const CACHE = "ec-offline-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("ec-offline-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const shell = req.mode === "navigate" && (url.pathname === "/downloads" || url.pathname.startsWith("/downloads/play/"));
  const asset = url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/");
  if (shell) {
    // Network first, so the page is always fresh online; the last copy answers offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname.startsWith("/downloads/play/") ? "/downloads/play/" : "/downloads", copy));
        }
        return res;
      }).catch(() => caches.match(url.pathname.startsWith("/downloads/play/") ? "/downloads/play/" : "/downloads").then((r) => r || Response.error())),
    );
  } else if (asset) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })));
  }
});

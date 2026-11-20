// Shell: cache per version. Task data: kept until a newer version replaces it. index.bin: network first.
const V = "993a24101d-5a53d1d7";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "salt.json", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open("shell-" + V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("shell-") && k !== "shell-" + V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.endsWith("/data/index.bin")) {
    e.respondWith(fetch(e.request, { cache: "no-store" }).then((r) => { if (r.ok) { const c = r.clone(); caches.open("defter-data").then((d) => d.put(e.request, c)); } return r; })
      .catch(() => caches.open("defter-data").then((d) => d.match(e.request)).then((r) => r || Response.error())));
    return;
  }
  if (u.pathname.includes("/data/")) {
    e.respondWith(caches.open("defter-data").then((d) => d.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) d.put(e.request, r.clone()); return r; }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).catch(() => (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});

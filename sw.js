// Shell: cache per version. Task data: kept until a newer version replaces it. index.bin: network first.
const V = "17454b7ae8-afa8dbd3";
const SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "salt.json", "icon-180.png", "icon-192.png", "icon-512.png"];
// 21.11: "reload" skips the browser's HTTP cache (GitHub Pages keeps files 10 minutes), so a new version never stores old files
self.addEventListener("install", (e) => { e.waitUntil(caches.open("shell-" + V).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
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
// 21.11: gentle reminders. The Mac sends an empty push (no payload to encrypt) at most every four days, by day; the
// words are chosen here. Silent, one at a time (the same tag replaces an older one), a tap opens the app.
const MSG = [
  ["Karekî biçûk li benda te ye.", "Seni bekleyen küçük bir iş var."],
  ["Çend deqe guhdarî modela me fêrî kurmancî dike.", "Birkaç dakikalık dinleme modelimize Kurmancî öğretiyor."],
  ["Baxçeyê te li benda kulîlkeke nû ye. 🌷", "Bahçen yeni bir çiçek bekliyor."],
  ["Spas ji bo keda te! Dema te hebe, em li vir in.", "Emeğin için teşekkürler! Vaktin olursa buradayız."],
];
self.addEventListener("push", (e) => {
  let d = null; try { d = e.data ? e.data.json() : null; } catch (x) { d = null; }
  const m = MSG[Math.floor(Date.now() / 86400000) % MSG.length];
  e.waitUntil(self.registration.showNotification((d && d.title) || "Deng Defter",
    { body: (d && d.body) || m[0] + "\n" + m[1], icon: "icon-192.png", badge: "icon-192.png", tag: "deng-defter", silent: true, data: { url: "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ws) => {
    for (const w of ws) if ("focus" in w) return w.focus();
    return self.clients.openWindow("./");
  }));
});

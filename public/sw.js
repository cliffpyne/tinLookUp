// Minimal service worker — only needed so the PWA install prompt is offered.
// Network-first for everything else (this is a server-dependent app).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* let the browser do its thing */ });

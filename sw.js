/* Taper moved to pantsonmyhead.com/taper. This worker replaces the old one, clears its cache and steps aside. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll())
      .then(cs => cs.forEach(c => c.navigate("https://pantsonmyhead.com/taper/")))
  );
});

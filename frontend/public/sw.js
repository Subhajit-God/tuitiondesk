/* TuitionDesk service worker: caches ONLY the static app shell so the PWA installs and opens quickly.
   API responses (student/fee/mark data) are never cached. */
const CACHE = 'tuitiondesk-shell-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['./', './manifest.webmanifest', './icon.svg']).catch(() => {})
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* FCM delivers a push event to this registered service worker.
   Handle notification and data payloads without caching or exposing app data. */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const data = payload.data || {};
  const notification = payload.notification || data;
  const title = notification.title || data.title || 'TuitionDesk';
  const body = notification.body || data.body || 'You have a new update.';
  const target = notification.click_action || notification.url || data.url || data.link || new URL('./#/notifications', self.registration.scope).href;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      data: { url: target },
      tag: data.tag || undefined
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget = event.notification.data?.url || './';
  let targetUrl = self.location.origin + '/';
  try {
    const parsed = new URL(rawTarget, self.registration.scope);
    if (parsed.origin === self.location.origin) targetUrl = parsed.href;
  } catch (_) {
    // Keep the safe same-origin homepage.
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin || u.pathname.endsWith('config.json')) return; // network only
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) {
        const copy = r.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('./')))
  );
});

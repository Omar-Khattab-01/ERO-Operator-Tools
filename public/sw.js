self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { title: 'ERO Tool', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Trip starts soon';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'ero-trip-start',
    renotify: true,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        await client.focus();
        return;
      }
    }
    if (clients.openWindow) await clients.openWindow(targetUrl);
  })());
});

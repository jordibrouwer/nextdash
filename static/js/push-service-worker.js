/**
 * Service worker for Web Push.
 *
 * Deliberately minimal: it does not cache anything. nextDash already handles
 * stale assets with content-hashed URLs and the app-version guard, and a caching
 * service worker layered on top of that would be a second, competing answer to
 * the same problem. This worker exists only to receive push events while the
 * app is closed.
 *
 * Served from / (not /static/) so its scope covers the whole app — a worker can
 * only control pages at or below its own path.
 */

// Take over as soon as possible so a freshly granted subscription is handled by
// this version rather than waiting for every tab to close.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const DEFAULT_TITLE = 'nextDash';
const DEFAULT_ICON = '/static/nextdash-logo.png';

self.addEventListener('push', (event) => {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (err) {
            // A payload that is not JSON still deserves to reach the user, so fall
            // back to showing it as plain text rather than dropping the event.
            data = { title: DEFAULT_TITLE, body: event.data.text() };
        }
    }

    const title = data.title || DEFAULT_TITLE;
    const options = {
        body: data.body || '',
        icon: DEFAULT_ICON,
        badge: DEFAULT_ICON,
        tag: data.tag || 'nextdash',
        renotify: Boolean(data.renotify) && Boolean(data.tag),
        timestamp: data.at || Date.now(),
        data: { url: data.url || '/', kind: data.kind || '' },
    };

    // waitUntil keeps the worker alive until the notification is actually shown;
    // without it the browser may kill the worker first and show nothing.
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || '/';

    // Prefer focusing an already-open nextDash tab over opening a duplicate.
    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
            const sameOrigin = new URL(client.url).origin === self.location.origin;
            if (sameOrigin && 'focus' in client) {
                if ('navigate' in client && new URL(client.url).pathname !== target) {
                    try {
                        await client.navigate(target);
                    } catch (err) {
                        // Navigation can be refused (e.g. the tab is mid-unload);
                        // focusing what is already there is still better than nothing.
                    }
                }
                return client.focus();
            }
        }
        return self.clients.openWindow(target);
    })());
});

/**
 * Web Push client: registers the service worker, manages the browser's push
 * subscription, and keeps the server's copy fresh.
 *
 * Exposed as window.PushNotifications so the config view can drive the toggle
 * and the test button without importing anything.
 */
(function () {
    'use strict';

    const SW_URL = '/push-service-worker.js';

    // A browser can silently drop a push subscription (profile cleanup, key
    // rotation upstream). Re-sending it on load is cheap and keeps the server's
    // list accurate, so this runs on every page load once permission is granted.
    let registrationPromise = null;

    function isSupported() {
        return 'serviceWorker' in navigator
            && 'PushManager' in window
            && 'Notification' in window;
    }

    /**
     * Push requires a secure context. localhost counts as one, which is what
     * makes local development work without TLS — but a LAN IP does not, and that
     * is the single most common reason self-hosted push appears broken.
     */
    function isSecureContext() {
        return window.isSecureContext === true;
    }

    function permission() {
        return isSupported() ? Notification.permission : 'unsupported';
    }

    /** Converts the server's base64url VAPID key to the Uint8Array subscribe() wants. */
    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = window.atob(base64);
        const output = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
        return output;
    }

    function registerWorker() {
        if (!registrationPromise) {
            registrationPromise = navigator.serviceWorker.register(SW_URL, { scope: '/' });
        }
        return registrationPromise;
    }

    async function fetchPublicKey() {
        const res = await fetch('/api/push/public-key', { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error('Could not load the push key');
        return res.json();
    }

    /**
     * POSTs JSON through nextDashFetch so the X-NextDash-Token header is included
     * when the operator has set a write token. A plain fetch() would come back
     * 401 on every write endpoint and the opt-in would fail with no explanation.
     */
    async function postJSON(url, body) {
        const send = window.nextDashFetch || fetch;
        return send(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    /** A short, human-readable device name for the config list. */
    function deviceLabel() {
        const ua = navigator.userAgent || '';
        const browser = /Edg\//.test(ua) ? 'Edge'
            : /OPR\//.test(ua) ? 'Opera'
            : /Firefox\//.test(ua) ? 'Firefox'
            : /Chrome\//.test(ua) ? 'Chrome'
            : /Safari\//.test(ua) ? 'Safari'
            : 'Browser';
        const os = /Android/.test(ua) ? 'Android'
            : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
            : /Mac OS X/.test(ua) ? 'macOS'
            : /Windows/.test(ua) ? 'Windows'
            : /Linux/.test(ua) ? 'Linux'
            : '';
        return os ? `${browser} on ${os}` : browser;
    }

    async function sendSubscription(subscription) {
        const json = subscription.toJSON();
        const res = await postJSON('/api/push/subscribe', {
            endpoint: json.endpoint,
            keys: json.keys,
            label: deviceLabel(),
        });
        if (!res.ok) throw new Error(await res.text() || 'Could not register this device');
        return res.json();
    }

    /**
     * Requests notification permission, tolerating both API shapes.
     *
     * Older Safari only supports the callback form and returns undefined instead
     * of a promise; awaiting that resolves immediately with undefined and the
     * caller would treat a granted permission as a refusal.
     */
    function requestPermissionFromGesture() {
        // Already decided: return it without prompting. Re-prompting a denied
        // permission is impossible from script anyway.
        if (Notification.permission !== 'default') {
            return Promise.resolve(Notification.permission);
        }
        return new Promise((resolve) => {
            let settled = false;
            const done = (value) => {
                if (settled) return;
                settled = true;
                resolve(value || Notification.permission);
            };
            try {
                // Passing the callback and inspecting the return value covers both
                // shapes at once; whichever the browser honours resolves first.
                const maybePromise = Notification.requestPermission(done);
                if (maybePromise && typeof maybePromise.then === 'function') {
                    maybePromise.then(done, () => done(Notification.permission));
                }
            } catch (err) {
                done(Notification.permission);
            }
        });
    }

    /**
     * Subscribes this browser. Asks for permission if it has not been decided;
     * a previously denied permission cannot be re-prompted from script, so that
     * case is reported back for the UI to explain.
     */
    async function subscribe(options = {}) {
        if (!isSupported()) throw new Error('This browser does not support push notifications');
        if (!isSecureContext()) throw new Error('Push notifications require HTTPS (or localhost)');

        // Ask for permission FIRST, before any await.
        //
        // Safari ties requestPermission() to an active user gesture and drops that
        // gesture the moment the handler awaits anything. Fetching the server key
        // first — as this used to — makes Safari reject the prompt outright with
        // "Notification prompting can only be done from a user gesture", so the
        // dialog never appears and the opt-in silently does nothing. Chrome is
        // laxer, which is exactly why this is easy to get wrong.
        const permissionResult = await requestPermissionFromGesture();
        if (permissionResult !== 'granted') {
            throw new Error(permissionResult === 'denied'
                ? 'Notifications are blocked for this site. Allow them in your browser settings.'
                : 'Notification permission was dismissed');
        }

        // The one safe moment to switch push on server-side: the permission
        // prompt is answered (so the user has actually committed) and the key
        // fetch below would fail while the server switch is still off. Callers
        // that need no such change simply omit it.
        if (typeof options.beforeRegister === 'function') {
            await options.beforeRegister();
        }

        const { enabled, publicKey } = await fetchPublicKey();
        if (!enabled) throw new Error('Push notifications are disabled on the server');
        if (!publicKey) throw new Error('The server has no push key');

        let registration;
        try {
            registration = await registerWorker();
            // Wait for an active worker: subscribing against an installing worker
            // throws in some browsers.
            await navigator.serviceWorker.ready;
        } catch (err) {
            // A failed registration leaves the cached promise rejected, which would
            // make every later attempt fail without retrying.
            registrationPromise = null;
            throw new Error(`The service worker could not start: ${err.message || err}`);
        }

        let subscription = await registration.pushManager.getSubscription();
        // A subscription made with a different server key cannot receive our
        // messages, so replace it rather than reusing it.
        if (subscription && !applicationKeyMatches(subscription, publicKey)) {
            await subscription.unsubscribe();
            subscription = null;
        }
        if (!subscription) {
            try {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey),
                });
            } catch (err) {
                throw new Error(describeSubscribeFailure(err));
            }
        }

        return sendSubscription(subscription);
    }

    /**
     * Turns a raw PushManager error into something the user can act on.
     *
     * The browser's own messages are written for developers ("Registration failed
     * - permission denied") and name causes the user cannot see, so each of the
     * common ones is mapped to the setting that actually needs changing.
     */
    function describeSubscribeFailure(err) {
        const raw = String(err?.message || err || '');

        // Chrome and Firefox both block push in private/incognito windows, and
        // deliberately offer no way to feature-detect it.
        if (/permission denied/i.test(raw) && Notification.permission === 'granted') {
            return 'The browser refused to register. Private/incognito windows cannot receive push notifications — try a normal window.';
        }
        if (/push service|registration failed|AbortError/i.test(raw)) {
            return `The browser could not reach its push service. Check your connection or firewall. (${raw})`;
        }
        if (/NotAllowedError/i.test(raw) || /denied/i.test(raw)) {
            return 'Notifications are blocked for this site. Allow them in your browser settings.';
        }
        return raw || 'The browser could not register for push notifications.';
    }

    function applicationKeyMatches(subscription, publicKey) {
        const current = subscription.options?.applicationServerKey;
        if (!current) return true; // Cannot tell; assume it is fine rather than churning.
        const expected = urlBase64ToUint8Array(publicKey);
        const actual = new Uint8Array(current);
        if (actual.length !== expected.length) return false;
        return actual.every((byte, i) => byte === expected[i]);
    }

    /** Removes this browser's subscription, locally and on the server. */
    async function unsubscribe() {
        if (!isSupported()) return { removed: false };

        const registration = await navigator.serviceWorker.getRegistration(SW_URL);
        const subscription = registration ? await registration.pushManager.getSubscription() : null;
        if (!subscription) return { removed: false };

        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        const res = await postJSON('/api/push/unsubscribe', { endpoint });
        if (!res.ok) throw new Error('Could not remove this device on the server');
        return res.json();
    }

    async function isSubscribed() {
        if (!isSupported() || permission() !== 'granted') return false;
        const registration = await navigator.serviceWorker.getRegistration(SW_URL);
        if (!registration) return false;
        return Boolean(await registration.pushManager.getSubscription());
    }

    /**
     * Re-registers an existing subscription on load, so the server's list stays
     * accurate after a browser drops or rotates one. Silent by design: this runs
     * without the user asking, so a failure must not surface as an error.
     */
    async function refresh() {
        try {
            if (!isSupported() || !isSecureContext()) return;
            if (Notification.permission !== 'granted') return;

            const { enabled, publicKey } = await fetchPublicKey();
            if (!enabled || !publicKey) return;

            await registerWorker();
            await navigator.serviceWorker.ready;
            const registration = await navigator.serviceWorker.getRegistration(SW_URL);
            const subscription = registration
                ? await registration.pushManager.getSubscription()
                : null;
            if (subscription && applicationKeyMatches(subscription, publicKey)) {
                await sendSubscription(subscription);
            }
        } catch (err) {
            /* Best effort; the config page reports real problems when the user acts. */
        }
    }

    async function sendTest() {
        const res = await postJSON('/api/push/test');
        if (!res.ok) throw new Error(await res.text() || 'Could not send the test notification');
        return res.json();
    }

    window.PushNotifications = {
        isSupported,
        isSecureContext,
        permission,
        isSubscribed,
        subscribe,
        unsubscribe,
        sendTest,
        refresh,
    };

    // Keep the server's device list fresh, but never at the cost of first paint.
    if (document.readyState === 'complete') {
        setTimeout(refresh, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(refresh, 2000), { once: true });
    }
})();

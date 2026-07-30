// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Opens Behaviour → Status & health, where the push panel lives. */
async function openStatusTab(page) {
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.locator('[data-behavior-tab="status"]').click();
}

test.describe('config: browser push notifications', () => {
    test('the status tab shows the push panel with all four toggles', async ({ page }) => {
        await loadDashboard(page);
        await openStatusTab(page);

        for (const field of ['pushNotifyEnabled', 'pushNotifyMonitor', 'pushNotifyBackup', 'pushNotifyRelease']) {
            await expect(page.locator(`[data-behavior-field="${field}"]`)).toBeVisible();
        }
        await expect(page.locator('[data-behavior-field="pushNotifySubject"]')).toBeVisible();
    });

    test('the per-device control renders and reports this browser state', async ({ page }) => {
        await loadDashboard(page);
        await openStatusTab(page);

        await expect(page.locator('[data-push-toggle]')).toBeVisible();
        // The status line is filled in from the browser's own permission state,
        // so a rendered-but-empty line would mean the binding never ran.
        await expect(page.locator('[data-push-status]')).not.toBeEmpty();
    });

    test('the enable toggle persists to settings', async ({ page }) => {
        await loadDashboard(page);
        await openStatusTab(page);

        const toggle = page.locator('[data-behavior-field="pushNotifyEnabled"]');
        const wasChecked = await toggle.isChecked();
        await toggle.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.pushNotifyEnabled))
            .toBe(!wasChecked);

        // And it survives a reload, i.e. it really reached the server.
        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.pushNotifyEnabled))
            .toBe(!wasChecked);
    });

    test('the service worker is served from the site root', async ({ page }) => {
        const res = await page.request.get('/push-service-worker.js');
        expect(res.status()).toBe(200);
        expect(res.headers()['content-type']).toContain('javascript');
        expect(await res.text()).toContain("addEventListener('push'");
    });

    test('the public key endpoint answers with the enabled state', async ({ page }) => {
        const res = await page.request.get('/api/push/public-key');
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty('enabled');
    });

    // With NEXTDASH_WRITE_TOKEN set, a plain fetch() gets 401 on every write
    // endpoint and the opt-in fails with no explanation. The client must go
    // through nextDashFetch so the header is attached.
    test('write calls go through nextDashFetch so a write token is attached', async ({ page }) => {
        await loadDashboard(page);

        const posts = [];
        page.on('request', (r) => {
            if (r.url().includes('/api/push/') && r.method() === 'POST') {
                posts.push(r.headers()['x-nextdash-token'] ?? null);
            }
        });

        const hasToken = await page.evaluate(() =>
            Boolean(document.querySelector('meta[name="nextdash-write-token"]')?.content?.trim()));

        await page.evaluate(async () => {
            try { await window.PushNotifications.sendTest(); } catch (e) { /* result does not matter */ }
        });

        expect(posts.length).toBeGreaterThan(0);
        if (hasToken) {
            expect(posts.every((t) => t)).toBe(true);
        }
    });

    // Safari only allows requestPermission() while the user gesture is alive and
    // drops that gesture on the first await. Fetching the server key before
    // prompting therefore makes Safari refuse to show the dialog at all — the
    // opt-in appears to do nothing. The prompt must come before any await.
    test('permission is requested before any await, keeping the user gesture', async ({ page }) => {
        await page.addInitScript(() => {
            window.__order = [];
            window.__gestureAlive = true;
            const origFetch = window.fetch;
            window.fetch = function (...args) {
                window.__order.push('fetch');
                window.__gestureAlive = false; // any round trip ends the gesture
                return origFetch.apply(this, args);
            };
            Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
            Notification.requestPermission = function () {
                window.__order.push(window.__gestureAlive ? 'requestPermission' : 'REJECTED-no-gesture');
                return Promise.resolve(window.__gestureAlive ? 'granted' : 'default');
            };
        });

        await loadDashboard(page);

        await page.evaluate(async () => {
            window.__order = [];
            window.__gestureAlive = true;
            try { await window.PushNotifications.subscribe(); } catch (e) { /* only ordering matters */ }
        });

        const order = await page.evaluate(() => window.__order);
        expect(order[0]).toBe('requestPermission');
        expect(order).not.toContain('REJECTED-no-gesture');
    });

    test('clicking Enable keeps the gesture alive until requestPermission', async ({ page }) => {
        await page.addInitScript(() => {
            window.__order = [];
            window.__gestureAlive = false;

            // The gesture starts on a real click...
            document.addEventListener('pointerdown', () => { window.__gestureAlive = true; }, true);

            // ...and Safari ends it when the clicked element is disabled.
            const disabledSetter = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled').set;
            Object.defineProperty(HTMLButtonElement.prototype, 'disabled', {
                configurable: true,
                get: Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled').get,
                set(v) {
                    if (v && this.hasAttribute('data-push-toggle')) {
                        window.__order.push('toggle-disabled');
                        window.__gestureAlive = false;
                    }
                    return disabledSetter.call(this, v);
                },
            });

            const origFetch = window.fetch;
            window.fetch = function (...args) {
                if (String(args[0]).includes('/api/push/')) {
                    window.__order.push('fetch');
                    window.__gestureAlive = false; // an await also ends it
                }
                return origFetch.apply(this, args);
            };

            Object.defineProperty(Notification, 'permission', { get: () => 'default', configurable: true });
            Notification.requestPermission = function () {
                window.__order.push(window.__gestureAlive ? 'requestPermission-OK' : 'REJECTED-no-gesture');
                return Promise.resolve(window.__gestureAlive ? 'granted' : 'default');
            };
        });

        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="status"]').click();

        const master = page.locator('[data-behavior-field="pushNotifyEnabled"]');
        if (!(await master.isChecked())) await master.click();
        await page.waitForTimeout(1000);

        await page.evaluate(() => { window.__order = []; });

        // A genuine click on the button, as a user would.
        await page.locator('[data-push-toggle]').click();
        await page.waitForTimeout(1500);

        const order = await page.evaluate(() => window.__order);
        console.log('--- order:', JSON.stringify(order));

        expect(order).toContain('requestPermission-OK');
        expect(order).not.toContain('REJECTED-no-gesture');
        // The prompt must come before the button is disabled.
        if (order.includes('toggle-disabled')) {
            expect(order.indexOf('requestPermission-OK')).toBeLessThan(order.indexOf('toggle-disabled'));
        }
    });

    // A declined invitation is otherwise unreachable: the card never returns and
    // nothing in config brings it back.
    test('the re-ask button restores a declined invitation', async ({ page }) => {
        await loadDashboard(page);
        await page.evaluate(async () => {
            const d = window.dashboardInstance;
            d.settings.quickStart = { ...(d.settings.quickStart || {}), pushChoiceMade: true, pushAskAfter: 0 };
            await d.saveSettings?.();
        });
        await openStatusTab(page);

        const reask = page.locator('[data-push-reask]');
        // Offered even where this browser cannot subscribe: it is about the
        // dashboard card, not about this browser's permission state.
        await expect(reask).toBeVisible();
        await reask.click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.quickStart.pushChoiceMade))
            .toBe(false);
    });

    test('subscribing with a non-https endpoint is refused', async ({ page }) => {
        const res = await page.request.post('/api/push/subscribe', {
            data: {
                endpoint: 'http://127.0.0.1:9/internal',
                keys: { p256dh: 'x', auth: 'y' },
            },
        });
        // 400 (bad endpoint), 403 (push disabled) or 401 (a write token is set and
        // this bare request carries none) — never a success.
        expect([400, 401, 403]).toContain(res.status());
    });
});

// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What happens when "Turn on" does not work.
 *
 * dashboard-push-notice.spec.js stubs subscribe() as always succeeding, so the
 * whole failure path was untested — and it was where the real bug lived. On
 * Safari over http://localhost, WebKit will not show the permission prompt at
 * all: window.isSecureContext is true (the spec trusts localhost) so nothing
 * stops the attempt, but requestPermission() throws "Notification prompting can
 * only be done from a user gesture" and leaves permission at "default".
 *
 * That produced three failures at once: the user was told notifications were
 * "blocked" and sent to browser settings that were not the problem, the card
 * stayed put with no visible reason, and the server-side switch that
 * beforeRegister had already turned on was never put back.
 */

/** Replaces Notification with one that refuses to prompt, the way WebKit does. */
async function withRefusingPrompt(page, { hostname = null } = {}) {
    await page.addInitScript(({ hostname }) => {
        class FakeNotification {}
        // @ts-ignore
        FakeNotification.requestPermission = () => {
            throw new Error('Notification prompting can only be done from a user gesture.');
        };
        Object.defineProperty(FakeNotification, 'permission', { get: () => 'default' });
        // @ts-ignore
        window.Notification = FakeNotification;
        if (hostname) {
            Object.defineProperty(window.location, 'hostname', { get: () => hostname, configurable: true });
        }
    }, { hostname });
}

async function loadDashboard(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function showCard(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.quickStart = d.settings.quickStart || {};
        d.settings.quickStart.pushChoiceMade = false;
        d.settings.quickStart.pushAskAfter = 0;
        d.settings.pushNotifyEnabled = false;
        d.settings.pushNotifyMonitor = false;
        await d.saveSettings?.();
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
    });
    await page.evaluate(() => window.PushNotice.render());
    await expect(page.locator('.push-notice-card')).toBeVisible();
}

const subscribeError = (page) => page.evaluate(async () => {
    try {
        await window.PushNotifications.subscribe({ beforeRegister: async () => {} });
        return null;
    } catch (err) {
        return err?.message || String(err);
    }
});

test.describe('push opt-in: when the browser refuses to prompt', () => {
    test('a refusal on localhost names HTTPS, not a browser setting', async ({ page }) => {
        await withRefusingPrompt(page);
        await loadDashboard(page);

        const message = await subscribeError(page);
        expect(message).toMatch(/HTTPS/i);
        // The old text sent the user to settings to unblock something that was
        // never blocked; permission is still "default" here.
        expect(message).not.toMatch(/blocked/i);
        expect(message).not.toMatch(/dismissed/i);
    });

    test('a refusal off localhost does not blame HTTPS', async ({ page }) => {
        await withRefusingPrompt(page, { hostname: 'nextdash.example.ts.net' });
        await loadDashboard(page);

        const message = await subscribeError(page);
        expect(message).toMatch(/prompt/i);
        expect(message).not.toMatch(/blocked/i);
    });

    test('a genuinely denied permission still says blocked', async ({ page }) => {
        // The distinction only matters if the real "denied" case keeps its own
        // message — that one *is* fixed in browser settings.
        await page.addInitScript(() => {
            class FakeNotification {}
            // @ts-ignore
            FakeNotification.requestPermission = () => Promise.resolve('denied');
            Object.defineProperty(FakeNotification, 'permission', { get: () => 'denied' });
            // @ts-ignore
            window.Notification = FakeNotification;
        });
        await loadDashboard(page);

        expect(await subscribeError(page)).toMatch(/blocked/i);
    });

    test('a permission granted late beats the thrown error', async ({ page }) => {
        // Some WebKit builds throw but record the answer anyway. The recorded
        // decision is the truth.
        await page.addInitScript(() => {
            let perm = 'default';
            class FakeNotification {}
            // @ts-ignore
            FakeNotification.requestPermission = () => {
                perm = 'granted';
                throw new Error('Notification prompting can only be done from a user gesture.');
            };
            Object.defineProperty(FakeNotification, 'permission', { get: () => perm });
            // @ts-ignore
            window.Notification = FakeNotification;
        });
        await loadDashboard(page);

        const message = await subscribeError(page);
        // It gets past the permission gate; whatever fails next is not about
        // prompting or blocking.
        expect(message || '').not.toMatch(/HTTPS|blocked|dismissed/i);
    });

    test('the failure is shown on the card, not only in a toast', async ({ page }) => {
        await withRefusingPrompt(page);
        await loadDashboard(page);
        await showCard(page);

        await page.locator('[data-push-action="enable"]').click();

        const error = page.locator('.push-notice-error');
        await expect(error).toBeVisible();
        await expect(error).toContainText(/HTTPS/i);
        // Still answerable: the button must not stay disabled.
        await expect(page.locator('[data-push-action="enable"]')).toBeEnabled();
    });

    test('a failed attempt leaves the server-side switch off', async ({ page }) => {
        await withRefusingPrompt(page);
        await loadDashboard(page);
        await showCard(page);

        await page.locator('[data-push-action="enable"]').click();
        await expect(page.locator('.push-notice-error')).toBeVisible();

        // beforeRegister turns these on partway through; a failure must undo it,
        // or push reads as enabled while no device is subscribed.
        const settings = await page.evaluate(() => ({
            enabled: window.dashboardInstance.settings.pushNotifyEnabled,
            monitor: window.dashboardInstance.settings.pushNotifyMonitor,
        }));
        expect(settings.enabled).toBeFalsy();
        expect(settings.monitor).toBeFalsy();

        // And the server agrees, rather than only this tab.
        const persisted = await page.evaluate(async () => (await (await fetch('/api/push/public-key')).json()).enabled);
        expect(persisted).toBeFalsy();
    });

    test('a failed attempt is not recorded as an answer', async ({ page }) => {
        await withRefusingPrompt(page);
        await loadDashboard(page);
        await showCard(page);

        await page.locator('[data-push-action="enable"]').click();
        await expect(page.locator('.push-notice-error')).toBeVisible();

        // Failing is not deciding: the card must still be allowed to return.
        const made = await page.evaluate(() => window.dashboardInstance.settings.quickStart?.pushChoiceMade);
        expect(made).toBeFalsy();
    });
});

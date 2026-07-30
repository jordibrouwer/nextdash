// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/** User agents the caveat logic has to get right. */
const UA = {
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    // iPadOS 13+ reports itself as macOS; only maxTouchPoints gives it away.
    chromeIpad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/120.0 Safari/537.36',
    // Android's stock browser says "Safari/" with no Chrome token, so a
    // brand-matching check mistakes it for Safari and warns about a restriction
    // that does not exist there.
    androidStock: 'Mozilla/5.0 (Linux; U; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36',
    // Chromium-branded browsers on iOS are still WebKit and still restricted,
    // even though their user agent carries a Blink token.
    braveIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120 Mobile/15E148 Safari/604.1 Chrome/120',
};

/**
 * Loads the dashboard with push support stubbed as available and unsubscribed,
 * so the invitation card has a reason to appear. Real push cannot be exercised
 * in headless Chromium — permission is always denied there.
 */
async function loadWithPushAvailable(page, opts = {}) {
    const { subscribed = false, userAgent = null, maxTouchPoints = 0 } = opts;
    await page.addInitScript(({ subscribed, userAgent, maxTouchPoints }) => {
        window.__pushCalls = [];
        window.__gestureAlive = false;
        document.addEventListener('pointerdown', () => { window.__gestureAlive = true; }, true);

        // Safari ends the gesture when the clicked button is disabled.
        const desc = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled');
        Object.defineProperty(HTMLButtonElement.prototype, 'disabled', {
            configurable: true,
            get: desc.get,
            set(v) {
                if (v && this.hasAttribute('data-push-action')) {
                    window.__pushCalls.push('button-disabled');
                    window.__gestureAlive = false;
                }
                return desc.set.call(this, v);
            },
        });

        if (userAgent) {
            Object.defineProperty(navigator, 'userAgent', { get: () => userAgent, configurable: true });
        }
        if (typeof maxTouchPoints === 'number') {
            Object.defineProperty(navigator, 'maxTouchPoints', { get: () => maxTouchPoints, configurable: true });
        }

        window.__pushStubConfig = { subscribed };
    }, { subscribed, userAgent, maxTouchPoints });

    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    // Install the stub *after* load: push-notifications.js defines the real
    // window.PushNotifications on parse, which would overwrite an earlier stub.
    // The real one reports permission "denied" in headless Chromium, so the card
    // would correctly refuse to render and nothing here would be exercised.
    await page.evaluate(({ subscribed }) => {
        window.PushNotifications = {
            isSupported: () => true,
            isSecureContext: () => true,
            permission: () => 'default',
            isSubscribed: async () => subscribed,
            subscribe: (options = {}) => {
                window.__pushCalls.push(window.__gestureAlive ? 'subscribe-with-gesture' : 'subscribe-NO-gesture');
                // Mirror the real client: the caller's hook runs after permission
                // is granted and before the server is contacted.
                return Promise.resolve()
                    .then(() => options.beforeRegister?.())
                    .then(() => ({ success: true }));
            },
            sendTest: async () => { window.__pushCalls.push('sendTest'); return { sent: 1 }; },
            unsubscribe: async () => ({ removed: true }),
            refresh: async () => {},
        };
    }, { subscribed });
}

/**
 * Clears any prior answer so the card is eligible again, and gets the shared
 * bottom-left corner free: quick-start owns it on a fresh install and the push
 * card deliberately waits rather than stacking on top of it.
 */
async function resetAnswer(page) {
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.quickStart = d.settings.quickStart || {};
        d.settings.quickStart.pushChoiceMade = false;
        d.settings.quickStart.pushAskAfter = 0;
        d.settings.quickStart.pushSnoozes = 0;
        d.settings.pushNotifyEnabled = false;
        d.settings.pushNotifyMonitor = false;
        await d.saveSettings?.();
    });
    // Remove any quick-start/analytics card occupying the corner.
    await page.evaluate(() => {
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
    });
}

test.describe('dashboard: browser-notification invitation card', () => {
    test('the card appears and offers to turn alerts on', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        const card = page.locator('.push-notice-card');
        await expect(card).toBeVisible();
        await expect(card.locator('[data-push-action="enable"]')).toBeVisible();
        await expect(card.locator('[data-push-action="decline"]')).toBeVisible();
    });

    // The whole reason the earlier implementation failed in Safari: the permission
    // prompt must be reached while the click is still an active user gesture.
    test('Turn on reaches subscribe() before the gesture is lost', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await page.locator('.push-notice-card [data-push-action="enable"]').click();
        await page.waitForTimeout(600);

        const calls = await page.evaluate(() => window.__pushCalls);
        expect(calls).toContain('subscribe-with-gesture');
        expect(calls).not.toContain('subscribe-NO-gesture');
        // And the button is only disabled after the call is under way.
        if (calls.includes('button-disabled')) {
            expect(calls.indexOf('subscribe-with-gesture')).toBeLessThan(calls.indexOf('button-disabled'));
        }
    });

    test('accepting turns on the master switch and monitoring alerts', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await page.locator('.push-notice-card [data-push-action="enable"]').click();

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.pushNotifyEnabled))
            .toBe(true);
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.pushNotifyMonitor))
            .toBe(true);
        // Backup and release notices are not part of what the card asked for.
        expect(await page.evaluate(() => window.dashboardInstance.settings.pushNotifyBackup === true)).toBe(false);
        expect(await page.evaluate(() => window.dashboardInstance.settings.pushNotifyRelease === true)).toBe(false);
        // A confirming test notification is sent so success is visible. It fires
        // after the settings save resolves, so poll rather than reading once.
        await expect
            .poll(() => page.evaluate(() => window.__pushCalls.includes('sendTest')))
            .toBe(true);
    });

    // Merely showing the card must not change settings. It used to switch push on
    // up front so the register call would be allowed, which left the toggles on
    // for anyone who then declined — a setting changing itself with no consent.
    test('showing the card changes no settings until it is accepted', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await expect(page.locator('.push-notice-card')).toBeVisible();

        expect(await page.evaluate(() => window.dashboardInstance.settings.pushNotifyEnabled === true)).toBe(false);
        expect(await page.evaluate(() => window.dashboardInstance.settings.pushNotifyMonitor === true)).toBe(false);
    });

    test('declining leaves push switched off, including after a reload', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await page.locator('.push-notice-card [data-push-action="decline"]').click();
        await expect(page.locator('.push-notice-card')).toHaveCount(0);

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.quickStart?.pushChoiceMade))
            .toBe(true);

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.settings, null, { timeout: 15_000 });
        expect(await page.evaluate(() => window.dashboardInstance.settings.pushNotifyEnabled === true)).toBe(false);
    });

    // Config, health and the inbox share this page, so a card would land on top
    // of whatever the user opened — including the push panel it is about.
    test('the card stays away while the config view is open', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.PushNotice.render())).toBe(false);
    });

    test('declining records an answer so the card does not return', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await page.locator('.push-notice-card [data-push-action="decline"]').click();
        await expect(page.locator('.push-notice-card')).toHaveCount(0);

        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.settings.quickStart?.pushChoiceMade))
            .toBe(true);

        // Rendering again must be refused now the question is answered.
        expect(await page.evaluate(() => window.PushNotice.render())).toBe(false);
    });

    test('× snoozes without answering, so it can come back later', async ({ page }) => {
        await loadWithPushAvailable(page);
        await resetAnswer(page);

        await page.evaluate(() => window.PushNotice.render());
        await page.locator('.push-notice-card [data-push-action="later"]').click();
        await expect(page.locator('.push-notice-card')).toHaveCount(0);

        const qs = await page.evaluate(() => window.dashboardInstance.settings.quickStart);
        expect(qs.pushChoiceMade).not.toBe(true);   // not an answer
        expect(qs.pushAskAfter).toBeGreaterThan(0); // but hidden for now
    });

    test('an already-subscribed browser is not asked', async ({ page }) => {
        await loadWithPushAvailable(page, { subscribed: true });
        await resetAnswer(page);

        expect(await page.evaluate(() => window.PushNotice.render())).toBe(false);
    });

    // The caveat follows the rendering engine, not the brand. Every browser on
    // iOS/iPadOS is WebKit underneath — Chrome included — so they inherit the
    // HTTPS restriction and must be warned; Blink and Gecko must not be.
    const caveatCases = [
        { name: 'Safari on macOS', ua: UA.safariMac, touch: 0, expected: true },
        { name: 'Chrome on iOS', ua: UA.chromeIos, touch: 5, expected: true },
        { name: 'Chrome on iPadOS (claims macOS)', ua: UA.chromeIpad, touch: 5, expected: true },
        // Chromium-branded but WebKit underneath: the engine is what counts.
        { name: 'a Chromium-branded iOS browser', ua: UA.braveIos, touch: 5, expected: true },
        { name: 'Chrome on macOS', ua: UA.chromeMac, touch: 0, expected: false },
        { name: 'Chrome on Android', ua: UA.chromeAndroid, touch: 5, expected: false },
        // Says "Safari/" with no Chrome token, but is not restricted.
        { name: "Android's stock browser", ua: UA.androidStock, touch: 5, expected: false },
    ];

    for (const { name, ua, touch, expected } of caveatCases) {
        test(`the HTTPS caveat ${expected ? 'shows' : 'stays hidden'} for ${name}`, async ({ page }) => {
            await loadWithPushAvailable(page, { userAgent: ua, maxTouchPoints: touch });
            await resetAnswer(page);
            await page.evaluate(() => window.PushNotice.render());

            await expect(page.locator('.push-notice-card')).toBeVisible();
            const caveat = page.locator('.push-notice-caveat');
            if (expected) {
                await expect(caveat).toBeVisible();
                await expect(caveat).toContainText('HTTPS');
            } else {
                await expect(caveat).toHaveCount(0);
            }
        });
    }
});

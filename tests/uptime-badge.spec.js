// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The uptime badge is a public image, so it exists only while its switch is on.
 */

async function setBadges(page, on) {
    await page.evaluate(async (value) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uptimeBadges: value }),
        });
    }, on);
}

test('the badge answers only while Serve uptime badges is on', async ({ page }) => {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    try {
        await setBadges(page, false);
        const off = await page.request.get('/badge/uptime.svg?url=https%3A%2F%2Fexample.com%2F');
        expect(off.status()).toBe(404);

        await setBadges(page, true);
        const on = await page.request.get('/badge/uptime.svg?url=https%3A%2F%2Fexample.com%2F');
        expect(on.status()).toBe(200);
        expect(on.headers()['content-type']).toContain('image/svg+xml');
        expect(await on.text()).toContain('<svg');
    } finally {
        await setBadges(page, false);
    }
});

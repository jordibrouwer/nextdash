// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The published release travels with the settings snapshot.
 *
 * Without it every version's sessions land in one bucket, so a default that
 * changed between releases reads as a gradual drift rather than the switch it
 * actually was.
 *
 * These stub `umami.track` rather than `nextdashTrack`, because the version is
 * read from the script tag and added inside the analytics module — stubbing the
 * public helper would jump over exactly the code under test.
 */

/** Turn analytics on server-side; the tracker is only emitted when it is. */
async function enableAnalytics(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    const ok = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await api('/api/settings')).json();
        current.analyticsOptIn = true;
        const res = await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current),
        });
        return res.ok;
    });
    expect(ok, 'enabling analytics should succeed').toBe(true);
}

/** Record what the tracker is handed, before any app script runs. */
async function captureUmami(page) {
    await page.addInitScript(() => {
        window.__umami = [];
        window.umami = { track: (name, props) => { window.__umami.push({ name, props }); } };
    });
}

async function loadDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
}

const snapshot = (page) => page.evaluate(() =>
    (window.__umami || []).find((e) => e.name === 'settings-snapshot'));

test.describe('analytics — release version in the settings snapshot', () => {
    test.describe.configure({ mode: 'serial' });

    test('the snapshot carries the published release', async ({ page }) => {
        await enableAnalytics(page);
        await captureUmami(page);
        await loadDashboard(page);

        await expect.poll(() => snapshot(page), { timeout: 15_000 }).toBeTruthy();
        const snap = await snapshot(page);

        // The same tag the What's new index lists, so the number in Umami can be
        // matched against a release rather than guessed at.
        const expected = await page.evaluate(async () => {
            const res = await fetch('/static/data/whats-new/index.json');
            const index = await res.json();
            return index[0]?.tag || index[0]?.id || '';
        });
        // Both schemes: tags were vYYYY.MM.N until the move to semver at v1.0.0.
        expect(expected).toMatch(/^v(\d{4}\.|\d+\.\d+\.\d+$)/);
        expect(snap.props.appVersion).toBe(expected);
    });

    test('the version is served from the script tag, not hardcoded', async ({ page }) => {
        await enableAnalytics(page);
        await loadDashboard(page);

        // Rendered by the server from the release index; a constant in the JS
        // would be a second copy to bump every release, and would drift.
        const attr = await page.evaluate(() => document
            .querySelector('script[data-nextdash-analytics="on"]')?.getAttribute('data-release'));
        expect(attr).toMatch(/^v(\d{4}\.|\d+\.\d+\.\d+$)/);
    });

    test('no tracker and no version are emitted while analytics is off', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const current = await (await api('/api/settings')).json();
            current.analyticsOptIn = false;
            await api('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(current),
            });
        });

        await captureUmami(page);
        await loadDashboard(page);
        await page.waitForTimeout(1500);

        // Opting out means the script is never put in the page at all, so the
        // release cannot leak through it either.
        expect(await page.evaluate(() => document
            .querySelectorAll('script[data-nextdash-analytics="on"]').length)).toBe(0);
        expect(await snapshot(page)).toBeUndefined();
    });
});

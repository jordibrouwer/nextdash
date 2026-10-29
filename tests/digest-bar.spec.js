// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Closing the digest's bar (static/js/digest-notice.js): it asks first, and
 * names what is still in the digest.
 */

function snapshot(extra = {}) {
    return {
        dueKey: '2026-10-26', generatedAt: 1_900_000_000_000,
        health: {
            newlyBroken: ['Plex', 'Router admin'], stillBroken: 5, stillBrokenNames: ['Old 1'],
            certsExpiring: ['nas.home (5 days)', 'git.home (12 days)', 'photos.home (26 days)', 'x.home (3 days)'],
        },
        usage: { inbox: 3 },
        ...extra,
    };
}

async function barUp(page, snap) {
    await page.route('**/api/digest/latest', (route) => route.fulfill({ json: snap }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.settings && window.DigestNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.localStorage.removeItem('nextdashDigestSeenAt');
        window.localStorage.removeItem('nextdashDigestProgress');
        window.localStorage.removeItem('nextdashDigestCard');
    });
    await page.evaluate(() => window.DigestNotice.openDigest());
    await page.locator('.digest-row[data-digest-row="inbox"]').click();
    await page.locator('.digest-window [data-digest-go="inbox"]').click();
    await expect(page.locator('.digest-bar')).toBeVisible();
}

test.describe('closing the digest bar', () => {
    test('asks first, names what is left, and Keep it keeps the bar', async ({ page }) => {
        await barUp(page, snapshot());
        await page.locator('.digest-bar [data-digest-bar="close"]').click();
        const dialog = page.locator('#app-modal');
        await expect(dialog).toContainText('Close this digest until Monday?');
        await expect(dialog).toContainText('7 broken links, 4 certificates');
        await dialog.getByRole('button', { name: 'Keep it' }).click();
        await expect(page.locator('.digest-bar')).toBeVisible();
    });

    test('Close until Monday removes the bar, and a reload does not bring it back', async ({ page }) => {
        await barUp(page, snapshot());
        await page.locator('.digest-bar [data-digest-bar="close"]').click();
        await page.locator('#app-modal').getByRole('button', { name: 'Close until Monday' }).click();
        await expect(page.locator('.digest-bar')).toHaveCount(0);
        await page.reload();
        await page.waitForFunction(() => window.DigestNotice, null, { timeout: 15_000 });
        // A check that something does NOT happen: the bar must stay away after a reload, so it gets time to be drawn if it were.
        await page.waitForTimeout(1000);
        await expect(page.locator('.digest-bar')).toHaveCount(0);
    });

    test('with nothing in the first group it still asks, in general words', async ({ page }) => {
        await barUp(page, { dueKey: '2026-10-26', generatedAt: 1_900_000_000_000, usage: { inbox: 3, neverOpened: 5, neverOpenedNames: ['A'] } });
        await page.locator('.digest-bar [data-digest-bar="close"]').click();
        const dialog = page.locator('#app-modal');
        await expect(dialog).toContainText('Close this digest until Monday?');
        await expect(dialog).toContainText('not been opened yet');
    });

    test('names the singular when there is one, and the weekday that is set', async ({ page, request }) => {
        const headers = { 'X-NextDash-Token': WRITE_TOKEN };
        const set = await request.post('/api/settings', { data: { digestWeekday: 5 }, headers });
        expect(set.ok()).toBeTruthy();
        try {
            await barUp(page, snapshot({ health: { newlyBroken: ['Plex'], certsExpiring: ['nas.home (5 days)'] } }));
            await page.locator('.digest-bar [data-digest-bar="close"]').click();
            const dialog = page.locator('#app-modal');
            await expect(dialog).toContainText('1 broken link, 1 certificate');
            await expect(dialog).not.toContainText('1 broken links');
            await expect(dialog).not.toContainText('1 certificates');
            await expect(dialog).toContainText('Close this digest until Friday?');
            await expect(dialog.getByRole('button', { name: 'Close until Friday' })).toBeVisible();
        } finally {
            await request.post('/api/settings', { data: { digestWeekday: 1 }, headers });
        }
    });
});

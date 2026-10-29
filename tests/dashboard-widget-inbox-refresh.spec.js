// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Inbox tile keeps up without a reload.
 *
 * It keeps one answer until something clears it. A link saved from the
 * extension or another device moved the data revision, the dashboard reloaded
 * its bookmarks, and the tile went on showing the old list. A snoozed link that
 * woke while the dashboard stayed open did not come back either: the sleeping
 * ones were dropped once, at load, and the tile has no beat of its own.
 */

async function withInboxTile(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await f('/api/pages/1/blocks', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: [{ type: 'inbox', title: 'Inbox', config: { rows: 20 } }] }),
        });
    });
}

/** Saves a link the way the extension does: straight to the server, not through this page. */
async function saveElsewhere(page, title, extra = {}) {
    return page.evaluate(async ({ title, extra }) => {
        const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const url = `https://example.com/${encodeURIComponent(title)}`;
        const res = await f('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, title, source: 'extension' }),
        });
        const body = await res.json();
        const id = body?.item?.id || body?.id;
        if (extra.snoozedUntil) {
            await f('/api/inbox', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, snoozedUntil: extra.snoozedUntil }),
            });
        }
        return id;
    }, { title, extra });
}

const tile = (page) => page.locator('.dashboard-widget[data-widget-type="inbox"]');

test.describe('the Inbox tile keeps up', () => {
    test('a link saved elsewhere shows once the tab is back in front', async ({ page }) => {
        await withInboxTile(page);
        await page.reload();
        await expect(tile(page)).toBeVisible({ timeout: 15_000 });
        const title = `Saved elsewhere ${Date.now()}`;
        await expect(tile(page)).not.toContainText(title);
        await saveElsewhere(page, title);
        // What the browser sends when the reader comes back to the tab.
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(tile(page)).toContainText(title, { timeout: 10_000 });
    });

    test('a snoozed link is counted as asleep, and comes back on its own when it wakes', async ({ page }) => {
        await withInboxTile(page);
        const title = `Wakes soon ${Date.now()}`;
        await saveElsewhere(page, title, { snoozedUntil: Date.now() + 5000 });
        await page.reload();
        await expect(tile(page)).toBeVisible({ timeout: 15_000 });
        await expect(tile(page).locator('[data-widget-inbox-asleep]')).toBeVisible();
        await expect(tile(page)).not.toContainText(title);
        await expect(tile(page)).toContainText(title, { timeout: 15_000 });
    });
});

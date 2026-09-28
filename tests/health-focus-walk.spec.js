// @ts-check
const { test, expect } = require('./fixtures');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * Work through: Health's walk (DashboardHealthFocus) over the Bookmarks view's
 * list, one bookmark at a time, and what its card says about drift and muting.
 *
 * The report knows six bookmarks -- one broken, three drifted, one stale, one
 * unused -- so the walk has exactly those, and each card's badges key off the
 * states set here rather than whatever the seeded bookmarks happen to score.
 */

/** A monitored, drifted bookmark. `flags` first: matchesFilter reads it before `status`. */
const drifted = (name, extra = {}) => ({
    name, status: 'healthy', score: 100, flags: ['drift', 'healthy'],
    reasons: [], reasonDetails: [],
    monitor: true, checkStatus: false, monitorIntervalMinutes: 5,
    watchDrift: true, driftNoticed: 'host',
    driftReason: 'Now redirects to new.example', driftSince: 1752000000000,
    ...extra,
});

const SIX = [
    { name: 'Broken one', status: 'broken', score: 25, flags: ['broken'],
        reasons: ['HTTP 500'], reasonDetails: [{ code: 'last_error', detail: 'HTTP 500', penalty: 60 }] },
    drifted('Drift A'),
    drifted('Drift B', { driftNoticed: 'title-changed', driftReason: 'Page title changed' }),
    drifted('Drift C', { notifyMuted: true }),
    { name: 'Stale one', status: 'stale', score: 80, flags: ['stale'], openCount: 5, lastOpened: 1,
        reasons: ['Not opened in over 30 days'], reasonDetails: [{ code: 'not_opened_30_days', penalty: 10 }] },
    { name: 'Unused one', status: 'unused', score: 85, flags: ['unused'], openCount: 0, lastOpened: 0,
        reasons: ['Never opened'], reasonDetails: [{ code: 'never_opened', penalty: 10 }] },
];

async function openWalk(page) {
    await openBookmarksWithHealth(page, (issues) => SIX.map((fields, i) => ({ ...issues[i], ...fields })));
    await page.locator('[data-bm-work-through]').click();
    await page.locator('[data-focus-pile="list"]').click();
    await expect(page.locator('.health-focus-card')).toBeVisible();
}

const title = (page) => page.locator('.health-focus-title');
const progress = (page) => page.locator('.health-focus-progress');

/** Step to the card with this name. */
async function walkTo(page, name) {
    for (let i = 0; i < SIX.length; i += 1) {
        if ((await title(page).textContent())?.trim() === name) return;
        await page.keyboard.press('j');
    }
    throw new Error(`${name} is not in the walk`);
}

test.describe('Work through', () => {
    test('shows one bookmark at a time, out of the ones the list has', async ({ page }) => {
        await openWalk(page);
        await expect(progress(page)).toHaveText(/1 of 6$/);
        expect(SIX.map((b) => b.name)).toContain((await title(page).textContent())?.trim());
    });

    test('j and k walk the queue, and Escape leaves it', async ({ page }) => {
        await openWalk(page);
        const first = (await title(page).textContent())?.trim();
        await page.keyboard.press('j');
        await expect(progress(page)).toHaveText(/2 of 6$/);
        await expect(title(page)).not.toHaveText(first || '');
        await page.keyboard.press('k');
        await expect(progress(page)).toHaveText(/1 of 6$/);
        await expect(title(page)).toHaveText(first || '');
        await page.keyboard.press('Escape');
        await expect(page.locator('.health-focus-overlay')).toHaveCount(0);
    });

    test('ends on a summary at the end of the queue rather than wrapping', async ({ page }) => {
        await openWalk(page);
        for (let i = 1; i < SIX.length; i += 1) await page.keyboard.press('j');
        await expect(progress(page)).toHaveText(/6 of 6$/);
        await page.keyboard.press('j');
        await expect(page.locator('.health-focus-card--done')).toBeVisible();
    });

    test('the list behind the overlay does not also act on the keys', async ({ page }) => {
        await openWalk(page);
        await page.keyboard.press('x');
        expect(await page.evaluate(() => window.dashboardInstance.config.instance.bmSelected.size)).toBe(0);
    });
});

test.describe('the card\'s badges', () => {
    test('a drift finding is badged with what it found, the reason in its title', async ({ page }) => {
        await openWalk(page);
        await walkTo(page, 'Drift A');
        const badge = page.locator('.health-focus-card .health-drift-badge');
        await expect(badge).toHaveText('Moved');
        await expect(badge).toHaveAttribute('title', 'Now redirects to new.example');
    });

    test('a title finding is badged distinctly from a moved one', async ({ page }) => {
        await openWalk(page);
        await walkTo(page, 'Drift B');
        await expect(page.locator('.health-focus-card .health-drift-badge')).toHaveText('Retitled');
    });

    test('no drift badge without a finding', async ({ page }) => {
        await openWalk(page);
        await walkTo(page, 'Stale one');
        await expect(page.locator('.health-focus-card .health-drift-badge')).toHaveCount(0);
    });

    test('a muted bookmark says so, and an unmuted one does not', async ({ page }) => {
        await openWalk(page);
        // A comes before C in the walk, and walking past the end ends it.
        await walkTo(page, 'Drift A');
        await expect(page.locator('.health-focus-card .health-muted-badge')).toHaveCount(0);
        await walkTo(page, 'Drift C');
        await expect(page.locator('.health-focus-card .health-muted-badge')).toBeVisible();
    });
});

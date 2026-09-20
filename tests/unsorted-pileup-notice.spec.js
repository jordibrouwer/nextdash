// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A pile of kept links that nobody is filing.
 *
 * Keeping is the cheap half of the decision, so the list only grows: the queue
 * has a badge and a limit, this had neither. It is not a place for a cap --
 * deleting what someone kept is the one thing this list must never do on its
 * own -- so it says something once, in the corner, and the reader decides.
 */

const DAY = 86_400_000;

async function seedKept(page, count, ageDays) {
    await page.evaluate(async ({ n, age }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const current = await (await fetch('/api/unsorted', { cache: 'no-store' })).json();
        for (const bookmark of current.bookmarks || []) {
            await api('/api/bookmarks', {
                method: 'DELETE', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ page: 999999, bookmark }),
            });
        }
        for (let i = 0; i < n; i += 1) {
            await api('/api/bookmarks/add', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    page: 999999,
                    bookmark: {
                        name: `Pile ${i}`, url: `https://pile.example/${i}`, category: '',
                        createdAt: Date.now() - age * 86400000,
                    },
                }),
            });
        }
        await window.dashboardInstance.loadAllBookmarks?.();
    }, { n: count, age: ageDays });
}

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
    // The corner holds one card at a time, and a fresh install's quick-start
    // is already in it -- closing it is what a reader does before any of these
    // notices can reach them.
    const quickstart = page.locator('.quickstart-card .quickstart-close').first();
    if (await quickstart.count()) {
        await quickstart.click();
        await expect(page.locator('.quickstart-card')).toHaveCount(0, { timeout: 10_000 });
    }
    // And again after it: quick-start decides whether it is starting a session
    // *after* the first pass, and every corner card waits out a session that
    // began with the wizard. The reader this card is for finished setup weeks
    // ago.
    await dismissOnboardingIfPresent(page);
}

test('says something once when kept links have been sitting for a month', async ({ page }) => {
    await open(page);
    await seedKept(page, 12, 45);

    const shown = await page.evaluate(() => ({
        should: window.DashboardKeptPileNotice?.shouldShow?.() === true,
        stale: window.DashboardKeptPileNotice?.staleCount?.(),
    }));
    expect(shown.should).toBe(true);
    expect(shown.stale).toBe(12);

    await page.evaluate(() => window.DashboardKeptPileNotice.render());
    const card = page.locator('.notice-card', { hasText: 'kept' }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('12');

    // Its one action opens the list where the work is.
    await card.getByRole('button', { name: /show|kept|open/i }).first().click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.inbox?.tab), { timeout: 10_000 }).toBe('kept');
});

test('stays quiet over a small or recent pile', async ({ page }) => {
    await open(page);
    await seedKept(page, 12, 2);
    expect(await page.evaluate(() => window.DashboardKeptPileNotice?.shouldShow?.())).toBe(false);

    await seedKept(page, 3, 60);
    expect(await page.evaluate(() => window.DashboardKeptPileNotice?.shouldShow?.())).toBe(false);
});

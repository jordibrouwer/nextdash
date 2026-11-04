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

const ROW = '.notification-bell-row[data-bell-id="kept-pile"]';

async function openBell(page) {
    await page.evaluate(() => {
        // A "No" said in a test must not reach the shared ./data.
        window.dashboardInstance.saveSettings = ((save) => function (opts, ...rest) {
            // schedulePersist() runs through the module's own closure, so only the
            // save can be held back: the shared ./data keeps no mark of a test.
            if (opts?.keys?.length === 1 && opts.keys[0] === 'discoverabilityState') return Promise.resolve(true);
            return save.call(this, opts, ...rest);
        })(window.dashboardInstance.saveSettings);
        return window.NotificationBell.refreshAll();
    });
    await page.evaluate(() => window.NotificationBell.open());
}

test('says so in the bell when kept links have been sitting for a month', async ({ page }) => {
    await open(page);
    await seedKept(page, 12, 45);

    const shown = await page.evaluate(async () => ({
        state: await window.DashboardKeptPileNotice?.state?.(),
        stale: window.DashboardKeptPileNotice?.staleCount?.(),
    }));
    expect(shown.state?.count).toBe(12);
    expect(shown.stale).toBe(12);

    await openBell(page);
    const row = page.locator(ROW);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('12 kept links waiting over a month');
    // The corner is not used, and the old postponing button is gone.
    await expect(page.locator('.kept-pile-card')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Not now' })).toHaveCount(0);

    // Its one action opens the list where the work is: Bookmarks → Unsorted.
    await row.getByRole('button', { name: /open unsorted/i }).click();
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView), { timeout: 10_000 }).toBe('library');
    await expect(page).toHaveURL(/#bookmarks\?filter=unsorted$/);
});

test('stays quiet over a small or recent pile', async ({ page }) => {
    await open(page);
    await seedKept(page, 12, 2);
    expect(await page.evaluate(() => window.DashboardKeptPileNotice?.state?.())).toBeNull();

    await seedKept(page, 3, 60);
    expect(await page.evaluate(() => window.DashboardKeptPileNotice?.state?.())).toBeNull();
});

test('No hides it until the pile has grown by twenty', async ({ page }) => {
    await open(page);
    await seedKept(page, 12, 45);
    await openBell(page);
    await page.locator(ROW).getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.locator(ROW)).toHaveCount(0);

    // Nineteen more is not enough ...
    await seedKept(page, 31, 45);
    await openBell(page);
    await expect(page.locator(ROW)).toHaveCount(0);

    // ... twenty is.
    await seedKept(page, 32, 45);
    await openBell(page);
    await expect(page.locator(ROW)).toBeVisible();
    await expect(page.locator(ROW)).toContainText('32 kept links');
});

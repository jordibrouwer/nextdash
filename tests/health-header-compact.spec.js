// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * How far it is from the heading to the first bookmark.
 *
 * Six things stood between them — a subtitle, ten summary tiles, fifteen filter
 * pills, a search row, up to eleven action buttons, and a sentence — so on a
 * laptop the first row of a list about bookmarks began below the fold. The
 * tiles and the pills were largely the same figures twice over, the cards being
 * the expensive copy.
 *
 * The report is supplied rather than seeded: these are measurements in pixels,
 * and a list whose length depends on what earlier specs left behind measures
 * something different every run.
 */
const REPORT = {
    generatedAt: Date.now(),
    summary: { total: 4, healthyCount: 2, brokenCount: 1, staleCount: 1 },
    certificates: { 'cert.example.com': { expiresAt: Date.now() + 5 * 86400000, issuer: 'Test CA' } },
    issues: [
        { pageId: 1, index: 0, name: 'Healthy one', url: 'https://a.example.com/',
          certHost: 'cert.example.com', status: 'healthy', flags: ['healthy'], score: 100, lastChecked: Date.now() },
        { pageId: 1, index: 1, name: 'Healthy two', url: 'https://b.example.com/',
          status: 'healthy', flags: ['healthy'], score: 100, lastChecked: Date.now() },
        { pageId: 1, index: 2, name: 'Broken one', url: 'https://c.example.com/',
          status: 'broken', flags: ['broken'], score: 10, lastChecked: Date.now() },
        { pageId: 1, index: 3, name: 'Stale one', url: 'https://d.example.com/',
          status: 'stale', flags: ['stale'], score: 60, lastChecked: Date.now() - 400 * 86400000 },
        // One row per remaining flag: most pills render only when their count
        // is above zero, so a thin report measures a strip that is not the one
        // a real install shows.
        { pageId: 1, index: 4, name: 'Unused one', url: 'https://e.example.com/',
          status: 'unused', flags: ['unused'], score: 70, lastChecked: Date.now() },
        { pageId: 1, index: 5, name: 'Unchecked one', url: 'https://f.example.com/',
          status: 'unchecked', flags: ['unchecked'], score: 50, lastChecked: 0 },
        { pageId: 1, index: 6, name: 'Duplicate one', url: 'https://g.example.com/',
          status: 'duplicate', flags: ['duplicate'], score: 80, lastChecked: Date.now() },
        { pageId: 1, index: 7, name: 'Drifted one', url: 'https://h.example.com/',
          status: 'drift', flags: ['drift'], score: 65, lastChecked: Date.now() },
        { pageId: 1, index: 8, name: 'No preview', url: 'https://i.example.com/',
          status: 'missing-preview', flags: ['missing-preview'], score: 95, lastChecked: Date.now() },
        { pageId: 1, index: 9, name: 'Content changed', url: 'https://j.example.com/',
          status: 'content', flags: ['content'], score: 75, lastChecked: Date.now() },
        { pageId: 1, index: 10, name: 'Shortcut clash', url: 'https://k.example.com/',
          status: 'shortcut-conflict', flags: ['shortcut-conflict'], score: 85, lastChecked: Date.now() },
        { pageId: 1, index: 11, name: 'Lost category', url: 'https://l.example.com/',
          status: 'orphaned-category', flags: ['orphaned-category'], score: 85, lastChecked: Date.now() },
        { pageId: 1, index: 12, name: 'Monitored one', url: 'https://m.example.com/',
          status: 'healthy', flags: ['healthy'], score: 100, monitor: true, lastChecked: Date.now() },
        { pageId: 1, index: 13, name: 'Set aside', url: 'https://n.example.com/',
          status: 'stale', flags: ['stale'], ignoredFlags: ['stale'], score: 60, lastChecked: Date.now() },
    ],
};

async function openHealth(page) {
    await page.route('**/api/bookmark-health**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(REPORT),
    }));
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/#health');
    await page.waitForSelector('.health-view-tiles', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test('the tiles read as one line, not a wall of cards', async ({ page }) => {
    await openHealth(page);

    const tiles = page.locator('.health-view-tiles');
    await expect(tiles).toBeVisible();

    const height = await tiles.evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(height, `tile strip is ${height}px tall`).toBeLessThan(48);

    // Still a way in: every figure that carried a filter keeps it.
    expect(await page.locator('[data-health-tile]').count()).toBeGreaterThan(3);
});

test('every filter pill is on screen without scrolling sideways', async ({ page }) => {
    await openHealth(page);

    const overflow = await page.evaluate(() => {
        const strip = document.querySelector('.health-view-filter-strip');
        if (!strip) return { error: 'no pill strip' };
        const box = strip.getBoundingClientRect();
        const cut = [...strip.querySelectorAll('[data-health-filter]')]
            .filter((pill) => pill.getBoundingClientRect().right > box.right + 1)
            .map((pill) => pill.textContent.trim());
        return { cut, total: strip.querySelectorAll('[data-health-filter]').length };
    });

    expect(overflow.error).toBeUndefined();
    expect(overflow.total).toBeGreaterThan(8);
    // A pill past the right edge is a filter the reader cannot see exists.
    expect(overflow.cut, JSON.stringify(overflow)).toEqual([]);
});

test('the rare actions are one click away, not eight buttons wide', async ({ page }) => {
    await openHealth(page);

    // The two Jordi named stay in the open, and so does the help button — that
    // explains the view rather than acting on the list.
    await expect(page.locator('.health-view-focus-btn')).toBeVisible();
    await expect(page.locator('.health-view-rot-btn')).toBeVisible();
    await expect(page.locator('.health-view-help-btn')).toBeVisible();

    // Everything else waits behind the hamburger.
    const more = page.locator('[data-health-toolbar-more]');
    await expect(more).toBeVisible();
    await expect(page.locator('.health-view-retest-btn')).toBeHidden();

    await more.click();
    for (const cls of ['.health-view-retest-btn', '.health-view-export-btn',
        '.health-view-checkoff-btn', '.health-view-settings-link']) {
        await expect(page.locator(cls), `${cls} missing from the menu`).toBeVisible();
    }
});

test('the header no longer carries a settings button of its own', async ({ page }) => {
    await openHealth(page);
    // It moved into the menu; on the header it was one more thing between the
    // heading and the rows.
    await expect(page.locator('.health-view-header .health-view-settings-link')).toHaveCount(0);
});

test('the filter sentence appears where it tells you something', async ({ page }) => {
    await openHealth(page);

    /*
     * Every note explains a rule the pill has no room for -- what counts as
     * stale, why a bookmark is called unused. Those earn their line.
     *
     * All is the exception: "Every bookmark, whatever its state" describes
     * exactly what an unfiltered list looks like, to someone already looking at
     * one. It is the one filter whose note is a line spent on nothing.
     */
    await page.locator('[data-health-filter="stale"]').click();
    await expect(page.locator('.health-view-filter-note')).toBeVisible();

    await page.locator('[data-health-filter="all"]').click();
    await expect(page.locator('.health-view-filter-note')).toHaveCount(0);
});

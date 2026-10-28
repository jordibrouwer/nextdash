// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * "Usually now" in the empty search panel (static/js/search-usually-now.js).
 *
 * The opens are logged the way the app logs them (its own tracker), so the
 * bookmarks' openLog is what a reader's would be. Three opens "now" make a
 * habit for "now".
 */

const headers = { 'X-NextDash-Token': WRITE_TOKEN };
let seeded = 0;

async function addBookmark(request, name) {
    seeded += 1;
    const url = `https://usually-now-${Date.now()}-${seeded}.example/`;
    const res = await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name, url } }, headers });
    expect(res.ok()).toBeTruthy();
    return url;
}

async function loadDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Open a bookmark `times` times through the app's own tracker. */
async function logOpens(page, url, times) {
    await page.evaluate(async ({ url, times }) => {
        const d = window.dashboardInstance;
        const index = d.bookmarks.findIndex((b) => b.url === url);
        for (let i = 0; i < times; i += 1) {
            await d.analytics.trackBookmarkOpen(d.currentPageId, index, 'dashboard', 'click', undefined, url);
        }
    }, { url, times });
}

async function reloadWithOpens(page) {
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);
}

async function openPanel(page) {
    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent?.isActive?.())).toBe(true);
}

const groupNames = (page) => page.evaluate(() => {
    const matches = window.dashboardInstance.searchComponent.searchMatches || [];
    const out = [];
    let current = null;
    for (const m of matches) {
        if (m.type === 'command-group-header') { current = { label: m.label, names: [] }; out.push(current); continue; }
        if (m.type === 'bookmark' && current) current.names.push(m.bookmark.name);
    }
    return out;
});

test.describe('usually now', () => {
    test('three bookmarks opened three times each lead the empty panel, open by default', async ({ page, request }) => {
        const names = ['UN Alpha', 'UN Beta', 'UN Gamma'];
        const urls = [];
        for (const n of names) urls.push(await addBookmark(request, n));
        await loadDashboard(page);
        for (const url of urls) await logOpens(page, url, 3);
        await reloadWithOpens(page);

        await openPanel(page);
        const groups = await groupNames(page);
        const group = groups.find((g) => g.label === 'Usually now');
        expect(group, JSON.stringify(groups)).toBeTruthy();
        expect([...group.names].sort()).toEqual([...names].sort());
        // Above Recent, open without a click.
        const labels = groups.map((g) => g.label);
        if (labels.includes('Recent')) expect(labels.indexOf('Usually now')).toBeLessThan(labels.indexOf('Recent'));
    });

    test('fewer than three habits show no group at all', async ({ page, request }) => {
        const urls = [await addBookmark(request, 'UN Solo A'), await addBookmark(request, 'UN Solo B')];
        await loadDashboard(page);
        for (const url of urls) await logOpens(page, url, 3);
        await reloadWithOpens(page);
        // A fresh install may carry habits from other specs on this shared server; count only ours.
        await openPanel(page);
        const group = (await groupNames(page)).find((g) => g.label === 'Usually now');
        const ours = (group?.names || []).filter((n) => n.startsWith('UN Solo'));
        expect(ours.length).toBeLessThanOrEqual(2);
        if (group) expect(group.names.length).toBeGreaterThanOrEqual(3);
    });

    test('a panel left open does not re-rank when another open is logged', async ({ page, request }) => {
        const urls = [];
        for (const n of ['UN Rank A', 'UN Rank B', 'UN Rank C', 'UN Rank D']) urls.push(await addBookmark(request, n));
        await loadDashboard(page);
        for (const url of urls.slice(0, 3)) await logOpens(page, url, 3);
        await logOpens(page, urls[3], 2); // one short of a habit
        await reloadWithOpens(page);

        await openPanel(page);
        const before = (await groupNames(page)).find((g) => g.label === 'Usually now')?.names ?? [];
        expect(before).not.toContain('UN Rank D');

        // D becomes a habit while the panel is open: nothing moves.
        await logOpens(page, urls[3], 5);
        // What the app does to the bookmark in memory when it logs an open.
        await page.evaluate((url) => {
            const d = window.dashboardInstance;
            const bookmark = d.bookmarks.find((b) => b.url === url);
            const now = Date.now();
            bookmark.openLog = [...(bookmark.openLog || []), now, now, now, now, now];
            bookmark.openCount = (bookmark.openCount || 0) + 5;
            d.searchComponent.updateSearch();
        }, urls[3]);
        const during = (await groupNames(page)).find((g) => g.label === 'Usually now')?.names ?? [];
        expect(during).toEqual(before);
    });
});

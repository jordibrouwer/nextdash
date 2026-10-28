// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, WRITE_TOKEN } = require('./e2e-helpers');

/**
 * Right arrow on a bookmark result unfolds its actions (static/js/search.js).
 *
 * The rows come from "Usually now", which is the one place the empty panel
 * lists bookmarks: three real opens each make a habit for now.
 */

const headers = { 'X-NextDash-Token': WRITE_TOKEN };
let seeded = 0;

async function seedHabits(page, request) {
    const rows = [];
    for (const name of ['RA Alpha', 'RA Beta', 'RA Gamma']) {
        seeded += 1;
        const url = `https://result-actions-${Date.now()}-${seeded}.example/`;
        const res = await request.post('/api/bookmarks/add', { data: { page: 1, bookmark: { name, url } }, headers });
        expect(res.ok()).toBeTruthy();
        rows.push({ name, url });
    }
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (list) => {
        const d = window.dashboardInstance;
        for (const { url } of list) {
            const index = d.bookmarks.findIndex((b) => b.url === url);
            for (let i = 0; i < 3; i += 1) await d.analytics.trackBookmarkOpen(d.currentPageId, index, 'dashboard', 'click', undefined, url);
        }
    }, rows);
    await page.reload();
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissBlockingOverlays(page);
    return rows;
}

const selected = (page) => page.evaluate(() => {
    const s = window.dashboardInstance.searchComponent;
    const m = s.selectableMatches[s.selectedMatchIndex];
    return { type: m?.type, name: m?.bookmark?.name, active: s.isActive() };
});

async function onBookmarkRow(page) {
    await page.keyboard.press('>');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent?.isActive?.())).toBe(true);
    for (let i = 0; i < 12; i += 1) {
        if ((await selected(page)).type === 'bookmark') return;
        await page.keyboard.press('ArrowDown');
    }
    throw new Error('no bookmark row reached');
}

const actionLabels = (page) => page.locator('.search-row-actions [role="menuitem"]').allTextContents();

test.describe('actions on a result', () => {
    test('Right unfolds six actions in order; Left and Escape fold them, then Escape closes', async ({ page, request }) => {
        await seedHabits(page, request);
        await onBookmarkRow(page);

        await page.keyboard.press('ArrowRight');
        const labels = (await actionLabels(page)).map((t) => t.trim());
        expect(labels).toEqual(['Open', 'Open in new tab', 'Copy URL', 'Edit', 'Show in list', 'Move to…']);
        await expect(page.locator('.search-row-actions [role="menuitem"].is-selected')).toHaveText('Open');

        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.search-row-actions [role="menuitem"].is-selected')).toHaveText('Open in new tab');
        await page.keyboard.press('ArrowUp');
        await expect(page.locator('.search-row-actions [role="menuitem"].is-selected')).toHaveText('Open');

        await page.keyboard.press('ArrowLeft');
        await expect(page.locator('.search-row-actions')).toHaveCount(0);
        expect((await selected(page)).active).toBe(true);

        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.search-row-actions')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('.search-row-actions')).toHaveCount(0);
        expect((await selected(page)).active).toBe(true);
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.isActive())).toBe(false);
    });

    test('Copy URL copies the address and closes the panel', async ({ page, request, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await seedHabits(page, request);
        await onBookmarkRow(page);
        const name = (await selected(page)).name;
        const url = await page.evaluate((n) => window.dashboardInstance.bookmarks.find((b) => b.name === n).url, name);

        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.search-row-actions [role="menuitem"].is-selected')).toHaveText('Copy URL');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent.isActive())).toBe(false);
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(url);
    });

    test('Move opens the existing move list, with no panel left over it', async ({ page, request }) => {
        await seedHabits(page, request);
        await onBookmarkRow(page);
        await page.keyboard.press('ArrowRight');
        for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
        await expect(page.locator('.search-row-actions [role="menuitem"].is-selected')).toHaveText('Move to…');
        await page.keyboard.press('Enter');
        await expect(page.locator('#move-popover')).toBeVisible();
        expect((await selected(page)).active).toBe(false);
    });

    test('Right on a group header unfolds nothing, and a chip row still steps chips', async ({ page, request }) => {
        await seedHabits(page, request);
        await page.keyboard.press('>');
        await expect.poll(() => page.evaluate(() => window.dashboardInstance.searchComponent?.isActive?.())).toBe(true);
        expect((await selected(page)).type).toBe('command-group-header');
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.search-row-actions')).toHaveCount(0);

        // Recent holds chips: give it two and step through them.
        await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            s.searchHistory = ['alpha', 'beta'];
            s.updateSearch();
        });
        for (let i = 0; i < 12; i += 1) {
            if ((await page.evaluate(() => window.dashboardInstance.searchComponent.selectableMatches[window.dashboardInstance.searchComponent.selectedMatchIndex]?.type)) === 'history-chips') break;
            await page.keyboard.press('ArrowDown');
        }
        const chip = () => page.evaluate(() => window.dashboardInstance.searchComponent.selectedChipIndex);
        const before = await chip();
        await page.keyboard.press('ArrowRight');
        expect(await chip()).not.toBe(before);
        await expect(page.locator('.search-row-actions')).toHaveCount(0);
    });

    test('a result whose row is not on this page offers the actions that do not need a row', async ({ page, request }) => {
        await seedHabits(page, request);
        const labels = await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            const list = s._rowActionList({ bookmark: { name: 'Elsewhere', url: 'https://not-on-this-page.example/' } });
            return list.map((a) => a.label);
        });
        expect(labels).toEqual(['Open', 'Open in new tab', 'Copy URL', 'Show in list']);
    });

    test('in the recents tile band Right still steps tiles; a row below the band unfolds', async ({ page }) => {
        await page.setViewportSize({ width: 1500, height: 1000 });
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(async () => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const dash = window.dashboardInstance;
            const pageId = dash.currentPageId;
            const base = Date.now();
            const additions = Array.from({ length: 10 }, (_, i) => ({
                name: `RA Recent ${i + 1}`, url: `https://ra-recent-${base}-${i}.example/`, shortcut: '', category: '',
                checkStatus: false, lastOpened: base - i * 3600 * 1000, openCount: 2, createdAt: base - i * 3600 * 1000,
            }));
            const existing = await (await fetch(`/api/bookmarks?page=${pageId}`)).json();
            await api(`/api/bookmarks?page=${pageId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([...existing, ...additions]),
            });
            await dash.loadData();
        });
        await page.evaluate(() => window.dashboardInstance.searchComponent.openInRecentMode());
        await page.waitForSelector('.search-recent-tile', { timeout: 20_000 });

        const index = () => page.evaluate(() => window.dashboardInstance.searchComponent.selectedMatchIndex);
        expect(await index()).toBe(0);
        await page.keyboard.press('ArrowRight');
        expect(await index()).toBe(1);
        await expect(page.locator('.search-row-actions')).toHaveCount(0);

        // Past the four tiles a row is a row.
        await page.evaluate(() => {
            const s = window.dashboardInstance.searchComponent;
            s.selectedMatchIndex = 5;
            s.updateSelectionHighlight();
        });
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.search-row-actions')).toHaveCount(1);
    });

    test('an inbox result does not unfold: it is not a bookmark on a page', async ({ page, request }) => {
        await seedHabits(page, request);
        await onBookmarkRow(page);
        const unfolded = await page.evaluate(() => window.dashboardInstance.searchComponent.openRowActions({
            type: 'bookmark', inbox: true, bookmark: { name: 'In the inbox', url: 'https://inbox-only.example/' },
        }));
        expect(unfolded).toBe(false);
        await expect(page.locator('.search-row-actions')).toHaveCount(0);
    });

    test('Ctrl+Enter with the actions open folds them and opens the result in a new tab', async ({ page, request, context }) => {
        await seedHabits(page, request);
        await onBookmarkRow(page);
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('.search-row-actions')).toHaveCount(1);
        const opened = context.waitForEvent('page', { timeout: 10_000 });
        await page.keyboard.press('Control+Enter');
        await opened;
        await expect(page.locator('.search-row-actions')).toHaveCount(0);
    });

    test('the unfolded menu is announced: aria-expanded and the selected action', async ({ page, request }) => {
        await seedHabits(page, request);
        await onBookmarkRow(page);
        const row = page.locator('#search-matches .keyboard-selected').first();
        await page.keyboard.press('ArrowRight');
        await expect(row).toHaveAttribute('aria-expanded', 'true');
        const selectedId = () => page.locator('.search-row-actions .is-selected').getAttribute('id');
        await expect(row).toHaveAttribute('aria-activedescendant', (await selectedId()) || '');
        await page.keyboard.press('ArrowDown');
        await expect(row).toHaveAttribute('aria-activedescendant', (await selectedId()) || '');
        await page.keyboard.press('ArrowLeft');
        await expect(row).not.toHaveAttribute('aria-expanded', 'true');
        await expect(row).not.toHaveAttribute('aria-activedescendant', /.+/);
    });
});

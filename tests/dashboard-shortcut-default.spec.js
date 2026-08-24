// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A shortcut opens the moment it matches — the default, again.
 *
 * v1.2.0 made Enter the default: typing narrowed the list and nothing opened by
 * itself. The reason was real — an instant shortcut can swallow an ordinary word
 * that starts with the same letters, and which words survive depends on the
 * shortcuts you own — but it was the rare case, and the cure charged every
 * shortcut a second keystroke on every use. v1.3.0 puts the default back and
 * says so in the release notes.
 *
 * What this file pins is the default itself, since that is what changed twice.
 * The three modes' own behaviour is tests/shortcut-open-mode.spec.js, and the
 * escape hatch is asserted here only far enough to show it is still there.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
}

const query = (page) => page.evaluate(() => document.querySelector('.search-query')?.textContent || '');

/** A bookmark whose shortcut is a prefix of an ordinary word, plus a longer one. */
async function seedShortcut(page, name, shortcut) {
    await page.evaluate(async ({ name, shortcut }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const page_ = window.dashboardInstance.settings.currentPage || 1;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: page_,
                bookmark: {
                    name,
                    url: `https://${name.toLowerCase()}.example.com`,
                    pageId: page_,
                    shortcut,
                    category: '',
                },
            }),
        });
    }, { name, shortcut });
    // The search index is built from what the page loaded, so a seed only counts
    // once the dashboard has fetched it again.
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction((mark) => (window.dashboardInstance?.allBookmarks || [])
        .some((b) => b.shortcut === mark), shortcut, { timeout: 15_000 });
    await page.waitForTimeout(400);
}

/** Record what the search asks to open rather than following it: this
 *  environment has no network, so a real open lands on an error page. */
async function watchOpens(page) {
    await page.evaluate(() => {
        const search = window.dashboardInstance.searchComponent;
        window.__opened = [];
        const real = search.openBookmark.bind(search);
        search.openBookmark = (bookmark, ...rest) => {
            window.__opened.push(String(bookmark?.url || ''));
            return real(bookmark, ...rest);
        };
    });
}

const opened = (page) => page.evaluate(() => window.__opened || []);

test.describe('the shortcut default', () => {
    test('a fresh install opens the shortcut without Enter', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Zenith', 'ZN');
        // The setting is read from what the server sent, so this is the default
        // as an install actually receives it — not one written by the test.
        expect(await page.evaluate(() =>
            window.dashboardInstance.searchComponent.shortcutOpenMode())).toBe('instant');

        await watchOpens(page);
        await page.keyboard.type('zn', { delay: 60 });
        await expect.poll(() => opened(page), { timeout: 5_000 })
            .toEqual([expect.stringContaining('zenith.example.com')]);
    });

    test('and the way out of it is still there', async ({ page }) => {
        await dashboard(page);
        // Not "IN"/Intranet: shortcut-open-mode.spec.js seeds that pair for its
        // own delay case, and the server refuses a second bookmark with the
        // same shortcut — the two specs share one data directory.
        await seedShortcut(page, 'Ivory-tower', 'IV');
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.shortcutOpenMode = 'enter';
            d.searchComponent.settings = d.settings;
        });

        // The cost the default carries: "IV" matches two keystrokes into
        // "ivory". Under Enter the word arrives whole, which is why the mode
        // exists rather than being dropped.
        await watchOpens(page);
        await page.keyboard.type('ivory', { delay: 55 });
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^ivory$/i);
        expect(await opened(page)).toEqual([]);
    });
});

test.describe('the letter you are about to assign', () => {
    test('says what the dashboard does with it, and when', async ({ page }) => {
        await dashboard(page);
        const notes = await page.evaluate(() => ({
            j: window.ShortcutKeys?.gridKeyNote?.('J') || '',
            c: window.ShortcutKeys?.gridKeyNote?.('C') || '',
            jira: window.ShortcutKeys?.gridKeyNote?.('JI') || '',
            free: window.ShortcutKeys?.gridKeyNote?.('Q') || '',
        }));
        // j moves the cursor, but only while a row is selected — so the bookmark
        // is still reachable the rest of the time.
        expect(notes.j).toMatch(/selected/i);
        // c adds a category whether or not a row is selected: this one is never
        // reachable by its letter.
        expect(notes.c).toMatch(/cannot/i);
        // The first keystroke is what decides, so a two-letter shortcut starting
        // with j carries the same warning.
        expect(notes.jira).not.toBe('');
        // And a letter the grid does not want says nothing at all.
        expect(notes.free).toBe('');
    });

    test('lists the shortcuts the page has already spoken for', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Almanac', 'AL');

        const note = await page.evaluate(() => window.ShortcutKeys?.usedShortcutsNote?.(
            window.dashboardInstance.allBookmarks, null,
            { pageId: window.dashboardInstance.settings.currentPage || 1 }) || '');
        expect(note).toMatch(/AL/);
    });

    test('the inline editor says it beside the field', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() =>
            !!document.querySelector('.bookmark-link.keyboard-selected')), { timeout: 5_000 }).toBe(true);

        // Through the row's own menu, which is the route that does not depend on
        // where the keyboard cursor happens to be.
        await page.locator('.bookmark-link').first().click({ button: 'right' });
        await expect(page.locator('.bookmark-context-menu')).toBeVisible({ timeout: 10_000 });
        await page.locator('.bookmark-context-menu').getByText(/^edit/i).first().click();
        const inputs = page.locator('input.bookmark-inline-input');
        await expect(inputs.first()).toBeVisible({ timeout: 10_000 });

        // The shortcut input is the short one at the end of the row.
        const shortcutInput = page.locator('input.bookmark-inline-input[maxlength="5"]').first();
        await shortcutInput.fill('J');
        // Several fields carry a conflict slot; this is the one under the
        // shortcut input.
        const hint = page.locator('.bookmark-inline-conflict').filter({ hasText: /dashboard/i }).first();
        // It used to say one thing only — "already in use" — and stay silent
        // about the letter the grid had already claimed.
        await expect(hint).toBeVisible({ timeout: 5_000 });
        await expect(hint).toContainText(/dashboard/i);
    });
});

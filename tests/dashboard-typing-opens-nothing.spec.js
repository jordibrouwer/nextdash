// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Typing filters; Enter opens.
 *
 * A bookmark shortcut used to fire the moment the query matched it exactly and
 * no longer shortcut shared its letters. Whether your own word survived
 * therefore depended on which *other* bookmarks you happened to own, and
 * changed every time you added one: on an install with 200 shortcuts, eight of
 * thirteen ordinary words were swallowed mid-word — "invoice" opened something
 * at "in" and left "voice" behind, "github" arrived as "hub".
 *
 * The exact match still leads the list, so a shortcut costs one keystroke more
 * than it did. What it buys is a keyboard that behaves the same tomorrow as it
 * does today.
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

test.describe('a word survives its own first letters', () => {
    test('typing past a shortcut leaves the query whole', async ({ page }) => {
        await dashboard(page);
        // "IN" is exactly the kind of shortcut that used to eat a word: it
        // matches after two keystrokes, and nothing longer shares it.
        await seedShortcut(page, 'Intranet', 'IN');

        await page.keyboard.type('invoice', { delay: 55 });
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^invoice$/i);
    });

    test('the shortcut still opens the bookmark, with Enter', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Zenith', 'ZN');

        await page.keyboard.type('zn', { delay: 60 });
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^zn$/i);
        // The exact match leads the list, so Enter opens the bookmark the
        // shortcut names rather than something else.
        await expect(page.locator('.search-match').first()).toContainText(/zenith/i);

        // What Enter asks to open, rather than where the browser ends up: this
        // environment has no network, so the new tab lands on an error page.
        await page.evaluate(() => {
            const search = window.dashboardInstance.searchComponent;
            window.__opened = [];
            const real = search.openBookmark.bind(search);
            search.openBookmark = (bookmark, ...rest) => {
                window.__opened.push(String(bookmark?.url || ''));
                return real(bookmark, ...rest);
            };
        });
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate(() => window.__opened || []), { timeout: 5_000 })
            .toEqual([expect.stringContaining('zenith.example.com')]);
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

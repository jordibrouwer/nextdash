// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * What typing a bookmark shortcut does is a choice, not a rule.
 *
 * Until v1.2.0 a shortcut fired the moment the query matched it and nothing
 * longer shared its letters, which swallowed ordinary words mid-word; v1.2.0
 * made Enter the only opener. Both are defensible, so both are here, with a
 * middle that opens once you stop typing — and Enter stays the default,
 * because it is the one whose behaviour does not depend on the shortcuts you
 * happen to own.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
}

/** A bookmark whose shortcut is the start of an ordinary word. */
async function seedShortcut(page, name, shortcut) {
    await page.evaluate(async ({ name, shortcut }) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const pageId = window.dashboardInstance.settings.currentPage || 1;
        await api('/api/bookmarks/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                page: pageId,
                bookmark: { name, url: `https://${name.toLowerCase()}.example.com`, pageId, shortcut, category: '' },
            }),
        });
    }, { name, shortcut });
    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction((mark) => (window.dashboardInstance?.allBookmarks || [])
        .some((b) => b.shortcut === mark), shortcut, { timeout: 20_000 });
    await page.waitForTimeout(400);
}

/** Record what the search asks to open, rather than following it. */
async function watchOpens(page, mode) {
    await page.evaluate((m) => {
        const search = window.dashboardInstance.searchComponent;
        window.dashboardInstance.settings.shortcutOpenMode = m;
        search.settings = window.dashboardInstance.settings;
        window.__opened = [];
        const real = search.openBookmark.bind(search);
        search.openBookmark = (bookmark, ...rest) => {
            window.__opened.push(String(bookmark?.url || ''));
            return real(bookmark, ...rest);
        };
    }, mode);
}

const opened = (page) => page.evaluate(() => window.__opened || []);
// The query as the search component holds it. The line on screen is repainted
// on a debounce, so reading the DOM mid-word measures the repaint, not the state.
const query = (page) => page.evaluate(() => window.dashboardInstance.searchComponent.currentQuery || '');

test.describe('typing a bookmark shortcut', () => {
    test('enter: typing opens nothing, Enter opens the match', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Ledger', 'LE');
        await watchOpens(page, 'enter');

        await page.keyboard.type('le', { delay: 60 });
        await page.waitForTimeout(900);
        expect(await opened(page)).toEqual([]);
        await page.keyboard.press('Enter');
        await expect.poll(() => opened(page), { timeout: 5_000 })
            .toEqual([expect.stringContaining('ledger.example.com')]);
    });

    test('instant: the match opens on the keystroke that completes it', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Meteor', 'ME');
        await watchOpens(page, 'instant');

        await page.keyboard.type('me', { delay: 60 });
        await expect.poll(() => opened(page), { timeout: 5_000 })
            .toEqual([expect.stringContaining('meteor.example.com')]);
    });

    test('delay: it waits, and a word typed past the shortcut is left alone', async ({ page }) => {
        await dashboard(page);
        await seedShortcut(page, 'Invoice-app', 'IN');
        await watchOpens(page, 'delay');

        // Typing straight through the shortcut: the pause never arrives while
        // the word is still being typed, so nothing opens and the word is whole.
        // "inside" rather than "invoice" deliberately — c is the one letter the
        // grid keeps for itself (it adds a category), which is documented and
        // has nothing to do with the mode under test.
        await page.keyboard.type('inside', { delay: 45 });
        expect(await opened(page)).toEqual([]);
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^inside$/i);

        // And the same shortcut on its own does open, once the typing stops.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.keyboard.type('in', { delay: 60 });
        await expect.poll(() => opened(page), { timeout: 5_000 })
            .toEqual([expect.stringContaining('invoice-app.example.com')]);
    });
});

test.describe('Inbox is its own tab in Behavior', () => {
    test('the tab exists and carries the inbox settings', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.waitForSelector('[data-behavior-tab]', { timeout: 15_000 });

        const tabs = await page.locator('[data-behavior-tab]').evaluateAll(
            (els) => els.map((el) => el.getAttribute('data-behavior-tab')));
        expect(tabs).toContain('inbox');
        // Search keeps its name for what it is now, without the inbox tacked on.
        const searchLabel = await page.locator('[data-behavior-tab="search"]').innerText();
        expect(searchLabel.toLowerCase()).not.toContain('inbox');

        await page.locator('[data-behavior-tab="inbox"]').click();
        await page.waitForTimeout(600);
        const body = await page.locator('#config-behavior-body').innerText();
        expect(body.toLowerCase()).toContain('inbox');
        expect(await page.locator('#config-behavior-body [data-behavior-field="inboxEnabled"]').count())
            .toBeGreaterThan(0);
    });

    test('the shortcut choice is on Search, as three cards with an info button', async ({ page }) => {
        await dashboard(page);
        await page.evaluate(() => {
            const c = window.dashboardInstance.config;
            c.openConfigView('behavior');
            c.behaviorTab = 'search';
            c.render();
        });
        await page.waitForTimeout(800);

        const cards = page.locator('#config-behavior-body [data-behavior-field="shortcutOpenMode"][data-behavior-type="cards"]');
        expect(await cards.count()).toBe(3);
        await expect(page.locator('#config-behavior-body [data-info-field="shortcutOpenMode"]')).toHaveCount(1);
    });
});

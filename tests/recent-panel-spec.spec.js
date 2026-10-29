// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Recent bookmarks, drawn the way the overlays spec draws a panel.
 *
 * It was a 52rem sheet of cards: each row an outlined box, the name on one
 * line and its category on the next, a bordered pill for the time and a count
 * beside it, and the row opened with its own position in the list. Four
 * bookmarks filled a window, and the loudest thing on a panel about four
 * bookmarks was a full-width button about all of them.
 *
 * It is drawn as a column of two tiles across on one slab: each tile leads
 * with the day it was opened, then the name and the key that opens it, the
 * weekday and time, where it lives and how often. A thin foot holds the pager.
 * What these tests hold is what a tile says, not its pixels.
 */

async function seedRecent(page, count) {
    await page.evaluate(async (bookmarkCount) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        const dash = window.dashboardInstance;
        const pageId = dash.currentPageId;
        const base = Date.now();
        const additions = Array.from({ length: bookmarkCount }, (_, index) => ({
            name: `Recent spec ${index + 1}`,
            url: `https://example.com/recent-spec-${base}-${index}`,
            shortcut: '',
            category: '',
            checkStatus: false,
            lastOpened: base - index * 1000,
            openCount: 2,
            createdAt: base - index * 1000,
        }));
        const response = await fetch(`/api/bookmarks?page=${pageId}`);
        const existing = await response.json();
        await api(`/api/bookmarks?page=${pageId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([...existing, ...additions]),
        });
        await dash.loadData();
    }, count);
}

async function openRecent(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await seedRecent(page, 6);

    /*
     * This panel belongs to the recents button, and the button is off by
     * default since the header was rebuilt -- with it off, `*` opens the
     * search panel in its recents mode instead. Switch the button on, which is
     * what anyone still using this panel has done.
     */
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.showRecentButton = true;
        d.setupDOM?.();
        await d.saveSettings?.();
    });
    await expect(page.locator('body')).toHaveAttribute('data-show-recent-button', 'true');

    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('Shift+Digit8');
    await page.waitForSelector('.recent-bookmarks-modal-item', { timeout: 20_000 });
}

test.describe('the recent bookmarks panel', () => {
    test('a tile leads with the day it was opened, and says when and how often', async ({ page }) => {
        await openRecent(page);

        const seen = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const tile = document.querySelector('.recent-bookmarks-modal-item');
            const name = tile.querySelector('.recent-bookmarks-modal-name').textContent.trim();
            const bookmark = d.recent.recentPool().find((b) => b.name === name);
            const opened = new Date(Number(bookmark.lastOpened));
            const lang = d.settings?.language || undefined;
            return {
                day: tile.querySelector('.recent-bookmarks-modal-date b')?.textContent?.trim(),
                wantDay: opened.toLocaleDateString(lang, { day: 'numeric' }),
                recency: tile.querySelector('.recent-bookmarks-modal-recency')?.textContent?.trim() || '',
                wantTime: opened.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
                title: tile.getAttribute('title') || '',
            };
        });
        expect(seen.day, 'the date block shows another day').toBe(seen.wantDay);
        expect(seen.recency, 'the tile does not say the time it was opened').toContain(seen.wantTime);
        expect(seen.title.length, 'the full date is not on the tile').toBeGreaterThan(0);
        await expect(page.locator('.recent-bookmarks-modal-item').first().locator('.recent-bookmarks-modal-opens')).toContainText('×');
    });

    test('the tiles share one slab', async ({ page }) => {
        await openRecent(page);
        // The slab is a depth cue, and the default depth is flat, which draws
        // none -- so this is asked of a step that draws depth at all.
        await page.evaluate(() => document.body.setAttribute('data-depth', 'rich'));
        await expect.poll(() => page.evaluate(() => {
            const bg = (el) => window.getComputedStyle(el).backgroundColor;
            const c = bg(document.querySelector('.recent-bookmarks-modal-list'));
            return c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent'
                && c !== bg(document.querySelector('.recent-bookmarks-modal'));
        })).toBe(true);

        const same = await page.evaluate(() => {
            const bg = (el) => window.getComputedStyle(el).backgroundColor;
            const list = document.querySelector('.recent-bookmarks-modal-list');
            const panel = document.querySelector('.recent-bookmarks-modal');
            return {
                listHasGround: bg(list) !== 'rgba(0, 0, 0, 0)' && bg(list) !== 'transparent',
                differsFromPanel: bg(list) !== bg(panel),
            };
        });

        expect(same.listHasGround, 'the list has no ground of its own').toBe(true);
        expect(same.differsFromPanel, 'the slab is the same colour as the panel').toBe(true);
    });

    test('the row leads with the site, not with a number', async ({ page }) => {
        await openRecent(page);

        const first = page.locator('.recent-bookmarks-modal-item').first();
        await expect(first.locator('.recent-bookmarks-modal-icon')).toBeVisible();
        expect(await page.locator('.recent-bookmarks-modal-rank').count(),
            'the rank numbers are back').toBe(0);
    });

    test('the header names the key, and the panel follows the header row', async ({ page }) => {
        await openRecent(page);

        const chip = await page.locator('.recent-bookmarks-modal-key').first().textContent();
        expect((chip || '').trim(), 'the header does not name the key that opens it').toBe('*');

        /*
         * It opens in the middle of the window like every dashboard modal,
         * in a column of its own, 46rem at most, since a line across the
         * whole band was too wide to read.
         *
         * Measured once the panel has finished rising in: read during the
         * rise its box is still drawn at the entrance scale, a few percent
         * short of the row.
         */
        await page.waitForFunction(() => {
            const overlay = document.querySelector('#app-modal');
            return overlay && overlay.getAnimations({ subtree: true }).every((a) => a.playState !== 'running');
        });
        const seen = await page.evaluate(() => {
            const panel = document.querySelector('.recent-bookmarks-modal').getBoundingClientRect();
            const row = document.querySelector('.header-top').getBoundingClientRect();
            return {
                width: Math.round(panel.width),
                rowWidth: Math.round(row.width),
                mid: Math.round(panel.x + panel.width / 2),
                winMid: Math.round(document.documentElement.clientWidth / 2),
            };
        });
        expect(seen.width, `the panel is ${seen.width}px wide`).toBeLessThanOrEqual(736);
        expect(Math.abs(seen.mid - seen.winMid), 'the panel is not centred in the window').toBeLessThanOrEqual(1);
    });

    test('the foot says what is on screen instead of a button saying close', async ({ page }) => {
        await openRecent(page);

        await expect(page.locator('.recent-bookmarks-modal-foot')).toBeVisible();
        const actions = await page.evaluate(() => {
            const el = document.querySelector('.recent-bookmarks-modal .modal-actions');
            return el ? window.getComputedStyle(el).display : 'absent';
        });
        // The header closes it, and says so. A wide Close button under the list
        // was a third way of saying what Esc and the × already say.
        expect(actions, 'the wide Close button is back').toBe('none');
        await expect(page.locator('.recent-bookmarks-modal-close')).toBeVisible();
    });

    test('the row the keyboard is on carries the accent bar', async ({ page }) => {
        await openRecent(page);

        // Selection in this panel is focus: the arrow keys move it down the list.
        await page.keyboard.press('ArrowDown');
        const shadow = await page.evaluate(() =>
            window.getComputedStyle(document.activeElement).boxShadow);

        expect(shadow, 'the focused row is not marked at all').not.toBe('none');
        expect(shadow, 'the focused row has no bar on its left edge').toContain('inset');
    });
});

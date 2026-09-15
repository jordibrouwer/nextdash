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
 * The spec draws it as a narrow panel of quiet rows in one slab -- icon, name,
 * category, time on a single line -- with the key that opens it beside the
 * name and a thin foot under the list. What these tests hold is the shape,
 * not the pixels: one line per bookmark, one ground under all of them, and
 * the panel narrow enough to read down.
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
    await page.waitForTimeout(200);

    // Through the key someone presses, not through the renderer.
    await page.keyboard.press('Shift+Digit8');
    await page.waitForSelector('.recent-bookmarks-modal-item', { timeout: 20_000 });
}

test.describe('the recent bookmarks panel', () => {
    test('a bookmark is one line, not a card', async ({ page }) => {
        await openRecent(page);

        const shape = await page.evaluate(() => {
            const row = document.querySelector('.recent-bookmarks-modal-item');
            const cs = window.getComputedStyle(row);
            const name = row.querySelector('.recent-bookmarks-modal-name').getBoundingClientRect();
            const detail = row.querySelector('.recent-bookmarks-modal-detail').getBoundingClientRect();
            return {
                height: Math.round(row.getBoundingClientRect().height),
                // Stacked, the category sat on its own line under the name.
                sameLine: Math.abs(Math.round(name.top) - Math.round(detail.top)) <= 4,
                borderWidth: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth),
            };
        });

        expect(shape.sameLine, 'the category is on its own line under the name').toBe(true);
        // 52px: the row every list in the product draws, since the panel became
        // a sheet across the page rather than a narrow column.
        expect(shape.height, `a row is ${shape.height}px tall`).toBeLessThanOrEqual(54);
        /*
         * A hairline under a row is the list's own rule, the way the pages
         * sheet draws it; what must not come back is the box around each one --
         * ten outlined cards are ten borders competing with the panel's own.
         */
        const box = await page.evaluate(() => {
            const cs = window.getComputedStyle(document.querySelector('.recent-bookmarks-modal-item'));
            return {
                top: parseFloat(cs.borderTopWidth),
                left: parseFloat(cs.borderLeftWidth),
                radius: parseFloat(cs.borderTopLeftRadius),
            };
        });
        expect(box.top + box.left, 'the row draws its own box').toBe(0);
        expect(box.radius, 'the row is a card again').toBe(0);
    });

    test('the rows share one slab rather than each bringing a box', async ({ page }) => {
        await openRecent(page);
        // The slab is a depth cue, and the default depth is flat, which draws
        // none -- so this is asked of a step that draws depth at all.
        await page.evaluate(() => document.body.setAttribute('data-depth', 'rich'));
        await page.waitForTimeout(150);

        const same = await page.evaluate(() => {
            const bg = (el) => window.getComputedStyle(el).backgroundColor;
            const list = document.querySelector('.recent-bookmarks-modal-list');
            const panel = document.querySelector('.recent-bookmarks-modal');
            return {
                listHasGround: bg(list) !== 'rgba(0, 0, 0, 0)' && bg(list) !== 'transparent',
                differsFromPanel: bg(list) !== bg(panel),
                rowsTransparent: [...document.querySelectorAll('.recent-bookmarks-modal-item')]
                    .every((r) => bg(r) === 'rgba(0, 0, 0, 0)' || bg(r) === 'transparent'),
            };
        });

        expect(same.listHasGround, 'the list has no ground of its own').toBe(true);
        expect(same.differsFromPanel, 'the slab is the same colour as the panel').toBe(true);
        expect(same.rowsTransparent, 'a resting row paints its own ground').toBe(true);
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
         * It was a 440px column you read down. It hangs from the header band
         * now and takes that band's own width, because it is opened from the
         * bar in it -- the same bargain the pages panel makes.
         */
        const seen = await page.evaluate(() => {
            const panel = document.querySelector('.recent-bookmarks-modal').getBoundingClientRect();
            const row = document.querySelector('.header-top').getBoundingClientRect();
            return {
                width: Math.round(panel.width),
                rowWidth: Math.round(row.width),
                mid: Math.round(panel.x + panel.width / 2),
                rowMid: Math.round(row.x + row.width / 2),
            };
        });
        expect(seen.width, `the panel is ${seen.width}px wide`).toBe(seen.rowWidth);
        expect(seen.mid, 'the panel is not centred on the header row').toBe(seen.rowMid);
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

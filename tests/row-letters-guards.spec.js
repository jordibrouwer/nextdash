// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent, ensureBookmarksDashboardView } = require('./e2e-helpers');

/**
 * The guards around plain letters on a row, and the strip that says what the
 * keys do: the mode strip on the page-name line, the label on the focused row,
 * Undo after pin and move, and a cursor that lapses after ten idle seconds.
 */

async function load(page, width = 1400) {
    await page.setViewportSize({ width, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await ensureBookmarksDashboardView(page);
}

const strip = (page) => page.locator('#mode-strip');
const index = (page) => page.evaluate(() => window.dashboardInstance.keyboardNavigation.currentIndex);

async function cursorDown(page) {
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => index(page)).toBeGreaterThanOrEqual(0);
}

test.describe('mode strip', () => {
    test('absent on an idle dashboard', async ({ page }) => {
        await load(page);
        await expect(strip(page)).toContainText('Search');
    });

    test('Cursor after ArrowDown, gone after Esc', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await expect(strip(page)).toBeVisible();
        await expect(strip(page)).toContainText('Cursor');
        await expect(strip(page).locator('kbd', { hasText: 'Esc' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(strip(page)).toContainText('Search');
    });

    test('3 selected after ticking three rows with x', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('x');
        await expect(strip(page)).toContainText('3 selected');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(strip(page)).toContainText('Search');
    });

    test('Edit mode after Shift+E, gone when it ends', async ({ page }) => {
        await load(page);
        await page.keyboard.press('Shift+E');
        await expect(strip(page)).toContainText('Edit mode');
        await page.keyboard.press('Shift+E');
        await expect(strip(page)).toContainText('Search');
    });

    for (const width of [1100, 1900]) {
        test(`does not overlap the page name, the clock or the page buttons at ${width}px`, async ({ page }) => {
            await load(page, width);
            await cursorDown(page);
            await expect(strip(page)).toBeVisible();
            const hits = await page.evaluate(() => {
                const box = (el) => el.getBoundingClientRect();
                const s = box(document.getElementById('mode-strip'));
                const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
                return ['.section-controls .title', '.date-time-line', '.header-track', '.header-actions']
                    .map((sel) => document.querySelector(sel))
                    .filter(Boolean)
                    .filter((el) => overlap(s, box(el)))
                    .map((el) => el.className);
            });
            expect(hits).toEqual([]);
        });
    }

    test('is large enough to read', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await expect(strip(page)).toBeVisible();
        const size = await strip(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
        expect(size).toBeGreaterThanOrEqual(15);
    });

    test('hidden below 900px', async ({ page }) => {
        await load(page, 880);
        await cursorDown(page);
        await expect(strip(page)).toBeHidden();
    });
});

test('no label is drawn on the bookmark row: the strip is the only hint', async ({ page }) => {
    await load(page);
    await cursorDown(page);
    await expect(strip(page)).toBeVisible();
    await expect(page.locator('.row-letter-hint')).toHaveCount(0);
});

test.describe('undo', () => {
    const pinned = (page) => page.evaluate(() => !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.pinned);

    test('p shows Undo, and clicking it unpins', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        const before = await pinned(page);
        await page.keyboard.press('p');
        await expect.poll(() => pinned(page), { timeout: 5000 }).toBe(!before);
        const action = page.locator('#app-notification.show .app-notification-action');
        await expect(action).toBeVisible({ timeout: 5000 });
        await action.click();
        await expect.poll(() => pinned(page), { timeout: 5000 }).toBe(before);
    });

    test('Ctrl+Z after p puts the pin back', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        const before = await pinned(page);
        await page.keyboard.press('p');
        await expect.poll(() => pinned(page), { timeout: 5000 }).toBe(!before);
        await expect(page.locator('#app-notification.show.has-action')).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Control+z');
        await expect.poll(() => pinned(page), { timeout: 5000 }).toBe(before);
    });

    test('a move shows Undo and Ctrl+Z files the bookmark back', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        const category = () => page.evaluate(() => String(window.dashboardInstance.keyboardNavigation.getSelectedBookmark()?.category));
        const before = await category(page);
        await page.keyboard.press('m');
        await expect(page.locator('#move-popover')).toBeVisible();
        const target = page.locator('#move-popover .move-popover-item[data-type="category"]:not(.is-current)').first();
        await expect(target).toBeVisible();
        await target.click();
        await expect.poll(() => category(page), { timeout: 5000 }).not.toBe(before);
        await expect(page.locator('#app-notification.show.has-action')).toBeVisible({ timeout: 5000 });
        await page.keyboard.press('Control+z');
        await expect.poll(() => category(page), { timeout: 5000 }).toBe(before);
    });
});

test.describe('the cursor lapses', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.install();
        await load(page);
    });

    test('after 10 idle seconds the cursor is gone and a letter searches', async ({ page }) => {
        await cursorDown(page);
        await page.clock.runFor(10_500);
        await expect.poll(() => index(page)).toBe(-1);
        await expect(strip(page)).toContainText('Search');
        await page.keyboard.press('t');
        // The page clock is faked: let the search line's own timers run.
        await page.clock.runFor(600);
        await expect(page.locator('#shortcut-search.show')).toBeVisible({ timeout: 5000 });
        await expect(page.locator('#tag-popover')).toHaveCount(0);
    });

    test('a key within the window keeps it', async ({ page }) => {
        await cursorDown(page);
        await page.clock.runFor(6000);
        await page.keyboard.press('ArrowDown');
        await page.clock.runFor(6000);
        expect(await index(page)).toBeGreaterThanOrEqual(0);
    });

    test('it does not lapse while the tag popover is open', async ({ page }) => {
        await cursorDown(page);
        await page.keyboard.press('t');
        await page.clock.runFor(600);
        await expect(page.locator('#tag-popover')).toBeVisible();
        // A popover parks the cursor while it is open (the popover is the mode),
        // so the clock must not take it away for good: closing hands it back.
        await page.clock.runFor(15_000);
        await expect(page.locator('#tag-popover')).toBeVisible();
        await page.keyboard.press('Escape');
        await page.clock.runFor(600);
        await expect(page.locator('#tag-popover')).toHaveCount(0);
        await expect.poll(() => index(page)).toBeGreaterThanOrEqual(0);
    });
});

test('the strip appearing does not make the page-name line taller', async ({ page }) => {
    await load(page);
    const line = () => page.evaluate(() => document.querySelector('.section-controls .title-wrapper').getBoundingClientRect().height);
    const before = await line();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#mode-strip')).toBeVisible();
    expect(await line()).toBe(before);
});

test.describe('review fixes', () => {
    test('the idle lapse does not commit a half-typed rename', async ({ page }) => {
        await page.clock.install();
        await load(page);
        await cursorDown(page);
        await page.keyboard.press('Shift+Home');
        await expect(page.locator('.category-title:focus')).toHaveCount(1);
        await page.keyboard.press('F2');
        const input = page.locator('.category-title--renaming input, .category-rename-input').first();
        await expect(input).toBeVisible();
        await page.keyboard.type('Half');
        await page.clock.runFor(11_000);
        await expect(input).toBeVisible();
        await expect(input).toHaveValue(/Half/);
        await page.keyboard.press('Escape');
    });

    test('Shift+M with a row opens no edit mode and names the plain m', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await page.evaluate(() => {
            window.__toasts = [];
            window.dashboardInstance.showNotification = (m) => { window.__toasts.push(String(m)); };
        });
        await page.keyboard.press('Shift+M');
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => document.body.getAttribute('data-edit-mode'))).not.toBe('on');
        expect(await page.evaluate(() => window.__toasts.some((m) => /press M/i.test(m)))).toBe(true);
    });

    test('after x x x the letters m and d are bulk, whatever row the cursor is on', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        for (let i = 0; i < 3; i += 1) await page.keyboard.press('x');
        await expect(page.locator('#mode-strip')).toContainText('3 selected');
        await page.evaluate(() => {
            window.__bulkMove = 0;
            window.dashboardInstance.multiSelect.openMovePopover = () => { window.__bulkMove += 1; };
        });
        await page.keyboard.press('m');
        await expect.poll(() => page.evaluate(() => window.__bulkMove), { timeout: 3000 }).toBe(1);
        await expect(page.locator('#move-popover')).toHaveCount(0);
    });

    test('the strip stops saying Cursor once the row is gone', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await expect(page.locator('#mode-strip')).toBeVisible();
        await page.evaluate(() => {
            const kn = window.dashboardInstance.keyboardNavigation;
            kn.navigableElements[kn.currentIndex].remove();
            kn.updateNavigableElements();
        });
        await expect(page.locator('#mode-strip')).toContainText('Search');
        await expect(page.locator('.row-letter-hint')).toHaveCount(0);
    });

    test('a letter with focus on the // handle of a title never acts on the parked row', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await page.keyboard.press('Shift+Home');
        await page.keyboard.press('Tab');
        await expect(page.locator('.category-reorder-handle:focus')).toHaveCount(1);
        await page.keyboard.press('d');
        await page.waitForTimeout(400);
        await expect(page.locator('#delete-popover')).toHaveCount(0);
    });

    test('the strip is not rewritten while the state is unchanged', async ({ page }) => {
        await load(page);
        await cursorDown(page);
        await expect(page.locator('#mode-strip')).toBeVisible();
        const mutations = await page.evaluate(async () => {
            let n = 0;
            const mo = new MutationObserver((list) => { n += list.length; });
            mo.observe(document.getElementById('mode-strip'), { childList: true, subtree: true, characterData: true });
            return new Promise((resolve) => {
                // The same row, looked at again and again: nothing to rewrite.
                for (let i = 0; i < 5; i += 1) window.dashboardInstance.keyboardNavigation._syncModeStrip();
                setTimeout(() => { mo.disconnect(); resolve(n); }, 400);
            });
        });
        expect(mutations).toBe(0);
    });
});

test('the strip is for the keyboard: a mouse press hides it, a key brings it back', async ({ page }) => {
    await load(page);
    await cursorDown(page);
    await expect(strip(page)).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(strip(page)).toBeHidden();
    // Moving the cursor by key shows it again.
    await page.keyboard.press('ArrowDown');
    await expect(strip(page)).toBeVisible();
});

test('the dashboard legend is one line in priority order and is not sticky', async ({ page }) => {
    await load(page, 1400);
    await page.evaluate(() => { window.dashboardInstance.settings.showGridKeyLegend = true; window.dashboardInstance.renderDashboard({ animate: false }); });
    const legend = page.locator('.dashboard-legend');
    await expect(legend).toBeVisible();
    expect(await legend.evaluate((el) => getComputedStyle(el).position)).not.toBe('sticky');
    expect(await legend.locator('.dashboard-legend-line').count()).toBe(1);
    // The first entries are the most useful ones, Shift+H is among the first shown.
    const first = await legend.locator('kbd').allInnerTexts();
    expect(first.slice(0, 3)).toEqual(['↑ ↓ ← →', 'Enter', 'x']);
    expect(first).toContain('Shift+H');
    // Denser: the keys do not need more rows than a handful at this width.
    const rows = await legend.locator('span:has(> kbd):visible').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    expect(rows).toBeLessThanOrEqual(3);
});

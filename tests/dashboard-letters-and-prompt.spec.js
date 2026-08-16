// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The dashboard has a search line that is always listening, so every letter is a
 * character someone might be typing. The rule that keeps typing and the grid
 * apart is the cursor: a letter acts on the grid once a row is selected, and
 * types before that. Arrows, Home/End and Tab are the way in, because none of
 * them is a character.
 *
 * Two keys did not follow it. `g` armed its chord unconditionally, so a search
 * for "github" arrived as "ithub". And `j`/`k` moved the cursor without taking
 * the key, so the search line then typed the letter and cleared the very
 * selection the keypress had just made.
 *
 * `c` is the deliberate exception: "c adds a category" is pinned by
 * create-page-category-from-dashboard.spec.js, which asserts both that it works
 * with no row focused and that it must not reach the shortcut search.
 *
 * The prompt is the other half: it now names the key that starts each mode, and
 * clears itself when the query is abandoned rather than leaving the old text on
 * screen.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.waitForTimeout(500);
}

const query = (page) => page.evaluate(() => document.querySelector('.search-query')?.textContent || '');
const cursorRow = (page) => page.evaluate(() =>
    document.querySelector('.bookmark-link.keyboard-selected')?.getAttribute('data-bookmark-url') || null);

test.describe('a letter is a letter until the cursor is in the grid', () => {
    test('a word starting with g reaches the search line whole', async ({ page }) => {
        await dashboard(page);
        // "google" used to arrive as "oogle": the chord armed on the idle
        // dashboard and stopped the key before search ever saw it.
        await page.keyboard.type('goo', { delay: 60 });
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^goo$/i);
    });

    test('the arrows still enter the grid from anywhere', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).not.toBeNull();
        expect(await query(page)).toBe('');
    });

    test('j and k move once the cursor is there, and type nothing', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).not.toBeNull();
        const first = await cursorRow(page);

        await page.keyboard.press('j');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).not.toBe(first);
        const second = await cursorRow(page);
        // It used to select the next row and then let the search line type the
        // letter, which cleared the selection in the same keystroke.
        expect(await query(page)).toBe('');
        expect(second).not.toBeNull();

        await page.keyboard.press('k');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).toBe(first);
        expect(await query(page)).toBe('');
    });

    test('the g chord still works from inside the grid, and says it is armed', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).not.toBeNull();
        const first = await cursorRow(page);
        await page.keyboard.press('j');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).not.toBe(first);

        await page.keyboard.press('g');
        // Three seconds in which the next key means something else, with nothing
        // on screen to say so.
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-g-chord')),
            { timeout: 3_000 }).toBe('armed');
        await page.keyboard.press('g');
        await expect.poll(() => cursorRow(page), { timeout: 5_000 }).toBe(first);
        expect(await query(page)).toBe('');
        await expect.poll(() => page.evaluate(() => document.body.getAttribute('data-g-chord')),
            { timeout: 5_000 }).toBeNull();
    });
});

test.describe('the line you type into says what it is', () => {
    test('the key that starts the mode sits in front of the mode', async ({ page }) => {
        await dashboard(page);
        const chevron = page.locator('.search-chevron');
        await expect(chevron).toHaveText('>');

        await page.keyboard.press(':');
        await expect.poll(() => chevron.textContent(), { timeout: 5_000 }).toBe(':');
        await page.keyboard.press('Escape');
        await expect.poll(() => chevron.textContent(), { timeout: 5_000 }).toBe('>');
    });

    test('Escape clears the line rather than leaving the old query on it', async ({ page }) => {
        await dashboard(page);
        await page.keyboard.type('zzq', { delay: 60 });
        await expect.poll(() => query(page), { timeout: 5_000 }).toMatch(/^zzq$/i);

        await page.keyboard.press('Escape');
        // The state was reset and the prompt was not, so Escape read as "did
        // nothing" until the next keystroke replaced the text.
        await expect.poll(() => query(page), { timeout: 5_000 }).toBe('');
    });

    test('a typed query can be cleared by clicking, not only by Escape', async ({ page }) => {
        await dashboard(page);
        const clear = page.locator('#search-clear');
        await expect(clear).toBeHidden();

        await page.keyboard.type('zzq', { delay: 60 });
        await expect(clear).toBeVisible();
        await clear.click();
        await expect.poll(() => query(page), { timeout: 5_000 }).toBe('');
        await expect(clear).toBeHidden();
    });
});

test.describe('the grid says where a row sits', () => {
    test('row indices run through the whole grid, not per category', async ({ page }) => {
        await dashboard(page);
        const state = await page.evaluate(() => {
            const grid = document.getElementById('dashboard-layout');
            return {
                indices: [...document.querySelectorAll('.bookmark-link[data-bookmark-url]')]
                    .map((row) => Number(row.getAttribute('aria-rowindex'))),
                rowcount: Number(grid?.getAttribute('aria-rowcount')),
                // aria-rowcount is not carried by role=rowgroup; it was written
                // per category and ignored.
                groupsWithCount: [...document.querySelectorAll('.category[role="rowgroup"]')]
                    .filter((g) => g.hasAttribute('aria-rowcount')).length,
            };
        });
        expect(state.indices.length).toBeGreaterThan(1);
        // Restarting per category made the first row of every one "row 1 of 14".
        expect(state.indices).toEqual(state.indices.map((_, i) => i + 1));
        expect(state.rowcount).toBe(state.indices.length);
        expect(state.groupsWithCount).toBe(0);
    });

    test('the key legend is off until asked for, and then only while typing', async ({ page }) => {
        await dashboard(page);
        // Ten entries under a grid that can hold seven bookmarks was a manual,
        // not a hint, so it is a setting now — on for a fresh install, and
        // switchable off.
        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showGridKeyLegend = false;
            d.syncBookmarkGridA11y?.();
        });
        await expect(page.locator('.dashboard-legend')).toHaveCount(0);

        await page.evaluate(() => {
            const d = window.dashboardInstance;
            d.settings.showGridKeyLegend = true;
            d.syncBookmarkGridA11y?.();
        });
        const legend = page.locator('.dashboard-legend');
        await expect(legend).toHaveCount(1);
        // Switched on but nobody has touched the keyboard: still nothing to see.
        await expect(legend).toBeHidden();

        await page.keyboard.press('ArrowDown');
        await expect(legend).toBeVisible({ timeout: 5_000 });
        const text = await legend.innerText();
        // Four keys and a pointer at the sheet that has the rest.
        expect(await legend.locator('kbd').count()).toBe(4);
        expect(text).toMatch(/!/);
        // Decorative twice over: the keys are in the cheat sheet and the rows
        // announce themselves.
        await expect(legend).toHaveAttribute('aria-hidden', 'true');

        await page.evaluate(() => { window.open = () => null; });
        await page.keyboard.press('Enter');
        // Opening is the end of the trip it was there for.
        await expect(legend).toBeHidden({ timeout: 5_000 });
    });
});

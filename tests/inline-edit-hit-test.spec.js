// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The inline editor opened from Health could not be typed in, in Safari only.
 *
 * The form is tall and overlaps the neighbouring column, and every non-editing
 * row's children carried `filter: blur()`. A filtered element gets its own
 * compositing layer, and WebKit hit-tests those in paint order rather than by
 * z-index — so the blurred column beside the form received the clicks, and
 * `pointer-events: none` on it changed nothing. The blur was doing almost
 * nothing at 18% opacity, so it is gone.
 *
 * Headless WebKit does not reproduce the original symptom (its compositing
 * differs from the real browser), so what is pinned here is the cause: no
 * filter on the dimmed rows, and the form's own fields answering a hit test.
 */

async function openInlineEditor(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        const bookmark = d.bookmarks[0];
        const row = document.querySelector(`.bookmark-link[data-bookmark-url="${CSS.escape(bookmark.url)}"]`);
        const ref = d.resolveBookmarkReference(bookmark);
        await d.openBookmarkInlineEditor(row, ref);
    });
    await page.waitForSelector('.bookmark-inline-form', { timeout: 15_000 });
}

test.describe('the inline editor takes the clicks aimed at it', () => {
    test('nothing around it is blurred into a compositing layer', async ({ page }) => {
        await openInlineEditor(page);

        const filters = await page.evaluate(() => {
            const rows = [...document.querySelectorAll(
                '#dashboard-layout .bookmark-link:not(.bookmark-inline-editing) > *')];
            return [...new Set(rows.map((el) => getComputedStyle(el).filter))];
        });
        // A filter on a dimmed row is what put a layer over the form. Any value
        // other than "none" brings the bug back.
        expect(filters.every((f) => f === 'none' || f === '')).toBe(true);
    });

    test('a hit test on a field lands on that field', async ({ page }) => {
        await openInlineEditor(page);

        const landed = await page.evaluate(() => {
            const form = document.querySelector('.bookmark-inline-form');
            const fields = [...form.querySelectorAll('input, textarea, select, button')].slice(0, 6);
            return fields.map((field) => {
                const box = field.getBoundingClientRect();
                if (!box.width || !box.height) return 'invisible';
                const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
                // Its own label counts: a checkbox sits inside one.
                return field.contains(hit) || hit === field || field.closest('label')?.contains(hit)
                    ? 'field'
                    : (hit?.className || hit?.tagName || 'nothing');
            });
        });
        expect(landed.filter((r) => r !== 'field' && r !== 'invisible')).toEqual([]);
    });

    test('typing in it actually goes in', async ({ page }) => {
        await openInlineEditor(page);
        const note = page.locator('.bookmark-inline-form .bookmark-inline-textarea').first();
        await note.click();
        await note.fill('typed through the overlay');
        await expect(note).toHaveValue('typed through the overlay');
    });
});

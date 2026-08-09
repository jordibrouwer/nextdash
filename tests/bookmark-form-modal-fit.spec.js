// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The add/edit bookmark modal fits on a normal laptop without scrolling.
 *
 * The bug: the dialog was capped at 90vh inside an overlay that already held
 * 24px of padding top and bottom, so it asked for 90% of a box that had 48px
 * taken off it. The form needs 735px; on an 800px-tall window the cap came out
 * at 720 and the body scrolled with 15px to spare. Common laptop heights (800,
 * 810) fell just under the line, so the modal grew a scrollbar for no visible
 * reason while the very same form sat still on a taller screen.
 */
async function openAddBookmark(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        const handler = window.dashboardInstance.searchComponent
            ?.commandsComponent?.newCommandHandler;
        if (!handler) throw new Error('bookmark form handler missing');
        handler.openModal({});
    });
    await expect(page.locator('#bookmark-form-modal.show')).toBeVisible();
    // The icon prefetch repaints parts of the form; measuring before it settles
    // would measure a shorter form than the one the user ends up looking at.
    await page.waitForTimeout(700);
}

function overflow(page) {
    return page.evaluate(() => {
        const body = document.querySelector('.bookmark-form-modal-body');
        return body.scrollHeight - body.clientHeight;
    });
}

test.describe('bookmark form modal — fits without scrolling', () => {
    // 800 is the height that regressed: the old 90vh cap left 720px for a form
    // needing 735. 810 is the other common laptop height on the same edge.
    for (const height of [800, 810, 900]) {
        test(`no scrollbar at 1280x${height}`, async ({ page }) => {
            await page.setViewportSize({ width: 1280, height });
            await openAddBookmark(page);

            expect(await overflow(page)).toBe(0);
        });
    }

    test('the dialog stays inside the viewport, actions and all', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openAddBookmark(page);

        const box = await page.evaluate(() => {
            const dialog = document.querySelector('.bookmark-form-modal-dialog');
            const rect = dialog.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, viewport: window.innerHeight };
        });
        expect(box.top).toBeGreaterThanOrEqual(-1);
        expect(box.bottom).toBeLessThanOrEqual(box.viewport + 1);

        // The save row is the thing a scrollbar used to push out of reach.
        await expect(page.locator('.bookmark-inline-actions .bookmark-inline-save')).toBeInViewport();
    });

    // A window genuinely shorter than the form still has to scroll — the point
    // is that the modal never scrolls while the room is there, not that it
    // never scrolls at all.
    test('a viewport too short for the form still scrolls rather than clipping', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 620 });
        await openAddBookmark(page);

        expect(await overflow(page)).toBeGreaterThan(0);
        const reachable = await page.evaluate(() => {
            const body = document.querySelector('.bookmark-form-modal-body');
            body.scrollTop = body.scrollHeight;
            const actions = document.querySelector('.bookmark-inline-actions');
            const a = actions.getBoundingClientRect();
            const b = body.getBoundingClientRect();
            return a.bottom <= b.bottom + 2;
        });
        expect(reachable).toBe(true);
    });
});

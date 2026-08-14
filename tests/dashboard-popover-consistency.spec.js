// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The row popovers are one surface to a user and behaved like three.
 *
 * Move, Delete and Tag share a look, a trigger and a place on screen, but only
 * Tag closed on a right-click outside itself and only Tag used the listbox ARIA
 * pattern its own role promises. The multi-select tags popover was further out
 * still: no reposition at all, so it drifted away from the toolbar button it is
 * anchored to as soon as the grid scrolled.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Put the keyboard cursor on the first bookmark, the way a user starts. */
async function focusFirstBookmark(page) {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(() => page.evaluate(() => window.dashboardInstance.keyboardNavigation?.currentIndex ?? -1))
        .toBeGreaterThanOrEqual(0);
}

/**
 * Right-click somewhere with no popover under it.
 *
 * After a beat, because the outside-close listener is deliberately armed on the
 * next tick — otherwise the very gesture that opened the popover would close it
 * again. A user cannot right-click inside that tick; a test can.
 */
async function rightClickAwayFromPopover(page) {
    await page.waitForTimeout(50);
    await page.evaluate(() => {
        document.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, clientX: 5, clientY: 5,
        }));
    });
}

/**
 * Walk the grid with the arrow keys until the cursor is on a row that belongs to
 * the page currently open, then tick it.
 *
 * Not simply the first row: smart collections render bookmarks from other pages,
 * and a selection keyed to another page resolves to nothing on this one — so the
 * bulk actions quietly do nothing. Which row ArrowDown lands on first depends on
 * what the collections are showing, which depends on what earlier specs left
 * behind.
 */
async function tickFirstCurrentPageRow(page) {
    await page.evaluate(() => document.activeElement?.blur());
    for (let step = 0; step < 25; step += 1) {
        await page.keyboard.press('ArrowDown');
        const onCurrentPage = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const kn = d.keyboardNavigation;
            const row = (kn?.navigableElements || [])[kn?.currentIndex ?? -1];
            if (!row) return false;
            const idx = parseInt(row.dataset.bookmarkIndex ?? '-1', 10);
            return Number.isFinite(idx) && idx >= 0 && Boolean(d.bookmarks[idx]);
        });
        if (onCurrentPage) {
            await page.keyboard.press('x');
            return true;
        }
    }
    return false;
}

const POPOVERS = [
    { name: 'move', key: 'Shift+M', id: '#move-popover' },
    { name: 'delete', key: 'Shift+D', id: '#delete-popover' },
    { name: 'tag', key: 'Shift+T', id: '#tag-popover' },
];

test.describe('the row popovers behave alike', () => {
    for (const popover of POPOVERS) {
        test(`${popover.name} closes when a right-click lands outside it`, async ({ page }) => {
            await openDashboard(page);
            await focusFirstBookmark(page);

            await page.keyboard.press(popover.key);
            await expect(page.locator(popover.id)).toBeVisible({ timeout: 5000 });

            await rightClickAwayFromPopover(page);
            // Without this the popover stayed open behind the native menu the
            // right-click opens, since a contextmenu produces no click.
            await expect(page.locator(popover.id)).toHaveCount(0, { timeout: 5000 });
        });

        test(`${popover.name} keeps focus on the listbox and names the active option`, async ({ page }) => {
            await openDashboard(page);
            await focusFirstBookmark(page);

            await page.keyboard.press(popover.key);
            const pop = page.locator(popover.id);
            await expect(pop).toBeVisible({ timeout: 5000 });

            const state = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                const active = el.getAttribute('aria-activedescendant');
                return {
                    role: el.getAttribute('role'),
                    focusOnBox: document.activeElement === el,
                    activeDescendant: active,
                    pointsAtAnItem: Boolean(active && el.querySelector(`#${CSS.escape(active)}`)),
                    // Options must not be individually tabbable in a listbox.
                    tabbableOptions: [...el.querySelectorAll('[role="option"]')]
                        .filter((opt) => opt.tabIndex >= 0).length,
                };
            }, popover.id);

            expect(state.role).toBe('listbox');
            expect(state.focusOnBox).toBe(true);
            expect(state.pointsAtAnItem).toBe(true);
            expect(state.tabbableOptions).toBe(0);
        });

        test(`${popover.name} still moves its highlight with the arrow keys`, async ({ page }) => {
            await openDashboard(page);
            await focusFirstBookmark(page);
            await page.keyboard.press(popover.key);
            await expect(page.locator(popover.id)).toBeVisible({ timeout: 5000 });

            const before = await page.evaluate((selector) =>
                document.querySelector(selector).getAttribute('aria-activedescendant'), popover.id);

            await page.keyboard.press('ArrowDown');
            const after = await page.evaluate((selector) =>
                document.querySelector(selector).getAttribute('aria-activedescendant'), popover.id);

            expect(after).not.toBe(before);
            // And the highlight is on exactly one option, still.
            expect(await page.locator(`${popover.id} .is-focused`).count()).toBe(1);
        });
    }
});

test.describe('the multi-select tags popover', () => {
    async function openTagsPopover(page) {
        await openDashboard(page);
        const ticked = await tickFirstCurrentPageRow(page);
        expect(ticked, 'no row on the current page to select').toBe(true);
        await expect
            .poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.count()))
            .toBeGreaterThan(0);
        await page.locator('.multi-select-tags-btn').click();
        await expect(page.locator('#multi-select-tags-popover, .tag-popover')).toBeVisible({ timeout: 5000 });
    }

    test('follows its button when the page scrolls', async ({ page }) => {
        await openTagsPopover(page);

        const drift = await page.evaluate(async () => {
            const pop = document.querySelector('.move-popover.tag-popover');
            const btn = document.querySelector('.multi-select-tags-btn');

            const offsetBefore = pop.getBoundingClientRect().top - btn.getBoundingClientRect().top;

            const spacer = document.createElement('div');
            spacer.style.height = '2000px';
            document.getElementById('dashboard-layout').appendChild(spacer);
            window.scrollTo({ top: 300, behavior: 'instant' });
            window.dispatchEvent(new Event('scroll'));
            await new Promise((resolve) => requestAnimationFrame(resolve));

            const offsetAfter = pop.getBoundingClientRect().top - btn.getBoundingClientRect().top;
            spacer.remove();
            return { offsetBefore, offsetAfter };
        });

        // The gap between button and popover is what must not change; both move
        // together with the page.
        expect(Math.abs(drift.offsetAfter - drift.offsetBefore)).toBeLessThan(4);
    });

    test('closes on a right-click outside it', async ({ page }) => {
        await openTagsPopover(page);
        await rightClickAwayFromPopover(page);
        await expect(page.locator('.move-popover.tag-popover')).toHaveCount(0, { timeout: 5000 });
    });

    test('a click on its own button does not close and reopen it', async ({ page }) => {
        await openTagsPopover(page);
        // The outside handler must ignore anything inside the anchor, not only
        // the anchor element itself — an icon added to the button would
        // otherwise count as "outside".
        //
        // Compared by element identity, not by whether a popover is on screen:
        // the button's own handler toggles the popover, so closing it from here
        // is immediately followed by the button reopening a *new* one. Asking
        // "is one open?" cannot tell that flicker apart from never closing,
        // and passes either way.
        const sameElement = await page.evaluate(() => {
            const btn = document.querySelector('.multi-select-tags-btn');
            const before = document.querySelector('.move-popover.tag-popover');
            const probe = document.createElement('span');
            btn.appendChild(probe);
            probe.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const after = document.querySelector('.move-popover.tag-popover');
            probe.remove();
            return Boolean(before) && before === after;
        });
        expect(sameElement).toBe(true);
    });
});

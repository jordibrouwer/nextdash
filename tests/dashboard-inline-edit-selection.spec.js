// @ts-check
const { test, expect } = require('@playwright/test');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * Where the keyboard cursor ends up after the inline editor closes.
 *
 * The regression: closing an editor that was opened with the mouse left the
 * cursor parked on that row, so the next arrow key stepped *off* it and the row
 * could never be selected again — it read as skipped. Restoring the selection is
 * right when the keyboard put the cursor there, and wrong when a click did.
 *
 * Both routes are covered because the fix is a branch: fixing the mouse case by
 * never restoring would silently break keyboard users.
 */

/** `category:url` for the row the keyboard cursor is on, or null. */
function selectedKey(page) {
    return page.evaluate(() => {
        const kn = window.dashboardInstance?.keyboardNavigation;
        const el = kn?.navigableElements?.[kn.currentIndex];
        if (!el) return null;
        const cat = el.closest('.category')?.getAttribute('data-category-id');
        return `${cat}:${el.getAttribute('data-bookmark-url')}`;
    });
}

async function setup(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
}

/** The rows an unbroken keyboard walk visits, as the yardstick for both cases. */
async function walk(page, steps = 5) {
    await page.click('body');
    const seen = [];
    for (let i = 0; i < steps; i += 1) {
        await page.keyboard.press('ArrowDown');
        seen.push(await selectedKey(page));
    }
    return seen;
}

async function closeEditor(page, how) {
    if (how === 'escape') {
        await page.keyboard.press('Escape');
    } else {
        await page.locator('.bookmark-inline-form .bookmark-inline-action-btn', { hasText: /cancel/i })
            .first().click();
    }
    await expect(page.locator('.bookmark-inline-editing')).toHaveCount(0, { timeout: 10_000 });
}

test.describe('keyboard selection after the inline editor closes', () => {
    test.describe.configure({ mode: 'serial' });

    for (const how of ['escape', 'cancel']) {
        test(`a mouse-opened editor closed with ${how} selects the row it edited`, async ({ page }) => {
            await setup(page);
            const row = page.locator('.bookmark-link').nth(2);
            const target = await row.evaluate((el) => {
                const cat = el.closest('.category')?.getAttribute('data-category-id');
                return `${cat}:${el.getAttribute('data-bookmark-url')}`;
            });

            await row.click({ button: 'right' });
            await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
            await page.locator('[data-action="edit"]').click();
            await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
            await closeEditor(page, how);

            // You keep your place: the cursor is on the row you just edited, so
            // the next arrow key moves off it like any other selected row.
            await expect.poll(() => selectedKey(page)).toBe(target);
        });

        test(`a keyboard-opened editor closed with ${how} keeps its row selected`, async ({ page }) => {
            await setup(page);
            await page.click('body');
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('ArrowDown');
            const edited = await selectedKey(page);
            expect(edited).not.toBeNull();

            await page.keyboard.press(';');
            await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
            await closeEditor(page, how);

            // The keyboard put the cursor here, so it belongs here afterwards.
            await expect.poll(() => selectedKey(page)).toBe(edited);
        });
    }

    test('the edited row is visibly highlighted, not just marked selected', async ({ page }) => {
        await setup(page);

        // A control row selected the ordinary way, to compare the edited row
        // against. Asserting the class alone would not have caught this: the
        // editor left an inline `background` on the row, which outranks the
        // stylesheet, so the row carried .keyboard-selected while rendering
        // exactly like an unselected one.
        const controlPaint = await page.evaluate(() => {
            const row = document.querySelectorAll('.bookmark-link')[0];
            row.classList.add('keyboard-selected');
            const paint = getComputedStyle(row).backgroundImage;
            row.classList.remove('keyboard-selected');
            return paint;
        });
        expect(controlPaint).toContain('gradient');

        const row = page.locator('.bookmark-link').nth(2);
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.locator('[data-action="edit"]').click();
        await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
        await closeEditor(page, 'escape');

        // Away from every row, so hover styling cannot stand in for selection.
        await page.mouse.move(1200, 800);

        await expect.poll(() => page.evaluate(() => {
            const sel = document.querySelector('.bookmark-link.keyboard-selected');
            return sel ? getComputedStyle(sel).backgroundImage : null;
        })).toContain('gradient');

        // And the leftover inline background is gone rather than merely overridden.
        expect(await page.evaluate(() => {
            const sel = document.querySelector('.bookmark-link.keyboard-selected');
            return sel?.style.background || '';
        })).toBe('');
    });

    test('arrow keys resume from the edited row rather than skipping it', async ({ page }) => {
        await setup(page);

        // What an uninterrupted walk visits, to compare against.
        const baseline = await walk(page, 5);
        expect(baseline.filter(Boolean).length).toBeGreaterThan(3);

        await setup(page);
        const row = page.locator('.bookmark-link').nth(2);
        await row.click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.locator('[data-action="edit"]').click();
        await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
        await closeEditor(page, 'escape');

        // The cursor sits on the third row, so arrowing on continues with the
        // fourth and fifth — the rows after it, in order, none of them skipped.
        const after = [];
        for (let i = 0; i < 2; i += 1) {
            await page.keyboard.press('ArrowDown');
            after.push(await selectedKey(page));
        }
        expect(after).toEqual(baseline.slice(3, 5));
    });
});

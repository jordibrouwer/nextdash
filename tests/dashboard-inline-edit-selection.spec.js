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
        test(`a mouse-opened editor closed with ${how} leaves no row unreachable`, async ({ page }) => {
            await setup(page);
            const baseline = await walk(page);
            expect(baseline.filter(Boolean).length).toBeGreaterThan(2);

            await setup(page);
            const row = page.locator('.bookmark-link').nth(2);
            await row.click({ button: 'right' });
            await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
            await page.locator('[data-action="edit"]').click();
            await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
            await closeEditor(page, how);

            // Same sequence as an untouched dashboard: no row is stepped over.
            expect(await walk(page)).toEqual(baseline);
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

    test('the row edited by mouse can still be selected afterwards', async ({ page }) => {
        await setup(page);
        const target = await page.locator('.bookmark-link').nth(1).evaluate((el) => {
            const cat = el.closest('.category')?.getAttribute('data-category-id');
            return `${cat}:${el.getAttribute('data-bookmark-url')}`;
        });

        await page.locator('.bookmark-link').nth(1).click({ button: 'right' });
        await page.waitForSelector('#bookmark-context-menu', { timeout: 10_000 });
        await page.locator('[data-action="edit"]').click();
        await expect(page.locator('.bookmark-inline-form').first()).toBeVisible({ timeout: 10_000 });
        await closeEditor(page, 'escape');

        // The point of the bug report: this row was permanently skipped.
        expect(await walk(page, 6)).toContain(target);
    });
});

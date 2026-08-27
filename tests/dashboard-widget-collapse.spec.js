// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * A widget folds away like the categories beside it.
 *
 * A widget is a summary, and a dashboard carrying several of them has the
 * problem a dashboard of long categories has: the block you want is below the
 * fold because the ones above it are open. Categories have folded since long
 * before widgets existed, so this is the same gesture on the same header rather
 * than a second one to learn.
 *
 * Deliberately reusing what categories already have, which is what the
 * assertions here pin: the same `collapsedCategories` store under a page-scoped
 * key, the same `.category-body` wrapper so the animation is the one already
 * written, and the same `data-collapsed` attribute — which is why *Collapse
 * all* picks widgets up without knowing they exist.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect(page.locator('.dashboard-widget').first()).toBeVisible({ timeout: 15_000 });
}

const bodyHeight = (page) => page.evaluate(() => {
    const el = document.querySelector('.dashboard-widget .dashboard-widget-body');
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
});

test.describe('a widget folds away', () => {
    test('the header opens and closes it, and it closes to nothing', async ({ page }) => {
        await dashboard(page);
        const widget = page.locator('.dashboard-widget').first();

        await expect(widget).toHaveAttribute('data-collapsed', 'false');
        await expect(widget.locator('.category-chevron')).toHaveCount(1);
        expect(await bodyHeight(page)).toBeGreaterThan(0);

        await widget.locator('.category-title').click();
        await expect(widget).toHaveAttribute('data-collapsed', 'true');
        await expect(widget.locator('.category-title')).toHaveAttribute('aria-expanded', 'false');
        // Not merely hidden: the body reserves 3.5rem so the packed layout does
        // not shift when its figures arrive, and that reservation is exactly
        // what would stop a collapsed widget from closing.
        await expect.poll(() => bodyHeight(page), { timeout: 5_000 }).toBe(0);

        await widget.locator('.category-title').click();
        await expect(widget).toHaveAttribute('data-collapsed', 'false');
        await expect.poll(() => bodyHeight(page), { timeout: 5_000 }).toBeGreaterThan(0);
    });

    test('the keyboard closes it too', async ({ page }) => {
        await dashboard(page);
        const widget = page.locator('.dashboard-widget').first();

        await widget.locator('.category-title').focus();
        await page.keyboard.press('Enter');
        await expect(widget).toHaveAttribute('data-collapsed', 'true');
        await page.keyboard.press(' ');
        await expect(widget).toHaveAttribute('data-collapsed', 'false');
    });

    test('a folded widget is still folded on the next visit', async ({ page }) => {
        await dashboard(page);
        await page.locator('.dashboard-widget .category-title').first().click();
        await expect(page.locator('.dashboard-widget').first()).toHaveAttribute('data-collapsed', 'true');

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await expect(page.locator('.dashboard-widget').first()).toHaveAttribute('data-collapsed', 'true');

        // Put it back, so the next spec in this file meets an open one.
        await page.locator('.dashboard-widget .category-title').first().click();
        await expect(page.locator('.dashboard-widget').first()).toHaveAttribute('data-collapsed', 'false');
    });

    test('Collapse all takes the widgets with it', async ({ page }) => {
        await dashboard(page);
        const state = () => page.evaluate(() => ({
            widget: document.querySelector('.dashboard-widget')?.getAttribute('data-collapsed'),
            categories: [...document.querySelectorAll('.category:not(.dashboard-widget)')]
                .map((e) => e.getAttribute('data-collapsed')),
        }));

        await page.evaluate(() => window.dashboardInstance.toggleAllCategoriesCollapsed());
        const closed = await state();
        expect(closed.widget).toBe('true');
        expect(closed.categories.every((v) => v === 'true')).toBe(true);

        await page.evaluate(() => window.dashboardInstance.toggleAllCategoriesCollapsed());
        const open = await state();
        expect(open.widget).toBe('false');
        expect(open.categories.every((v) => v === 'false')).toBe(true);
    });

    /*
     * The "// " prefix is the drag handle, and dragging a widget into place has
     * to stay a different gesture from folding it — they start on the same
     * element.
     */
    test('dragging the handle does not fold it', async ({ page }) => {
        await dashboard(page);
        const widget = page.locator('.dashboard-widget').first();
        const handle = widget.locator('.category-reorder-handle');
        const box = await handle.boundingBox();

        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 120, { steps: 8 });
        await page.mouse.up();
        await expect(widget).toHaveAttribute('data-collapsed', 'false');

        await handle.click({ force: true });
        await expect(widget).toHaveAttribute('data-collapsed', 'false');
    });

    /*
     * The body moved inside a .category-body wrapper to inherit the collapse
     * animation. Everything that redraws a widget in place looks the body up by
     * its own class, so the wrapper must not have cost it that.
     */
    test('a widget still redraws in place', async ({ page }) => {
        await dashboard(page);
        const before = await page.evaluate(() =>
            document.querySelector('.dashboard-widget-body')?.textContent?.trim());

        await page.evaluate(() => window.dashboardInstance.renderCore.refreshWidgets('health'));

        expect(await page.evaluate(() => ({
            text: document.querySelector('.dashboard-widget-body')?.textContent?.trim(),
            insideWrapper: !!document.querySelector('.category-body > .dashboard-widget-body'),
            bodies: document.querySelectorAll('.dashboard-widget-body').length,
        }))).toEqual({ text: before, insideWrapper: true, bodies: 1 });
    });
});

// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * A category can be given an icon.
 *
 * Category.Icon has been in the model, persisted through the categories
 * endpoint and rendered by the dashboard — an uploaded image or an emoji, with
 * a fallback glyph — since categories had icons at all, and there was nowhere
 * to set it. New categories got an empty one, the config row has only a name
 * field, and the inline rename edits the name. The locale strings for the
 * control were still in all four files with no caller, so it fell out at some
 * point and left every page with eight identical headers.
 */

async function dashboard(page) {
    await markWhatsNewSeen(page);
    // Before the first paint, not after: the grid animates its rows in, and a
    // right-click on a header that is still moving is refused as unstable —
    // which is a property of the test harness, not of the app.
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => document.body.classList.add('no-animations'));
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.evaluate(() => document.body.classList.add('no-animations'));
    // The quick-start card floats over the grid and swallows the right-click on
    // a category header; dismissOnboardingIfPresent does not always catch it
    // before it has finished animating in.
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
    await page.waitForTimeout(300);
}

/** Right-click a real category header and pick the icon entry. */
async function openIconEditor(page) {
    const header = page.locator('.category:not([data-smart-collection="true"]) .category-title').first();
    await header.click({ button: 'right' });
    await expect(page.locator('#category-context-menu')).toBeVisible({ timeout: 10_000 });
    const id = await page.evaluate(() =>
        document.querySelector('.category:not([data-smart-collection="true"])')?.getAttribute('data-category-id'));
    await page.evaluate(() => {
        const items = [...document.querySelectorAll('#category-context-menu button, #category-context-menu [role="menuitem"]')];
        items.find((b) => /icon|icoon|symbol|icône/i.test(b.textContent))?.click();
    });
    await expect(page.locator('.category-icon-popover')).toBeVisible({ timeout: 10_000 });
    return id;
}

test.describe('setting a category icon', () => {
    test('typing one saves it, and the header shows it', async ({ page }) => {
        await dashboard(page);
        const id = await openIconEditor(page);
        test.skip(!id, 'needs a real category');

        // The field takes focus, so the emoji goes where it is meant to.
        await expect(page.locator('.category-icon-input')).toBeFocused();
        await page.keyboard.type('🚀');
        await page.keyboard.press('Enter');

        await expect.poll(() => page.evaluate((catId) =>
            (window.dashboardInstance.categories || []).find((c) => String(c.id) === catId)?.icon,
        id), { timeout: 5_000 }).toBe('🚀');

        // Rendered, not only stored: the icon is the reason the setting exists.
        await expect.poll(() => page.evaluate((catId) =>
            document.querySelector(`.category[data-category-id="${catId}"] .category-title`)?.innerText || '',
        id), { timeout: 5_000 }).toContain('🚀');

        // And it survives on the server, through the same categories payload the
        // drag reorder and the rename already write.
        await expect.poll(async () => page.evaluate(async (catId) => {
            const res = await fetch(`/api/categories?page=${window.dashboardInstance.currentPageId}`, { cache: 'no-store' });
            const body = await res.json();
            const list = Array.isArray(body) ? body : (body.categories || []);
            return list.find((c) => String(c.id) === catId)?.icon || '';
        }, id), { timeout: 10_000 }).toBe('🚀');
    });

    test('Clear takes it off again', async ({ page }) => {
        await dashboard(page);
        const id = await openIconEditor(page);
        test.skip(!id, 'needs a real category');
        await page.keyboard.type('📚');
        await page.keyboard.press('Enter');
        await expect.poll(() => page.evaluate((catId) =>
            (window.dashboardInstance.categories || []).find((c) => String(c.id) === catId)?.icon,
        id), { timeout: 5_000 }).toBe('📚');

        await openIconEditor(page);
        await page.locator('.category-icon-clear').click();
        await expect.poll(() => page.evaluate((catId) =>
            (window.dashboardInstance.categories || []).find((c) => String(c.id) === catId)?.icon,
        id), { timeout: 5_000 }).toBe('');
    });

    test('the header follows what you type, before you commit', async ({ page }) => {
        await dashboard(page);
        const id = await openIconEditor(page);
        test.skip(!id, 'needs a real category');

        const headerIcon = () => page.evaluate((catId) =>
            document.querySelector(`.category[data-category-id="${catId}"] .category-title-icon`)?.textContent?.trim() || '',
        id);

        await page.keyboard.type('🎧');
        // No Enter yet: the choice is made against the header, not against the
        // field.
        await expect.poll(headerIcon, { timeout: 5_000 }).toBe('🎧');

        await page.keyboard.press('Escape');
        // Browsing is not choosing.
        await expect.poll(headerIcon, { timeout: 5_000 }).not.toBe('🎧');
    });

    test('Escape leaves the category as it was', async ({ page }) => {
        await dashboard(page);
        const id = await openIconEditor(page);
        test.skip(!id, 'needs a real category');
        const before = await page.evaluate((catId) =>
            (window.dashboardInstance.categories || []).find((c) => String(c.id) === catId)?.icon || '', id);

        await page.keyboard.type('🐙');
        await page.keyboard.press('Escape');
        await expect(page.locator('.category-icon-popover')).toHaveCount(0);
        expect(await page.evaluate((catId) =>
            (window.dashboardInstance.categories || []).find((c) => String(c.id) === catId)?.icon || '', id)).toBe(before);
    });
});

/**
 * Favicon harmonisation is a whole-dashboard setting, and a category header's
 * emoji is an icon like any other. It was left at full colour beside harmonised
 * favicons, because the variant rules in theme.css reach for <img> and a glyph
 * has none — so the header stood out exactly where the setting exists to stop
 * things standing out.
 */
test.describe('the category glyph follows favicon harmonisation', () => {
    test('it is styled while harmonisation is on, and plain again when it is off', async ({ page }) => {
        await dashboard(page);
        const glyph = '#dashboard-layout .category-title .category-title-icon';
        await expect(page.locator(glyph).first()).toBeVisible({ timeout: 10_000 });

        const on = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const key = window.ThemeIconStyling.getThemeIconStylingThemeKey(d.settings);
            d.settings.themeIconStyling = {
                ...(d.settings.themeIconStyling || {}),
                [key]: { enabled: true, style: 'muted', intensity: 0.8 },
            };
            // The same call the theme switch makes, so this is the live path and
            // not a fresh render that happens to read the setting.
            window.ThemeIconStyling.applyThemeIconStylingToDocument(d.settings);
            const el = document.querySelector('#dashboard-layout .category-title .category-title-icon');
            return { cls: el.className, filter: getComputedStyle(el).filter };
        });
        expect(on.cls).toContain('icon-themed--muted');
        expect(on.filter).toContain('grayscale');

        const off = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const key = window.ThemeIconStyling.getThemeIconStylingThemeKey(d.settings);
            d.settings.themeIconStyling = {
                ...(d.settings.themeIconStyling || {}),
                [key]: { enabled: false },
            };
            window.ThemeIconStyling.applyThemeIconStylingToDocument(d.settings);
            const el = document.querySelector('#dashboard-layout .category-title .category-title-icon');
            return { cls: el.className, filter: getComputedStyle(el).filter };
        });
        expect(off.cls).not.toContain('icon-themed--muted');
        expect(off.filter).toBe('none');
    });
});

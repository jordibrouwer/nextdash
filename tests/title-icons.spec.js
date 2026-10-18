// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Icons live in the title, not in a field of their own.
 *
 * A category had an icon field: a glyph or an uploaded image drawn in front of
 * its name, with a square as the fallback. The icon is part of the title now --
 * an emoji typed in the name, or :file.svg: for an app icon -- so a title is one
 * thing and a widget's title can carry an icon the same way.
 */
async function dashboard(page) {
    await markWhatsNewSeen(page);
    await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => document.body.classList.add('no-animations'));
    });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await page.evaluate(() => document.querySelectorAll('.quickstart-card').forEach((el) => el.remove()));
}

test.describe('icons in a title', () => {
    test('a title is split into text and icons, and lower-cases only the text', async ({ page }) => {
        await dashboard(page);
        const parts = await page.evaluate(() => window.DashboardTitleIcons.segments(':Docker-Abc.svg: Media Shelf :nofile: 📺 TV'));
        expect(parts).toEqual([
            { icon: 'Docker-Abc.svg' },
            { text: ' media shelf :nofile: 📺 tv' },
        ]);
    });

    test('a category named with an icon draws the image and the lower-cased name', async ({ page, request }) => {
        await dashboard(page);
        const id = await page.evaluate(() => document.querySelector('.category:not([data-smart-collection="true"]):not(.dashboard-widget)').getAttribute('data-category-id'));
        const shown = await page.evaluate(async ({ id, token }) => {
            const d = window.dashboardInstance;
            const cat = d.categories.find((c) => String(c.id) === String(id));
            const before = cat.name;
            cat.name = ':icon-test.svg: Media Shelf';
            d.renderDashboard({ animate: false, forceFull: true });
            const el = document.querySelector(`.category[data-category-id="${CSS.escape(id)}"] .category-title-name`);
            const out = {
                img: el.querySelector('img.bookmark-icon')?.getAttribute('src'),
                text: el.textContent.trim(),
                title: el.title,
                legacy: document.querySelectorAll('.category-title-icon').length,
            };
            cat.name = before;
            d.renderDashboard({ animate: false, forceFull: true });
            return out;
        }, { id, token: WRITE_TOKEN });
        expect(shown.img).toBe('/data/icons/icon-test.svg');
        expect(shown.text).toBe('media shelf');
        expect(shown.title).toBe(':icon-test.svg: Media Shelf');
        expect(shown.legacy, 'there is no icon field in the title any more').toBe(0);
    });

    test('an emoji typed in the name stays text, in front of the name', async ({ page }) => {
        await dashboard(page);
        const text = await page.evaluate(() => {
            const d = window.dashboardInstance;
            const cat = d.categories[0];
            const before = cat.name;
            cat.name = '📺 Media';
            d.renderDashboard({ animate: false, forceFull: true });
            const el = document.querySelector(`.category[data-category-id="${CSS.escape(String(cat.id))}"] .category-title-name`);
            const out = el.textContent.trim();
            cat.name = before;
            d.renderDashboard({ animate: false, forceFull: true });
            return out;
        });
        expect(text).toBe('📺 media');
    });

    test('the category menu inserts an icon in the name and has no icon field', async ({ page }) => {
        await dashboard(page);
        const header = page.locator('.category:not([data-smart-collection="true"]):not(.dashboard-widget) .category-title').first();
        const id = await page.evaluate(() => document.querySelector('.category:not([data-smart-collection="true"]):not(.dashboard-widget)').getAttribute('data-category-id'));
        const before = await page.evaluate((cid) => window.dashboardInstance.categories.find((c) => String(c.id) === String(cid)).name, id);
        // The picker is the shared one; here it answers with a chosen file.
        await page.evaluate(async () => {
            const picker = await window.IconSetAuto.loadPicker();
            picker.open = (_anchor, options) => { options.onPick('docker-abc.svg'); };
        });
        await header.click({ button: 'right' });
        const menu = page.locator('#category-context-menu');
        await expect(menu).toBeVisible();
        await expect(menu.getByText('Insert icon…', { exact: true })).toBeVisible();
        await expect(menu.getByText('Icon…', { exact: true })).toHaveCount(0);

        const saved = page.waitForResponse((r) => r.url().includes('/api/categories') && r.request().method() === 'POST');
        await menu.getByText('Insert icon…', { exact: true }).click();
        await saved;
        const name = await page.evaluate((cid) => window.dashboardInstance.categories.find((c) => String(c.id) === String(cid)).name, id);
        expect(name).toBe(`:docker-abc.svg: ${before}`);

        // Leave the page as it was found: the data directory is shared.
        const restore = page.waitForResponse((r) => r.url().includes('/api/categories') && r.request().method() === 'POST');
        await page.evaluate(async ({ cid, previous }) => {
            const d = window.dashboardInstance;
            d.categories.find((c) => String(c.id) === String(cid)).name = previous;
            await d.renderCore.saveCategoryOrder({ pageId: Number(d.currentPageId) });
        }, { cid: id, previous: before });
        await restore;
    });
});

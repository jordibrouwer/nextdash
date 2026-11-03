// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * A colour per tag, chosen in Config → Bookmarks → Tags and painted on the
 * chips of the grid. The setting holds palette names only.
 */

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true && window.TagColors, null, { timeout: 20_000 });
}

async function storedColors(page) {
    return page.evaluate(async () => (await (await fetch('/api/settings')).json()).tagColors || {});
}

test.describe('tag colours', () => {
    test('the server keeps palette names and drops anything else', async ({ page }) => {
        await openDashboard(page);
        const saved = await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/settings', { method: 'POST', headers: h, body: JSON.stringify({ tagColors: { Docker: 'Blue', evil: 'url(x)', '': 'red' } }) });
            return (await (await fetch('/api/settings')).json()).tagColors;
        });
        expect(saved).toEqual({ docker: 'blue' });
        await page.evaluate(async () => {
            const f = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const h = { 'Content-Type': 'application/json', ...(typeof nextDashWriteHeaders === 'function' ? nextDashWriteHeaders() : {}) };
            await f('/api/settings', { method: 'POST', headers: h, body: JSON.stringify({ tagColors: {} }) });
        });
        expect(await storedColors(page)).toEqual({});
    });

    test('a coloured tag paints its chip, and a tag without one is left alone', async ({ page }) => {
        await openDashboard(page);
        const out = await page.evaluate(() => {
            window.dashboardInstance.settings.tagColors = { docker: 'blue' };
            const a = document.createElement('span');
            const b = document.createElement('span');
            window.TagColors.paint(a, 'Docker');
            window.TagColors.paint(b, 'other');
            return { a: a.getAttribute('data-tag-color'), b: b.getAttribute('data-tag-color') };
        });
        expect(out).toEqual({ a: 'blue', b: null });
    });

    test('choosing a colour in Config saves it and the Tags list shows it', async ({ page }) => {
        await openDashboard(page);
        await waitForConfigReady(page);
        await page.evaluate(() => { window.location.hash = '#config/bookmarks/tags'; });
        await page.waitForSelector('[data-tag-color-for]', { timeout: 20_000 });
        const select = page.locator('[data-tag-color-for]').first();
        const tag = await select.getAttribute('data-tag-color-for');
        await select.selectOption('green');
        await expect.poll(async () => (await storedColors(page))[String(tag).toLowerCase()], { timeout: 10_000 }).toBe('green');
        await expect(select).toHaveAttribute('data-tag-color', 'green');
        // Put it back so the shared data directory is as it was.
        await select.selectOption('');
        await expect.poll(async () => (await storedColors(page))[String(tag).toLowerCase()], { timeout: 10_000 }).toBeUndefined();
    });
});

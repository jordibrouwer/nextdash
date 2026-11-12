// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Spatial theme group moves layers with the pointer.
 *
 * What these pin down is behaviour, not looks: the pointer drives two CSS
 * variables on <html> while a spatial-* theme is active, and ONLY then; the
 * page stays usable (a bookmark still opens) and nothing that holds content
 * wears a transform, which would drag position:fixed menus off their anchors.
 */

const VAR = '--sp-x';
const spatialVar = (page, name = VAR) =>
    page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name);

async function setTheme(page, theme) {
    const res = await page.request.post('/api/settings', {
        data: { theme },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    if (!res.ok()) throw new Error(`setTheme failed: HTTP ${res.status()}`);
}

async function open(page, theme = 'spatial-diorama-dark') {
    await setTheme(page, theme);
    await page.setViewportSize({ width: 1300, height: 800 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

test.describe('spatial theme group', () => {
    for (const theme of ['spatial-diorama-dark', 'spatial-lightbox-light', 'spatial-orbit-dark']) {
        test(`${theme}: moving the mouse moves the layers`, async ({ page }) => {
            await open(page, theme);
            await page.mouse.move(20, 400);
            await expect.poll(async () => parseFloat(await spatialVar(page) || '0')).toBeLessThan(-0.9);
            await page.mouse.move(1280, 400);
            await expect.poll(async () => parseFloat(await spatialVar(page) || '0')).toBeGreaterThan(0.9);
            // Vertical follows too.
            await page.mouse.move(650, 10);
            await expect.poll(async () => parseFloat(await spatialVar(page, '--sp-y') || '0')).toBeLessThan(-0.9);
        });
    }

    test('a bookmark still opens with the layers moving', async ({ page, context }) => {
        await open(page);
        // Whatever the bookmark points at, the answer is a stub: the test is about the click.
        await context.route((url) => !/localhost|127\.0\.0\.1/.test(url.hostname), (route) =>
            route.fulfill({ status: 200, contentType: 'text/html', body: '<title>opened</title>' }));
        const link = page.locator('.bookmark-link').first();
        const box = await link.boundingBox();
        if (!box) throw new Error('no bookmark box');
        await page.mouse.move(box.x + box.width / 2 - 30, box.y + box.height / 2, { steps: 5 });
        await expect.poll(() => spatialVar(page)).not.toBe('');

        // The pseudo-element layers must not be what receives the click.
        const hit = await page.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return !!el && !!el.closest('.bookmark-link');
        }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
        expect(hit).toBe(true);

        const opened = Promise.race([
            context.waitForEvent('page').then(() => 'popup'),
            page.waitForURL((u) => !/localhost|127\.0\.0\.1/.test(u.hostname)).then(() => 'navigated'),
        ]);
        await link.click();
        expect(['popup', 'navigated']).toContain(await opened);
    });

    test('nothing that holds content is transformed', async ({ page }) => {
        // A transform, translate, rotate or scale on an ancestor makes it the containing
        // block of every position:fixed descendant: menus, tooltips and modals would
        // land in the wrong place.
        for (const theme of ['spatial-diorama-dark', 'spatial-lightbox-dark', 'spatial-orbit-light']) {
            await open(page, theme);
            await page.mouse.move(100, 100);
            await page.mouse.move(900, 600, { steps: 5 });
            await expect.poll(() => spatialVar(page)).not.toBe('');
            const offenders = await page.evaluate(() => {
                // Settle the one-off entry animation first.
                const bad = [];
                for (const el of document.querySelectorAll('body, body > .container, .dashboard-grid, .dashboard-grid *')) {
                    if (el.closest('.skeleton-root')) continue;
                    const cs = getComputedStyle(el);
                    if (cs.animationName !== 'none') continue;
                    if (cs.translate !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none'
                        || (cs.transform !== 'none' && !el.matches('.category-chevron *, .category-chevron, [class*="icon"], [class*="icon"] *'))) {
                        bad.push(el.tagName + '.' + el.className);
                    }
                }
                return bad.slice(0, 5);
            });
            expect(offenders, theme).toEqual([]);
            // clip-path and filter on a category would clip or capture its fixed popovers.
            const clipped = await page.evaluate(() => [...document.querySelectorAll('.dashboard-grid .category')]
                .filter((c) => { const cs = getComputedStyle(c); return cs.clipPath !== 'none' || cs.filter !== 'none' || cs.mask !== 'none' && cs.mask !== ''; }).length);
            expect(clipped, theme).toBe(0);
        }
    });

    test('switching to another theme stops it and clears the variables', async ({ page }) => {
        await open(page);
        await page.mouse.move(300, 300);
        await page.mouse.move(400, 350, { steps: 3 });
        await expect.poll(() => spatialVar(page)).not.toBe('');

        await page.evaluate(() => window.ThemeLoader.applyTheme('look-ocean-dark'));
        await expect.poll(() => spatialVar(page)).toBe('');
        expect(await page.evaluate(() => window.NDSpatial.isRunning())).toBe(false);

        await page.mouse.move(900, 500, { steps: 4 });
        // The pointer writes its CSS variables once per frame; give the frame time to run.
        await page.waitForTimeout(150);
        expect(await spatialVar(page)).toBe('');
        expect(await spatialVar(page, '--sp-y')).toBe('');

        // And back again: it wakes up.
        await page.evaluate(() => window.ThemeLoader.applyTheme('spatial-orbit-dark'));
        await page.mouse.move(100, 100, { steps: 4 });
        await expect.poll(() => spatialVar(page)).not.toBe('');
    });

    test('reduced motion keeps every layer still', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open(page);
        await page.mouse.move(100, 100);
        await page.mouse.move(1000, 600, { steps: 6 });
        // The pointer writes its CSS variables once per frame; give the frame time to run.
        await page.waitForTimeout(200);
        expect(await spatialVar(page)).toBe('');
        expect(await spatialVar(page, '--sp-y')).toBe('');
        expect(await page.evaluate(() => window.NDSpatial.isRunning())).toBe(false);
    });

    test('Effects off keeps it still, and turning them on again wakes it', async ({ page }) => {
        await open(page);
        await page.mouse.move(200, 200);
        await page.mouse.move(300, 250, { steps: 3 });
        await expect.poll(() => spatialVar(page)).not.toBe('');

        await page.evaluate(() => document.documentElement.setAttribute('data-effects', 'off'));
        await expect.poll(() => spatialVar(page)).toBe('');
        await page.mouse.move(1000, 600, { steps: 4 });
        // The pointer writes its CSS variables once per frame; give the frame time to run.
        await page.waitForTimeout(150);
        expect(await spatialVar(page)).toBe('');

        await page.evaluate(() => document.documentElement.setAttribute('data-effects', 'held'));
        await page.mouse.move(100, 100, { steps: 4 });
        await expect.poll(() => spatialVar(page)).not.toBe('');
    });

    test('an ordinary theme never starts it', async ({ page }) => {
        await open(page, 'look-ocean-dark');
        await page.mouse.move(100, 100);
        await page.mouse.move(900, 500, { steps: 4 });
        // Checks that nothing moves: give the frame time to run before reading the variables.
        await page.waitForTimeout(150);
        expect(await spatialVar(page)).toBe('');
        expect(await page.evaluate(() => window.NDSpatial.isRunning())).toBe(false);
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The category header under a material's signature.
 *
 * Every material draws its own header when the reader's header style is the
 * theme's own (data-cat-head="theme"), and every one of them keeps the "//":
 * it is the grip that moves a category and the mark that says nextDash. A
 * header the reader chose by name is left alone.
 *
 * Behaviour only: that the // is there, can be seen and can be grabbed, and
 * that a chosen style wins. How a tab or a plate looks is not asserted.
 */
const MATERIALS = ['lacquer', 'glass', 'frost', 'aurora', 'neon', 'velvet', 'enamel', 'brushed', 'carbon', 'paper', 'terminal', 'ink'];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // The layout the signature draws; the terminal and launcher layouts keep their own.
    await page.evaluate(() => {
        const grid = document.querySelector('.dashboard-grid');
        grid.classList.remove('layout-terminal', 'layout-launcher');
        grid.classList.add('layout-masonry');
    });
}

/** Put the page under one material's signature, with the theme's own header. */
async function under(page, material, head = 'theme') {
    await page.evaluate(([m, h]) => {
        [document.documentElement, document.body].forEach((el) => {
            el.setAttribute('data-material-style', 'signature');
            el.setAttribute('data-material', m);
        });
        document.body.setAttribute('data-cat-head', h);
    }, [material, head]);
}

/** What the grip of the first plain category looks like to a reader. */
const grip = (page) => page.evaluate(() => {
    const handle = document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-reorder-handle');
    const glyph = handle && handle.querySelector('.category-reorder-glyph');
    if (!handle || !glyph) return null;
    const box = handle.getBoundingClientRect();
    const cs = getComputedStyle(handle);
    return {
        text: (glyph.textContent || '').trim(),
        width: box.width,
        height: box.height,
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0,
        // A glyph painted in no colour at all is a // nobody can see.
        fill: cs.webkitTextFillColor,
    };
});

test.describe('the header under a material', () => {
    test('every material keeps the // and its grip', async ({ page }) => {
        await openDashboard(page);
        for (const material of MATERIALS) {
            await under(page, material);
            const g = await grip(page);
            expect(g, `${material}: no grip`).not.toBeNull();
            expect(g.text, `${material}: the // is gone`).toBe('//');
            expect(g.width, `${material}: the grip has no width`).toBeGreaterThan(4);
            expect(g.visible, `${material}: the grip is hidden`).toBe(true);
            expect(g.fill, `${material}: the // is painted transparent`).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
        }
    });

    test('the signature draws a header, and a header the reader chose wins', async ({ page }) => {
        await openDashboard(page);
        const label = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-label');
            const cs = getComputedStyle(el);
            return { transform: cs.textTransform, flex: cs.flexGrow, clip: cs.clipPath };
        });

        await under(page, 'neon');
        expect((await label()).transform, 'neon draws its name in capitals').toBe('uppercase');

        await under(page, 'neon', 'clean');
        expect((await label()).transform, 'a chosen style left the neon header on').not.toBe('uppercase');

        await under(page, 'carbon');
        expect((await label()).clip, 'carbon draws its tab with a cut corner').not.toBe('none');

        // Classic draws none of it.
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        expect((await label()).clip, 'classic drew the carbon tab').toBe('none');
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The category header under a material's signature.
 *
 * Every material draws its own header when the reader's header style is the
 * theme's own (data-cat-head="theme"). The two slashes of the "//" become two
 * filled, slanted blocks there, and a widget has three bars instead of its
 * panel; the "//" itself stays in the grip, unseen, so the grip is the same
 * button it always was. A header the reader chose by name, and classic, keep
 * the "//".
 *
 * Behaviour only: that the mark is there, can be seen and can be grabbed, and
 * that a chosen style and classic leave it alone. How a tab or a plate looks is
 * not asserted.
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
    const before = getComputedStyle(glyph, '::before');
    return {
        text: (glyph.textContent || '').trim(),
        width: box.width,
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0,
        // The slanted blocks: drawn when the pseudo-element has content and a size.
        marked: before.content !== 'none' && before.content !== 'normal' && parseFloat(before.width) > 2,
        fill: getComputedStyle(glyph).webkitTextFillColor,
    };
});

test.describe('the header under a material', () => {
    test.afterEach(async ({ request }) => {
        // One store behind the worker: the theme is put back for the next test.
        await request.post('/api/settings', { data: { theme: 'look-berry-dark' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
    });

    test('every material draws its mark where the // was, and keeps the grip', async ({ page }) => {
        await openDashboard(page);
        for (const material of MATERIALS) {
            await under(page, material);
            const g = await grip(page);
            expect(g, material + ': no grip').not.toBeNull();
            expect(g.text, material + ': the grip lost its //, which is what a screen reader and a drag read').toBe('//');
            expect(g.width, material + ': the grip has no width').toBeGreaterThan(4);
            expect(g.visible, material + ': the grip is hidden').toBe(true);
            expect(g.marked, material + ': no mark is drawn where the // was').toBe(true);
        }
    });

    test('classic and a chosen header style keep the //', async ({ page }) => {
        await openDashboard(page);
        await under(page, 'neon');
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        let g = await grip(page);
        expect(g.marked, 'classic drew the slanted blocks').toBe(false);
        expect(g.fill, 'classic hid the //').not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        await under(page, 'neon', 'clean');
        g = await grip(page);
        expect(g.marked, 'a chosen style drew the slanted blocks').toBe(false);
    });

    test('the signature draws a header, and a header the reader chose wins', async ({ page }) => {
        await openDashboard(page);
        const label = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-label');
            const cs = getComputedStyle(el);
            return { transform: cs.textTransform, flex: cs.flexGrow, weight: cs.fontWeight };
        });

        await under(page, 'neon');
        expect((await label()).transform, 'neon draws its name in capitals').toBe('uppercase');

        await under(page, 'neon', 'clean');
        expect((await label()).transform, 'a chosen style left the neon header on').not.toBe('uppercase');

        await under(page, 'carbon');
        expect((await label()).transform, 'carbon draws its name in capitals').toBe('uppercase');

        // Classic draws none of it.
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        expect((await label()).transform, 'classic drew the carbon header').not.toBe('uppercase');
    });

    test('a theme brings its material and its header by itself, through the settings', async ({ page, request }) => {
        // Neon material, set the way a reader sets it: the theme, and nothing by hand.
        await request.post('/api/settings', { data: { theme: 'cold-cathode-dark', materialStyle: 'signature', categoryHeaderStyle: 'theme' }, headers: { 'X-NextDash-Token': WRITE_TOKEN } });
        await openDashboard(page);
        await page.reload();
        await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
        await page.evaluate(() => {
            const grid = document.querySelector('.dashboard-grid');
            grid.classList.remove('layout-terminal', 'layout-launcher');
            grid.classList.add('layout-masonry');
        });
        expect(await page.evaluate(() => document.body.getAttribute('data-material')), 'the theme brought no material').toBe('neon');
        const g = await grip(page);
        expect(g.marked, 'the real page drew no mark where the // was').toBe(true);
        const transform = await page.evaluate(() => getComputedStyle(document.querySelector('.dashboard-grid .category:not(.dashboard-widget) .category-title-label')).textTransform);
        expect(transform, 'the real page drew no neon header').toBe('uppercase');
    });

    test('a widget takes the same header, and its mark stands where the // does', async ({ page }) => {
        await openDashboard(page);
        const widget = () => page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid .category.dashboard-widget');
            if (!el) return null;
            const title = el.querySelector('.category-title');
            const label = el.querySelector('.category-title-label');
            const glyph = el.querySelector('.category-reorder-glyph');
            const mark = glyph && getComputedStyle(glyph, '::before').content;
            return {
                transform: getComputedStyle(label).textTransform,
                stripBorder: getComputedStyle(title).borderBottomWidth,
                stripFill: getComputedStyle(title).backgroundColor,
                markDrawn: !!mark && mark !== 'none',
                markBorder: glyph ? getComputedStyle(glyph, '::before').borderTopWidth : '',
                isWidgetMark: !!glyph && glyph.classList.contains('category-reorder-glyph--widget'),
            };
        });
        test.skip(!(await widget()), 'this dashboard has no widget');

        await under(page, 'neon');
        const neon = await widget();
        expect(neon.transform, 'the widget did not take the neon header').toBe('uppercase');
        expect(neon.isWidgetMark, 'the widget lost its mark').toBe(true);
        expect(neon.markDrawn, 'the widget mark is not drawn').toBe(true);
        // Three bars, not the bordered panel it was.
        expect(neon.markBorder, 'the widget mark is still the panel').toBe('0px');

        // The strip of a widget gives way: the header sits on the card, like a category's.
        expect(neon.stripBorder, 'the widget strip kept its rule').toBe('0px');
        expect(neon.stripFill, 'the widget strip kept its fill').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

        // Classic keeps the strip it had.
        await page.evaluate(() => {
            [document.documentElement, document.body].forEach((el) => el.setAttribute('data-material-style', 'classic'));
        });
        const classic = await widget();
        expect(classic.transform, 'classic drew the neon header on a widget').not.toBe('uppercase');
        expect(classic.markBorder, 'classic lost the widget panel').not.toBe('0px');
    });
});

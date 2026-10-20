// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config's panels and tables are the same pane as the dashboard's.
 *
 * Config drew its own flat rectangles (a 1px border over 55% of the page
 * colour) and left its tables bare. They read as another application. Now a
 * panel, an overview card and a table take the pane the dashboard draws, in the
 * same glass, card or open, and open still keeps a light frame so a form is
 * not a pile of loose fields.
 */
async function open(page, hash) {
    await markWhatsNewSeen(page);
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.goto(`/${hash}`);
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

const setSurface = (page, word) => page.evaluate((w) => window.ThemeLoader.applyCatSurface(w), word);

/** What a block is painted with: alpha of its fill, blur, radius, whether it has a hairline. */
const paint = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    // The bookmarks view blurs through a layer behind its content, so that it is not the
    // containing block of the fixed sheets and modals inside it.
    const layer = sel.includes('config-view--library') ? getComputedStyle(el, '::before') : cs;
    const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
    const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
    const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
    return {
        alpha,
        blur: layer.backdropFilter && layer.backdropFilter !== 'none' ? 'blur' : 'none',
        radius: cs.borderTopLeftRadius,
        border: cs.borderTopWidth,
        hairline: /inset 0px 0px 0px 1px|0px 0px 0px 1px inset/.test(cs.boxShadow),
    };
}, selector);

test.describe('config in loose panes (the default)', () => {
    test('a panel is glass, card or a light frame, like a category on the dashboard', async ({ page }) => {
        await open(page, '#config/appearance');
        await page.waitForSelector('.config-panel', { timeout: 20_000 });

        await setSurface(page, 'glass');
        const glass = await paint(page, '.config-view .config-panel');
        expect(glass.blur).toBe('blur');
        expect(glass.alpha).toBeGreaterThan(0);
        expect(glass.alpha).toBeLessThan(1);
        expect(glass.hairline).toBe(true);
        expect(glass.border).toBe('0px');
        expect(parseFloat(glass.radius)).toBeGreaterThanOrEqual(8);

        await setSurface(page, 'card');
        const card = await paint(page, '.config-view .config-panel');
        expect(card.blur).toBe('none');
        expect(card.alpha).toBe(1);

        await setSurface(page, 'open');
        const frame = await paint(page, '.config-view .config-panel');
        expect(frame.blur).toBe('none');
        expect(frame.alpha).toBeGreaterThan(0);
        expect(frame.alpha).toBeLessThan(0.12);
        expect(frame.hairline).toBe(true);
    });

    test('a table sits in the same pane instead of on the bare page, and the view itself is not one', async ({ page }) => {
        await open(page, '#config/structure');
        await page.waitForSelector('[data-structure-table]', { timeout: 20_000 });
        await setSurface(page, 'glass');
        const table = await paint(page, '[data-structure-table]');
        expect(table.blur).toBe('blur');
        expect(table.alpha).toBeGreaterThan(0);
        expect(table.alpha).toBeLessThan(1);
        expect(table.hairline).toBe(true);
        const view = await paint(page, '#dashboard-layout.config-layout > .config-view');
        expect(view.blur).toBe('none');
        expect(view.hairline).toBe(false);
    });
});

test.describe('the opening text of a tab is a pane too', () => {
    const routes = [
        ['#config/structure/categories', '.config-panel-note'],
        ['#config/structure/finders', '.config-panel-note'],
        ['#config/structure/pages', '.config-panel-note'],
        ['#config/stats', '.config-tab-note'],
        ['#config/widgets', '.config-tab-note'],
        ['#config/containers', '.config-tab-note'],
        ['#config/logs', '.config-view-intro'],
    ];
    for (const [hash, sel] of routes) {
        test(`${hash}: the first paragraph sits in a pane`, async ({ page }) => {
            await open(page, hash);
            await page.waitForSelector('.config-view-body', { timeout: 20_000 });
            await setSurface(page, 'glass');
            const note = await page.evaluate((s) => {
                const p = [...document.querySelectorAll(`.config-view-body ${s}`)]
                    .find((el) => !el.closest('.config-panel, .config-widget'));
                if (!p) return null;
                const cs = getComputedStyle(p);
                return { blur: cs.backdropFilter !== 'none', pad: parseFloat(cs.paddingLeft), radius: parseFloat(cs.borderTopLeftRadius) };
            }, sel);
            expect(note).not.toBeNull();
            expect(note.blur).toBe(true);
            expect(note.pad).toBeGreaterThan(8);
            expect(note.radius).toBeGreaterThanOrEqual(8);
        });
    }
});

test.describe('config as one pane (data-config-panes="one")', () => {
    const view = '#dashboard-layout.config-layout > .config-view';
    const one = (page) => page.evaluate(() => document.body.setAttribute('data-config-panes', 'one'));

    test('the whole config view is a single pane: glass, card, or a light frame under open', async ({ page }) => {
        await open(page, '#config/appearance');
        await page.waitForSelector(view, { timeout: 20_000 });
        await one(page);

        await setSurface(page, 'glass');
        const glass = await paint(page, view);
        expect(glass.blur).toBe('blur');
        expect(glass.alpha).toBeGreaterThan(0);
        expect(glass.alpha).toBeLessThan(1);
        expect(glass.hairline).toBe(true);

        await setSurface(page, 'card');
        const card = await paint(page, view);
        expect(card.blur).toBe('none');
        expect(card.alpha).toBe(1);

        await setSurface(page, 'open');
        const frame = await paint(page, view);
        expect(frame.blur).toBe('none');
        expect(frame.alpha).toBeGreaterThan(0);
        expect(frame.hairline).toBe(true);
    });

    test('the header is the top of the pane and the panels inside are not panes of their own', async ({ page }) => {
        await open(page, '#config/structure');
        await page.waitForSelector('[data-structure-table]', { timeout: 20_000 });
        await one(page);
        await setSurface(page, 'glass');
        const head = await paint(page, '#dashboard-layout.config-layout > .config-view > .config-view-head');
        expect(head.alpha).toBe(0);
        expect(head.hairline).toBe(false);
        const framed = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout.config-layout > .config-view :is(.config-panel, .config-widget, .config-widget-row, .config-widget-kind, .config-widget-custom-card, .config-backup-row, .config-attention-row, .config-crud-list--table):not(.config-panel--attention, .config-panel--danger)')]
            .filter((el) => {
                const cs = getComputedStyle(el);
                const filtered = cs.backdropFilter && cs.backdropFilter !== 'none';
                const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
                const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
                const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
                return filtered || alpha > 0 || /0px 0px 0px 1px inset|inset 0px 0px 0px 1px/.test(cs.boxShadow);
            }).length);
        expect(framed).toBe(0);
    });
});

// A whole view is one pane: the tag view, the inbox and the bookmarks view are
// each drawn as a single pane round everything in them, and what is inside is
// not framed again.
test.describe('a view is one pane', () => {
    const cases = [
        ['the tag view', '#tags', '#dashboard-layout.tag-view-layout > .lvs'],
        ['the inbox', '#inbox', '#dashboard-layout.inbox-layout > .lvs'],
        ['the containers view', '#docker', '#dashboard-layout.docker-layout > .lvs'],
        ['the bookmarks view', '#bookmarks', '#dashboard-layout.library-layout > .config-view--library'],
    ];
    for (const [name, hash, selector] of cases) {
        test(`${name} is a single glass pane, and a light frame under open`, async ({ page }) => {
            await open(page, hash);
            await page.waitForSelector(selector, { timeout: 20_000 });
            await setSurface(page, 'glass');
            const glass = await paint(page, selector);
            expect(glass.blur).toBe('blur');
            expect(glass.alpha).toBeGreaterThan(0);
            expect(glass.alpha).toBeLessThan(1);
            expect(glass.hairline).toBe(true);
            expect(parseFloat(glass.radius)).toBeGreaterThanOrEqual(8);

            await setSurface(page, 'open');
            const frame = await paint(page, selector);
            expect(frame.blur).toBe('none');
            expect(frame.alpha).toBeGreaterThan(0);
            expect(frame.hairline).toBe(true);
        });
    }

    const shellHeader = '#dashboard-layout > .lvs .lvs-header';
    for (const [name, hash, headerSelector] of [
        ['the tag view', '#tags', shellHeader],
        ['the inbox', '#inbox', shellHeader],
        ['the containers view', '#docker', shellHeader],
        // Its band is config's head, not the shell's; it was left out and stood
        // dark at the top of the page before anything had scrolled.
        ['the bookmarks view', '#bookmarks', '#dashboard-layout.library-layout > .config-view--library > .config-view-head'],
    ]) {
        test(`the header of ${name} is part of the pane, not a pane of its own`, async ({ page }) => {
            await open(page, hash);
            await page.waitForSelector(headerSelector, { timeout: 20_000 });
            await setSurface(page, 'glass');
            const header = await paint(page, headerSelector);
            expect(header.alpha).toBe(0);
            expect(header.blur).toBe('none');
            expect(header.hairline).toBe(false);
        });
    }

    test('nothing inside the bookmarks view is framed again', async ({ page }) => {
        await open(page, '#bookmarks');
        await page.waitForSelector('#dashboard-layout.library-layout .config-view--library', { timeout: 20_000 });
        await setSurface(page, 'glass');
        const framed = await page.evaluate(() => [...document.querySelectorAll('#dashboard-layout.library-layout .config-view--library :is(.config-panel, .config-widget, .config-widget-row, .config-widget-kind, .config-widget-custom-card, .config-backup-row, .config-attention-row, .config-crud-list--table)')]
            .filter((el) => {
                const cs = getComputedStyle(el);
                const filtered = cs.backdropFilter && cs.backdropFilter !== 'none';
                const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
                const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
                const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
                return filtered || alpha > 0;
            }).length);
        expect(framed).toBe(0);
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Config is one pane, like the views beside it.
 *
 * Config drew every panel, overview card and table as a pane of its own on the
 * page, with its header a separate block above them, while the containers
 * view, the inbox, the tag view and the bookmarks view are each one pane round
 * everything in them. Config read as a different application. Now it is one
 * pane too -- glass, card or a light frame, like the dashboard's categories --
 * and the blocks inside keep a faint tint and a hairline, so a long settings
 * page still shows where a block starts and ends.
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

/*
 * Since v1.22.0 the default Material style is Signature: the views and Config take the
 * surface of the material (theme-overlays.css), whatever the category surface says. The
 * glass / card / open choice is the Classic drawing, so the tests of that choice put Classic
 * on the page first -- without saving it, which would leak to the other specs on this server.
 */
const asClassic = (page) => page.evaluate(async () => {
    await window.ThemeLoader.applySurfacesForTheme(window.dashboardInstance.settings.theme,
        { ...window.dashboardInstance.settings, materialStyle: 'classic', themeSurfacesForceAll: true });
});

/** What a block is painted with: alpha of its fill, blur, radius, whether it has a hairline. */
const paint = (page, selector) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    // Under Classic the bookmarks view blurs through a layer behind its content, so that it is
    // not the containing block of the fixed sheets and modals inside it; under Signature the
    // plate blurs by itself and that layer has none (theme-overlays.css).
    const ownBlur = cs.backdropFilter && cs.backdropFilter !== 'none';
    const layer = sel.includes('config-view--library') && !ownBlur ? getComputedStyle(el, '::before') : cs;
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

test.describe('config reads on its pane', () => {
    const view = '#dashboard-layout.config-layout > .config-view';

    test('what you set is white, help is a step lighter and as large as a note', async ({ page }) => {
        await open(page, '#config/behavior');
        await page.waitForSelector(`${view} .config-field-hint`, { timeout: 20_000 });
        const read = await page.evaluate((v) => {
            const primary = getComputedStyle(document.querySelector(v)).getPropertyValue('--text-primary').trim();
            const probe = document.createElement('span');
            probe.style.color = primary;
            document.body.appendChild(probe);
            const white = getComputedStyle(probe).color;
            probe.remove();
            const style = (sel) => {
                const cs = getComputedStyle(document.querySelector(`${v} ${sel}`));
                return { color: cs.color, size: parseFloat(cs.fontSize) };
            };
            return { white, label: style('.config-field-label'), nav: style('.config-nav-item:not(.is-active)'),
                hint: style('.config-field-hint'), note: style('.config-panel-note'), kbd: style('kbd') };
        }, view);
        expect(read.label.color).toBe(read.white);
        expect(read.nav.color).toBe(read.white);
        expect(read.hint.color).not.toBe(read.white);
        expect(read.hint.size).toBe(read.note.size);
        expect(read.kbd.size).toBeGreaterThanOrEqual(12);
    });
});

test.describe('config is one pane', () => {
    const view = '#dashboard-layout.config-layout > .config-view';

    test('the whole config view is a single pane: glass, card, or a light frame under open', async ({ page }) => {
        await open(page, '#config/appearance');
        await page.waitForSelector(view, { timeout: 20_000 });

        // Signature, the default: one pane drawn as a category of the material is --
        // on Aurora Glass a blurred, see-through plate with a round corner. Aurora
        // lets the backdrop supply the colour, so the fill itself can be clear.
        await setSurface(page, 'card');
        const signature = await paint(page, view);
        expect(signature.blur).toBe('blur');
        expect(signature.alpha).toBeLessThan(1);
        expect(parseFloat(signature.radius)).toBeGreaterThanOrEqual(8);

        // Glass, card or a light frame is the Classic drawing.
        await asClassic(page);
        await setSurface(page, 'glass');
        const glass = await paint(page, view);
        expect(glass.blur).toBe('blur');
        expect(glass.alpha).toBeGreaterThan(0);
        expect(glass.alpha).toBeLessThan(1);
        expect(glass.hairline).toBe(true);
        expect(parseFloat(glass.radius)).toBeGreaterThanOrEqual(8);

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

    test('the header is the top of the pane at rest', async ({ page }) => {
        await open(page, '#config/structure');
        await page.waitForSelector('[data-structure-table]', { timeout: 20_000 });
        await setSurface(page, 'glass');
        const head = await paint(page, `${view} > .config-view-head`);
        expect(head.alpha).toBe(0);
        expect(head.blur).toBe('none');
        expect(head.hairline).toBe(false);
    });

    test('a block inside is tinted with a hairline, never a pane of its own', async ({ page }) => {
        const readBlocks = () => page.evaluate((v) => [...document.querySelectorAll(`${v} :is(.config-panel, .config-widget, .config-crud-list--table):not(.config-panel--attention, .config-panel--danger)`)]
            .filter((el) => !el.parentElement.closest('.config-panel, .config-widget, .config-crud-list--table'))
            .map((el) => {
                const cs = getComputedStyle(el);
                const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
                const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
                const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
                return {
                    alpha,
                    blur: Boolean(cs.backdropFilter && cs.backdropFilter !== 'none'),
                    hairline: /inset 0px 0px 0px 1px|0px 0px 0px 1px inset/.test(cs.boxShadow),
                };
            }), view);
        for (const hash of ['#config/overview', '#config/behavior', '#config/structure']) {
            await open(page, hash);
            await page.waitForSelector(`${view} :is(.config-panel, .config-widget, .config-crud-list--table)`, { timeout: 20_000 });
            // Signature, the default: a block lies on the plate in the material's small fill
            // (--ov-fill-small, nearly closed on glass) with a hairline, and never blurs again.
            const onSignature = await readBlocks();
            expect(onSignature.length, `${hash} signature`).toBeGreaterThan(0);
            for (const block of onSignature) {
                expect(block.blur, `${hash} signature`).toBe(false);
                expect(block.alpha, `${hash} signature`).toBeGreaterThan(0);
                expect(block.hairline, `${hash} signature`).toBe(true);
            }
            // The tint per category surface is the Classic drawing.
            await asClassic(page);
            for (const surface of ['glass', 'card', 'open']) {
                await setSurface(page, surface);
                const blocks = await readBlocks();
                expect(blocks.length, `${hash} ${surface}`).toBeGreaterThan(0);
                for (const block of blocks) {
                    expect(block.blur, `${hash} ${surface}`).toBe(false);
                    expect(block.alpha, `${hash} ${surface}`).toBeGreaterThan(0);
                    // A tint, not a pane: at most the 35% darkening on glass and open.
                    expect(block.alpha, `${hash} ${surface}`).toBeLessThanOrEqual(0.36);
                    expect(block.hairline, `${hash} ${surface}`).toBe(true);
                }
            }
        }
    });

    test('scrolled, the header fills like the other views\' headers', async ({ page }) => {
        await open(page, '#config/behavior');
        await page.waitForSelector(`${view} .config-panel`, { timeout: 20_000 });
        await setSurface(page, 'glass');
        await page.mouse.wheel(0, 700);
        await expect.poll(() => page.evaluate(() => document.body.dataset.scrolled)).toBe('true');
        // Polled: the fill eases in over 0.18 s after data-scrolled flips.
        await expect.poll(async () => (await paint(page, `${view} > .config-view-head`)).alpha)
            .toBeGreaterThanOrEqual(0.85);
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
            // Signature, the default: the view is one plate in the material, a blurred glass
            // pane on Aurora Glass under any category surface.
            await setSurface(page, 'open');
            const signature = await paint(page, selector);
            expect(signature.blur).toBe('blur');
            expect(signature.alpha).toBeGreaterThan(0);
            expect(signature.alpha).toBeLessThan(1);
            expect(parseFloat(signature.radius)).toBeGreaterThanOrEqual(8);

            // Glass against a light frame is the Classic drawing.
            await asClassic(page);
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

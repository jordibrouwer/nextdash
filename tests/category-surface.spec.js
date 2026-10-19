// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * What a category sits on: glass, card or open.
 *
 * A category was text on the page in every theme. data-cat-surface on <body>
 * says what it sits on now, and the three words draw three different things on
 * the same .category, without a change to its DOM.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** The pane a category draws: its background alpha and its backdrop-filter. */
async function pane(page, layout) {
    return page.evaluate((layoutClass) => {
        const grid = document.querySelector('.dashboard-grid');
        grid.classList.remove('layout-default', 'layout-masonry', 'layout-terminal', 'layout-launcher');
        grid.classList.add(layoutClass);
        const cs = getComputedStyle(document.querySelector('.dashboard-grid .category'));
        // rgb() and rgba() carry alpha as a fourth number, color() after a slash.
        const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
        const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
        const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
        return {
            alpha,
            blur: cs.backdropFilter && cs.backdropFilter !== 'none' ? cs.backdropFilter : 'none',
            border: cs.borderTopWidth,
        };
    }, layout);
}

async function setSurface(page, word) {
    await page.evaluate((w) => window.ThemeLoader.applyCatSurface(w), word);
}

test.describe('category surface', () => {
    test('a fresh page is drawn on glass', async ({ page }) => {
        await openDashboard(page);
        await expect(page.locator('body')).toHaveAttribute('data-cat-surface', 'glass');
    });

    test('glass is see-through and blurred, card is solid, open has no pane', async ({ page }) => {
        await openDashboard(page);

        await setSurface(page, 'glass');
        const glass = await pane(page, 'layout-default');
        expect(glass.alpha).toBeGreaterThan(0);
        expect(glass.alpha).toBeLessThan(1);
        expect(glass.blur).not.toBe('none');

        await setSurface(page, 'card');
        const card = await pane(page, 'layout-default');
        expect(card.alpha).toBe(1);
        expect(card.blur).toBe('none');

        await setSurface(page, 'open');
        const open = await pane(page, 'layout-default');
        expect(open.alpha).toBe(0);
        expect(open.blur).toBe('none');
    });

    test('a widget under a pane keeps one surface, not a card in a card', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'glass');
        const body = await page.evaluate(() => {
            const el = document.querySelector('.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .dashboard-widget .dashboard-widget-body');
            if (!el) return null;
            const cs = getComputedStyle(el);
            return { blur: cs.backdropFilter, border: cs.borderTopWidth, shadow: cs.boxShadow };
        });
        expect(body, 'the starter page has widgets').not.toBeNull();
        expect(body.blur).toBe('none');
        expect(body.border).toBe('0px');
        expect(body.shadow).toBe('none');
    });

    test('the rows of a widget list are not filled: a hairline between them, a light wash when pointed at', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'glass');
        const got = await page.evaluate(() => {
            const alphaOf = (cs) => {
                const m = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
                const c = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
                return m ? parseFloat(m[1]) : c ? parseFloat(c[1].split(',')[3]) : 1;
            };
            const scope = '.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .dashboard-widget';
            const row = document.querySelector(`${scope} :is(.dashboard-widget-health-row, .dashboard-widget-trend-row, .dashboard-widget-weather-row)`);
            if (!row) return null;
            const list = row.parentElement;
            const rs = getComputedStyle(row);
            const hover = getComputedStyle(document.documentElement).getPropertyValue('--dashboard-widget-cell-hover');
            return {
                row: alphaOf(rs),
                list: alphaOf(getComputedStyle(list)),
                gap: getComputedStyle(list).rowGap,
                line: rs.borderBottomWidth,
                hover,
                bodyHover: getComputedStyle(row.closest('.dashboard-widget')).getPropertyValue('--dashboard-widget-cell-hover'),
            };
        });
        expect(got, 'the starter page has a widget with a list of rows').not.toBeNull();
        expect(got.row).toBe(0);
        expect(got.list).toBe(0);
        expect(got.gap).toBe('0px');
        expect(got.line).toBe('1px');
        expect(got.bodyHover.trim()).not.toBe('');
    });

    test('the figures of a stats widget are a faint chip', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'glass');
        const alpha = await page.evaluate(() => {
            const cell = document.querySelector('.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .dashboard-widget .dashboard-widget-stat');
            if (!cell) return null;
            const m = getComputedStyle(cell).backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
            const comma = getComputedStyle(cell).backgroundColor.match(/rgba\(([^)]+)\)/);
            return m ? parseFloat(m[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
        });
        test.skip(alpha === null, 'the starter page has no stats widget');
        expect(alpha).toBeGreaterThan(0);
        expect(alpha).toBeLessThanOrEqual(0.06);
    });

    test('the terminal and launcher layouts keep their own design', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'glass');
        for (const layout of ['layout-terminal', 'layout-launcher']) {
            const got = await pane(page, layout);
            expect(got.blur, layout).toBe('none');
        }
    });

    test('hovering a glass category does not move it', async ({ page }) => {
        await openDashboard(page);
        await setSurface(page, 'glass');
        const cat = page.locator('.dashboard-grid .category').first();
        await cat.scrollIntoViewIfNeeded();
        const before = await cat.boundingBox();
        await cat.hover();
        const after = await cat.boundingBox();
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
        expect(after.width).toBe(before.width);
    });
});

// Effects is how loudly a theme's character is drawn -- its shine, its grain. A
// pane has to carry that character or the setting changes nothing you can see.
// The lacquer theme ships at the glass depth, which draws no gloss, so the test
// asks for a richer one: it is the shine that Effects turns down.
test('the panes draw the theme\'s shine, and Effects turns it down', async ({ page, request }) => {
    const headers = { 'X-NextDash-Token': WRITE_TOKEN };
    const before = await (await request.get('/api/settings')).json();
    expect((await request.post('/api/settings', { headers, data: { theme: 'gloss-liquid-chrome-dark', themeSurfacePrefs: { 'gloss-liquid-chrome-dark': { depth: 'rich' } }, themeEffects: 'follow' } })).ok()).toBe(true);
    try {
        await openDashboard(page);
        await setSurface(page, 'glass');
        const paint = (effects) => page.evaluate((e) => {
            document.documentElement.setAttribute('data-effects', e);
            document.body.setAttribute('data-effects', e);
            const el = document.querySelector('.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .category:not(.dashboard-widget)');
            return getComputedStyle(el).backgroundImage;
        }, effects);
        const full = await paint('full');
        const off = await paint('off');
        expect(full, 'a pane carries no gradient of the theme\'s').toContain('gradient');
        expect(off, 'Effects off drew the same pane as full').not.toBe(full);
    } finally {
        await request.post('/api/settings', { headers, data: { theme: before.theme, themeSurfacePrefs: before.themeSurfacePrefs || {}, themeEffects: before.themeEffects || 'follow' } });
    }
});

// Open is open for the widget too: no card behind it, so what a widget shows
// sits on the page like the lists beside it.
test('under open a widget has no card of its own when Widget background is none', async ({ page }) => {
    await openDashboard(page);
    // Automatic gives a widget a frame of its own on open (widget-background.spec.js).
    await page.evaluate(() => window.ThemeLoader.applyWidgetSurface('none'));
    await setSurface(page, 'open');
    const body = await page.evaluate(() => {
        const el = document.querySelector('.dashboard-grid:is(.layout-default, .layout-compact, .layout-masonry) .dashboard-widget .dashboard-widget-body');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const slash = cs.backgroundColor.match(/\/\s*([\d.]+)\s*\)/);
        const comma = cs.backgroundColor.match(/rgba\(([^)]+)\)/);
        const alpha = slash ? parseFloat(slash[1]) : comma ? parseFloat(comma[1].split(',')[3]) : 1;
        return { alpha, border: cs.borderTopWidth, shadow: cs.boxShadow, blur: cs.backdropFilter };
    });
    expect(body, 'the starter page has widgets').not.toBeNull();
    expect(body.alpha).toBe(0);
    expect(body.border).toBe('0px');
    expect(body.shadow).toBe('none');
    expect(body.blur).toBe('none');
});

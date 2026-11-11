// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Riso group draws a second ink a pixel or two off the first. What matters
 * is that it is a hard offset shadow behind the text (so the glyph stays
 * crisp), that it exists only under riso themes, and that the text still reads.
 */
const THEMES = [
    'riso-pink-blue-light', 'riso-pink-blue-dark',
    'riso-green-orange-light', 'riso-green-orange-dark',
    'riso-mimeograph-light', 'riso-mimeograph-dark',
];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

async function use(page, theme) {
    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        await d.config.ensureSection('appearance');
        await d.config.setTheme(t);
        d.setupDOM();
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

/** The first row and the first category title that are really on the page. */
async function probe(page) {
    return page.evaluate(() => {
        const luminance = (rgb) => {
            const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        // The mimeograph adds a soft ink-bleed halo; the second ink is the shadow with an offset.
        const shadow = (el) => {
            const all = [...getComputedStyle(el).textShadow.matchAll(/(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/g)]
                .map((m) => ({ x: +m[1], y: +m[2], blur: +m[3] }));
            return all.find((s) => s.x !== 0 || s.y !== 0) || all[0] || null;
        };
        const row = document.querySelector('.category:not([data-smart-collection]) .bookmark-link .bookmark-text');
        const title = document.querySelector('.category:not([data-smart-collection]) .category-title-name');
        // The page colour the text sits on, resolved through a probe element.
        const probeEl = document.createElement('i');
        probeEl.style.color = 'var(--background-secondary)';
        document.body.appendChild(probeEl);
        const bg = parse(getComputedStyle(probeEl).color);
        probeEl.remove();
        const fg = parse(getComputedStyle(row).color);
        const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
        // The head is a flat block of ink: its own text against its own fill.
        const head = title.closest('.category-title');
        const headFg = parse(getComputedStyle(head).color);
        const headBg = parse(getComputedStyle(head).backgroundColor);
        const [h1, h2] = [luminance(headFg), luminance(headBg)].sort((a, b) => b - a);
        const cat = title.closest('.category');
        const cs = getComputedStyle(cat);
        return {
            row: shadow(row), title: shadow(title), contrast: (l1 + 0.05) / (l2 + 0.05),
            headContrast: (h1 + 0.05) / (h2 + 0.05),
            borderPx: parseFloat(cs.borderTopWidth), radius: parseFloat(cs.borderTopLeftRadius),
            blockShadow: cs.boxShadow, headFill: getComputedStyle(head).backgroundColor,
        };
    });
}

test.describe('riso theme group', () => {
    test('rows and category titles carry a misregistered second ink', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            const p = await probe(page);
            for (const [what, s] of [['row', p.row], ['title', p.title]]) {
                expect(s, `${theme} ${what} has a text-shadow`).not.toBeNull();
                expect(Math.abs(s.x) + Math.abs(s.y), `${theme} ${what} is offset`).toBeGreaterThan(0);
                expect(Math.max(Math.abs(s.x), Math.abs(s.y)), `${theme} ${what} stays within 1-3px`).toBeLessThanOrEqual(4);
                expect(s.blur, `${theme} ${what} is a hard shadow, never a blur`).toBe(0);
            }
        }
    });

    test('text still reads against the paper or stock', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            // A theme change fades its colours; poll until the fade has landed.
            await expect.poll(async () => (await probe(page)).contrast, { message: theme }).toBeGreaterThanOrEqual(4.5);
        }
    });

    test('a category is a flat block of ink with square corners and a thick outline', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            await expect.poll(async () => (await probe(page)).headContrast, { message: theme }).toBeGreaterThanOrEqual(4.5);
            const p = await probe(page);
            expect(p.borderPx, `${theme} outline`).toBeGreaterThanOrEqual(2);
            expect(p.radius, `${theme} square corners`).toBe(0);
            expect(p.headFill, `${theme} head is solid ink`).not.toBe('rgba(0, 0, 0, 0)');
        }
        // Pink-Blue prints a hard second pass off the block; Green-Orange stamps instead.
        await use(page, 'riso-pink-blue-light');
        expect((await probe(page)).blockShadow).toMatch(/\d+px \d+px 0px/);
    });

    test('every column count keeps the blocks inside the page', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'riso-pink-blue-dark');
        for (const n of [1, 2, 3, 4, 5, 6]) {
            await page.evaluate(async (cols) => {
                const d = window.dashboardInstance;
                d.settings.columnsPerRow = cols;
                d.setupDOM();
            }, n);
            const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(over, `${n} columns`).toBeLessThanOrEqual(0);
            const rows = await page.locator('.category:not([data-smart-collection]) .bookmark-link').count();
            expect(rows, `${n} columns draw rows`).toBeGreaterThan(0);
        }
    });

    test('an ordinary theme has no second ink', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'riso-pink-blue-light');
        await use(page, 'look-ocean-dark');
        const p = await probe(page);
        expect(p.row).toBeNull();
        expect(p.title).toBeNull();
    });

    test('an open menu stays plain and legible under multiply', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'riso-pink-blue-light');
        await page.locator('.category:not([data-smart-collection]) .bookmark-link').first().click({ button: 'right' });
        const item = page.locator('.context-menu, [role="menu"]').first();
        await expect(item).toBeVisible();
        const blend = await item.evaluate((el) => getComputedStyle(el).mixBlendMode);
        expect(blend).toBe('normal');
    });
});

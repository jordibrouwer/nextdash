// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The Tactile group: a row is an object (label tape, keycap, rack plate).
 *
 * Behaviour only: what the row computes to under each theme, that a press
 * sinks a keycap, that status keeps a shape of its own, and that a reader who
 * asked for no motion gets a colour change instead of a move.
 */
const THEMES = [
    'tactile-label-maker-dark', 'tactile-label-maker-light',
    'tactile-keycap-dark', 'tactile-keycap-light',
    'tactile-rack-unit-dark', 'tactile-rack-unit-light',
];

async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmarks-list > .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Pick a theme through the app's own writer, then wait for the page to follow. */
async function use(page, theme) {
    await page.evaluate(async (t) => {
        const d = window.dashboardInstance;
        await d.config.ensureSection('appearance');
        await d.config.setTheme(t);
    }, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
}

const row = (page) => page.locator('.category:not([data-smart-collection="true"]) .bookmarks-list > .bookmark-link').first();

const paint = (loc) => loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundImage + '|' + cs.backgroundColor, shadow: cs.boxShadow, transform: cs.transform, radius: cs.borderTopLeftRadius };
});

test.describe('tactile theme group', () => {
    test('every family draws the row as an object, in both halves', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'look-ocean-dark');
        const plain = await paint(row(page));
        const plainWidth = await row(page).evaluate((el) => el.getBoundingClientRect().width);
        for (const theme of THEMES) {
            await use(page, theme);
            const p = await paint(row(page));
            expect(p.shadow, `${theme} shadow`).not.toBe('none');
            expect(`${p.bg}${p.shadow}`, `${theme} differs from an ordinary theme`).not.toBe(`${plain.bg}${plain.shadow}`);
            // Still the full-width link it always was: no narrower than in an ordinary theme.
            const width = await row(page).evaluate((el) => el.getBoundingClientRect().width);
            expect(width, `${theme} row width`).toBeGreaterThan(plainWidth * 0.95);
        }
    });

    test('a keycap sinks while it is held, and comes back', async ({ page }) => {
        await openDashboard(page);
        for (const theme of ['tactile-keycap-dark', 'tactile-keycap-light']) {
            await use(page, theme);
            const r = row(page);
            await r.scrollIntoViewIfNeeded();
            const idle = await paint(r);
            expect(idle.transform).toBe('none');
            const box = await r.boundingBox();
            if (!box) throw new Error('row has no box');
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down();
            await expect.poll(async () => (await paint(r)).transform, theme).not.toBe('none');
            await expect.poll(async () => (await paint(r)).shadow, `${theme} edge`).not.toBe(idle.shadow);
            // Release away from the link: a release over it would open the bookmark.
            await page.mouse.move(2, 2);
            await page.mouse.up();
            await expect.poll(async () => (await paint(r)).transform, theme).toBe('none');
        }
    });

    test('with motion off a press changes colour, nothing moves', async ({ page }) => {
        await openDashboard(page);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await use(page, 'tactile-keycap-dark');
        const r = row(page);
        await r.scrollIntoViewIfNeeded();
        const box = await r.boundingBox();
        if (!box) throw new Error('row has no box');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const hovered = await paint(r);
        await page.mouse.down();
        await expect.poll(async () => (await paint(r)).bg).not.toBe(hovered.bg);
        expect((await paint(r)).transform).toBe('none');
        await page.mouse.move(2, 2);
        await page.mouse.up();
    });

    test('status keeps a shape of its own, not only a colour', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            const shapes = await row(page).evaluate((el) => {
                const out = {};
                for (const s of ['status-online', 'status-offline', 'status-checking']) {
                    el.classList.remove('status-online', 'status-offline', 'status-checking');
                    el.classList.add(s);
                    const lamp = getComputedStyle(el.querySelector('.bookmark-lead'), '::after');
                    out[s] = { shown: lamp.display !== 'none', radius: lamp.borderTopLeftRadius, rotate: lamp.transform, filled: lamp.backgroundColor !== 'rgba(0, 0, 0, 0)' };
                }
                el.classList.remove('status-online', 'status-offline', 'status-checking');
                const idle = getComputedStyle(el.querySelector('.bookmark-lead'), '::after').display;
                return { out, idle };
            });
            expect(shapes.idle, `${theme}: a row without a status has no lamp`).toBe('none');
            for (const s of ['status-online', 'status-offline', 'status-checking']) expect(shapes.out[s].shown, `${theme} ${s}`).toBe(true);
            expect(shapes.out['status-online'].radius, theme).not.toBe(shapes.out['status-offline'].radius);
            expect(shapes.out['status-offline'].rotate, theme).not.toBe('none');
            expect(shapes.out['status-checking'].filled, `${theme}: checking is a ring`).toBe(false);
            expect(shapes.out['status-online'].filled, theme).toBe(true);
        }
    });

    test('the keyboard-selected row is marked, in every theme', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            const mark = await row(page).evaluate(async (el) => {
                document.activeElement?.blur?.();
                await new Promise((r) => setTimeout(r, 300));
                const idle = getComputedStyle(el).boxShadow;
                el.classList.add('keyboard-selected');
                // The edge transitions; read it once it has settled.
                await new Promise((r) => setTimeout(r, 300));
                const cs = getComputedStyle(el);
                const o = { w: parseFloat(cs.outlineWidth), style: cs.outlineStyle, shadow: cs.boxShadow, idle };
                el.classList.remove('keyboard-selected');
                return o;
            });
            if (theme.startsWith('tactile-label-maker')) {
                // The strip is clipped to its cut ends, so the frame sits inside it as an inset ring.
                expect(mark.shadow, theme).toContain('inset');
                expect(mark.shadow, theme).not.toBe(mark.idle);
            } else {
                expect(mark, theme).toMatchObject({ w: 2, style: 'solid' });
            }
        }
    });

    test('label maker rows are strips of different colours with black print', async ({ page }) => {
        await openDashboard(page);
        for (const theme of ['tactile-label-maker-dark', 'tactile-label-maker-light']) {
            await use(page, theme);
            const rows = await page.evaluate(() => Array.from([...document.querySelectorAll('.category .bookmarks-list')]
                .find((list) => list.querySelectorAll(':scope > .bookmark-link').length >= 5)
                .querySelectorAll(':scope > .bookmark-link'))
                .slice(0, 5).map((el) => { const cs = getComputedStyle(el); return { tape: cs.getPropertyValue('--lm-tape').trim(), ink: cs.color, clip: cs.clipPath }; }));
            expect(new Set(rows.map((r) => r.tape)).size, `${theme} five cartridges`).toBe(5);
            for (const r of rows) {
                expect(r.ink, theme).toBe('rgb(10, 10, 12)');
                expect(r.clip, `${theme} cut ends`).toContain('polygon');
            }
        }
    });

    test('a widget has the same pane as a category, and its lines are objects too', async ({ page }) => {
        await openDashboard(page);
        for (const theme of THEMES) {
            await use(page, theme);
            // Let the pressed state settle before the fixture tears the page down.
            await page.waitForTimeout(250);
            const got = await page.evaluate(() => {
                const pick = (el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, img: c.backgroundImage, shadow: c.boxShadow, r: c.borderRadius }; };
                const widget = document.querySelector('.category.dashboard-widget');
                const cat = document.querySelector('.category:not(.dashboard-widget):not([data-smart-collection="true"])');
                const line = document.querySelector('.dashboard-widget .dashboard-widget-note-task, .dashboard-widget .dashboard-widget-health-row');
                const text = document.querySelector('.dashboard-widget .dashboard-widget-note-lines');
                const ordinary = (el) => (el ? getComputedStyle(el).boxShadow : null);
                return widget && cat ? { widget: pick(widget), cat: pick(cat), line: line ? ordinary(line) : null, text: text ? ordinary(text) : null } : null;
            });
            expect(got, `${theme}: the page has a widget and a category`).not.toBeNull();
            expect(got.widget, theme).toEqual(got.cat);
            // The widget's lines carry the same kind of depth as the rows of a category.
            if (got.line !== null) expect(got.line, `${theme} widget line`).not.toBe('none');
            // Label Maker and Keycap give the text its own label or well; a rack's text stays on the pane.
            if (got.text !== null && !theme.startsWith('tactile-rack-unit')) expect(got.text, `${theme} widget text panel`).not.toBe('none');
        }
    });

    test('rack unit widget content has no fill of its own', async ({ page }) => {
        await openDashboard(page);
        for (const theme of ['tactile-rack-unit-dark', 'tactile-rack-unit-light']) {
            await use(page, theme);
            // Let the pressed state settle before the fixture tears the page down.
            await page.waitForTimeout(250);
            const text = await page.evaluate(() => {
                const el = document.querySelector('.dashboard-widget .dashboard-widget-note-lines');
                if (!el) return null;
                const c = getComputedStyle(el);
                return { bg: c.backgroundColor, img: c.backgroundImage, shadow: c.boxShadow };
            });
            expect(text, `${theme}: the page has a notes widget`).not.toBeNull();
            expect(text, theme).toEqual({ bg: 'rgba(0, 0, 0, 0)', img: 'none', shadow: 'none' });
        }
    });

    test('every family has a backdrop of its own', async ({ request }) => {
        const meta = await (await request.get('/api/themes/meta')).json();
        const want = { 'tactile-label-maker': 'labeltape', 'tactile-keycap': 'keycapfield', 'tactile-rack-unit': 'rackcables' };
        for (const [family, recipe] of Object.entries(want)) {
            for (const half of ['-dark', '-light']) {
                expect(meta.themes?.[family + half]?.backdrop ?? meta[family + half]?.backdrop, family + half).toBe(recipe);
            }
        }
    });

    test('ordinary themes are untouched', async ({ page }) => {
        await openDashboard(page);
        await use(page, 'look-ocean-dark');
        const lamp = await row(page).evaluate((el) => getComputedStyle(el.querySelector('.bookmark-lead'), '::after').content);
        expect(lamp === 'none' || lamp === 'normal').toBe(true);
    });
});

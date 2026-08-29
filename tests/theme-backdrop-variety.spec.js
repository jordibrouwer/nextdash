// @ts-check
const { test, expect } = require('./fixtures');
const { prepareDashboardInteraction } = require('./e2e-helpers');

/*
 * Every theme family says which backdrop suits it.
 *
 * The texture behind the dashboard is a theme's decision: blueprint wants a
 * grid, a CRT wants scanlines, paper wants a hatch. Fourteen families said so
 * and the remaining ninety-three fell through to the default, so someone
 * stepping through themes met dots two hundred times out of two hundred and
 * fourteen and reasonably concluded the other backdrops were broken.
 *
 * Assigned per family rather than per variant, because a theme's light and dark
 * halves are one idea: Bone China on paper is Bone China whichever way round it
 * is printed.
 */

/** Read what a theme actually paints, through the app's own theme switch. */
async function backdropsFor(page, themes) {
    return page.evaluate(async (list) => {
        const out = {};
        for (const theme of list) {
            window.ThemeLoader?.applyTheme?.(theme) ?? window.applyTheme?.(theme);
            // The switch writes attributes and the styles resolve on the next
            // frame; reading immediately gets the previous theme's answer.
            await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 20)));
            const image = getComputedStyle(document.body, '::before').backgroundImage;
            out[theme] = image.includes('radial') ? 'dots'
                : image.includes('repeating-linear') ? 'hatch'
                : (image.match(/linear-gradient/g) || []).length > 1 ? 'grid'
                : image.includes('linear') ? 'lines'
                : 'nothing';
        }
        return out;
    }, themes);
}

test.describe('a theme brings its own backdrop', () => {
    test('all four textures are in use across the library', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        // A spread across the library rather than the fourteen that already
        // differed: the point is that an ordinary theme now has an opinion too.
        const sample = ['jungle-neon-dark', 'slate-one-dark', 'owl-hours-dark', 'mirage-sand-dark',
            'bone-china-dark', 'wheat-field-dark', 'copper-circuit-dark', 'emerald-matrix-dark',
            'terminal-amber-dark', 'midnight-neon-dark', 'nordic-frost-dark', 'harbour-fog-dark',
            'library-mahogany-dark', 'foundry-iron-dark', 'sea-glass-dark', 'signal-flare-dark'];
        const found = await backdropsFor(page, sample);

        // Nothing is a bug: every theme paints something unless the reader
        // asked for none.
        for (const [theme, backdrop] of Object.entries(found)) {
            expect(backdrop, `${theme} paints nothing`).not.toBe('nothing');
        }
        // All four in a sample of sixteen. Before this, the same sample was
        // dots sixteen times.
        expect(new Set(Object.values(found)), JSON.stringify(found))
            .toEqual(new Set(['dots', 'grid', 'lines', 'hatch']));
    });

    test('light and dark of one family agree', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const families = ['bone-china', 'copper-circuit', 'terminal-amber', 'nordic-frost',
            'wheat-field', 'emerald-matrix', 'harbour-fog', 'library-mahogany'];
        const pairs = families.flatMap((f) => [`${f}-dark`, `${f}-light`]);
        const found = await backdropsFor(page, pairs);

        for (const family of families) {
            expect(found[`${family}-light`], `${family}: light and dark differ`)
                .toBe(found[`${family}-dark`]);
        }
    });
    /*
     * The whole library, not a sample.
     *
     * Two hundred and fourteen variants is past what anyone checks by eye, and
     * the two ways this breaks are both invisible: a family nobody assigned
     * falls back to the default and looks deliberate, and a family that named
     * only its dark half changes texture when the reader switches to light.
     * Four families were doing exactly that before this ran.
     */
    test('all 214 variants have one, and every family agrees with itself', async ({ page }) => {
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
        await prepareDashboardInteraction(page);

        const themes = require('fs').readFileSync('internal/app/models.go', 'utf8')
            .match(/"[a-z0-9-]+-(?:dark|light)":\s*\{Name:/g)
            .map((match) => match.split('"')[1]);
        expect(themes.length).toBeGreaterThan(200);

        // The attribute directly rather than the theme switch: two hundred and
        // fourteen round trips through applyTheme is a minute of waiting, and
        // what is under test is which CSS rule matches, not the switch.
        const found = await page.evaluate((list) => {
            const out = {};
            for (const theme of list) {
                document.documentElement.setAttribute('data-theme', theme);
                document.body.className = `${theme} font-size-m`;
                const image = getComputedStyle(document.body, '::before').backgroundImage;
                out[theme] = image.includes('radial') ? 'dots'
                    : image.includes('repeating-linear') ? 'hatch'
                    : (image.match(/linear-gradient/g) || []).length > 1 ? 'grid'
                    : image.includes('linear') ? 'lines'
                    : 'nothing';
            }
            return out;
        }, themes);

        const bare = Object.entries(found).filter(([, b]) => b === 'nothing').map(([t]) => t);
        expect(bare, 'themes painting nothing').toEqual([]);

        const families = {};
        for (const [theme, backdrop] of Object.entries(found)) {
            (families[theme.replace(/-(dark|light)$/, '')] ||= []).push(backdrop);
        }
        const split = Object.entries(families)
            .filter(([, backdrops]) => new Set(backdrops).size > 1)
            .map(([family]) => family);
        expect(split, 'families whose light and dark disagree').toEqual([]);
    });
});

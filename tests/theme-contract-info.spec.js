// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The stylesheet may now ask a theme for its fourth colour and get an answer.
 *
 * --accent-info marks a kind rather than a verdict: a feature row against a
 * post in the news stream, a filter completion against a finder in the search
 * list, the note field you are typing in. It was asked for in seven places
 * and defined in none, so every one of them fell through to a hard-coded
 * #60A5FA -- one blue across a paper theme, a green terminal and 220 others.
 *
 * Derived from the palette rather than written into 222 records: the tone
 * comes from the theme's own accent, and only the hue is chosen, as far from
 * success, warning and error as the circle allows.
 */

async function dashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** What a custom-property expression paints, resolved. */
const paint = (page, value) => page.evaluate((expr) => {
    const probe = document.createElement('span');
    probe.style.color = expr;
    document.body.appendChild(probe);
    const painted = window.getComputedStyle(probe).color;
    probe.remove();
    return painted;
}, value);

test.describe('the widened theme contract', () => {
    /**
     * Written the way the stylesheet writes it, fallback and all. Asking for a
     * bare var(--accent-info) proves nothing: undefined and with no fallback
     * it paints the inherited colour, which differs from the blue and from the
     * verdicts by accident, and the test passes on the very code it is meant
     * to catch.
     */
    const INFO = 'var(--accent-info, #60A5FA)';

    /** Paints the expression under a named theme. */
    const under = (page, theme) => page.evaluate(([name, expr]) => {
        document.documentElement.setAttribute('data-theme', name);
        const probe = document.createElement('span');
        probe.style.color = expr;
        document.body.appendChild(probe);
        const painted = window.getComputedStyle(probe).color;
        probe.remove();
        return painted;
    }, [theme, INFO]);

    test('a theme answers for its info colour', async ({ page }) => {
        await dashboard(page);

        // Two palettes as far apart as the collection goes: a green terminal
        // and a pale blue glass. One blue for both is the bug.
        const terminal = await under(page, 'retro-crt-dark');
        const glass = await under(page, 'aurora-glass-dark');

        expect(terminal, 'the info colour does not follow the theme').not.toBe(glass);
    });

    test('and it is not one of the three verdict colours', async ({ page }) => {
        await dashboard(page);

        const [info, success, warning, error] = await Promise.all([
            paint(page, INFO),
            paint(page, 'var(--accent-success)'),
            paint(page, 'var(--accent-warning)'),
            paint(page, 'var(--accent-error)'),
        ]);

        for (const [name, colour] of [['success', success], ['warning', warning], ['error', error]]) {
            expect(info, `info is indistinguishable from ${name}`).not.toBe(colour);
        }
    });

    test('the surface ladder carries the theme\'s own step', async ({ page }) => {
        await dashboard(page);

        const step = await page.evaluate(() =>
            window.getComputedStyle(document.body).getPropertyValue('--theme-surface-step').trim());

        expect(step, '--theme-surface-step is not declared').not.toBe('');
        expect(Number(step), `a step of ${step} is outside the range`).toBeGreaterThanOrEqual(0.6);
        expect(Number(step), `a step of ${step} is outside the range`).toBeLessThanOrEqual(1.8);
    });

    test('and the depth control still multiplies on top of it', async ({ page }) => {
        await dashboard(page);

        const surfaceAt = (depth) => page.evaluate((value) => {
            document.body.setAttribute('data-depth', value);
            const probe = document.createElement('span');
            probe.style.color = 'var(--surface-2)';
            document.body.appendChild(probe);
            const painted = window.getComputedStyle(probe).color;
            probe.remove();
            return painted;
        }, depth);

        // The step decides what one rung is worth on this theme; the reader
        // still decides how many rungs are drawn. A theme naming its surfaces
        // outright would have taken this away, which is why it cannot.
        const flat = await surfaceAt('flat');
        const rich = await surfaceAt('rich');
        expect(rich, 'the depth control no longer moves the surface').not.toBe(flat);
    });
});

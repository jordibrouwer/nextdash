// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * A raised surface has two edges, not one.
 *
 * --edge-light has drawn the lit top line since the depth ladder landed, and
 * it is what makes a flat rectangle read as something sitting on the page. On
 * its own it is a highlight; with a darker line along the bottom the same
 * surface reads as a slab with a thickness. Every one of the seven redesign
 * drafts uses both, and the shipped app defines only the first.
 *
 * Derived from --text-primary, never from black: an inset line lies ON the
 * surface, so on a light or paper theme a black one turns into a hard stripe.
 */

async function openDashboard(page, depth) {
    await page.addInitScript((value) => {
        window.localStorage.setItem('nextdash-test-depth', value);
    }, depth);
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((value) => {
        document.body.setAttribute('data-depth', value);
    }, depth);
}

/** The resolved value of a custom property on <body>. */
const tokenValue = (page, name) => page.evaluate(
    (prop) => window.getComputedStyle(document.body).getPropertyValue(prop).trim(),
    name,
);

test.describe('the dark bottom edge', () => {
    test('is defined, and derived from the theme rather than from black', async ({ page }) => {
        await openDashboard(page, 'rich');

        const edgeDark = await tokenValue(page, '--edge-dark');
        expect(edgeDark, '--edge-dark is not defined').not.toBe('');

        // An inset line along the bottom: the offset is negative.
        expect(edgeDark).toMatch(/inset/);
        expect(edgeDark).toMatch(/-1px/);

        // color-mix resolves before this is read, so what is left must not be
        // a flat black. A theme-derived line carries the theme's own hue.
        expect(edgeDark.toLowerCase()).not.toContain('rgb(0, 0, 0)');
        expect(edgeDark.toLowerCase()).not.toContain('#000');
    });

    test('flat means flat: no edges at all', async ({ page }) => {
        await openDashboard(page, 'flat');

        const edgeDark = await tokenValue(page, '--edge-dark');
        const edgeLight = await tokenValue(page, '--edge-light');

        // Both may resolve to a transparent line, but neither may paint.
        const paints = (value) => value !== '' && !/transparent|rgba\(0, 0, 0, 0\)/.test(value);
        expect(paints(edgeDark), 'flat drew a bottom edge').toBe(false);
        expect(paints(edgeLight), 'flat drew a top edge').toBe(false);
    });

    test('the raised surfaces carry both edges', async ({ page }) => {
        await openDashboard(page, 'rich');

        // A card preset's category: the widget body stepped off the ladder, so
        // the card is the raised surface the ladder still paints.
        const shadow = await page.evaluate(() => {
            const probe = document.createElement('div');
            probe.className = 'dashboard-grid layout-cards';
            const body = document.createElement('div');
            body.className = 'category';
            probe.appendChild(body);
            document.getElementById('dashboard-layout').appendChild(probe);
            const value = window.getComputedStyle(body).boxShadow;
            probe.remove();
            return value;
        });

        // Two inset lines in the same declaration: one down, one up.
        const insets = shadow.split(/,(?![^(]*\))/).filter((part) => part.includes('inset'));
        expect(insets.length, `expected two inset edges, got: ${shadow}`).toBeGreaterThanOrEqual(2);
    });
});

/**
 * And a shadow under it.
 *
 * Two inset lines of one pixel each, on a card that already draws a hairline
 * border, are not enough to tell soft from rich by eye -- which is the whole
 * point of a depth control. A surface reads as lifted because of what falls
 * under it. --surface-cast is that fall, and it scales on --theme-depth like
 * the rest of the ladder, so flat stays flat.
 *
 * Black here, unlike the two edges: this lands BESIDE the surface, on the
 * page, where a shadow is black on any theme. The edges lie ON the surface
 * and stay theme-derived.
 */
/** The box-shadow a raised card resolves to at a given depth. */
const widgetShadow = (page) => page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'dashboard-grid layout-cards';
    const body = document.createElement('div');
    body.className = 'category';
    probe.appendChild(body);
    document.getElementById('dashboard-layout').appendChild(probe);
    const value = window.getComputedStyle(body).boxShadow;
    probe.remove();
    return value;
});

/** Splits a resolved box-shadow into its parts, commas inside colours kept. */
const parts = (shadow) => shadow.split(/,(?![^(]*\))/).map((part) => part.trim());

/** The alpha of a colour written either as rgb(a) or as color(srgb ...). */
const alphaOf = (part) => {
    const srgb = part.match(/color\(srgb [^/)]+\/\s*([\d.]+)\)/);
    if (srgb) return parseFloat(srgb[1]);
    const rgba = part.match(/rgba?\([^)]*?,\s*([\d.]+)\)/);
    return rgba ? parseFloat(rgba[1]) : 1;
};

/**
 * And a shadow under it.
 *
 * Two inset lines of one pixel each, on a card that already draws a hairline
 * border, are not enough to tell soft from rich by eye -- which is the whole
 * point of a depth control. A surface reads as lifted because of what falls
 * under it. --surface-cast is that fall, and it scales on --theme-depth like
 * the rest of the ladder, so flat stays flat.
 *
 * Black here, unlike the two edges: this lands BESIDE the surface, on the
 * page, where a shadow is black on any theme. The edges lie ON the surface
 * and stay theme-derived.
 *
 * Read off a painted element rather than off the custom property: a token
 * comes back with its calc() and color-mix() unevaluated, so every depth
 * reports the same literal text and a test on it would pass no matter what
 * the depth control did.
 */
test.describe('the cast shadow', () => {
    /** The black, non-inset part of a shadow: the cast and nothing else. */
    const castPart = (shadow) => parts(shadow).find((part) =>
        !part.includes('inset') && /rgba?\(0, 0, 0|color\(srgb 0 0 0/.test(part));

    test('a raised surface drops one', async ({ page }) => {
        await openDashboard(page, 'rich');
        const cast = castPart(await widgetShadow(page));

        // The accent glow ring is also non-inset, and was there before this
        // existed -- so "has an outer shadow" would have passed either way.
        // What is new is a black one.
        expect(cast, 'nothing black falls under the surface').toBeTruthy();
        const lengths = [...cast.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]));
        expect(lengths.filter((value) => value > 0).length,
            `no offset and no blur to fall through: ${cast}`).toBeGreaterThanOrEqual(2);
    });

    test('and it deepens when the depth does', async ({ page }) => {
        await openDashboard(page, 'soft');
        const soft = castPart(await widgetShadow(page));
        await page.evaluate(() => document.body.setAttribute('data-depth', 'rich'));
        const rich = castPart(await widgetShadow(page));

        expect(alphaOf(rich), 'rich casts no darker than soft').toBeGreaterThan(alphaOf(soft));
        const blur = (part) => parseFloat([...part.matchAll(/(-?[\d.]+)px/g)].map((m) => m[1])[2]);
        expect(blur(rich), 'rich casts no further than soft').toBeGreaterThan(blur(soft));
    });

    test('flat drops nothing', async ({ page }) => {
        await openDashboard(page, 'flat');
        const shadow = await widgetShadow(page);

        expect(castPart(shadow) ?? 'none', `flat cast a shadow: ${shadow}`).toBe('none');
    });
});

/**
 * The top edge is as strong as the ladder says it is.
 *
 * theme-character.css restated --edge-light to fold the ambient glow ring in
 * behind it, and restated the strength along with it at a flat 6%. It loads
 * after theme-depth.css, so it won: raising the number in the ladder moved
 * nothing on screen, which is exactly the "I see no difference at all" this
 * work kept running into. The line now lives once, as --edge-top, and the
 * character sheet composes with it instead of copying it.
 */
test.describe('the top edge strength', () => {
    test('is the ladder\'s, not a second copy of it', async ({ page }) => {
        await openDashboard(page, 'rich');
        const shadow = await widgetShadow(page);

        // The lit line: inset, one pixel down, no blur.
        const top = parts(shadow).find((part) => part.includes('inset') && /\s0px 1px 0px/.test(part));
        expect(top, `no lit top line in: ${shadow}`).toBeTruthy();

        // 16% of the text colour at depth 1.5. The stale copy gave 0.09.
        expect(alphaOf(top), 'the top edge is painting at the overridden strength').toBeCloseTo(0.24, 2);
    });
});

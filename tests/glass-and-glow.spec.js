// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Glass, and how loud the glow is.
 *
 * Glass used to be translucency and nothing else: with a near-uniform page
 * behind it, a blurred surface is only a lighter colour. It now has something
 * to be seen through (a stronger wash), a lighter cast, a specular edge and a
 * touch more light through the filter — and chrome, which carries almost no
 * text, opens one step further than the surfaces that do.
 *
 * The glow is a setting. Both layers read one multiplier: the ambient ring
 * under a resting surface and the bloom on what is focused. Soft — 60% of what
 * shipped — is the default, because at rich and glass the ring was reading as
 * a halo.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const token = (page, name) => page.evaluate(
    (prop) => window.getComputedStyle(document.body).getPropertyValue(prop).trim(),
    name,
);

async function setDepth(page, depth) {
    await page.evaluate((value) => {
        const d = window.dashboardInstance;
        d.settings.themeDepth = value;
        window.ThemeLoader?.applyThemeDepth?.(value);
    }, depth);
    await page.waitForTimeout(200);
}

test('the glow is soft out of the box, and both layers read the dial', async ({ page }) => {
    await openDashboard(page);
    // The ambient ring is only defined on the depths that draw one, and rich
    // is one of them.
    await setDepth(page, 'rich');

    expect(await page.evaluate(() => document.body.getAttribute('data-glow'))).toBe('soft');
    expect(await token(page, '--glow-strength')).toBe('0.6');

    await page.evaluate(() => window.ThemeLoader.applyGlowStrength('off'));
    await page.waitForTimeout(150);
    expect(await token(page, '--glow-strength')).toBe('0');
    const off = {
        bloom: await token(page, '--bloom'),
        ring: await token(page, '--surface-glow-ring'),
    };

    // Both glows carry the multiplier rather than each having its own number.
    await page.evaluate(() => window.ThemeLoader.applyGlowStrength('soft'));
    await page.waitForTimeout(150);
    expect(await token(page, '--glow-strength')).toBe('0.6');
    const soft = {
        bloom: await token(page, '--bloom'),
        ring: await token(page, '--surface-glow-ring'),
    };
    expect(soft.bloom, 'the bloom ignored the dial').not.toBe(off.bloom);
    expect(soft.ring, 'the ambient ring ignored the dial').not.toBe(off.ring);

    await page.evaluate(() => window.ThemeLoader.applyGlowStrength('full'));
    await page.waitForTimeout(150);
    expect(await token(page, '--glow-strength')).toBe('1');
});

/*
 * The three Surfaces answers now belong to the theme.
 *
 * An install used to carry one answer for all of them; each theme states the
 * surfaces it was drawn for instead, and the setting says "follow". So what a
 * fresh install stores is the word follow, and what it draws is whatever the
 * theme it opens on asks for — Tarnished Brass is brushed, which is drawn for
 * rich and a soft glow.
 */
test('a fresh install follows the theme, and the theme decides the surfaces', async ({ page }) => {
    await openDashboard(page);

    const stored = await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        return (await api('/api/settings')).json();
    });

    expect(stored.themeBackdrop).toBe('on');
    // The exact words the three settings hold on a genuinely fresh install are
    // pinned in Go (TestFreshInstallFollowsTheTheme): the store here is shared
    // with the tests above, so what can honestly be asserted is the marker and
    // what ends up on screen.
    expect(stored.surfaceFollowMigrated, 'the follow marker was not written').toBe(true);

    // And the page is drawn with the theme's answers, not with the word
    // "follow" — which would match no rule in the stylesheet at all.
    const drawn = await page.evaluate(() => ({
        depth: document.body.getAttribute('data-depth'),
        glow: document.body.getAttribute('data-glow'),
        effects: document.body.getAttribute('data-effects'),
        backdrop: document.body.getAttribute('data-theme-backdrop'),
    }));
    expect(drawn.depth, 'the page was drawn with a word the stylesheet does not define')
        .toBe('rich');
    expect(drawn.glow).toBe('soft');
    expect(drawn.effects).toBe('full');
    expect(drawn.backdrop).toBe('on');
});

/*
 * And a reader who changes one keeps it: the marker is written once, so the
 * pass above never runs a second time.
 */
test('a changed answer survives the next load', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.glowStrength = 'full';
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(d.settings),
        });
    });

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.getAttribute('data-glow'))).toBe('full');
});

test('the choice is saved and comes back', async ({ page }) => {
    await openDashboard(page);
    await waitForConfigReady(page);
    await page.evaluate(() => (window.dashboardInstance.config.appearanceTab = window.dashboardInstance.config.appearanceTab || 'general', window.dashboardInstance.config).openConfigView('appearance'));
    await page.waitForSelector('.config-view', { timeout: 20_000 });

    await page.locator('[data-appearance-select="glowStrength"]').selectOption('full');
    await expect.poll(() => page.evaluate(
        () => document.body.getAttribute('data-glow')), { timeout: 5_000 }).toBe('full');

    await page.reload();
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    expect(await page.evaluate(() => document.body.getAttribute('data-glow'))).toBe('full');
    // The server renders it for the first paint, not just the client.
    expect(await page.evaluate(
        () => document.documentElement.getAttribute('data-glow'))).toBe('full');
});

test('glass has more to see through than the other depths', async ({ page }) => {
    await openDashboard(page);

    await setDepth(page, 'rich');
    const rich = {
        wash: await token(page, '--depth-wash'),
        cast: await token(page, '--surface-cast'),
    };

    await setDepth(page, 'glass');
    const glass = {
        wash: await token(page, '--depth-wash'),
        cast: await token(page, '--surface-cast'),
        brightness: await token(page, '--glass-brightness'),
        chromeBlur: await token(page, '--glass-blur-page'),
        slabBlur: await token(page, '--glass-blur-slab'),
        chrome: await token(page, '--surface-glass-page'),
        slab: await token(page, '--surface-glass-slab'),
    };

    // A third cloud, and stronger: something for the blur to work on.
    expect(glass.wash).not.toBe(rich.wash);
    expect(glass.wash.match(/radial-gradient/g) || [], 'glass has no wash of its own')
        .toHaveLength(3);
    // Glass hangs rather than sits.
    expect(glass.cast, 'glass kept rich’s cast').not.toBe(rich.cast);
    expect(glass.brightness, 'the filter has no brightness to take').toBeTruthy();
    // Chrome blurs further than the surfaces that carry text. A custom property
    // is a string until something uses it, so the lengths are measured rather
    // than parsed: a probe takes each one as its width.
    const blur = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        document.body.appendChild(probe);
        const read = (prop) => {
            probe.style.width = `var(${prop})`;
            return parseFloat(window.getComputedStyle(probe).width) || 0;
        };
        const out = { chrome: read('--glass-blur-page'), slab: read('--glass-blur-slab') };
        probe.remove();
        return out;
    });
    expect(blur.chrome, `chrome blurs ${blur.chrome}px, slabs ${blur.slab}px`)
        .toBeGreaterThan(blur.slab);
    // And it is the more open of the two.
    expect(glass.chrome).toContain('62%');
    expect(glass.slab).toContain('88%');
});

test('the lit edge has a direction now', async ({ page }) => {
    await openDashboard(page);
    await setDepth(page, 'soft');

    const side = await token(page, '--edge-side');
    const light = await token(page, '--edge-light');

    expect(side, 'there is no side light').toBeTruthy();
    expect(light, 'the lit edge is still one flat line').toContain('inset');
    expect(light.match(/inset/g) || [], 'the edge carries only one line').not.toHaveLength(1);

    await setDepth(page, 'flat');
    // Flat resolves every depth-scaled colour to transparent; the token is
    // still written, so what is asserted here is that it draws nothing.
    expect(await token(page, '--edge-side')).toContain('transparent');
});


/*
 * Flat is about layers, not about colour.
 *
 * `background-image: none` at flat meant the backdrop choice above it did
 * nothing there — on and off both painted the same flat colour, so the dropdown
 * read as broken. The theme's own backdrop stays at every depth; what flat
 * drops is the depth wash, which is the part flat is about.
 */
test('the backdrop survives flat, and the setting still switches it', async ({ page }) => {
    await openDashboard(page);
    const painted = () => page.evaluate(
        () => window.getComputedStyle(document.body).backgroundImage,
    );

    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('on'));
    await setDepth(page, 'rich');
    const rich = await painted();
    expect(rich, 'no backdrop at rich to compare against').not.toBe('none');

    await setDepth(page, 'flat');
    const flat = await painted();
    expect(flat, 'flat threw the theme backdrop away').not.toBe('none');

    // And the choice still means something there.
    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('off'));
    await page.waitForTimeout(150);
    expect(await painted(), 'switching the backdrop off at flat changed nothing')
        .not.toBe(flat);

    await page.evaluate(() => window.ThemeLoader.applyThemeBackdrop('on'));
    await page.waitForTimeout(150);
    expect(await painted()).toBe(flat);
});

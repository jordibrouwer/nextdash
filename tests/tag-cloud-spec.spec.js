// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The word cloud, drawn the way the overlays spec draws it.
 *
 * Two things separate the draft's cloud from what shipped. A tag that is
 * filtering the page is a filled pill there and was an underlined word here —
 * and in a cloud where size and colour already carry how often a tag is used,
 * an underline is a third quiet signal competing with two loud ones. A filled
 * pill is the only shape in the cloud, so it cannot be read as a heavier tag.
 *
 * And the draft closes its cloud with two figures on a rule: how many tags
 * there are, and how many are filtering. A cloud says which tags are big and
 * says nothing about either.
 */

async function openCloud(page) {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => {
        window.dashboardInstance.settings.showTagCloudButton = true;
        window.dashboardInstance.setupDOM?.();
    });
    await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
    await expect.poll(() => page.locator('.tag-cloud-word').count()).toBeGreaterThan(1);
}

const styleOf = (page, selector, props) => page.evaluate(([sel, list]) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = window.getComputedStyle(el);
    return Object.fromEntries(list.map((p) => [p, cs[p]]));
}, [selector, props]);

test.describe('the word cloud', () => {
    test('closes with what it adds up to', async ({ page }) => {
        await openCloud(page);

        const total = page.locator('.tag-cloud-total');
        await expect(total, 'the cloud does not say how much of it there is').toHaveCount(1);
        // Two figures at opposite ends of a rule.
        const shape = await styleOf(page, '.tag-cloud-total', ['justifyContent', 'borderTopWidth']);
        expect(shape.justifyContent).toBe('space-between');
        expect(parseFloat(shape.borderTopWidth), 'no rule under the cloud').toBeGreaterThan(0);
        await expect(total).toContainText(/\d/);
    });

    test('a tag that is filtering is a filled pill', async ({ page }) => {
        await openCloud(page);
        await page.evaluate(() => document.querySelector('.tag-cloud-word')?.click());
        await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
        await expect.poll(() => page.locator('.tag-cloud-word.is-selected').count()).toBe(1);

        const pill = await styleOf(page, '.tag-cloud-word.is-selected',
            ['backgroundColor', 'borderRadius', 'fontWeight', 'boxShadow']);
        expect(pill.backgroundColor, 'the pill has no fill').not.toBe('rgba(0, 0, 0, 0)');
        expect(pill.borderRadius, 'the pill is not round').toBe('999px');
        expect(pill.fontWeight).toBe('700');
        expect(pill.boxShadow, 'the pill does not glow').not.toBe('none');

        // On the accent, not in it, and no underline left over.
        const label = await styleOf(page, '.tag-cloud-word.is-selected .tag-cloud-word-label',
            ['color', 'textDecorationLine']);
        const page_ = await styleOf(page, 'body', ['backgroundColor']);
        expect(label.textDecorationLine, 'the underline is still there').toBe('none');
        expect(label.color, 'the label is not the page colour on the fill').toBe(page_.backgroundColor);
    });

    test('and the count follows what is filtering', async ({ page }) => {
        await openCloud(page);
        const before = await page.locator('.tag-cloud-total').innerText();

        await page.evaluate(() => document.querySelector('.tag-cloud-word')?.click());
        await page.evaluate(() => window.DashboardTagCloud?.openModal?.());
        await expect.poll(() => page.locator('.tag-cloud-word.is-selected').count()).toBe(1);

        const after = await page.locator('.tag-cloud-total').innerText();
        expect(after, 'the figure did not move when a tag was switched on').not.toBe(before);
    });
});

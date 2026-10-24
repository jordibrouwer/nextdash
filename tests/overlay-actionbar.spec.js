// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The action bar under the signature is a handle on the edge of the screen: flush to it, rounded only on
 * the inside, with a line of the accent along the inside. Classic keeps its floating pill.
 */
async function setStyle(request, theme, materialStyle) {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
}

async function bar(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.header-shortcuts', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    return page.evaluate(() => {
        const el = document.querySelector('.header-shortcuts');
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
            gapToEdge: parseFloat(cs.right),
            side: document.body.getAttribute('data-action-bar'),
            left: parseFloat(cs.borderTopLeftRadius),
            right: parseFloat(cs.borderTopRightRadius),
            shadow: cs.boxShadow,
        };
    });
}

test.describe('the action bar', () => {
    test.afterEach(async ({ request }) => {
        await setStyle(request, 'look-berry-dark', 'signature');
    });

    for (const theme of ['arctic-cyan-dark', 'candlelit-study-dark', 'retro-crt-mk2-dark']) {
        test(`sits on the edge of the screen under the signature: ${theme}`, async ({ page, request }) => {
            await setStyle(request, theme, 'signature');
            const m = await bar(page);
            test.skip(m.side !== 'right', 'the action bar is not on the right in this install');
            expect(m.gapToEdge, 'the bar floats away from the edge').toBeLessThanOrEqual(1);
            expect(m.left, 'the inside is not rounded').toBeGreaterThan(0);
            expect(m.right, 'the side on the edge is rounded').toBe(0);
            expect(m.shadow, 'no line of the accent along the inside').toMatch(/inset/);
        });
    }

    test('keeps its floating pill in classic', async ({ page, request }) => {
        await setStyle(request, 'arctic-cyan-dark', 'classic');
        const m = await bar(page);
        test.skip(m.side !== 'right', 'the action bar is not on the right in this install');
        expect(m.gapToEdge).toBeGreaterThan(4);
    });
});

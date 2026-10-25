// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Paper keeps its red rule under a head and on the double line at the top of a layer; the rings
 * round fields and the lines between items are a neutral line of ink (--ov-rule-soft). A red ring
 * round every field read as an error message. Every other material answers both tokens alike.
 */
async function ruleTokens(page, request, theme) {
    const response = await request.post('/api/settings', {
        data: { theme, materialStyle: 'signature' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    expect(response.ok(), 'settings save failed').toBe(true);
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.dashboard-grid .category .bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    return page.evaluate(() => {
        const probe = document.createElement('i');
        const read = (token) => {
            probe.style.color = `var(${token})`;
            document.body.appendChild(probe);
            const value = getComputedStyle(probe).color;
            probe.remove();
            return value;
        };
        return { material: document.body.dataset.material, rule: read('--ov-rule'), soft: read('--ov-rule-soft') };
    });
}

const channels = (color) => (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

test('paper: a red rule under heads, a neutral line round fields', async ({ page, request }) => {
    const t = await ruleTokens(page, request, 'candlelit-study-dark');
    expect(t.material).toBe('paper');
    expect(t.rule).not.toBe(t.soft);
    const [r, g] = channels(t.rule);
    expect(r).toBeGreaterThan(g * 1.8);
    const [sr, sg, sb] = channels(t.soft);
    expect(Math.max(sr, sg, sb) - Math.min(sr, sg, sb)).toBeLessThan(0.25 * Math.max(sr, sg, sb, 0.01));
});

test('another material answers both tokens alike', async ({ page, request }) => {
    const t = await ruleTokens(page, request, 'aurora-glass-dark');
    expect(t.material).toBe('glass');
    expect(t.rule).toBe(t.soft);
});

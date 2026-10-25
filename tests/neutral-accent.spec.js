// @ts-check
const { test, expect } = require('./fixtures');
const { WRITE_TOKEN, markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays, waitForConfigReady } = require('./e2e-helpers');

/**
 * Appearance → Surfaces → Accent of the neutrals.
 *
 * One of six colours for the neutral themes and for nothing else. Behaviour
 * only: the colour reaches the page, is saved, comes back after a reload, and a
 * theme outside the neutrals does not move. Which blue it is is not asserted.
 */
const HEX = /^#[0-9a-f]{6}$/i;
const NEUTRAL = 'slate-dark';
const OTHER = 'gloss-jade-dark';

const accentOf = (page) => page.evaluate(
    () => getComputedStyle(document.documentElement).getPropertyValue('--accent-primary').trim());

const stored = (page) => page.evaluate(async () => {
    const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
    return (await api('/api/settings')).json();
});

async function openSurfaces(page, theme) {
    await page.request.post('/api/settings', {
        data: { theme, neutralAccent: 'theme' },
        headers: { 'X-NextDash-Token': WRITE_TOKEN },
    });
    await page.setViewportSize({ width: 1500, height: 1000 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await waitForConfigReady(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
    await page.click('[data-appearance-tab="surface"]');
}

test.describe('accent of the neutrals', () => {
    test.describe.configure({ mode: 'serial' });

    test.afterEach(async ({ request }) => {
        await request.post('/api/settings', {
            data: { neutralAccent: 'theme' },
            headers: { 'X-NextDash-Token': WRITE_TOKEN },
        });
    });

    test('a neutral theme takes the colour, keeps it after a reload, and goes back', async ({ page }) => {
        await openSurfaces(page, NEUTRAL);
        // A real colour, not the empty answer of a stylesheet still on its way.
        await expect.poll(() => accentOf(page), { timeout: 10_000 }).toMatch(HEX);
        const own = await accentOf(page);
        const select = page.locator('[data-appearance-select="neutralAccent"]');
        await expect(select).toHaveValue('theme');

        await select.selectOption('rose');
        await expect.poll(async () => {
            const now = await accentOf(page);
            return HEX.test(now) && now !== own;
        }, { timeout: 10_000 }).toBe(true);
        const rose = await accentOf(page);
        await expect.poll(async () => (await stored(page)).neutralAccent, { timeout: 5_000 }).toBe('rose');

        await page.reload();
        await page.waitForFunction(() => window.dashboardInstance && window.dashboardInstance.config, null, { timeout: 20_000 });
        expect(await accentOf(page), 'the accent did not come back after a reload').toBe(rose);

        await waitForConfigReady(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
        await page.waitForSelector('#config-appearance-body', { timeout: 20_000 });
        await page.click('[data-appearance-tab="surface"]');
        await select.selectOption('theme');
        await expect.poll(() => accentOf(page), { timeout: 10_000 }).toBe(own);
    });

    test('a theme outside the neutrals keeps its own accent', async ({ page }) => {
        await openSurfaces(page, OTHER);
        await expect.poll(() => accentOf(page), { timeout: 10_000 }).toMatch(HEX);
        const own = await accentOf(page);
        await page.locator('[data-appearance-select="neutralAccent"]').selectOption('violet');
        await expect.poll(async () => (await stored(page)).neutralAccent, { timeout: 5_000 }).toBe('violet');
        // The stylesheet is fetched again for the new accent: wait for that link, not for a clock.
        await page.waitForFunction(() => [...document.querySelectorAll('link[href^="/api/theme.css"]')].some((l) => l.href.includes('neutralAccent=violet')), null, { timeout: 10_000 });
        // Pacing: the new stylesheet is in, the repaint after it gets a moment before the colour is read.
        await page.waitForTimeout(200);
        expect(await accentOf(page), 'a theme outside the neutrals changed colour').toBe(own);
    });
});

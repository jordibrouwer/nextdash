// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The Living group: three theme families whose page follows something real.
 * Behaviour only -- the runtime starts with the theme, reads what the
 * dashboard already knows, and leaves nothing behind when the theme changes.
 */

const WEATHER_KEY = 'nextdash-weather-cache:manual:celsius:test';

async function open(page, weatherCode) {
    await markWhatsNewSeen(page);
    if (weatherCode != null) {
        await page.addInitScript(([key, code]) => {
            localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data: { weatherCode: code } }));
        }, [WEATHER_KEY, weatherCode]);
    }
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

const useTheme = (page, id) => page.evaluate((t) => window.ThemeLoader.applyTheme(t), id);

test.describe('living themes', () => {
    test('Tidewatch follows the health the page already shows', async ({ page }) => {
        await open(page);
        await useTheme(page, 'living-tidewatch-dark');
        await expect(page.locator('body')).toHaveAttribute('data-living', 'tidewatch');
        await expect(page.locator('body')).toHaveAttribute('data-living-health', 'ok');
        await expect(page.locator('.living-layer .lv-edge')).toHaveCount(1);
        const calm = await page.locator('.lv-water').evaluate((el) => el.getBoundingClientRect().height);

        // A monitored bookmark that stopped answering carries .status-offline.
        await page.evaluate(() => document.querySelector('.bookmark-link')?.classList.add('status-offline'));
        await expect(page.locator('body')).toHaveAttribute('data-living-health', 'down');
        await expect(page.locator('body')).toHaveAttribute('data-living-count', /^[1-9]/);
        // The water rises with the problem.
        await expect.poll(() => page.locator('.lv-water').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(calm + 50);

        // It stays a still picture without motion, but the state is still drawn.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        expect(await page.locator('.lv-edge').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
        await page.emulateMedia({ reducedMotion: 'no-preference' });

        await page.evaluate(() => document.querySelector('.bookmark-link')?.classList.remove('status-offline'));
        await expect(page.locator('body')).toHaveAttribute('data-living-health', 'ok');
    });

    test('Daydrift sets its own palette by the clock and stays readable all day', async ({ page }) => {
        await open(page);
        await useTheme(page, 'living-daydrift-light');
        await expect(page.locator('body')).toHaveAttribute('data-living', 'daydrift');
        await expect(page.locator('body')).toHaveAttribute('data-living-phase', /^(dawn|day|dusk|night)$/);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--background-primary'))).toMatch(/^#[0-9a-f]{6}$/);

        // Every quarter hour of both halves keeps AA for the theme's own text.
        const worst = await page.evaluate(() => {
            const lum = (h) => {
                const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
                    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
                return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
            };
            const ratio = (a, b) => {
                const x = Math.max(lum(a), lum(b));
                const y = Math.min(lum(a), lum(b));
                return (x + 0.05) / (y + 0.05);
            };
            const text = {
                dark: ['#F3EEF2', '#D3C9D6', '#B5A9BC', '#5FD39A', '#F0C060', '#FF8F7A'],
                light: ['#1A1626', '#463F5C', '#554E6E', '#145C38', '#7E5200', '#9C2A16'],
            };
            let min = 99;
            for (const half of ['dark', 'light']) {
                for (let h = 0; h < 24; h += 0.25) {
                    const p = window.NDLiving.paletteAt(half, h);
                    for (const fg of [...text[half], p.accent]) {
                        for (const bg of [p.page, p.card]) min = Math.min(min, ratio(fg, bg));
                    }
                }
            }
            return min;
        });
        expect(worst).toBeGreaterThanOrEqual(4.5);

        // The sun crosses the horizon band by the clock: east in the morning, west at dusk, the moon after.
        const orbs = await page.evaluate(() => [7, 12, 17, 22].map((h) => window.NDLiving.orbAt(h)));
        expect(orbs.map((o) => o.body)).toEqual(['sun', 'sun', 'sun', 'moon']);
        expect(orbs[0].x).toBeLessThan(orbs[1].x);
        expect(orbs[1].x).toBeLessThan(orbs[2].x);
        expect(orbs[1].rise).toBeGreaterThan(orbs[0].rise);
        expect(orbs[0].lit).toBe('left');
        expect(orbs[2].lit).toBe('right');
        await expect(page.locator('.living-layer .lv-orb')).toHaveCount(1);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--dd-x'))).toMatch(/%$/);

        // The hours differ: the page really drifts.
        const [dawn, noon] = await page.evaluate(() => [window.NDLiving.paletteAt('dark', 6).page, window.NDLiving.paletteAt('dark', 12).page]);
        expect(dawn).not.toBe(noon);
    });

    test('Skywatch reads the cached weather and makes no request of its own', async ({ page }) => {
        const outside = [];
        page.on('request', (req) => {
            if (!/^(http:\/\/(localhost|127\.0\.0\.1)|data:|blob:)/.test(req.url())) outside.push(req.url());
        });
        await open(page, 63);
        const before = outside.length;
        await useTheme(page, 'living-skywatch-dark');
        await expect(page.locator('body')).toHaveAttribute('data-living-sky', 'rain');
        await expect(page.locator('body')).toHaveAttribute('data-living-source', 'weather');
        await expect(page.locator('.lv-glyph--rain')).toBeVisible();
        expect(outside.length).toBe(before);

        // A foggy reading, picked up when the theme starts again.
        await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data: { weatherCode: 45 } })), WEATHER_KEY);
        await useTheme(page, 'look-ocean-dark');
        await useTheme(page, 'living-skywatch-light');
        await expect(page.locator('body')).toHaveAttribute('data-living-sky', 'fog');

        // The clock alone when no weather is configured.
        await page.evaluate((key) => localStorage.removeItem(key), WEATHER_KEY);
        await useTheme(page, 'look-ocean-dark');
        await useTheme(page, 'living-skywatch-dark');
        await expect(page.locator('body')).toHaveAttribute('data-living-source', 'clock');
        await expect(page.locator('body')).toHaveAttribute('data-living-sky', /^(sun|night)$/);
    });

    test('leaving a living theme removes everything it added', async ({ page }) => {
        await open(page, 0);
        for (const id of ['living-tidewatch-dark', 'living-daydrift-dark', 'living-skywatch-light']) {
            await useTheme(page, id);
            await expect(page.locator('body')).toHaveAttribute('data-living', /./);
            await useTheme(page, 'look-ocean-dark');
            await expect(page.locator('body')).not.toHaveAttribute('data-living', /./);
            const left = await page.evaluate(() => ({
                layers: document.querySelectorAll('.living-layer').length,
                attrs: [...document.body.attributes].map((a) => a.name).filter((n) => n.startsWith('data-living')),
                vars: ['--background-primary', '--accent-primary'].map((v) => document.documentElement.style.getPropertyValue(v)).filter(Boolean),
            }));
            expect(left).toEqual({ layers: 0, attrs: [], vars: [] });
        }
    });
});

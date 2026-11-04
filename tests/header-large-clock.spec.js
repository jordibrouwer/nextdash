// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The classic header is a large clock: the time on its own, the greeting, date
 * and weather beside it, and a halo in the theme's background colour on the
 * text and glyphs of both corners so they read over any backdrop.
 */
async function open(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('.bookmark-link', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async () => {
        const d = window.dashboardInstance;
        d.settings.headerClockPlacement = 'classic';
        d.settings.showTime = true;
        d.settings.greetingName = 'Jordi';
        d.setupDOM?.();
        d.renderDateWeatherLine();
    });
}

test('the greeting follows the hour and carries the name', async ({ page }) => {
    await open(page);
    const greet = async (hour, name) => page.evaluate(([h, n]) => {
        const d = window.dashboardInstance;
        d.settings.greetingName = n;
        const t = (k, f) => f;
        return d.dateWeather.formatGreeting(new Date(2026, 10, 4, h, 0), t);
    }, [hour, name]);

    expect(await greet(3, 'Jordi')).toBe('Good night, Jordi');
    expect(await greet(6, 'Jordi')).toBe('Good morning, Jordi');
    expect(await greet(12, 'Jordi')).toBe('Good afternoon, Jordi');
    expect(await greet(18, 'Jordi')).toBe('Good evening, Jordi');
    expect(await greet(19, '')).toBe('Good evening');
});

test('the clock stands large with the greeting beside it', async ({ page }) => {
    await open(page);
    const shape = await page.evaluate(() => {
        const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.x, w: b.width }; };
        return {
            clock: r('.date-clock'), side: r('.date-side'),
            clockSize: parseFloat(getComputedStyle(document.querySelector('.date-clock')).fontSize),
            body: parseFloat(getComputedStyle(document.body).fontSize),
            greeting: document.querySelector('.date-greeting').textContent,
        };
    });
    expect(shape.clockSize).toBeGreaterThan(shape.body * 2.5);
    expect(shape.side.x).toBeGreaterThan(shape.clock.x + shape.clock.w - 1);
    expect(shape.greeting).toContain('Jordi');
});

test('the halo follows the theme background on both corners', async ({ page }) => {
    await open(page);
    const read = (color) => page.evaluate((c) => {
        document.documentElement.style.setProperty('--background-primary', c);
        document.body.style.setProperty('--background-primary', c);
        const sh = (s) => getComputedStyle(document.querySelector(s)).textShadow;
        return {
            left: sh('.date-clock'),
            right: sh('.header-actions'),
            glyph: getComputedStyle(document.querySelector('.header-actions svg')).filter,
        };
    }, color);
    const dark = await read('#101410');
    const light = await read('#f6f1e4');

    for (const v of [dark, light]) {
        expect(v.left, 'no halo on the clock').not.toBe('none');
        expect(v.right, 'no halo on the buttons').not.toBe('none');
        expect(v.glyph).toContain('drop-shadow');
    }
    expect(light.left, 'the halo ignores the theme').not.toBe(dark.left);
    expect(light.right, 'the halo ignores the theme').not.toBe(dark.right);
});

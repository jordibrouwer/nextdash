// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The first-run setup window asked for a town, a clock and a unit before the
 * reader had seen the dashboard those answers are about. It is gone, so the
 * questions are asked in the corner instead — once, and only of an install
 * that has no town to look up.
 */

const PROMO_ID = 'clock-weather-v1';

async function loadWithCardPending(page, settings = {}) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, next }) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        Object.assign(window.dashboardInstance.settings, {
            weatherSource: 'manual', weatherLocation: '', timeFormat: '24h', weatherUnit: 'celsius',
        }, next);
        // The quick-start checklist owns the same corner on a fresh install.
        document.querySelectorAll('.quickstart-card:not(.clock-weather-notice-card)').forEach((el) => el.remove());
    }, { id: PROMO_ID, next: settings });
}

const card = (page) => page.locator('.clock-weather-notice-card');

test('asked of an install with no town, not of one that has one', async ({ page }) => {
    await loadWithCardPending(page);
    expect(await page.evaluate(() => window.ClockWeatherNotice.shouldShow())).toBe(true);

    await page.evaluate(() => { window.dashboardInstance.settings.weatherLocation = 'Leiden'; });
    expect(await page.evaluate(() => window.ClockWeatherNotice.shouldShow())).toBe(false);

    // Nor of one reading the browser's own location.
    await page.evaluate(() => {
        Object.assign(window.dashboardInstance.settings, { weatherLocation: '', weatherSource: 'browser' });
    });
    expect(await page.evaluate(() => window.ClockWeatherNotice.shouldShow())).toBe(false);
});

test('saving writes the town, the clock and the unit', async ({ page }) => {
    await loadWithCardPending(page);
    await page.evaluate(() => window.ClockWeatherNotice.render());
    await expect(card(page)).toBeVisible();
    // Copy, not locale keys.
    await expect(card(page)).not.toContainText('dashboard.clockWeather');

    await card(page).locator('#clock-weather-place').fill('Leiden');
    await card(page).locator('[data-choice="timeFormat"][data-value="12h"]').click();
    await card(page).locator('[data-choice="weatherUnit"][data-value="fahrenheit"]').click();
    await card(page).locator('[data-clock-weather-action="save"]').click();

    await expect(card(page)).toHaveCount(0);
    const saved = await page.evaluate(async () => {
        const res = await fetch('/api/settings');
        const s = await res.json();
        return { place: s.weatherLocation, clock: s.timeFormat, unit: s.weatherUnit, weather: s.showWeatherWithDate };
    });
    expect(saved).toEqual({ place: 'Leiden', clock: '12h', unit: 'fahrenheit', weather: true });
});

test('answered once, never asked again', async ({ page }) => {
    await loadWithCardPending(page);
    await page.evaluate(() => window.ClockWeatherNotice.render());
    // The × carries the same name, so pick the button in the row of answers.
    await card(page).locator('button[data-clock-weather-action="dismiss"]:not([data-notice-dismiss])').click();

    await expect(card(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.ClockWeatherNotice.shouldShow())).toBe(false);
    // And nothing was written to the settings it asks about.
    expect(await page.evaluate(() => window.dashboardInstance.settings.weatherLocation)).toBe('');
});

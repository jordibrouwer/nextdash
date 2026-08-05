// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Weather is the one Date & weather setting that is not read at render time: it
 * comes from a cached fetch keyed by location, source and unit. Changing any of
 * those only redrew the line, so the old location's reading stayed on screen
 * until the page was reloaded.
 */

/** Stub geocoding + forecast, recording which place names were looked up. */
async function stubWeather(page, asked, temperature = 21) {
    await page.route('**/geocoding-api.open-meteo.com/**', async (route) => {
        const name = new URL(route.request().url()).searchParams.get('name');
        asked.push(name);
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ results: [{ latitude: 1, longitude: 2, name }] }),
        });
    });
    await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ current: { temperature_2m: temperature, weather_code: 0 } }),
    }));
}

async function openDateWeatherTab(page, settings = {}) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(async (extra) => {
        const d = window.dashboardInstance;
        Object.assign(d.settings, {
            showDate: true,
            showWeatherWithDate: true,
            weatherSource: 'manual',
            weatherLocation: '',
        }, extra);
        d.weatherData = null;
        await d.saveSettings?.();
        // Seed the starting reading so the assertions below measure the change,
        // not the first fetch.
        await d.refreshWeather?.(true);
    }, settings);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
    await page.evaluate(() => {
        window.dashboardInstance.config.behaviorTab = 'datetime';
        window.dashboardInstance.config.render();
    });
    await expect(page.locator('[data-behavior-field="weatherLocation"]')).toBeVisible();
}

test.describe('weather settings apply without a reload', () => {
    test('a new location is fetched and shown straight away', async ({ page }) => {
        const asked = [];
        await stubWeather(page, asked, 33);
        await openDateWeatherTab(page);

        const line = page.locator('#date-element');
        await expect(line).not.toContainText('Berlin');

        const input = page.locator('[data-behavior-field="weatherLocation"]');
        await input.fill('Berlin');
        await input.dispatchEvent('change');

        // The reading itself has to arrive, not just the saved setting.
        await expect(line).toContainText('Berlin', { timeout: 10_000 });
        await expect(line).toContainText('33');
        expect(asked).toContain('Berlin');
    });

    test('the temperature unit refetches rather than reusing the cache', async ({ page }) => {
        const asked = [];
        await stubWeather(page, asked);
        await openDateWeatherTab(page, { weatherLocation: 'Berlin' });
        await expect(page.locator('#date-element')).toContainText('Berlin', { timeout: 10_000 });

        asked.length = 0;
        await page.selectOption('[data-behavior-field="weatherUnit"]', 'fahrenheit');

        // Unit is part of the cache key, so the cached celsius reading does not
        // answer for it.
        await expect.poll(() => asked.length, { timeout: 10_000 }).toBeGreaterThan(0);
    });

    test('a formatting-only change does not refetch the weather', async ({ page }) => {
        const asked = [];
        await stubWeather(page, asked);
        await openDateWeatherTab(page, { weatherLocation: 'Berlin', showTime: true });
        await expect(page.locator('#date-element')).toContainText('Berlin', { timeout: 10_000 });

        asked.length = 0;
        await page.selectOption('[data-behavior-field="timeFormat"]', '12h');
        await page.waitForTimeout(1500);

        // The clock is read at render time; refetching here would hit the
        // network on every unrelated tweak.
        expect(asked).toEqual([]);
    });
});

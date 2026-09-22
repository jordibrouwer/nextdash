// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * The weather widget: current conditions beside a forecast, reusing the
 * location/source/unit the header's own weather line already reads rather
 * than asking a second time.
 */

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('the weather widget', () => {
    test('it is offered and has a renderer', async ({ page }) => {
        await open(page);
        const state = await page.evaluate(async () => {
            await window.dashboardInstance.config?.load?.();
            const Config = window.DashboardConfig
                || window.dashboardInstance.config?.instance?.constructor;
            return {
                offered: [...(Config?.WIDGET_TYPES || [])],
                renderer: typeof window.DashboardWidgets?.weather,
                settings: (Config?.WIDGET_SETTINGS?.weather || []).map((f) => f.key),
            };
        });
        expect(state.offered).toContain('weather');
        expect(state.renderer).toBe('function');
        // No location field: that comes from the header's own weather setting.
        expect(state.settings).toEqual(['forecastRange']);
    });

    test('with no location set, it says so rather than fetching', async ({ page }) => {
        await open(page);
        const text = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, { weatherSource: 'manual', weatherLocation: '' });
            const body = document.createElement('div');
            await window.DashboardWidgets.weather(body, { id: 'w_x', type: 'weather', config: {} }, d);
            return body.textContent;
        });
        expect(text).toContain('Config');
    });

    test('draws current conditions beside a 3-day forecast', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, { weatherSource: 'manual', weatherLocation: 'Berlin' });
            const realFetch = window.fetch;
            window.fetch = async (url, ...rest) => {
                const address = String(url);
                if (address.includes('geocoding-api.open-meteo.com')) {
                    return new Response(JSON.stringify({
                        results: [{ latitude: 52.5, longitude: 13.4, name: 'Berlin' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (address.includes('api.open-meteo.com') && address.includes('daily=')) {
                    return new Response(JSON.stringify({
                        current: { temperature_2m: 21, weather_code: 0 },
                        daily: {
                            time: ['2026-09-08', '2026-09-09', '2026-09-10'],
                            temperature_2m_max: [22, 24, 19],
                            temperature_2m_min: [12, 13, 10],
                            weather_code: [0, 2, 61],
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.weather(
                    body, { id: 'w_x', type: 'weather', config: { forecastRange: '3day' } }, d);
            } finally {
                window.fetch = realFetch;
            }
            return {
                temp: body.querySelector('.dashboard-widget-weather-temp')?.textContent,
                rows: [...body.querySelectorAll('.dashboard-widget-weather-row-range')]
                    .map((el) => el.textContent),
                location: body.querySelector('.dashboard-widget-weather-location')?.textContent,
            };
        });
        expect(rendered.temp).toBe('21°C');
        expect(rendered.rows).toEqual(['22° / 12°', '24° / 13°', '19° / 10°']);
        expect(rendered.location).toBe('Berlin');
    });

    test('the 24h range asks for hourly data and lists it in 3-hour steps', async ({ page }) => {
        await open(page);
        const rendered = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, { weatherSource: 'manual', weatherLocation: 'Berlin' });
            const realFetch = window.fetch;
            const hours = Array.from({ length: 24 }, (_, i) => `2026-09-08T${String(i).padStart(2, '0')}:00`);
            window.fetch = async (url, ...rest) => {
                const address = String(url);
                if (address.includes('geocoding-api.open-meteo.com')) {
                    return new Response(JSON.stringify({
                        results: [{ latitude: 52.5, longitude: 13.4, name: 'Berlin' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (address.includes('api.open-meteo.com') && address.includes('hourly=')) {
                    return new Response(JSON.stringify({
                        current: { temperature_2m: 21, weather_code: 0 },
                        hourly: {
                            time: hours,
                            temperature_2m: hours.map((_, i) => 10 + i),
                            weather_code: hours.map(() => 0),
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                await window.DashboardWidgets.weather(
                    body, { id: 'w_x', type: 'weather', config: { forecastRange: '24h' } }, d);
            } finally {
                window.fetch = realFetch;
            }
            return {
                rowCount: body.querySelectorAll('.dashboard-widget-weather-row').length,
            };
        });
        // Every third hour across 24: eight points, not twenty-four.
        expect(rendered.rowCount).toBe(8);
    });

    /*
     * The forecast request must still ask for current conditions.
     *
     * The extra readings a wide tile shows are a continuation of `current=`,
     * not a parameter of their own. Adding them once dropped `&current=`
     * itself, and Open-Meteo then answered without a current block, which this
     * client reads as "no forecast at all" -- the whole tile said the weather
     * was unavailable. The stubs in the tests above answer any URL, so only
     * the URL itself can catch that.
     */
    test('the forecast asks for the current conditions and the extra readings', async ({ page }) => {
        await open(page);
        const asked = await page.evaluate(async () => {
            const d = window.dashboardInstance;
            Object.assign(d.settings, { weatherSource: 'manual', weatherLocation: 'Berlin' });
            const realFetch = window.fetch;
            const urls = [];
            window.fetch = async (url, ...rest) => {
                const address = String(url);
                if (address.includes('geocoding-api.open-meteo.com')) {
                    return new Response(JSON.stringify({
                        results: [{ latitude: 52.5, longitude: 13.4, name: 'Berlin' }],
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                if (address.includes('api.open-meteo.com')) {
                    urls.push(address);
                    return new Response(JSON.stringify({
                        current: {
                            temperature_2m: 21, weather_code: 0, apparent_temperature: 19,
                            relative_humidity_2m: 70, wind_speed_10m: 11, precipitation_probability: 30,
                        },
                        daily: {
                            time: ['2026-09-08'], temperature_2m_max: [22],
                            temperature_2m_min: [12], weather_code: [0],
                        },
                    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                return realFetch(url, ...rest);
            };
            const body = document.createElement('div');
            try {
                // Cached forecasts would answer without a request at all.
                await window.DashboardWidgets.weather(
                    body, { id: 'w_url', type: 'weather', config: { forecastRange: '3day' } },
                    { ...d, weatherService: Object.assign(Object.create(Object.getPrototypeOf(d.weatherService)), d.weatherService) });
            } finally {
                window.fetch = realFetch;
            }
            return { urls, temp: body.querySelector('.dashboard-widget-weather-temp')?.textContent };
        });

        const forecast = asked.urls.find((u) => u.includes('daily=') || u.includes('hourly='));
        expect(forecast).toBeTruthy();
        expect(forecast).toContain('current=temperature_2m,weather_code');
        expect(forecast).toContain('apparent_temperature');
        expect(forecast).toContain('relative_humidity_2m');
        expect(forecast).toContain('wind_speed_10m');
        expect(forecast).toContain('precipitation_probability');
        expect(asked.temp).toBe('21°C');
    });
});

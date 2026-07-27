// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The config/health/inbox views report what people click so it can be analysed
 * in Umami. Two things matter and both are asserted here: the events actually
 * fire, and they never carry free text (a bookmark title, a URL, a search
 * query, a page name), per the rules at the top of umami-analytics.js.
 */

/** Capture nextdashTrack calls regardless of whether analytics is switched on. */
async function captureTracks(page) {
    await page.evaluate(() => {
        window.__tracks = [];
        window.nextdashTrack = (name, props) => window.__tracks.push({ name, props });
    });
}

const tracks = (page) => page.evaluate(() => window.__tracks || []);

async function openConfig(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => !!window.dashboardInstance?.config, null, { timeout: 20_000 });
}

test.describe('view analytics events', () => {
    test('config reports section and sub-tab navigation', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await captureTracks(page);

        await page.locator('[data-config-section="behavior"]').first().click();
        await page.locator('[data-behavior-tab="privacy"]').first().click();

        const seen = await tracks(page);
        expect(seen).toContainEqual({ name: 'config:section', props: { section: 'behavior' } });
        expect(seen).toContainEqual({
            name: 'config:subtab',
            props: { section: 'behavior', tab: 'privacy', via: 'click' },
        });
    });

    test('a sub-tab reached by keyboard is distinguishable from a click', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await captureTracks(page);

        await page.locator('[data-behavior-tab]').first().focus();
        await page.keyboard.press('ArrowRight');

        const seen = await tracks(page);
        const subtabs = seen.filter((t) => t.name === 'config:subtab');
        expect(subtabs.length).toBeGreaterThan(0);
        expect(subtabs[0].props.via).toBe('keyboard');
        expect(subtabs[0].props.section).toBe('behavior');
    });

    test('a settings change reports the field name but never a free-text value', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('behavior'));
        await page.locator('[data-behavior-tab="privacy"]').first().click();
        await captureTracks(page);

        const box = page.locator('[data-behavior-field="analyticsOptIn"]').first();
        await box.check();
        await page.waitForTimeout(500);

        const seen = await tracks(page);
        const setting = seen.find((t) => t.name === 'config:setting');
        expect(setting).toBeTruthy();
        expect(setting.props.field).toBe('analyticsOptIn');
        // Booleans report on/off; nothing else about the value is sent.
        expect(setting.props.value).toBe('on');

        await box.uncheck();
        await page.waitForTimeout(500);
    });

    test('a free-text setting reports its name only, not what was typed', async ({ page }) => {
        await openConfig(page);
        await captureTracks(page);

        // Drive setBehavior directly with a text value: this is the path every
        // text input takes, and the secret must not reach the event.
        await page.evaluate(async () => {
            await window.dashboardInstance.config.setBehavior('dashboardTitle', 'my-private-title-42', '');
        });

        const seen = await tracks(page);
        const setting = seen.find((t) => t.name === 'config:setting');
        expect(setting).toBeTruthy();
        expect(setting.props.field).toBe('dashboardTitle');
        expect(JSON.stringify(seen)).not.toContain('my-private-title-42');
        expect(setting.props.value).toBeUndefined();
    });

    test('health reports filter and sort choices', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.health.openHealthView());
        await page.waitForTimeout(800);
        await captureTracks(page);

        await page.evaluate(() => {
            document.querySelector('[data-health-filter="all"]')?.click();
        });

        const seen = await tracks(page);
        const filter = seen.find((t) => t.name === 'health:filter');
        expect(filter).toBeTruthy();
        expect(filter.props.via).toBe('pill');
        expect(filter.props.filter).toBe('all');
    });

    test('inbox reports filter choices', async ({ page }) => {
        await openConfig(page);
        await page.evaluate(() => window.dashboardInstance.inbox.openInboxView());
        await page.waitForTimeout(800);
        await captureTracks(page);

        const clicked = await page.evaluate(() => {
            const btn = document.querySelector('[data-inbox-filter]:not([data-inbox-filter="all"])')
                || document.querySelector('[data-inbox-filter]');
            if (!btn) return false;
            btn.click();
            return true;
        });
        expect(clicked).toBe(true);

        const seen = await tracks(page);
        const filter = seen.find((t) => t.name === 'inbox:filter');
        expect(filter).toBeTruthy();
        expect(filter.props.via).toBe('pill');
        expect(typeof filter.props.filter).toBe('string');
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The header health link flags a live monitor outage differently from an
 * ordinary dead link: a distinct badge, a one-off pulse when the outage count
 * rises, and a cooldown so a flapping monitor cannot pulse the header on every
 * check.
 */
test.describe('health monitor down alert', () => {
    test.beforeEach(async ({ page }) => {
        await markWhatsNewSeen(page);
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 20_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.waitForSelector('.health-link', { timeout: 10_000 });
    });

    test('a down monitor gets its own badge, above broken and warn', async ({ page }) => {
        const badge = await page.evaluate(() => {
            const anchor = document.querySelector('.health-link a');
            // Down, broken and warn all present at once: the most severe wins.
            window.HealthBadgeUtils.applyHealthBadgeToAnchor(
                anchor,
                { monitorDownCount: 2, brokenCount: 4, duplicateCount: 3 },
                window.dashboardInstance.language,
                { keepHref: true }
            );
            const b = anchor.querySelector('.health-badge');
            return { cls: b?.className, text: b?.textContent, aria: b?.getAttribute('aria-label') };
        });
        expect(badge.cls).toContain('health-badge-down');
        expect(badge.text).toBe('2');
        expect(badge.aria).toMatch(/not responding/i);
    });

    test('the down badge deep-links to the monitored filter', async ({ page }) => {
        const href = await page.evaluate(() =>
            window.HealthBadgeUtils.buildHealthPageHref({ monitorDown: 1, broken: 3 })
        );
        // Down beats broken: the monitored list is where the outage is.
        expect(href).toBe('/?hv_filter=monitored#health');
    });

    test('the link pulses when the outage count rises, but not on first sight or recovery', async ({ page }) => {
        const r = await page.evaluate(() => {
            const v = window.dashboardInstance.visual;
            const link = document.querySelector('.health-link');
            const has = () => link.classList.contains('is-health-alert');
            v._lastMonitorDownCount = undefined;
            v._lastHealthAlertAt = 0;

            v.maybePulseHealthAlert(1);            // first sight seeds the baseline
            const seed = has();
            link.classList.remove('is-health-alert');

            v.maybePulseHealthAlert(2);            // rose: pulse
            const rise = has();
            link.classList.remove('is-health-alert');

            v._lastHealthAlertAt = 0;              // clear cooldown to isolate the drop
            v.maybePulseHealthAlert(1);            // recovered: no pulse
            const recovery = has();
            return { seed, rise, recovery };
        });
        expect(r.seed).toBe(false);
        expect(r.rise).toBe(true);
        expect(r.recovery).toBe(false);
    });

    test('a flapping monitor is silenced by the cooldown until it expires', async ({ page }) => {
        const r = await page.evaluate(() => {
            const v = window.dashboardInstance.visual;
            const link = document.querySelector('.health-link');
            const has = () => link.classList.contains('is-health-alert');
            v._lastMonitorDownCount = 1;
            v._lastHealthAlertAt = Date.now();     // just alerted

            link.classList.remove('is-health-alert');
            v.maybePulseHealthAlert(2);            // rose again inside cooldown: suppressed
            const suppressed = has();

            link.classList.remove('is-health-alert');
            v._lastHealthAlertAt = Date.now() - 11 * 60 * 1000; // cooldown expired
            v.maybePulseHealthAlert(3);            // now it may pulse
            const afterExpiry = has();
            return { suppressed, afterExpiry };
        });
        expect(r.suppressed).toBe(false);
        expect(r.afterExpiry).toBe(true);
    });
});

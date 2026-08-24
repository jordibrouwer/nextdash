// @ts-check
const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * No screen shows a locale key instead of a sentence.
 *
 * The four locale files carried about a thousand strings nothing could reach —
 * left behind by panels, buttons and whole views that had been rewritten — and
 * removing them is only safe if the removal itself is checked. A key that was
 * in use renders as its own name (`config.somethingLabel`) or as an empty
 * space, and both are visible from the outside.
 *
 * So this walks every config section and sub-tab, plus the health and inbox
 * views, and fails on any text that looks like an identifier rather than a
 * sentence.
 *
 * What it deliberately does not claim: that every removed key was dead. Almost
 * every call site passes an English fallback — `t('config.x', 'Some text')` —
 * so a key removed by mistake shows that fallback rather than its own name, and
 * only a reader in Dutch, German or French would notice. The guard against that
 * is the scan behind scripts/find-unused-locale-keys.cjs being conservative,
 * plus the four locale files carrying identical key sets, which
 * scripts/validate-locale-parity.cjs checks.
 */

const KEY_PATTERN = /\b(config|dashboard|health|onboarding|commands|colors|quickstart|featureTour)\.[a-zA-Z][a-zA-Z0-9_.]{3,}/;

async function open(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

/** Visible text of the config body, with the keys it should never contain. */
async function bodyText(page) {
    return page.evaluate(() => document.getElementById('config-view-body')?.innerText || '');
}

test.describe('every screen speaks in sentences', () => {
    test('every config section and sub-tab', async ({ page }) => {
        await open(page);

        // The config module loads on demand, so its class only exists once
        // config has been opened once.
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForFunction(() => typeof window.DashboardConfig === 'function', null, { timeout: 15_000 });
        const sections = await page.evaluate(() => {
            const C = window.DashboardConfig;
            return C.SECTIONS.map((section) => ({
                section,
                tabs: (C.SUB_TABS[section] || []).slice(0, 12),
            }));
        });

        const offenders = [];
        for (const { section, tabs } of sections) {
            await page.evaluate((s) => window.dashboardInstance.config.openConfigView(s), section);
            await page.waitForTimeout(500);
            for (const tab of (tabs.length ? tabs : [null])) {
                if (tab) {
                    await page.evaluate(({ s, t }) => {
                        const c = window.dashboardInstance.config;
                        const prop = window.DashboardConfig.SUB_TAB_STATE[s];
                        if (prop) c[prop] = t;
                        c.render();
                    }, { s: section, t: tab });
                    await page.waitForTimeout(450);
                }
                const text = await bodyText(page);
                const hit = text.match(KEY_PATTERN);
                if (hit) offenders.push(`${section}${tab ? `/${tab}` : ''}: ${hit[0]}`);
            }
        }

        expect(offenders, `locale keys rendered as text:\n${offenders.join('\n')}`).toEqual([]);
    });

    test('the health and inbox views, and the dashboard itself', async ({ page }) => {
        await open(page);

        const dashboard = await page.evaluate(() => document.body.innerText);
        expect(dashboard.match(KEY_PATTERN)?.[0] ?? null).toBeNull();

        await page.evaluate(() => window.dashboardInstance.health?.openHealthView?.());
        await page.waitForTimeout(1500);
        const health = await page.evaluate(() => document.body.innerText);
        expect(health.match(KEY_PATTERN)?.[0] ?? null).toBeNull();

        await page.evaluate(() => window.dashboardInstance.inbox?.openInboxView?.());
        await page.waitForTimeout(1500);
        const inbox = await page.evaluate(() => document.body.innerText);
        expect(inbox.match(KEY_PATTERN)?.[0] ?? null).toBeNull();
    });
});

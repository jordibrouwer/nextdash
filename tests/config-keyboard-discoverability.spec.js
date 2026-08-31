// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

async function openConfigSection(page, section) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate((s) => {
        window.DiscoverabilityState?.init?.({ seenTips: ['tipConfigKeyboard'] });
        return window.dashboardInstance.config.openConfigView(s);
    }, section);
    await expect(page.locator('#config-view-body')).toBeVisible({ timeout: 10_000 });
}

test.describe('config keyboard discoverability', () => {
    test('form sections show a keyboard legend footer', async ({ page }) => {
        await openConfigSection(page, 'behavior');
        await expect(page.locator('.config-form-keyboard-legend')).toBeVisible();
        await expect(page.locator('.config-form-keyboard-legend')).toContainText(/Shift\+K|cheat sheet|spiekbriefje/i);
    });

    test('Help → Search & keyboard includes Config navigation', async ({ page }) => {
        await openConfigSection(page, 'help');
        await page.locator('[data-help-tab="search"]').click();
        await expect(page.getByRole('heading', { name: /Config navigation|Config-navigatie|Config-Navigation|Navigation dans config/i }))
            .toBeVisible();
    });

    test('first config open shows the keyboard intro toast once', async ({ page }) => {
        // The seen tips live in settings on the server, and the two specs above
        // this one open config and mark this tip seen there. init() only sets
        // the in-memory copy, so the empty state has to be written back and the
        // page reloaded onto it — otherwise this "first open" is a second one.
        await page.goto('/');
        await page.waitForFunction(() => window.DiscoverabilityState != null, null, { timeout: 15_000 });
        await page.evaluate(async () => {
            window.DiscoverabilityState?.init?.({ seenTips: [] });
            await window.DiscoverabilityState?.persistNow?.();
            // The search-mode note is not a tip in that state: it is keyed on
            // its own localStorage entry, and persistNow rewrites the legacy
            // keys around it — leaving this one cleared, so it fired again on
            // the second open and stood where this test counts zero toasts.
            // Stamped with the release the way markWhatsNewSeen does.
            try {
                localStorage.setItem('nextdash:search-mode-key-announced',
                    window.NEXTDASH_WHATS_NEW_RELEASE || '');
            } catch { /* private mode */ }
        });
        await page.goto('/');
        await page.waitForFunction(() => window.dashboardInstance?.config?.openConfigView, null, { timeout: 15_000 });
        await dismissOnboardingIfPresent(page);
        await dismissBlockingOverlays(page);
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        // The tip is queued behind whatever the view says on opening, so the
        // first toast to appear is not always this one. Wait for the text
        // rather than for the element, or the assertion reads a toast that was
        // on its way out.
        await expect(page.locator('#app-notification.show'))
            .toContainText(/j.*k|0.*9|Ctrl.*Shift.*K|cheat sheet|spiekbriefje/i, { timeout: 10_000 });

        await page.evaluate(() => window.AppNotification?.hide?.());
        await expect(page.locator('#app-notification.show')).toHaveCount(0);

        console.log('VOOR SLUITEN ->', JSON.stringify(await page.evaluate(() => ({
            text: (document.querySelector('#app-notification')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,50),
            shown: !!document.querySelector('#app-notification.show'),
            queue: window.AppNotification?._queue?.length,
        }))));
        await page.evaluate(() => window.dashboardInstance.config.closeConfigView());
        await page.evaluate(() => window.dashboardInstance.config.openConfigView('overview'));
        await page.waitForTimeout(900);
        console.log('SLEUTEL ->', JSON.stringify(await page.evaluate(() => ({
            announced: localStorage.getItem('nextdash:search-mode-key-announced'),
            release: window.NEXTDASH_WHATS_NEW_RELEASE,
        }))));
        console.log('TWEEDE OPENING ->', JSON.stringify(await page.evaluate(() => ({
            text: (document.querySelector('#app-notification')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,70),
            shown: !!document.querySelector('#app-notification.show'),
        }))));
        await expect(page.locator('#app-notification.show')).toHaveCount(0);
    });
});

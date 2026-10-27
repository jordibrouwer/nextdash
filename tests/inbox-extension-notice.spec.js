// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Inbox users who never saved anything with the browser extension are invited
 * to try it: a line in the empty Inbox, and a corner card after three opens.
 */
const PROMO_ID = 'inbox-extension-notice-v1';
const card = (page) => page.locator('.inbox-extension-notice-card');

async function load(page, { bySource = { paste: 3 }, settings = {}, opens = 3 } = {}) {
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.route('**/api/inbox-stats', (route) => route.fulfill({
        json: { total: 3, bySource },
    }));
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.inbox && window.DashboardInboxExtensionNotice, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(({ id, settings, opens }) => {
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
        localStorage.removeItem('nextdashInboxExtensionSnoozeUntil');
        localStorage.setItem('nextdashInboxOpens', String(opens));
        document.querySelectorAll('.quickstart-card').forEach((el) => el.remove());
        const d = window.dashboardInstance;
        d.settings.quickStart = { ...(d.settings.quickStart || {}), analyticsChoiceMade: true };
        Object.assign(d.settings, { inboxEnabled: true, enableInboxExtensionNotice: true }, settings);
        window.__tracked = [];
        window.nextdashTrack = (name, props) => window.__tracked.push([name, props]);
        window.__opened = [];
        window.open = (...args) => { window.__opened.push(args); return null; };
    }, { id: PROMO_ID, settings, opens });
}

const inView = (page, view) => page.evaluate((v) => { window.dashboardInstance.activeView = v; }, view);
const shouldShow = (page) => page.evaluate(() => window.DashboardInboxExtensionNotice.card.shouldShow());

test.describe('the Inbox browser-extension invitation', () => {
    test('the empty Inbox carries the extension line, once tracked, and the setting hides it', async ({ page }) => {
        await load(page);
        const empty = await page.evaluate(() => {
            const el = window.dashboardInstance.inbox.renderEmptyState();
            window.dashboardInstance.inbox.renderEmptyState();
            const link = el.querySelector('.inbox-empty-extension a');
            return { text: link?.textContent, href: link?.href, rel: link?.rel, target: link?.target };
        });
        expect(empty.text).toBe('Save pages here with the browser extension.');
        expect(empty.href).toBe('http://www.nextdash.cc/docs/browser-extension-and-capture.html');
        expect(empty.rel).toContain('noopener');
        expect(empty.target).toBe('_blank');
        const seen = await page.evaluate(() => window.__tracked.filter(([n, p]) => n === 'inbox-ext-cta' && p.action === 'empty-line-seen').length);
        expect(seen).toBe(1);

        const off = await page.evaluate(() => {
            window.dashboardInstance.settings.enableInboxExtensionNotice = false;
            return window.dashboardInstance.inbox.renderEmptyState().querySelector('.inbox-empty-extension') != null;
        });
        expect(off).toBe(false);
    });

    test('the card shows in the Inbox view after three opens when the extension was never used', async ({ page }) => {
        await load(page);
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(true);
        expect(await page.evaluate(() => window.DashboardInboxExtensionNotice.card.render())).toBe(true);
        await expect(card(page)).toBeVisible();
        await expect(card(page)).toContainText('Fill your Inbox from the browser');
        expect(await page.evaluate(() => window.__tracked.some(([n, p]) => n === 'inbox-ext-cta' && p.action === 'shown'))).toBe(true);
    });

    test('opens are counted by the view hook', async ({ page }) => {
        await load(page, { opens: 2 });
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(false);
        await page.evaluate(() => window.DashboardInboxExtensionNotice.onViewReady());
        expect(await shouldShow(page)).toBe(true);
    });

    test('no card when the extension has saved something, the setting is off, or it was answered', async ({ page }) => {
        await load(page, { bySource: { extension: 1 } });
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(false);

        await load(page, { settings: { enableInboxExtensionNotice: false } });
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(false);

        await load(page);
        await inView(page, 'inbox');
        await page.evaluate((id) => window.DiscoverabilityState.markSettingPromoSeen(id, { persist: false }), PROMO_ID);
        expect(await shouldShow(page)).toBe(false);
    });

    test('no card outside the Inbox view', async ({ page }) => {
        await load(page);
        await inView(page, 'bookmarks');
        expect(await shouldShow(page)).toBe(false);
    });

    test('Get the extension opens the link, answers and closes', async ({ page }) => {
        await load(page);
        await inView(page, 'inbox');
        await page.evaluate(() => window.DashboardInboxExtensionNotice.card.render());
        await card(page).locator('[data-inbox-ext-action="get"]').click();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened[0]?.[0])).toBe('http://www.nextdash.cc/docs/browser-extension-and-capture.html');
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.__tracked.some(([, p]) => p.action === 'get'))).toBe(true);
    });

    test('Not now and the x snooze it, Do not show again answers it', async ({ page }) => {
        await load(page);
        await inView(page, 'inbox');
        await page.evaluate(() => window.DashboardInboxExtensionNotice.card.render());
        await card(page).locator('[data-inbox-ext-action="later"]').click();
        await expect(card(page)).toHaveCount(0);
        expect(await shouldShow(page)).toBe(false);
        const until = await page.evaluate(() => Number(localStorage.getItem('nextdashInboxExtensionSnoozeUntil')));
        expect(until - Date.now()).toBeGreaterThan(13 * 86400000);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(false);

        await page.evaluate(() => localStorage.removeItem('nextdashInboxExtensionSnoozeUntil'));
        await page.evaluate(() => window.DashboardInboxExtensionNotice.card.render());
        await card(page).locator('.quickstart-close').click();
        await expect(card(page)).toHaveCount(0);
        expect(await shouldShow(page)).toBe(false);

        await page.evaluate(() => localStorage.removeItem('nextdashInboxExtensionSnoozeUntil'));
        await page.evaluate(() => window.DashboardInboxExtensionNotice.card.render());
        await card(page).locator('[data-inbox-ext-action="never"]').click();
        await expect(card(page)).toHaveCount(0);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.__tracked.map(([, p]) => p.action).filter((a) => ['later', 'dismiss', 'never'].includes(a)))).toEqual(['later', 'dismiss', 'never']);
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Inbox users who never saved anything with the browser extension are invited
 * to try it: a line in the empty Inbox, and a toast after three opens.
 */
const PROMO_ID = 'inbox-extension-notice-v1';
const card = (page) => page.locator('.inbox-extension-notice-card');
const toast = (page) => page.locator('#app-notification.show');
const row = (page) => page.locator('.notification-bell-row[data-bell-id="inbox-extension-notice"]');

async function openBell(page) {
    await page.evaluate(() => window.NotificationBell.refreshAll());
    await page.evaluate(() => window.NotificationBell.open());
}

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
        window.DiscoverabilityState.schedulePersist = () => {};
        window.DiscoverabilityState?.resetSettingPromoSeen?.(id, { persist: false });
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
const shouldShow = (page) => page.evaluate(() => window.DashboardInboxExtensionNotice.shouldShow());

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

    test('after three opens it is a tip in the bell, with no toast and no corner card', async ({ page }) => {
        await load(page);
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(true);
        await openBell(page);
        await expect(row(page)).toBeVisible();
        await expect(row(page)).toContainText('Fill your Inbox from the browser');
        await expect(page.locator('.notification-bell-group[data-bell-group="tips"]')).toContainText('Fill your Inbox from the browser');
        await expect(toast(page)).toHaveCount(0);
        await expect(card(page)).toHaveCount(0);
    });

    test('it shows in every view, not only the Inbox', async ({ page }) => {
        await load(page);
        await inView(page, 'bookmarks');
        expect(await shouldShow(page)).toBe(true);
        await openBell(page);
        await expect(row(page)).toBeVisible();
    });

    test('opens are counted by the view hook', async ({ page }) => {
        await load(page, { opens: 2 });
        await inView(page, 'inbox');
        expect(await shouldShow(page)).toBe(false);
        await page.evaluate(() => window.DashboardInboxExtensionNotice.onViewReady());
        expect(await shouldShow(page)).toBe(true);
    });

    test('no row when the extension has saved something, the setting is off, or it was answered', async ({ page }) => {
        await load(page, { bySource: { extension: 1 } });
        expect(await shouldShow(page)).toBe(false);

        await load(page, { settings: { enableInboxExtensionNotice: false } });
        expect(await shouldShow(page)).toBe(false);

        await load(page);
        await page.evaluate((id) => window.DiscoverabilityState.markSettingPromoSeen(id, { persist: false }), PROMO_ID);
        expect(await shouldShow(page)).toBe(false);
    });

    test('Mark read lets it go for good', async ({ page }) => {
        await load(page);
        await openBell(page);
        await row(page).getByRole('button', { name: 'Mark read' }).click();
        await expect(row(page)).toHaveCount(0);
        await page.evaluate(() => window.NotificationBell.refreshAll());
        await expect(row(page)).toHaveCount(0);
    });

    test('Get the extension opens the page, counts as answered and reads the row', async ({ page }) => {
        await load(page);
        await openBell(page);
        await row(page).getByRole('button', { name: 'Get the extension' }).click();
        await expect(row(page)).toHaveCount(0);
        expect(await page.evaluate(() => window.__opened.length)).toBe(1);
        expect(await page.evaluate((id) => window.DiscoverabilityState.hasSeenSettingPromo(id), PROMO_ID)).toBe(true);
        expect(await page.evaluate(() => window.__tracked.some(([n, p]) => n === 'inbox-ext-cta' && p.action === 'get'))).toBe(true);
    });
});

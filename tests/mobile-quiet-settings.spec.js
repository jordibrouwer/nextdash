// @ts-check
const { test, expect } = require('./fixtures');
const { startStubSite, installWithBookmark, openDashboard, row, headers } = require('./helpers/feed-watch');

/**
 * Three settings under Behavior -> On phones and tablets, all off by default:
 * links open in a new tab on a phone, notifications are hidden (errors stay),
 * and the corner cards stay away. They only ever apply to a touch screen; a
 * computer is unchanged.
 */
let site;
test.beforeEach(async ({ request }) => {
    site = await startStubSite();
    await installWithBookmark(request, site);
});
test.afterEach(async () => { await site.close(); });

const set = async (request, data) => {
    expect((await request.post('/api/settings', { data, headers })).ok()).toBe(true);
};

const toast = (page) => page.locator('#app-notification');

/** Raise a toast through the dashboard's own notification path. */
const notify = (page, message, type) => page.evaluate(([m, ty]) => window.dashboardInstance.showNotification(m, ty), [message, type]);

test.describe('on a phone', () => {
    test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

    test('toasts are hidden by default but errors show; off shows them', async ({ page, request }) => {
        // On by default: no toast, but an error still shows.
        await openDashboard(page);
        await notify(page, 'Saved it', 'success');
        // The toast must stay hidden: a fixed wait, so a late `show` class would be there before the single read.
        await page.waitForTimeout(600);
        // Read once: a retrying not-assertion would wait the toast out.
        expect(await toast(page).getAttribute('class')).not.toContain('show');
        await notify(page, 'It failed', 'error');
        await expect(toast(page)).toHaveClass(/show/);
        await expect(toast(page)).toContainText('It failed');

        await set(request, { hideToastsMobile: false });
        await openDashboard(page);
        await notify(page, 'Saved it', 'success');
        await expect(toast(page)).toHaveClass(/show/);
        await expect(toast(page)).toContainText('Saved it');
    });

    test('a corner card is held back, not dismissed, and comes back when the setting is off', async ({ page, request }) => {
        // Since v1.26.0 most notices wait in the bell, which the setting does
        // not touch (notice-card-bell.spec.js). What still stands in the corner
        // is an essential card, a report with its Undo (the app discovery
        // notice), which the phone layout lets through: the setting is what
        // holds it back. A probe card of that kind, through the real NoticeCard
        // path, so the test does not need a discovered app to report.
        const ask = () => page.evaluate(() => {
            window.__probeDismissed = 0;
            const card = window.NoticeCard.define({
                id: 'probe-corner',
                essential: true,
                title: () => 'Probe title',
                body: () => 'Probe body',
                canShow: () => true,
                onDismiss: () => { window.__probeDismissed += 1; },
            });
            return card.render();
        });
        await openDashboard(page);
        expect(await ask()).toBe(false);
        await expect(page.locator('.probe-corner-card')).toHaveCount(0);
        // Held back, not answered: nothing dismissed it.
        expect(await page.evaluate(() => window.__probeDismissed)).toBe(0);

        await set(request, { hideCornerCardsMobile: false });
        await openDashboard(page);
        expect(await ask()).toBe(true);
        await expect(page.locator('.probe-corner-card')).toBeVisible();
    });

    test('a bookmark opens in the same tab by default, in a new one when asked', async ({ page, context, request }) => {
        // Open links in a new tab is on, as a computer would have it: the phone setting rules here.
        await set(request, { openInNewTab: true });
        await openDashboard(page);
        let opened = 0;
        context.on('page', () => { opened += 1; });
        await row(page, 'Stub Blog').tap();
        await page.waitForURL(site.url);
        expect(opened).toBe(0);

        await set(request, { openInNewTab: true, openLinksNewTabMobile: true });
        await openDashboard(page);
        const popup = context.waitForEvent('page');
        await row(page, 'Stub Blog').tap();
        expect((await popup).url()).toContain(site.url.replace(/\/$/, ''));
    });

    test('the settings are in Config and save', async ({ page }) => {
        const saved = [];
        await page.route('**/api/settings', async (route) => {
            if (route.request().method() === 'POST') saved.push(JSON.parse(route.request().postData() || '{}'));
            return route.fallback();
        });
        await openDashboard(page);
        await page.evaluate(() => (window.dashboardInstance.config.behaviorTab = window.dashboardInstance.config.behaviorTab || 'general', window.dashboardInstance.config).openConfigView('behavior'));
        const box = (key) => page.locator(`[data-behavior-field="${key}"]`);
        await expect(box('openLinksNewTabMobile')).not.toBeChecked();
        await box('openLinksNewTabMobile').check();
        await expect.poll(() => saved.some((s) => s.openLinksNewTabMobile === true)).toBe(true);
        for (const key of ['hideToastsMobile', 'hideCornerCardsMobile']) {
            await expect(box(key)).toBeChecked();
            await box(key).uncheck();
            await expect.poll(() => saved.some((s) => s[key] === false)).toBe(true);
        }
    });
});

test.describe('on a computer', () => {
    test('the phone settings change nothing', async ({ page, context, request }) => {
        await set(request, { hideToastsMobile: true, hideCornerCardsMobile: true, openLinksNewTabMobile: false, openInNewTab: true });
        await openDashboard(page);
        await notify(page, 'Saved it', 'success');
        await expect(toast(page)).toHaveClass(/show/);
        const popup = context.waitForEvent('page');
        await row(page, 'Stub Blog').click();
        expect((await popup).url()).toContain(site.url.replace(/\/$/, ''));
        const free = await page.evaluate(() => window.NoticeCard.cornerIsFree('probe-card', {}));
        expect(free).toBe(true);
    });
});

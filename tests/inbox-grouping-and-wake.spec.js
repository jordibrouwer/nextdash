// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
}

test.describe('inbox date groups', () => {
    // "Oldest first" drew Today on top and the backlog at the bottom.
    test('oldest first puts the oldest group on top', async ({ page }) => {
        await openInbox(page);
        const keys = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            const now = Date.now();
            const items = [
                { id: 'a', addedAt: now - 40 * 86400000 },
                { id: 'b', addedAt: now },
            ];
            const saved = inbox.sort;
            inbox.sort = 'oldest';
            const out = inbox.groupFilteredItems(items).map((g) => g.key);
            inbox.sort = saved;
            return out;
        });
        expect(keys).toEqual(['older', 'today']);
    });
});

test.describe('inbox date groups across the clock change', () => {
    test.use({ timezoneId: 'Europe/Amsterdam' });
    // 25 October 2026 has 25 hours; on the Monday after, Sunday is "Yesterday".
    test('the day after the clocks go back, Sunday is yesterday', async ({ page }) => {
        await page.clock.setFixedTime(new Date('2026-10-26T10:00:00+01:00'));
        await openInbox(page);
        const key = await page.evaluate(() => window.dashboardInstance.inbox.getDateGroupKey(
            new Date('2026-10-25T00:30:00+02:00').getTime()));
        expect(key).toBe('yesterday');
    });
});

test.describe('inbox wake timer', () => {
    // The empty-list branches returned before the timer was set, so the last
    // snoozed link never came back on its own.
    test('an inbox with only snoozed links still sets its wake timer', async ({ page }) => {
        await openInbox(page);
        const armed = await page.evaluate(() => {
            const inbox = window.dashboardInstance.inbox;
            inbox.items = [{ id: 'sleeper', url: 'https://sleep.example/', title: 'Sleeper', addedAt: Date.now(), snoozedUntil: Date.now() + 60000 }];
            if (inbox._wakeTimer) { clearTimeout(inbox._wakeTimer); inbox._wakeTimer = null; }
            inbox.render();
            return inbox._wakeTimer != null;
        });
        expect(armed).toBe(true);
    });
});

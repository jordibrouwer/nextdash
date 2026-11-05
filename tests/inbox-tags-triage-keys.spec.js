// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The shared verbs: t edits tags (as on the dashboard), f works through the list
 * (as in the Bookmarks view). l and, with no row in hand, t keep doing what they
 * did for a couple of releases and say what replaced them. The handlers are
 * recorded rather than run, so no tag editor or triage card has to be driven.
 */
async function openInbox(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await prepareDashboardInteraction(page);
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
    await page.evaluate(async () => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        await api('/api/inbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://tt-keys-${Date.now()}.example/x`, title: 'Key probe', source: 'paste' }),
        });
    });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect(page.locator('[data-inbox-id]').first()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
        const inbox = window.dashboardInstance.inbox;
        window.__calls = [];
        window.__aliasToasts = [];
        inbox.editTags = async () => { window.__calls.push('tags'); };
        inbox.startTriage = async () => { window.__calls.push('triage'); };
        window.dashboardInstance.showNotification = (m) => { window.__aliasToasts.push(String(m)); };
    });
}
const calls = (page) => page.evaluate(() => window.__calls);
const toasts = (page) => page.evaluate(() => window.__aliasToasts);
async function selectFirstRow(page) {
    await page.keyboard.press('j');
    await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.inbox.selectedItemId)).toBe(true);
}

test('t edits the tags of the selected row', async ({ page }) => {
    await openInbox(page);
    await selectFirstRow(page);
    await page.keyboard.press('t');
    expect(await calls(page)).toEqual(['tags']);
    expect(await toasts(page)).toEqual([]);
});

test('l still edits the tags and names t', async ({ page }) => {
    await openInbox(page);
    await selectFirstRow(page);
    await page.keyboard.press('l');
    expect(await calls(page)).toEqual(['tags']);
    expect((await toasts(page)).some((m) => m.includes('l is now t'))).toBe(true);
});

test('f starts working through the list', async ({ page }) => {
    await openInbox(page);
    await page.keyboard.press('f');
    expect(await calls(page)).toEqual(['triage']);
    expect(await toasts(page)).toEqual([]);
});

test('t with no row in hand still starts the walk and names f', async ({ page }) => {
    await openInbox(page);
    await page.evaluate(() => { window.dashboardInstance.inbox.selectedItemId = null; });
    await page.keyboard.press('t');
    expect(await calls(page)).toEqual(['triage']);
    expect((await toasts(page)).some((m) => m.includes('t is now f'))).toBe(true);
});

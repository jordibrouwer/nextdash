const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/*
 * AppModal ran a caller's onHide before the button's own handler, and never
 * settled confirm() on Escape. Two ways that surfaced: the Inbox's bulk Delete
 * resolved "no" before it heard Delete and removed nothing, and a confirm
 * dismissed with Escape left its caller waiting for ever.
 */

async function openDashboard(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
}

test.describe('modal close order', () => {
    test('the inbox selection bar Delete deletes', async ({ page }) => {
        await openDashboard(page);
        await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
        await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });
        const stamp = Date.now();
        const titles = ['MCO one', 'MCO two'];
        await page.evaluate(async ({ titles, stamp }) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            for (let i = 0; i < titles.length; i += 1) {
                await api('/api/inbox', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: `https://mco${i}-${stamp}.example/x`, title: titles[i] }),
                });
            }
        }, { titles, stamp });
        await page.locator('#page-nav-inbox-btn').click();
        await expect(page.locator('.inbox-layout')).toBeVisible();
        await expect.poll(async () => page.evaluate(async (wanted) => {
            const ib = window.dashboardInstance.inbox;
            await ib.loadItems?.();
            ib.render();
            return wanted.every((t) => (ib.items || []).some((i) => i.title === t));
        }, titles), { timeout: 15_000 }).toBe(true);

        await page.evaluate((wanted) => {
            const ib = window.dashboardInstance.inbox;
            ib.items.filter((i) => wanted.includes(i.title)).forEach((i) => ib.setChecked(i.id, true));
            ib.render();
        }, titles);
        await page.locator('[data-inbox-selection="delete"]').click();
        await page.locator('#app-modal.show .modal-button--danger').click();

        await expect.poll(async () => page.evaluate(async (wanted) => {
            const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
            const data = await (await api('/api/inbox')).json();
            return (data.items || []).filter((i) => wanted.includes(i.title)).length;
        }, titles), { timeout: 10_000 }).toBe(0);
    });

    test('a confirm dismissed with Escape answers no', async ({ page }) => {
        await openDashboard(page);
        await page.evaluate(() => {
            window.__answer = 'pending';
            window.AppModal.confirm({ title: 'Sure?', message: 'Really?' }).then((ok) => { window.__answer = ok; });
        });
        await expect(page.locator('#app-modal.show')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.__answer)).toBe(false);
    });
});

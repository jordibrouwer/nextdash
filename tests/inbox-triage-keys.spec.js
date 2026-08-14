const { test, expect } = require('@playwright/test');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');

/**
 * Triage swallowed every key but Escape: its guard asked dash.isModalOpen(),
 * which counts the triage overlay itself as a modal — so the overlay blocked
 * its own keyboard and sat on the first link whatever you pressed.
 */
async function openTriage(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?.inbox != null, null, { timeout: 15_000 });
    await page.evaluate(() => { window.dashboardInstance.settings.inboxEnabled = true; });

    const titles = ['Triage one', 'Triage two', 'Triage three'];
    await page.evaluate(async (list) => {
        const api = typeof nextDashFetch === 'function' ? nextDashFetch : fetch;
        for (const t of list) {
            await api('/api/inbox', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: `https://tri-${t.replace(/\W/g, '')}-${Date.now()}.example/x`, title: t }),
            });
        }
    }, titles);

    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect.poll(() => page.evaluate(() =>
        (window.dashboardInstance.inbox.items || []).length), { timeout: 10_000 }).toBeGreaterThan(2);

    await page.keyboard.press('t');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.inbox.triage?.isOpen?.()), { timeout: 10_000 }).toBe(true);
}

const index = (page) => page.evaluate(() => window.dashboardInstance.inbox.triage.index);

test.describe('triage keyboard', () => {
    test('j and k move through the queue', async ({ page }) => {
        await openTriage(page);
        expect(await index(page)).toBe(0);

        await page.keyboard.press('j');
        await expect.poll(() => index(page), { timeout: 5_000 }).toBe(1);

        await page.keyboard.press('j');
        await expect.poll(() => index(page), { timeout: 5_000 }).toBe(2);

        await page.keyboard.press('k');
        await expect.poll(() => index(page), { timeout: 5_000 }).toBe(1);
    });

    test('the arrows do the same', async ({ page }) => {
        await openTriage(page);
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => index(page), { timeout: 5_000 }).toBe(1);
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => index(page), { timeout: 5_000 }).toBe(0);
    });

    // The guard is right to exist — it just asked the wrong question.
    test('a modal layered over triage still blocks its keys', async ({ page }) => {
        await openTriage(page);
        const blocked = await page.evaluate(() => {
            const tr = window.dashboardInstance.inbox.triage;
            // The page already owns an #app-modal, so toggle its class rather
            // than adding a second one getElementById would never reach.
            const modal = document.getElementById('app-modal');
            const had = modal?.classList.contains('show');
            modal?.classList.add('show');
            const layered = tr.isLayeredModalOpen();
            if (!had) modal?.classList.remove('show');
            return { layered, quietWhenClosed: tr.isLayeredModalOpen() };
        });
        expect(blocked.layered).toBe(true);
        // And triage on its own is not treated as layered over itself, which is
        // the bug this whole file is about.
        expect(blocked.quietWhenClosed).toBe(false);
    });
});

// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent,
    prepareDashboardInteraction } = require('./e2e-helpers');

/**
 * The Inbox speaks the dashboard's way too: plain letters on the row under the
 * cursor, Shift only for views. m keeps (it was Shift+K), s shares, q shows a QR
 * code, y copies the link, Ctrl/Cmd+Enter opens in a new tab, Ctrl/Cmd+C copies
 * the address. Shift+H switches the legend, and the mode strip says what the keys do.
 * The handlers are recorded rather than run.
 */
async function openInbox(page) {
    await page.setViewportSize({ width: 1500, height: 900 });
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
            body: JSON.stringify({ url: `https://inbox-letters-${Date.now()}.example/x`, title: 'Letters probe', source: 'paste' }),
        });
    });
    await page.locator('#page-nav-inbox-btn').click();
    await expect(page.locator('.inbox-layout')).toBeVisible();
    await page.evaluate(() => window.dashboardInstance.inbox.loadAndRender({ refresh: true }));
    await expect(page.locator('[data-inbox-id]').first()).toBeVisible({ timeout: 10_000 });
    await page.evaluate(() => {
        const inbox = window.dashboardInstance.inbox;
        window.__calls = [];
        inbox.keepItem = async () => { window.__calls.push('keep'); };
        inbox.copyItemLink = async () => { window.__calls.push('copy-link'); };
        window.dashboardInstance.contextMenu.shareBookmark = async () => { window.__calls.push('share'); };
        window.BookmarkQR = { ...(window.BookmarkQR || {}), show: async () => { window.__calls.push('qr'); } };
        window.open = (url) => { window.__calls.push(`open:${url}`); return null; };
    });
    await page.keyboard.press('j');
    await expect.poll(() => page.evaluate(() => !!window.dashboardInstance.inbox.selectedItemId)).toBe(true);
}
const calls = (page) => page.evaluate(() => window.__calls);

test('m keeps the row (it was Shift+K), and Shift+K does nothing now', async ({ page }) => {
    await openInbox(page);
    await page.evaluate(() => { window.dashboardInstance.inbox.keptEnabled = () => true; });
    await page.keyboard.press('Shift+K');
    // Guards a check that nothing happens: without the pause the check passes at once.
    await page.waitForTimeout(300);
    expect(await calls(page)).toEqual([]);
    await page.keyboard.press('m');
    await expect.poll(() => calls(page)).toContain('keep');
});

test('s, q and y share, show the QR code and copy the link', async ({ page }) => {
    await openInbox(page);
    await page.keyboard.press('s');
    await page.keyboard.press('q');
    await page.keyboard.press('y');
    await expect.poll(() => calls(page)).toEqual(expect.arrayContaining(['share', 'qr', 'copy-link']));
});

test('Ctrl+Enter opens the link in a new tab', async ({ page }) => {
    await openInbox(page);
    await page.keyboard.press('Control+Enter');
    await expect.poll(async () => (await calls(page)).some((c) => c.startsWith('open:https://inbox-letters-'))).toBe(true);
});

test('Shift+R is not a key of the view', async ({ page }) => {
    await openInbox(page);
    await page.evaluate(() => {
        window.dashboardInstance.inbox.refreshFromKeyboard = async () => { window.__calls.push('refresh'); };
    });
    await page.keyboard.press('Shift+R');
    // Guards a check that nothing happens: without the pause the check passes at once.
    await page.waitForTimeout(500);
    expect(await calls(page)).not.toContain('refresh');
});

test('the legend shows the new keys and Shift+H switches it', async ({ page }) => {
    await openInbox(page);
    const legend = page.locator('.inbox-legend');
    await expect(legend).toBeVisible();
    await expect(legend).toContainText('m');
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.inbox-legend')).toHaveCount(0);
    await page.keyboard.press('Shift+H');
    await expect(page.locator('.inbox-legend')).toBeVisible();
});

test('the row menu shows a key beside every action', async ({ page }) => {
    await openInbox(page);
    await page.locator('[data-inbox-id]').first().click({ button: 'right' });
    const menu = page.locator('#bookmark-context-menu');
    await expect(menu).toBeVisible();
    const missing = await menu.locator('[data-action]').evaluateAll((els) => els
        .filter((el) => !el.querySelector('.move-popover-item-key')).map((el) => el.getAttribute('data-action')));
    expect(missing, 'menu entries without a key').toEqual([]);
});

test('the mode strip follows the cursor in the Inbox and goes with it', async ({ page }) => {
    await openInbox(page);
    const strip = page.locator('#mode-strip');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Cursor');
    await page.keyboard.press('j');
    await expect(strip).toBeVisible();
    for (let i = 0; i < 4; i += 1) {
        if (!/Cursor|selected/.test(await strip.innerText().catch(() => ''))) break;
        await page.keyboard.press('Escape');
        // An Escape that only drops a tick leaves nothing new to wait on; give it a frame before the strip is read again.
        await page.waitForTimeout(200);
    }
    // Esc leaves the Inbox from a cursor-less list, so the strip names whichever mode the keys are in now.
    await expect(strip).toContainText(/Search|Browse/);
    await expect(strip).not.toContainText('Cursor');
});

test('the legend stays in view at the foot of the window with a long list', async ({ page }) => {
    await openInbox(page);
    await page.evaluate(() => {
        const inbox = window.dashboardInstance.inbox;
        const base = inbox.items[0];
        inbox.items = Array.from({ length: 40 }, (_, i) => ({ ...base, id: `pw-${i}`, url: `https://pw-${i}.example/`, title: `Row ${i}` }));
        inbox.render();
    });
    await expect(page.locator('.inbox-item').nth(30)).toBeAttached();
    const legend = page.locator('.inbox-legend-wrap');
    await expect(legend).toBeInViewport();
    const box = await legend.boundingBox();
    const vh = await page.evaluate(() => window.innerHeight);
    expect(box.y + box.height).toBeLessThanOrEqual(vh + 1);
});

test('the Triage button names its key f', async ({ page }) => {
    await openInbox(page);
    await expect(page.locator('.inbox-triage-btn kbd').first()).toHaveText('f');
});

test('in the Inbox the strip hides on a mouse click and returns with a key', async ({ page }) => {
    await openInbox(page);
    const strip = page.locator('#mode-strip');
    await expect(strip).toBeVisible();
    await page.mouse.click(8, 8);
    await expect(strip).toBeHidden();
    await page.keyboard.press('j');
    await expect(strip).toBeVisible();
});

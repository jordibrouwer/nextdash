// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissBlockingOverlays, dismissOnboardingIfPresent } = require('./e2e-helpers');
const { openBookmarksWithHealth } = require('./helpers/bookmarks-health');

/**
 * A bookmark as a QR code, to open it on a phone.
 *
 * Every entry opens the same window: the right-click menu, Shift+J on a row,
 * and in the Bookmarks view the row menu and Details → Address. Each test goes
 * in through the control a user would use, then reads the window itself.
 */

const modal = (page) => page.locator('#app-modal .modal.bookmark-qr-modal');

async function dashboardWithSelectedRow(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.evaluate(() =>
        !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark()), { timeout: 10_000 }).toBe(true);
    return page.evaluate(() => {
        const b = window.dashboardInstance.keyboardNavigation.getSelectedBookmark();
        return { name: b.name, url: b.url };
    });
}

/** The window shows this bookmark: its name, its address and a drawn code. */
async function expectQrFor(page, bookmark) {
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('#modal-title')).toHaveText('QR code');
    await expect(modal(page).locator('[data-bookmark-qr-name]')).toHaveText(bookmark.name);
    await expect(modal(page).locator('[data-bookmark-qr-url]')).toHaveText(bookmark.url);
    const code = modal(page).locator('svg.bookmark-qr-code');
    await expect(code).toHaveCount(1);
    // A version-n symbol is 17 + 4n modules, plus four of quiet zone each side.
    const size = Number((await code.getAttribute('viewBox') || '').split(' ')[2]);
    expect((size - 8 - 17) % 4).toBe(0);
    expect(size).toBeGreaterThanOrEqual(21 + 8);
    // The code holds this address and nothing else: the encoder, given the
    // bookmark's URL here, draws exactly the modules the window drew.
    const drawn = await code.locator('path').getAttribute('d');
    const expected = await page.evaluate((url) => {
        const qrcode = window.qrcode;
        qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
        const qr = qrcode(0, 'M');
        qr.addData(url, 'Byte');
        qr.make();
        let d = '';
        for (let r = 0; r < qr.getModuleCount(); r++) {
            for (let c = 0; c < qr.getModuleCount(); c++) {
                if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
            }
        }
        return d;
    }, bookmark.url);
    expect(drawn).toBe(expected);
}

test.describe('bookmark QR code', () => {
    test('the right-click menu opens it, and Copy URL copies the address', async ({ page }) => {
        const bookmark = await dashboardWithSelectedRow(page);
        // Fetched when a code is first drawn, not with the page.
        expect(await page.evaluate(() => typeof window.qrcode)).toBe('undefined');
        await page.evaluate(() => {
            window.__copied = [];
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve(); } },
            });
        });

        await page.locator('.bookmark-link.keyboard-selected, .bookmark-link').first().click({ button: 'right' });
        await page.locator('#bookmark-context-menu [data-action="qr"]').click();
        await expectQrFor(page, bookmark);

        await modal(page).locator('[data-bookmark-qr-copy]').click();
        await expect(modal(page)).toBeHidden();
        expect(await page.evaluate(() => window.__copied)).toEqual([bookmark.url]);
    });

    test('Shift+J opens it for the selected row, and Escape closes it', async ({ page }) => {
        const bookmark = await dashboardWithSelectedRow(page);
        await page.keyboard.press('Shift+J');
        await expectQrFor(page, bookmark);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeHidden();
    });

    test('the Bookmarks view offers it in Details → Address and in the row menu', async ({ page }) => {
        const { bookmarks } = await openBookmarksWithHealth(page);
        const target = bookmarks[1];
        const row = page.locator('#config-bm-list .config-bm-row', { has: page.locator('.config-bm-title', { hasText: target.name }) }).first();
        const drawer = page.locator('.lvs-drawer-host[data-lvs-drawer="library"] .lvs-drawer');

        await row.click();
        await drawer.locator('[data-bm-tab-panel="details"]').click();
        const address = drawer.locator('[data-bm-acc="address"]');
        await address.locator('summary').click();
        await address.locator('[data-bm-panel-action="qr"]').click();
        await expectQrFor(page, target);
        await page.keyboard.press('Escape');
        await expect(modal(page)).toBeHidden();

        await row.click({ button: 'right' });
        await page.locator('#config-bm-context-menu [data-action="qr"]').click();
        await expectQrFor(page, target);
        // The header's Esc x closes it too.
        await modal(page).locator('.bookmark-qr-modal-close').click();
        await expect(modal(page)).toBeHidden();
    });
});

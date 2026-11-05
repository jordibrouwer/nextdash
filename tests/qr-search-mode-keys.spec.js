// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays, markWhatsNewSeen } = require('./e2e-helpers');

/**
 * Shift+Q is the QR code of the selected bookmark (it was Shift+J); Shift+X
 * switches the search mode (it was Shift+Q) and, with the cursor on a row, still
 * ticks the whole category. The old keys work for a couple of releases.
 */
async function load(page, { selectRow = false } = {}) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForSelector('.bookmark-link', { timeout: 15_000 });
    await page.evaluate(() => {
        document.activeElement?.blur();
        // The mode is a stored setting: do not let a probe write it to ./data.
        window.dashboardInstance.saveSettings = async () => true;
        window.__aliasToasts = [];
        window.dashboardInstance.showNotification = (m) => { window.__aliasToasts.push(String(m)); };
    });
    if (selectRow) {
        await page.keyboard.press('ArrowDown');
        await expect.poll(() => page.evaluate(() =>
            !!window.dashboardInstance.keyboardNavigation.getSelectedBookmark())).toBe(true);
    }
}
const mode = (page) => page.evaluate(() => !!window.dashboardInstance.settings.interleaveMode);
const qr = (page) => page.locator('#app-modal .modal.bookmark-qr-modal');
const toasts = (page) => page.evaluate(() => window.__aliasToasts);

test('Shift+Q with a row selected opens the QR code', async ({ page }) => {
    await load(page, { selectRow: true });
    const before = await mode(page);
    await page.keyboard.press('Shift+Q');
    await expect(qr(page)).toBeVisible();
    expect(await mode(page)).toBe(before);
});

test('Shift+J with a row selected still opens it and names Shift + Q', async ({ page }) => {
    await load(page, { selectRow: true });
    await page.keyboard.press('Shift+J');
    await expect(qr(page)).toBeVisible();
    expect((await toasts(page)).some((m) => m.includes('Shift + J') && m.includes('Shift + Q'))).toBe(true);
});

test('Shift+X with no row switches the search mode', async ({ page }) => {
    await load(page);
    const before = await mode(page);
    await page.keyboard.press('Shift+X');
    await expect.poll(() => mode(page)).toBe(!before);
    await expect(qr(page)).toHaveCount(0);
});

test('Shift+Q with no row still switches the mode and names Shift + X', async ({ page }) => {
    await load(page);
    const before = await mode(page);
    await page.keyboard.press('Shift+Q');
    await expect.poll(() => mode(page)).toBe(!before);
    expect((await toasts(page)).some((m) => m.includes('Shift + Q') && m.includes('Shift + X'))).toBe(true);
});

test('Shift+X with a row selected ticks the whole category, not the mode', async ({ page }) => {
    await load(page, { selectRow: true });
    const before = await mode(page);
    await page.keyboard.press('Shift+X');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.multiSelect.isActive())).toBe(true);
    expect(await mode(page)).toBe(before);
});

test('Shift+X typed in a text field types an X', async ({ page }) => {
    await load(page);
    const before = await mode(page);
    await page.evaluate(() => {
        const input = document.createElement('input');
        input.id = 'probe-field';
        document.body.appendChild(input);
        input.focus();
    });
    await page.keyboard.press('Shift+X');
    await expect(page.locator('#probe-field')).toHaveValue('X');
    expect(await mode(page)).toBe(before);
});

test('Shift+Q on a tag-view row opens the QR code, not the search mode', async ({ page }) => {
    await load(page);
    const before = await mode(page);
    await page.keyboard.press('Shift+T');
    await expect.poll(() => page.evaluate(() => window.dashboardInstance.activeView)).toBe('tags');
    await page.waitForSelector('.tag-view-row', { timeout: 15_000 });
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.tag-view-row.is-focused')).toHaveCount(1);
    await page.keyboard.press('Shift+Q');
    await expect(qr(page)).toBeVisible();
    expect(await mode(page)).toBe(before);
});

test('Shift+X in the Containers view leaves the search mode alone', async ({ page }) => {
    const { mockDocker } = require('./helpers/docker-mock');
    await mockDocker(page);
    await markWhatsNewSeen(page);
    await page.goto('/#docker');
    await expect(page.locator('[data-docker-row]')).toHaveCount(4);
    await page.evaluate(() => {
        window.dashboardInstance.saveSettings = async () => true;
        document.activeElement?.blur();
    });
    const before = await mode(page);
    await page.keyboard.press('Shift+X');
    await page.waitForTimeout(300);
    expect(await mode(page)).toBe(before);
});

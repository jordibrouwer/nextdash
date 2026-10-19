// @ts-check
const { test, expect } = require('./fixtures');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Escape while a multi-select popover is open.
 *
 * The grid's keydown handler bows out for the action popovers, by id. Three
 * are missing from that list -- the two multi-select ones and the date
 * popover -- so on Escape the grid handler also ran and, seeing a live
 * selection, cleared it. Closing the Tags popover threw away the twenty rows
 * you had picked to tag.
 */
async function openDashboard(page) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/');
    await page.waitForSelector('#dashboard-layout', { timeout: 20_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.waitForFunction(() => window.dashboardInstance?._bookmarksReady === true, null, { timeout: 20_000 });
}

/** Tick two rows through the multi-select module, the way the x key does. */
async function selectTwoRows(page) {
    await page.evaluate(() => {
        const ms = window.dashboardInstance.multiSelect;
        [...document.querySelectorAll('.bookmark-link[data-bookmark-index]')]
            .slice(0, 2).forEach((row) => ms.toggleRow(row));
    });
    expect(await page.evaluate(() => window.dashboardInstance.multiSelect.count())).toBe(2);
    await expect(page.locator('.multi-select-btn').first()).toBeVisible({ timeout: 5000 });
}

test.describe('Escape with a multi-select popover open', () => {
    for (const { name, button, popover } of [
        { name: 'Tags', button: '.multi-select-tags-btn', popover: '#multi-select-tags-popover' },
        { name: 'Checking', button: '.multi-select-check-btn', popover: '#multi-select-check-popover' },
    ]) {
        test(`closes the ${name} popover and keeps the selection`, async ({ page }) => {
            await openDashboard(page);
            await selectTwoRows(page);

            await page.click(button);
            await expect(page.locator(popover)).toHaveCount(1, { timeout: 5000 });

            await page.keyboard.press('Escape');
            await expect(page.locator(popover)).toHaveCount(0, { timeout: 5000 });

            // One Escape closes one thing. The rows you picked are still picked.
            expect(await page.evaluate(() => window.dashboardInstance.multiSelect.isActive())).toBe(true);
        });
    }
});

/*
 * Clicking away from a popover closes it. The Checking one was the only
 * action popover that never bound the shared outside-click close, so it sat
 * over the page until you found Escape, and the click meant to dismiss it
 * landed on whatever was underneath.
 */
test.describe('clicking away from a multi-select popover', () => {
    for (const { name, button, popover } of [
        { name: 'Checking', button: '.multi-select-check-btn', popover: '#multi-select-check-popover' },
        { name: 'Tags', button: '.multi-select-tags-btn', popover: '#multi-select-tags-popover' },
    ]) {
        test(`closes the ${name} popover`, async ({ page }) => {
            await openDashboard(page);
            await selectTwoRows(page);

            await page.click(button);
            await expect(page.locator(popover)).toHaveCount(1, { timeout: 5000 });

            // Well away from both the popover and the button that opened it.
            await page.mouse.click(700, 8);
            await expect(page.locator(popover)).toHaveCount(0, { timeout: 5000 });
        });
    }
});

/*
 * A popover answers from the moment it is on screen.
 *
 * Its outside-click and Escape handlers were bound on a 0ms timer, to skip the
 * gesture that opened it. Browsers run input before timers, so a click or key
 * arriving a few milliseconds after the popover appeared was handled while
 * nothing listened, and the popover stayed open. That showed as a test that
 * failed one run in ten, and as a popover that ignored a quick click-away.
 * Here the click and the key follow the opening in the same task, which is
 * the worst case of that.
 */
test.describe('a popover that has only just opened', () => {
    test('closes on a click away straight after opening', async ({ page }) => {
        await openDashboard(page);
        await selectTwoRows(page);
        await page.evaluate(() => {
            document.querySelector('.multi-select-tags-btn').click();
            document.querySelector('.header-top, body').click();
        });
        await expect(page.locator('#multi-select-tags-popover')).toHaveCount(0, { timeout: 2000 });
    });

    test('closes on Escape straight after opening', async ({ page }) => {
        await openDashboard(page);
        await selectTwoRows(page);
        await page.evaluate(() => {
            document.querySelector('.multi-select-tags-btn').click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        });
        await expect(page.locator('#multi-select-tags-popover')).toHaveCount(0, { timeout: 2000 });
    });

    test('the click that opens it does not close it again', async ({ page }) => {
        await openDashboard(page);
        await selectTwoRows(page);
        await page.click('.multi-select-tags-btn');
        await page.waitForTimeout(200);
        await expect(page.locator('#multi-select-tags-popover')).toHaveCount(1);
    });
});

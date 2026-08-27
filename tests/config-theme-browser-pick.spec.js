// @ts-check
const { test, expect } = require('./fixtures');
const { markWhatsNewSeen, dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * Choosing a theme in the browser has to leave that theme on screen.
 *
 * The browser shows a theme on the real dashboard as you move over the cards,
 * which is the point of it. Choosing one is not instant -- it posts the
 * settings and paints afterwards -- and the modal was torn down without
 * waiting. Focus and the pointer land somewhere during that teardown, and
 * whichever card they landed on fired its own preview, which arrived while the
 * choice was still in flight and won. Choose Moss & Stone, get Marigold Dusk,
 * until the page was reloaded.
 *
 * Underneath it a second one: the old theme's class stayed on the body beside
 * the new one, so every rule written against the theme you had just left kept
 * matching.
 */
const PICK = 'moss-stone-dark';
const HOVER = 'marigold-dusk-dark';

async function openBrowser(page) {
    await markWhatsNewSeen(page);
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    // Quickstart's background favicon sweep reopens Overview when it finishes,
    // taking whatever panel is on screen with it.
    await page.waitForTimeout(6000);
    await page.evaluate(async () => { await window.dashboardInstance.config.openConfigView('appearance'); });
    await page.locator('[data-appearance-action="browse-themes"]').first().click();
    await expect(page.locator(`[data-theme-id="${PICK}"]`).first()).toBeAttached();
    /*
     * Wait until the colour document has landed, and it is not politeness.
     *
     * Loading it publishes window.CustomThemeIds, and the loader's class
     * cleanup asks `if (CustomThemeIds && Array.isArray(...))` -- which an
     * empty array satisfies, so from that moment the sweep that would have
     * taken the old built-in theme's class off never runs again. Picking
     * before it lands takes the other branch and passes for the wrong reason.
     */
    await page.waitForFunction(() => Array.isArray(window.CustomThemeIds), null, { timeout: 15_000 });
}

/** The background a theme is supposed to paint, from the app's own palette. */
const backgroundOf = (page, id) => page.evaluate(
    (theme) => window.dashboardInstance.config.themeById(theme)?.backgroundPrimary || null, id);

const onScreen = (page) => page.evaluate(() => ({
    background: getComputedStyle(document.documentElement)
        .getPropertyValue('--background-primary').trim(),
    themeClasses: [...document.body.classList]
        .filter((c) => c.endsWith('-dark') || c.endsWith('-light')),
    stored: window.dashboardInstance.settings.theme,
}));

test.describe('choosing a theme in the browser', () => {
    test('leaves the chosen theme on screen, not the one last previewed', async ({ page }) => {
        await openBrowser(page);
        const [wanted, previewed] = await Promise.all([
            backgroundOf(page, PICK), backgroundOf(page, HOVER)]);
        expect(wanted).toBeTruthy();
        expect(previewed).not.toBe(wanted);

        // Move over another card first, so there is a live preview to lose to.
        const other = page.locator(`[data-theme-id="${HOVER}"]`).first();
        await other.scrollIntoViewIfNeeded();
        await other.hover();
        await expect.poll(async () => (await onScreen(page)).background).toBe(previewed);

        const card = page.locator(`[data-theme-id="${PICK}"]`).first();
        await card.scrollIntoViewIfNeeded();
        await card.click();

        await expect.poll(async () => (await onScreen(page)).stored).toBe(PICK);
        // The colours, and not after a reload: the whole failure was that the
        // stored value was right all along while the screen was not.
        await expect.poll(async () => (await onScreen(page)).background).toBe(wanted);
    });

    test('leaves one theme class on the body, not two', async ({ page }) => {
        await openBrowser(page);
        const card = page.locator(`[data-theme-id="${PICK}"]`).first();
        await card.scrollIntoViewIfNeeded();
        await card.click();

        await expect.poll(async () => (await onScreen(page)).stored).toBe(PICK);
        await expect.poll(async () => (await onScreen(page)).themeClasses).toEqual([PICK]);
    });

    test('and it survives a reload, as it always did', async ({ page }) => {
        await openBrowser(page);
        const wanted = await backgroundOf(page, PICK);
        const card = page.locator(`[data-theme-id="${PICK}"]`).first();
        await card.scrollIntoViewIfNeeded();
        await card.click();
        await expect.poll(async () => (await onScreen(page)).stored).toBe(PICK);

        await page.reload({ waitUntil: 'networkidle' });
        await expect.poll(async () => (await onScreen(page)).background).toBe(wanted);
        await expect.poll(async () => (await onScreen(page)).themeClasses).toEqual([PICK]);
    });
});

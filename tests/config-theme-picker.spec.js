// @ts-check
const { test, expect } = require('@playwright/test');
const { dismissOnboardingIfPresent, dismissBlockingOverlays } = require('./e2e-helpers');

/**
 * The theme picker on Appearance → Theme.
 *
 * It is a listbox rather than a <select> for one reason: moving through the
 * list has to preview each theme on the dashboard behind the config view, and
 * a native select cannot do that. While its popup is open the browser owns the
 * keyboard, fires no change or input event, and leaves `value` on the old
 * option — there is no moment at which to run a preview. These tests pin the
 * behaviour that costs us: preview while moving, store only on choosing, and
 * put the old theme back on every way out that is not a choice.
 */
async function openPicker(page) {
    await page.goto('/');
    await page.waitForFunction(() => window.dashboardInstance?.pages?.length > 0, null, { timeout: 15_000 });
    await dismissOnboardingIfPresent(page);
    await dismissBlockingOverlays(page);
    await page.evaluate(() => window.dashboardInstance.config.openConfigView('appearance'));
    await expect(page.locator('[data-theme-picker-button]')).toBeVisible();
}

/** What is painted right now, which is what a preview has to change. */
const paintedBg = (page) => page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background-primary').trim());

/** What is stored, which browsing must not change. */
const stored = (page) => page.evaluate(() => window.dashboardInstance.settings.theme);

test.describe('Appearance → theme picker', () => {
    // These tests commit a theme, and the server is shared across the run. Put
    // the stored theme back so a later spec does not inherit whichever family
    // this file happened to land on — config-random-theme.spec.js clicks Quick
    // mode and expects the theme to change, which a leftover can make a no-op.
    let original = null;
    test.beforeEach(async ({ page }) => {
        if (original === null) {
            const res = await page.request.get('/api/settings');
            original = res.ok() ? (await res.json()).theme ?? 'dark' : 'dark';
        }
    });
    test.afterEach(async ({ page }) => {
        if (original !== null) {
            await page.request.post('/api/settings', { data: { theme: original } });
        }
    });

    test('moving through the list previews without storing anything', async ({ page }) => {
        await openPicker(page);
        const before = { bg: await paintedBg(page), theme: await stored(page) };

        await page.locator('[data-theme-picker-button]').click();
        await expect(page.locator('[data-theme-picker-list]')).toBeVisible();

        const painted = [];
        for (let i = 0; i < 4; i++) {
            await page.keyboard.press('ArrowDown');
            painted.push(await paintedBg(page));
        }

        // Every step repaints. Were this still a native select there would be
        // no event to hang this on and all four would read the same.
        expect(new Set(painted).size).toBe(4);
        // The list opens on the theme already applied, so the first step can
        // legitimately still paint the starting colour — the last cannot.
        expect(painted[painted.length - 1]).not.toBe(before.bg);
        // Browsing is not choosing.
        expect(await stored(page)).toBe(before.theme);
    });

    test('Escape puts the previous theme back and keeps config open', async ({ page }) => {
        await openPicker(page);
        const before = { bg: await paintedBg(page), theme: await stored(page) };

        await page.locator('[data-theme-picker-button]').click();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        expect(await paintedBg(page)).not.toBe(before.bg);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-theme-picker-list]')).toBeHidden();

        await expect.poll(() => paintedBg(page)).toBe(before.bg);
        expect(await stored(page)).toBe(before.theme);
        // Config's own Escape handler runs on document in the capture phase, so
        // it sees this key first; without its guard for an open picker, Escape
        // closed the whole view instead of just the list.
        await expect(page.locator('[data-theme-picker-button]')).toBeVisible();
    });

    test('clicking away cancels rather than keeping the previewed theme', async ({ page }) => {
        await openPicker(page);
        const before = { bg: await paintedBg(page), theme: await stored(page) };

        await page.locator('[data-theme-picker-button]').click();
        await page.keyboard.press('ArrowDown');
        await page.locator('.config-panel-title').first().click();

        await expect(page.locator('[data-theme-picker-list]')).toBeHidden();
        await expect.poll(() => paintedBg(page)).toBe(before.bg);
        expect(await stored(page)).toBe(before.theme);
    });

    test('choosing an option stores it and drops the preview stylesheet', async ({ page }) => {
        await openPicker(page);
        const before = await stored(page);

        await page.locator('[data-theme-picker-button]').click();
        const option = page.locator('[data-theme-option]').nth(3);
        const id = await option.getAttribute('data-theme-option');
        const label = (await option.textContent() || '').trim();
        await option.click();

        await expect.poll(() => stored(page)).toBe(id);
        expect(id).not.toBe(before);
        await expect(page.locator('[data-theme-picker-list]')).toBeHidden();
        expect((await page.locator('[data-theme-picker-label]').textContent() || '').trim()).toBe(label);

        // The preview block outranks /api/theme.css, so leaving it behind would
        // keep the dashboard on preview colours from a stylesheet nobody owns.
        expect(await page.evaluate(() => !document.getElementById('config-theme-preview'))).toBe(true);
    });

    test('Quick mode switches halves without losing the chosen theme', async ({ page }) => {
        await openPicker(page);

        await page.locator('[data-theme-picker-button]').click();
        const option = page.locator('[data-theme-option]').nth(5);
        const picked = await option.getAttribute('data-theme-option');
        await option.click();
        await expect.poll(() => stored(page)).toBe(picked);

        const family = String(picked).replace(/-(dark|light)$/, '');
        const other = `${family}-${picked.endsWith('-dark') ? 'light' : 'dark'}`;

        // Quick mode used to set the bare ids `light`/`dark`, which are a
        // specific legacy pair rather than a mode — so this threw the choice
        // away and left the picker reading "Old Default".
        await page.locator(`[data-appearance-theme="${other.endsWith('-dark') ? 'dark' : 'light'}"]`).click();
        await expect.poll(() => stored(page)).toBe(other);
        // The picker follows: same family, other half — not "Old Default".
        await expect.poll(async () => (await page.locator('[data-theme-picker-label]').textContent() || '').trim())
            .toBe(await page.evaluate((id) => window.dashboardInstance.config.themeDisplayName(
                id, window.dashboardInstance.config._themeList?.[id] || ''), other));

        // And the button for the half now showing is the one marked active.
        const activeButtons = await page.evaluate(() => [...document.querySelectorAll('[data-appearance-theme]')]
            .filter((b) => b.classList.contains('is-active'))
            .map((b) => b.getAttribute('data-appearance-theme')));
        expect(activeButtons).toEqual([other.endsWith('-dark') ? 'dark' : 'light']);
    });

    test('the list is wide enough for the longest theme name', async ({ page }) => {
        await openPicker(page);
        await page.locator('[data-theme-picker-button]').click();
        await expect(page.locator('[data-theme-picker-list]')).toBeVisible();

        const fit = await page.evaluate(() => {
            const list = document.querySelector('[data-theme-picker-list]');
            const panel = document.getElementById('config-section-panel');
            const options = [...list.querySelectorAll('[data-theme-option]')];
            return {
                clipped: options.filter((o) => o.scrollWidth > o.clientWidth + 1).length,
                overflowsPanel: list.getBoundingClientRect().right > panel.getBoundingClientRect().right + 1,
            };
        });
        // Pinning the list to both of the button's edges squeezed it to the
        // button's width and cut every name off.
        expect(fit.clipped).toBe(0);
        expect(fit.overflowsPanel).toBe(false);
    });
});
